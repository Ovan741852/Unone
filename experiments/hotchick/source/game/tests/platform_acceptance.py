"""Focused native platform pause and resume checks using real Luau rules."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from acceptance import frame, padded


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

    with tempfile.TemporaryDirectory(prefix="hotchick-platform-") as scratch:
        root = Path(scratch)
        input_file = root / "input.json"

        def fixture(name, *, capture=False):
            directory = root / name
            directory.mkdir()
            text = source
            for tier, count in (("small", 18), ("medium", 6), ("large", 3)):
                line = f'for _ = 1, {count} do table.insert(targets, createTarget(api, "{tier}", true)) end'
                assert text.count(line) == 1
                text = text.replace(line, line.replace(f"1, {count}", f"1, {int(tier == 'small')}"))
            text = text.replace("local lane = randomRange(api, -2.65, 2.85)", "local lane = 0")
            text = text.replace("speed=randomRange(api, 0.30, 0.65)", "speed=0.35")
            text = text.replace(
                "local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4",
                "local x = if initial then 0 else -direction * 9.4",
            )
            numerator = 4250 if capture else 0
            text = text.replace("local RTP_NUMERATOR = 98", f"local RTP_NUMERATOR = {numerator}")
            (directory / "main.luau").write_text(text, encoding="utf-8")
            (directory / "project.unone.json").write_text(
                json.dumps(dict(config, entry_script="main.luau", main_scene="main.scene.json", test_files=[])),
                encoding="utf-8",
            )
            shutil.copyfile(project / "scenes/main.scene.json", directory / "main.scene.json")
            return directory

        def run(board, sequence, frames):
            nonlocal runs
            input_file.write_text(json.dumps(padded(sequence, frames)), encoding="utf-8")
            result = subprocess.run(
                [str(args.sdk.resolve()), "run", "--project", str(board), "--frames", str(frames),
                 "--seed", "6", "--input-sequence", str(input_file), "--json"],
                capture_output=True, text=True, encoding="utf-8",
            )
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"], payload.get("diagnostics", result.stderr)
            value = payload["value"]["world"]["observations"]["game"]
            assert value["balance"] == 10000 - value["stats"]["spent"] - value["reservedWager"] + value["stats"]["won"]
            assert value["balance"] == value["displayBalance"] + value["pendingWin"]
            runs += 1
            return value

        def at(sequence, index, actions, *, down=False):
            result = padded(sequence, index + 1)
            result[index] = frame(actions, point=(0, 0) if down else None, down=down)
            return result

        board = fixture("moving-auto")
        firing = [frame({"WeaponRocket": True, "ToggleAuto": True})]
        baseline = run(board, firing, 30)
        paused_inputs = at(firing, 30, {"PlatformPause": True})
        paused = run(board, paused_inputs, 330)
        local_platform = {"paused": False, "exchangeRate": 50, "exchangeAvailable": False}
        assert {key: baseline["platform"][key] for key in local_platform} == local_platform
        assert not baseline["platform"]["enabled"]
        assert paused["platform"]["paused"] and not paused["canShoot"] and paused["auto"]
        for key in ("time", "cooldown", "targets", "shots", "stats", "balance", "displayBalance", "pendingWin"):
            assert paused[key] == baseline[key], key
        checks.append("pause-freezes-time-cooldown-targets-projectiles-and-paid-spend-with-AUTO-intent")

        resumed_inputs = at(paused_inputs, 330, {"PlatformResume": True})
        resumed = run(board, resumed_inputs, 360)
        uninterrupted = run(board, firing, 60)
        for key in ("time", "cooldown", "targets", "shots", "stats", "balance", "displayBalance", "pendingWin"):
            assert resumed[key] == uninterrupted[key], key
        assert resumed["auto"] and not resumed["platform"]["paused"]
        checks.append("resume-matches-uninterrupted-active-ticks-without-catch-up")

        blocked = at(paused_inputs, 60, {"ToggleAuto": True, "BetUp": True, "DemoReset": True})
        blocked = at(blocked, 90, {"Fire": True})
        assert run(board, blocked, 330)["stats"] == paused["stats"]
        simultaneous = at(firing, 30, {"PlatformPause": True, "PlatformResume": True, "Fire": True})
        assert run(board, simultaneous, 60)["platform"]["paused"]
        checks.append("paused-controls-cannot-mutate-game-and-simultaneous-pause-wins")

        manual = [frame({"Fire": True}) for _ in range(30)]
        manual = at(manual, 30, {"PlatformPause": True, "Fire": True})
        manual += [frame({"Fire": True}) for _ in range(90)]
        manual = at(manual, 121, {"PlatformResume": True, "Fire": True})
        manual += [frame({"Fire": True}) for _ in range(60)]
        held = run(board, manual, len(manual))
        assert held["stats"]["shots"] == run(board, [frame({"Fire": True})] * 30, 30)["stats"]["shots"]
        manual += [frame(), frame({"Fire": True})]
        fresh = run(board, manual, len(manual))
        assert fresh["stats"]["shots"] > held["stats"]["shots"]
        checks.append("manual-Fire-held-through-pause-requires-release-before-resuming")

        rewards = fixture("paid-reward", capture=True)
        winning_inputs = [frame({"WeaponFlower": True, "ToggleAuto": True})]
        award = None
        for count in range(8, 140, 4):
            candidate = run(rewards, winning_inputs, count)
            if candidate["pendingWin"] > 0 and candidate["rewardFx"]:
                award = candidate
                award_at = count
                break
        assert award is not None, "expected a real paid capture with reward hearts"
        award_pause = at(winning_inputs, award_at, {"PlatformPause": True})
        frozen_award = run(rewards, award_pause, award_at + 240)
        for key in ("pendingWin", "displayBalance", "collectedWin", "rewardFx", "fxHearts", "walletArrivalsSerial"):
            assert frozen_award[key] == award[key], key
        award_resume = at(award_pause, award_at + 240, {"PlatformResume": True})
        collected = run(rewards, award_resume, award_at + 420)
        assert collected["collectedWin"] >= award["pendingWin"]
        checks.append("paid-award-heart-progress-and-credit-freeze-then-resume-exactly")

        portrait = [frame({"ViewportPortrait": True}), frame({"PlatformPause": True})]
        portrait = at(portrait, 100, {"PlatformResume": True})
        portrait_state = run(board, portrait, 101)
        assert portrait_state["viewportBlocked"] and not portrait_state["platform"]["paused"]
        assert not portrait_state["canShoot"]
        gallery = [frame({"GalleryOpen": True}), frame({"PlatformPause": True})]
        gallery = at(gallery, 100, {"PlatformResume": True})
        gallery_state = run(board, gallery, 101)
        assert gallery_state["galleryOpen"] and not gallery_state["platform"]["paused"]
        assert not gallery_state["canShoot"]
        checks.append("platform-resume-preserves-independent-portrait-and-gallery-blocks")

    print(json.dumps({"passed": True, "runs": runs, "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
