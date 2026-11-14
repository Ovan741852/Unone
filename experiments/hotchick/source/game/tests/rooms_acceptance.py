"""Native shared-field, room transition and eligible-target settlement checks."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

from acceptance import frame, padded
from remote_settlement_acceptance import packet, profile_packet


def parameters(seed, slot, generation):
    modulus = 2147483647
    state = (seed + slot * 104729 + generation * 13007) % modulus
    if state < 1:
        state += 2147483646
    draws = []
    for _ in range(5):
        state = state * 16807 % modulus
        draws.append((state, (state - 1) / 2147483646))
    return (1 if draws[0][0] % 2 == 0 else -1, -2.65 + draws[1][1] * 5.5,
            draws[2][1] * math.pi * 2, ("original", "mugi", "jiayi", "yeseul", "eunbi")[int(draws[3][1] * 5)],
            40000 + slot % 7 * 4000, draws[4][1])


def initial_slots(seed):
    return [(1, -math.floor(parameters(seed, slot, 1)[4] * parameters(seed, slot, 1)[5])) for slot in range(1, 28)]


def room_packet(serial, kind=0, *, epoch=1, seed=12345, elapsed=1000, revision=1, seat=2, slots=None, players=(), gate=False):
    actions = {"HRReady": True}
    if gate:
        actions["RoomSwitchGate"] = True
    fields = [("HRPacketId", serial, 31), ("HRKind", kind, 2), ("HREpoch", epoch, 31)]
    if kind in (0, 1):
        fields += [("HRSeed", seed, 31), ("HRElapsedMs", int(elapsed), 40), ("HRRevision", revision, 31), ("HRSelfSeat", seat, 3)]
        for index, (generation, born) in enumerate(slots or initial_slots(seed), 1):
            fields += [(f"HRGen{index}", generation, 26), (f"HRBorn{index}", born, 40)]
    for player_seat, member, shot_serial in players:
        fields += [(f"HRPresent{player_seat}", 1, 1), (f"HRMember{player_seat}", member, 31),
                   (f"HRWeapon{player_seat}", 0, 2), (f"HRBet{player_seat}", 1, 3),
                   (f"HRAimX{player_seat}", 0, 16), (f"HRAimY{player_seat}", 1000, 16),
                   (f"HRShotSerial{player_seat}", shot_serial, 31), (f"HRTarget{player_seat}", 33, 31)]
    for name, value, width in fields:
        value %= 1 << width
        for bit in range(width):
            if value & (1 << bit):
                actions[f"{name}Bit{bit}"] = True
    return actions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk", required=True, type=Path)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    project = args.project.resolve()
    checks, runs = [], 0
    with tempfile.TemporaryDirectory(prefix="hotchick-rooms-") as scratch:
        root = Path(scratch)
        shutil.copyfile(project / "scripts/main.luau", root / "main.luau")
        shutil.copyfile(project / "scenes/main.scene.json", root / "main.scene.json")
        config = json.loads((project / "project.unone.json").read_text(encoding="utf-8-sig"))
        (root / "project.unone.json").write_text(json.dumps(dict(config, entry_script="main.luau", main_scene="main.scene.json", test_files=[])), encoding="utf-8")
        inputs = root / "input.json"

        def at(sequence, index, actions):
            result = padded(list(sequence), max(len(sequence), index + 1))
            result[index] = frame(actions)
            return result

        def gated(sequence, start, end):
            result = padded(list(sequence), max(len(sequence), end))
            for index in range(start, end):
                result[index]["actions"] = dict(result[index]["actions"], RoomSwitchGate=True)
            return result

        def base(commit_at=4, profile=None):
            sequence = [frame(packet(1, 0, mode=1, balance=1000)), frame(profile or profile_packet(2, mode=1, selected_bet=1))]
            return at(gated(sequence, 0, commit_at + 1), commit_at, room_packet(1, gate=True))

        def run(sequence, frames, seed=72):
            nonlocal runs
            inputs.write_text(json.dumps(padded(sequence, frames)), encoding="utf-8")
            result = subprocess.run([str(args.sdk.resolve()), "run", "--project", str(root), "--frames", str(frames),
                                     "--seed", str(seed), "--input-sequence", str(inputs), "--json"], capture_output=True, text=True, encoding="utf-8")
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"], payload.get("diagnostics", result.stderr)
            value = payload["value"]["world"]["observations"]["game"]
            runs += 1
            assert value["balance"] == value["platform"]["funding"] - value["stats"]["spent"] - value["reservedWager"] + value["stats"]["won"]
            assert value["balance"] == value["displayBalance"] + value["pendingWin"]
            return value

        def field(value):
            return [{key: target[key] for key in ("id", "tier", "characterId", "x", "y", "state", "phase")} for target in value["targets"]]

        first = run(base(), 6)
        late_client = run(base(commit_at=104), 106, seed=991)
        assert field(first) == field(late_client)
        assert first["time"] != late_client["time"] and len(first["targets"]) == 27
        for slot, target in enumerate(first["targets"], 1):
            generation, born = initial_slots(12345)[slot - 1]
            duration = 40000 + slot % 7 * 4000
            cycles = max(0, math.floor((first["room"]["elapsedMs"] - born) / duration))
            generation, born = generation + cycles, born + cycles * duration
            direction, lane, phase, character, _, _ = parameters(12345, slot, generation)
            age = (first["room"]["elapsedMs"] - born) / 1000
            assert target["id"] == str(generation * 32 + slot) and target["characterId"] == character
            assert abs(target["x"] - (-direction * 9.4 + direction * 18.8 / (duration / 1000) * age)) < 1e-9
            assert abs(target["y"] - (lane + math.sin(age * .72 + phase) * .35)) < 1e-9
        checks.append("two clients with different process seeds and local ages share all27 canonical target identities positions and sprite phases")

        future = at(base(), 6, room_packet(2, 1, elapsed=100000000, revision=2))
        advanced = run(future, 8)
        assert all(0 < int(target["id"]) <= 2147483647 and abs(target["x"]) <= 9.5 for target in advanced["targets"])
        captured_slots = initial_slots(12345)
        captured_slots[0] = (captured_slots[0][0] + 1, 2200)
        captured = at(base(), 6, room_packet(2, 1, elapsed=1000, revision=2, slots=captured_slots))
        waiting = run(captured, 8)
        assert waiting["targets"][0]["id"] == "65" and waiting["targets"][0]["state"] == "waiting"
        emerged = run(captured, 100)
        assert emerged["targets"][0]["id"] == "65" and emerged["targets"][0]["state"] == "swimming"
        stale = at(captured, 8, room_packet(3, 1, epoch=0, seed=99, elapsed=0))
        assert field(run(stale, 10)) == field(run(captured, 10))
        checks.append("natural expiry advances in constant time; captured generations wait before respawn and old-epoch updates are inert")

        peers = at(base(), 6, room_packet(2, 2, players=((1, 101, 10),)))
        baseline_peers = run(peers, 8)
        assert len(baseline_peers["room"]["players"]) == 1 and not baseline_peers["room"]["shots"]
        peers = at(peers, 8, room_packet(3, 2, players=((1, 101, 11),)))
        for index in range(9, 14):
            peers = at(peers, index, room_packet(3, 2, players=((1, 101, 11),)))
        visual = run(peers, 14)
        assert len(visual["room"]["shots"]) == 1 and visual["stats"]["shots"] == 0
        assert visual["balance"] == 1000 and visual["cards"]["drawsUsed"] == 0
        assert not visual["shots"] and not visual["platform"]["requests"]
        checks.append("peer shots are deduplicated Luau visuals and cannot create local wagers cards or awards")

        automatic = gated(at(base(), 6, {"ToggleLock": True}), 0, 10)
        automatic = at(automatic, 8, room_packet(2, epoch=2, seed=99, seat=3, gate=True))
        held_auto = run(automatic, 10)
        assert held_auto["auto"] and held_auto["lock"] and held_auto["stats"]["shots"] == 0
        resumed_auto = run(automatic, 12)
        assert resumed_auto["auto"] and resumed_auto["stats"]["shots"] == 1
        assert resumed_auto["shots"][0]["from"]["x"] == 5.1 and resumed_auto["room"]["localShot"]["serial"] == 1
        manual = gated(base(), 0, 10)
        manual = at(manual, 8, dict(room_packet(2, epoch=2, seed=99, seat=3, gate=True), Fire=True))
        for index in range(9, 20):
            manual = at(manual, index, {"Fire": True, **({"RoomSwitchGate": True} if index < 10 else {})})
        assert run(manual, 20)["stats"]["shots"] == 0
        manual = at(manual, 21, {"Fire": True})
        assert run(manual, 23)["stats"]["shots"] == 1
        checks.append("switching retains AUTO intent and the actual seat origin without catch-up; held manual Fire requires release")

        mask = 1 << first["platform"]["clipIds"].index("eunbi-classic-large")
        counts = [2] + [0] * 13
        saved_profile = profile_packet(2, mode=1, selected_bet=1, counts=counts, used=2, earned=5, packs=3,
                                       progress=100, unlocked=mask, watched=mask, skip=True)
        saved_base = base(profile=saved_profile)
        point = max((target for target in first["targets"] if target["state"] == "swimming" and -8 < target["x"] < 7),
                    key=lambda candidate: sum((target["x"]-candidate["x"])**2+(target["y"]-candidate["y"])**2 < 2.7**2 for target in first["targets"]))
        firing = padded(saved_base, 7)
        firing[6] = frame({"WeaponRocket": True, "Fire": True}, point=(point["x"], point["y"]), down=True)
        firing = gated(firing, 7, 127)
        pending = run(firing, 120)
        assert pending["reservedWager"] == 15 and pending["platform"]["pendingRounds"] == 1
        request = pending["platform"]["requests"][0]
        assert request["roomEpoch"] == 1 and len(request["targets"]) > 1
        assert not pending["room"]["drainReady"]
        rejected_commit = at(firing, 120, room_packet(2, epoch=2, seed=99, seat=3, gate=True))
        rejected = run(rejected_commit, 121)
        assert rejected["room"]["epoch"] == 1 and rejected["room"]["error"] == "commit-not-drained"
        dead_slots = []
        elapsed = int(rejected["room"]["elapsedMs"])
        for slot, (generation, born) in enumerate(initial_slots(12345), 1):
            duration = 40000 + slot % 7 * 4000
            cycles = max(0, (elapsed-born)//duration)
            dead_slots.append((generation+cycles+1, elapsed+1200))
        transitioned = at(rejected_commit, 121, room_packet(3, 1, elapsed=elapsed, revision=2, slots=dead_slots, gate=True))
        transitioned = at(transitioned, 122, dict(packet(3, 2, mode=1, round_id=request["roundId"], balance=1000), RoomSwitchGate=True))
        transitioned = at(transitioned, 123, room_packet(4, epoch=2, seed=99, seat=3, gate=True))
        transitioned = at(transitioned, 124, dict(packet(3, 2, mode=1, round_id=request["roundId"], balance=1000), RoomSwitchGate=True))
        switched = run(transitioned, 125)
        assert switched["room"]["epoch"] == 2 and switched["room"]["cannon"]["x"] == 5.1
        assert switched["balance"] == 1000 and switched["reservedWager"] == switched["stats"]["spent"] == 0
        assert switched["wagerLedger"]["refunded"] == 15 and switched["stats"]["shots"] == 1
        assert switched["cards"] == pending["cards"] and switched["preferences"] == pending["preferences"]
        assert switched["platform"]["packetAck"] == 3 and switched["cards"]["drawsUsed"] == 2
        checks.append("room commit waits for escrow; canonical captures retain frozen wagers and all-dead refunds once before a board-only switch preserves wallet and collection")

        tier = request["targets"][0]["tier"]
        multiplier = {"small": 2, "medium": 8, "large": 100}[tier]
        award = 15 * multiplier
        n = len(request["targets"])
        accepted = dict(packet(3, 1, mode=1, round_id=request["roundId"], balance=985+award,
                               awards=(award,)+(0,)*(n-1), multipliers=(multiplier,)+(0,)*(n-1)),
                        GSActiveMaskPresent=True, GSActiveMaskBit0=True, RoomSwitchGate=True)
        partial = run(at(firing, 120, accepted), 121)
        assert not partial["platform"]["packetError"] and partial["stats"]["spent"] == 15 and partial["stats"]["won"] == award
        assert partial["pendingWin"] == award and partial["reservedWager"] == 0
        collecting = at(at(firing, 120, accepted), 121, room_packet(2, epoch=2, seed=99, seat=3, gate=True))
        collecting = gated(collecting, 122, 1103)
        blocked_award = run(collecting, 123)
        assert blocked_award["room"]["epoch"] == 1 and blocked_award["room"]["error"] == "commit-not-drained"
        assert blocked_award["pendingWin"] == award and blocked_award["stats"]["won"] == award
        collecting = at(collecting, 1100, room_packet(3, epoch=2, seed=99, seat=3, gate=True))
        completed_award = run(collecting, 1102)
        assert completed_award["room"]["epoch"] == 2 and completed_award["pendingWin"] == 0
        assert completed_award["collectedWin"] == award and completed_award["displayBalance"] == 985 + award
        assert completed_award["stats"]["won"] == award and completed_award["stats"]["spent"] == 15
        checks.append("a paid reveal and all collecting hearts finish before board commit without discarding or duplicating the accepted award")
        illegal = dict(packet(3, 1, mode=1, round_id=request["roundId"], balance=986+award,
                              awards=(award, 1)+(0,)*(n-2), multipliers=(multiplier, 2)+(0,)*(n-2)),
                       GSActiveMaskPresent=True, GSActiveMaskBit0=True, RoomSwitchGate=True)
        invalid = run(at(firing, 120, illegal), 121)
        assert invalid["platform"]["packetError"] == "inactive-target-award" and invalid["reservedWager"] == 15
        checks.append("partial authoritative eligibility preserves target order and allocates whole cost only across accepted targets; inactive awards are rejected")

    print(json.dumps({"passed": True, "native_runs": runs, "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
