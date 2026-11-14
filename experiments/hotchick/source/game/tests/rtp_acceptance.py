"""Exact effective-wager RTP proof and native production-settlement checks."""
from __future__ import annotations

import argparse
from fractions import Fraction
import itertools
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from acceptance import frame, padded


RANGES = {"small": (2, 6), "medium": (8, 18), "large": (100, 240)}
WEAPONS = {"like": (1, 1), "flower": (6, 6), "rocket": (15, 5)}
TARGET_RTP = Fraction(98, 100)
LARGE_CAPTURE_DENOMINATOR = 50 * sum(RANGES["large"])
assert LARGE_CAPTURE_DENOMINATOR == 17000
assert Fraction(98, LARGE_CAPTURE_DENOMINATOR) == Fraction(98, 4250) / 4


def target_moments(cost, count, tier):
    low, high = RANGES[tier]
    probability = Fraction(98, 50 * (low + high))
    first = second = Fraction(0)
    for multiplier in range(low, high + 1):
        quotient, remainder = divmod(cost * multiplier, count)
        first += quotient + Fraction(remainder, count)
        second += quotient * quotient + Fraction((2 * quotient + 1) * remainder, count)
    return probability * first / (high - low + 1), probability * second / (high - low + 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk", required=True, type=Path)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    project = args.project.resolve()
    source = (project / "scripts/main.luau").read_text(encoding="utf-8")
    config = json.loads((project / "project.unone.json").read_text(encoding="utf-8-sig"))
    assert "local RTP_NUMERATOR = 98" in source and "local RTP_DENOMINATOR = 100" in source
    for name, expected in (("MIN_MULTIPLIER", {tier: limits[0] for tier, limits in RANGES.items()}),
                           ("MAX_MULTIPLIER", {tier: limits[1] for tier, limits in RANGES.items()}),
                           ("COSTS", {weapon: limits[0] for weapon, limits in WEAPONS.items()})):
        declaration = re.search(r"local " + name + r": [^\n]+ = \{([^}]+)\}", source)
        assert declaration is not None, name
        actual = {key: int(value) for key, value in re.findall(r"(\w+)\s*=\s*(\d+)", declaration[1])}
        assert actual == expected, (name, actual)
    assert 'attack.bet * multiplier * (if attack.weapon == "rocket" then 3 else 1)' not in source
    proof_cases = 0
    rounding_cases = 0
    for bet in (1, 5, 10, 20, 50):
        for factor, limit in WEAPONS.values():
            cost = bet * factor
            for count in range(1, limit + 1):
                moments = {tier: target_moments(cost, count, tier) for tier in RANGES}
                for tiers in itertools.product(RANGES, repeat=count):
                    assert sum(moments[tier][0] for tier in tiers) == cost * TARGET_RTP
                    proof_cases += 1
                for low, high in RANGES.values():
                    for multiplier in range(low, high + 1):
                        quotient, remainder = divmod(cost * multiplier, count)
                        sampled = sum(quotient + int(roll <= remainder) for roll in range(1, count + 1))
                        assert Fraction(sampled, count) == Fraction(cost * multiplier, count)
                        rounding_cases += 1

    runs = 0
    checks = []
    monte_carlo = []
    with tempfile.TemporaryDirectory(prefix="hotchick-rtp-") as scratch:
        root = Path(scratch)
        input_file = root / "input.json"

        def fixture(name, *, counts=(0, 0, 0), driver=None, capture_numerator=None):
            directory = root / name
            directory.mkdir()
            text = source
            for tier, total, count in zip(RANGES, (18, 6, 3), counts):
                line = f'for _ = 1, {total} do table.insert(targets, createTarget(api, "{tier}", true)) end'
                assert text.count(line) == 1
                text = text.replace(line, line.replace(f"1, {total}", f"1, {count}"))
            text = text.replace("local lane = randomRange(api, -2.65, 2.85)", "local lane = 0")
            text = text.replace("speed=randomRange(api, 0.30, 0.65)", "speed=0")
            text = text.replace("local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4", "local x = if initial then 0 else -direction * 9.4")
            if capture_numerator is not None:
                text = text.replace("local RTP_NUMERATOR = 98", f"local RTP_NUMERATOR = {capture_numerator}")
            if driver is not None:
                text = text[:text.index("function Game.start(api: EngineApi)")] + driver + "\nreturn Game\n"
            (directory / "main.luau").write_text(text, encoding="utf-8")
            (directory / "project.unone.json").write_text(json.dumps(dict(config, entry_script="main.luau", main_scene="main.scene.json", test_files=[])), encoding="utf-8")
            shutil.copyfile(project / "scenes/main.scene.json", directory / "main.scene.json")
            return directory

        def run(board, sequence=(), frames=1, observation="game", seed=72):
            nonlocal runs
            input_file.write_text(json.dumps(padded(list(sequence), frames)), encoding="utf-8")
            result = subprocess.run([str(args.sdk.resolve()), "run", "--project", str(board), "--frames", str(frames), "--seed", str(seed), "--input-sequence", str(input_file), "--json"], capture_output=True, text=True, encoding="utf-8")
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"], payload.get("diagnostics", result.stderr)
            runs += 1
            value = payload["value"]["world"]["observations"][observation]
            if observation == "game":
                assert value["balance"] == 10000 - value["stats"]["spent"] - value["reservedWager"] + value["stats"]["won"]
                assert value["balance"] == value["displayBalance"] + value["pendingWin"]
                assert value["stats"]["won"] == value["collectedWin"] + value["pendingWin"]
                assert value["cards"]["spentTotal"] == value["stats"]["spent"]
            return value

        empty = fixture("empty")
        shot = [frame({"Fire": True})]
        reserved = run(empty, shot, frames=2)
        assert reserved["reservedWager"] == 10 and reserved["stats"]["spent"] == 0
        assert reserved["cards"]["progress"] == 0
        refunded = run(empty, shot, frames=2200)
        assert refunded["balance"] == 10000 and refunded["reservedWager"] == 0
        assert refunded["stats"]["spent"] == refunded["stats"]["won"] == 0
        assert refunded["wagerLedger"]["refunded"] == 10 and refunded["wagerLedger"]["refundedRounds"] == 1
        assert refunded["cards"]["progress"] == refunded["cards"]["drawsEarned"] == 0
        checks.append("normal-empty-projectile-reserves-once-refunds-once-without-card-progress")

        paused_sequence = padded(shot, 10) + [frame({"PlatformPause": True})]
        frozen = run(empty, paused_sequence, frames=2400)
        assert frozen["reservedWager"] == 10 and frozen["wagerLedger"]["refunded"] == 0
        assert frozen["platform"]["paused"] and frozen["time"] < 1
        resumed = padded(paused_sequence, 2400) + [frame({"PlatformResume": True})]
        released = run(empty, resumed, frames=4600)
        assert released["balance"] == 10000 and released["reservedWager"] == 0
        assert released["wagerLedger"]["refundedRounds"] == 1
        reset_sequence = padded(shot, 10) + [frame({"DemoReset": True})]
        cleared = run(empty, reset_sequence, frames=12)
        assert cleared["balance"] == 10000 and cleared["reservedWager"] == 0
        assert cleared["wagerLedger"]["refunded"] == cleared["stats"]["spent"] == 0
        checks.append("pause-holds-inflight-reservation-and-reset-clears-it-with-no-late-refund")

        def settlement_driver(setup):
            return "function Game.start(api: EngineApi)\n time=0\n reset(api)\n" + setup + "\n publish(api)\nend\nfunction Game.update(api: EngineApi,dt: number)\n publish(api)\nend\n"

        stale = fixture("stale", counts=(1, 0, 0), driver=settlement_driver('weapon="rocket"\n shoot(api,targets[1])\n local attack=attacks[1]\n attack.hitTargetIds={targets[1].id,targets[1].id,"missing"}\n targets[1].state="caught"\n resolveAttack(api,attack)\n resolveAttack(api,attack)'))
        stale_state = run(stale)
        assert stale_state["balance"] == 10000 and stale_state["wagerLedger"]["refunded"] == 150
        assert stale_state["wagerLedger"]["refundedRounds"] == 1 and stale_state["cards"]["progress"] == 0
        checks.append("already-caught-and-missing-hits-refund-the-whole-round-exactly-once")

        partial = fixture("partial", counts=(3, 0, 0), capture_numerator=4250, driver=settlement_driver('weapon="rocket"\n shoot(api,targets[1])\n local attack=attacks[1]\n attack.hitTargetIds={targets[1].id,targets[1].id,targets[2].id,targets[3].id,"missing"}\n targets[3].state="caught"\n resolveAttack(api,attack)\n resolveAttack(api,attack)'))
        part = run(partial)
        assert part["lastRound"]["validHitCount"] == 2 and len(part["lastRound"]["settledTargetIds"]) == 2
        assert part["stats"]["spent"] == part["cards"]["progress"] == 150 and part["reservedWager"] == 0
        assert part["stats"]["captures"] == 2 and 300 <= part["stats"]["won"] <= 900
        assert part["displayBalance"] == 9850 and part["pendingWin"] == part["stats"]["won"]
        checks.append("partial-unique-hit-snapshot-shares-whole-rocket-cost-without-duplicate-charge-or-extra-scale")

        rounding_driver = '''function Game.start(api: EngineApi)
 local total=0
 for remainderRoll=1,5 do
  local values={1,2,remainderRoll}
  local calls=0
  local fake={random={nextInt=function(low,high) calls+=1;return values[calls] end}}
  local captured,award,multiplier=rollTargetAward(fake,"small",6,5)
  assert(captured and multiplier==2 and calls==3)
  total+=award
 end
 api.observation.set("audit",{sum=total,denominator=captureDenominator("small")})
end
function Game.update(api: EngineApi,dt: number) end'''
        rounding = run(fixture("rounding", driver=rounding_driver), observation="audit")
        assert rounding == {"sum": 12, "denominator": 400}
        checks.append("production-award-helper-enumerated-remainder-rolls-have-exact-fractional-mean")

        scenarios = [(1, ("small",)), (50, ("medium",)), (10, ("large",)), (6, ("small",) * 6), (60, ("small", "medium", "large", "small", "medium")), (300, ("large",)), (15, ("small", "medium", "large", "small", "large")), (150, ("medium", "large")), (750, ("small",))]
        for index, (cost, tiers) in enumerate(scenarios):
            encoded = "{" + ",".join(json.dumps(tier) for tier in tiers) + "}"
            driver = f'''local auditRounds=0
local auditAward=0
local auditCaptures=0
local auditTiers={encoded}
function Game.start(api: EngineApi) end
function Game.update(api: EngineApi,dt: number)
 for _=1,200 do
  for _,tier in auditTiers do
   local captured,award=rollTargetAward(api,tier,{cost},#auditTiers)
   auditAward+=award
   if captured then auditCaptures+=1 end
  end
  auditRounds+=1
 end
 api.observation.set("audit",{{rounds=auditRounds,award=auditAward,captures=auditCaptures}})
end'''
            sample = run(fixture(f"sample-{index}", driver=driver), frames=500, observation="audit", seed=100 + index)
            count = sample["rounds"]
            assert count == 100000
            variance = sum(second - mean * mean for mean, second in (target_moments(cost, len(tiers), tier) for tier in tiers))
            standard_error = math.sqrt(float(variance) / count) / cost
            measured = sample["award"] / (count * cost)
            assert abs(measured - float(TARGET_RTP)) <= 7 * standard_error, (index, measured, standard_error)
            monte_carlo.append({"cost": cost, "tiers": tiers, "rounds": count, "measured": measured, "standard_error": standard_error, "sigma_bound": 7})
        checks.append("actual-Luau-award-helper-900000-rounds-with-exact-variance-derived-seven-sigma-bounds")

    print(json.dumps({"passed": True, "native_runs": runs, "exact_composition_cases": proof_cases, "exact_rounding_cases": rounding_cases, "rtp": "49/50", "multiplier_ranges": RANGES, "large_capture_denominator": LARGE_CAPTURE_DENOMINATOR, "large_capture_rate": str(Fraction(98, LARGE_CAPTURE_DENOMINATOR)), "checks": checks, "monte_carlo": monte_carlo}, indent=2))


if __name__ == "__main__":
    main()
