"""Focused local-trial startup and seed checks; the old refill input is inert."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from acceptance import frame, padded
from remote_settlement_acceptance import packet, profile_packet


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk", required=True, type=Path)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    project = args.project.resolve()
    source = (project / "scripts/main.luau").read_text(encoding="utf-8")
    config = json.loads((project / "project.unone.json").read_text(encoding="utf-8-sig"))
    checks = []
    runs = 0

    with tempfile.TemporaryDirectory(prefix="hotchick-trial-") as scratch:
        root = Path(scratch)
        text = source
        for tier, total in (("small", 18), ("medium", 6), ("large", 3)):
            line = f'for _ = 1, {total} do table.insert(targets, createTarget(api, "{tier}", true)) end'
            assert text.count(line) == 1
            text = text.replace(line, line.replace(f"1, {total}", f"1, {int(tier == 'small')}"))
        text = text.replace("local lane = randomRange(api, -2.65, 2.85)", "local lane = 0")
        text = text.replace("speed=randomRange(api, 0.30, 0.65)", "speed=0")
        text = text.replace("local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4", "local x = 0")
        text = text.replace("local BETS = {1, 5, 10, 20, 50}", "local BETS = {1, 5, 1000, 2000, 3000}")
        text = text.replace("local RTP_NUMERATOR = 98", "local RTP_NUMERATOR = 0")
        (root / "main.luau").write_text(text, encoding="utf-8")
        (root / "project.unone.json").write_text(json.dumps(dict(
            config, entry_script="main.luau", main_scene="main.scene.json", test_files=[]
        )), encoding="utf-8")
        shutil.copyfile(project / "scenes/main.scene.json", root / "main.scene.json")
        input_file = root / "input.json"

        def at(sequence, index, actions):
            result = padded(list(sequence), max(len(sequence), index + 1))
            result[index] = frame(actions)
            return result

        def run(sequence=(), frames=1):
            nonlocal runs
            input_file.write_text(json.dumps(padded(list(sequence), frames)), encoding="utf-8")
            result = subprocess.run([
                str(args.sdk.resolve()), "run", "--project", str(root), "--frames", str(frames),
                "--seed", "72", "--input-sequence", str(input_file), "--json",
            ], capture_output=True, text=True, encoding="utf-8")
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"], payload.get("diagnostics", result.stderr)
            value = payload["value"]["world"]["observations"]["game"]
            runs += 1
            external = value["platform"]["enabled"]
            funding = value["platform"]["funding"] if external else 10000
            assert value["balance"] == funding - value["stats"]["spent"] - value["reservedWager"] + value["stats"]["won"]
            assert value["balance"] == value["displayBalance"] + value["pendingWin"]
            assert value["trial"] == {"enabled": not external, "initialBalance": 10000}
            return value

        initial = run()
        assert initial["balance"] == 10000 and initial["cards"]["drawsAvailable"] == 0
        spend = [frame({"Fire": True})]
        spent = run(spend, 70)
        assert spent["balance"] == 9000 and spent["stats"]["spent"] == 1000
        assert spent["cards"]["drawsAvailable"] == 1
        reloaded = run()
        assert reloaded["balance"] == 10000 and reloaded["stats"]["spent"] == 0
        assert reloaded["cards"]["drawsAvailable"] == reloaded["cards"]["drawsUsed"] == 0
        assert not any(card["count"] for card in reloaded["cards"]["catalog"])
        assert run(at(spend, 69, {"TrialRefill": True}), 70) == spent
        checks.append("each fresh local runtime starts10000 with fresh progress; the removed TrialRefill input cannot add funds")

        for mode in (0, 1):
            remote_inputs = [frame(packet(1, 0, mode=mode, balance=500)), frame(profile_packet(2, mode=mode))]
            remote = run(at(remote_inputs, 4, {"TrialRefill": True, "DemoReset": True}), 6)
            assert remote["platform"]["ready"] and remote["balance"] == 500
            assert remote["stats"]["spent"] == remote["stats"]["won"] == 0
        checks.append("remote paid and author demo keep the server wallet and cannot grant local startup points")

        def seed_actions(seed):
            return {"CardSeedReady": True, **{f"CardSeedBit{bit}": True for bit in range(31) if seed & (1 << bit)}}

        seed_inputs = [frame(dict(seed_actions(123456789), PlatformPause=True))]
        seed_inputs = at(seed_inputs, 4, {"PlatformResume": True})
        paused = run(seed_inputs, 4)
        assert paused["platform"]["paused"] and paused["time"] == 0 and paused["cards"]["seedReady"]
        seed_inputs = at(seed_inputs, 6, {"Fire": True})
        seed_inputs = at(seed_inputs, 80, {"GalleryOpen": True})
        seed_inputs = at(seed_inputs, 82, {"CardDrawAll": True})
        seeded = run(seed_inputs, 85)
        reseeded = run(at(seed_inputs, 2, seed_actions(1)), 85)
        assert seeded["cards"]["drawsUsed"] == 1 and seeded["cards"] == reseeded["cards"]
        checks.append("boot pause receives initial card entropy and subsequent seed handshakes cannot replace its stream")

    print(json.dumps({"passed": True, "native_runs": runs, "initial_balance": 10000,
                      "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
