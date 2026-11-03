"""Focused native AUTO intent, paid rocket cadence and award-pause checks."""
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
    parser.add_argument("--sdk",required=True,type=Path)
    parser.add_argument("--project",type=Path,default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    project,sdk = args.project.resolve(),args.sdk.resolve()
    source = (project/"scripts/main.luau").read_text(encoding="utf-8")
    config = json.loads((project/"project.unone.json").read_text(encoding="utf-8-sig"))
    runs,checks = 0,[]
    with tempfile.TemporaryDirectory(prefix="hotchick-auto-intent-") as scratch:
        root = Path(scratch)
        input_file = root/"input.json"

        def fixture(name, *, tier=None, count=1, bet=10, funds=10000, miss=False, incoming=False, queued=False):
            directory = root/name
            directory.mkdir()
            text = source
            for kind,total in (("small",18),("medium",6),("large",3)):
                line = f'for _ = 1, {total} do table.insert(targets, createTarget(api, "{kind}", true)) end'
                assert text.count(line) == 1
                text = text.replace(line,line.replace(f"1, {total}",f'1, {count if kind == tier else 0}'))
            text = text.replace('local characterId = SPAWN_CHARACTER_ORDER[(spawnCharacterSequence-1)%#SPAWN_CHARACTER_ORDER+1]','local characterId = "eunbi"')
            text = text.replace("local lane = randomRange(api, -2.65, 2.85)","local lane = 0")
            text = text.replace("speed=randomRange(api, 0.30, 0.65)","speed=0.8" if incoming else "speed=0")
            text = text.replace("local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4",f"local x = if initial then {9 if incoming else 0} else -direction * 9.4")
            if incoming: text = text.replace('local direction = if api.random.nextInt(0, 1) == 0 then -1 else 1','local direction = -1')
            if bet != 10: text = text.replace("local BETS = {1, 5, 10, 20, 50}",f"local BETS = {{1, 5, {bet}, 200, 500}}")
            if funds != 10000:
                text,changed = re.subn(r"(?m)^([ \t]*(?:local )?(?:balance|displayBalance) = )10000$",lambda m:m[1]+str(funds),text)
                assert changed == 4
            if miss:
                text,changed = re.subn(r"(?m)^(local ODDS: .*? = )\{[^\n]+\}$",lambda m:m[1]+"{small=0,medium=0,large=0}",text)
                assert changed == 1
            if queued:
                clips = ('eunbi-classic-large','eunbi-summer-large','yeseul-classic-large')
                mapping = "{"+",".join(f'["{clip}"]=true' for clip in clips)+"}"
                text = text.replace("    unlockedClips = {}","    unlockedClips = "+mapping)
                text = text.replace("    largePlayback.watched = {}","    largePlayback.watched = "+mapping)
                text = text.replace("    largePlayback.skipSeen = false","    largePlayback.skipSeen = true")
                injection = '\n'.join((f"    balance = {funds+495}",f"    displayBalance = {funds}","    pendingWin = 495","    won = 495",
                    '    enqueueReveal("large","small",17,false,clipFor("eunbi","classic","large"))',
                    '    enqueueReveal("large","medium",101,false,clipFor("eunbi","summer","large"))',
                    '    enqueueReveal("large","large",377,false,clipFor("yeseul","classic","large"))'))
                line = '    for _ = 1, 0 do table.insert(targets, createTarget(api, "large", true)) end'
                assert text.count(line) == 1
                text = text.replace(line,line+"\n"+injection)
            (directory/"project.unone.json").write_text(json.dumps(dict(config,entry_script="main.luau",main_scene="main.scene.json",test_files=[])),encoding="utf-8")
            (directory/"main.luau").write_text(text,encoding="utf-8")
            shutil.copyfile(project/"scenes/main.scene.json",directory/"main.scene.json")
            return directory,funds

        def run(board, sequence=(), *, frames=60, seed=6):
            nonlocal runs
            directory,funds = board
            input_file.write_text(json.dumps(padded(list(sequence),frames)),encoding="utf-8")
            result = subprocess.run([str(sdk),"run","--project",str(directory),"--frames",str(frames),"--seed",str(seed),"--input-sequence",str(input_file),"--json"],capture_output=True,text=True,encoding="utf-8")
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"],payload.get("diagnostics",result.stderr)
            value = payload["value"]["world"]["observations"]["game"]
            runs += 1
            assert value["balance"] == funds-value["stats"]["spent"]+value["stats"]["won"]
            assert value["balance"] == value["displayBalance"]+value["pendingWin"]
            assert value["stats"]["won"] == value["collectedWin"]+value["pendingWin"]
            return value

        def schedule(*entries):
            sequence = []
            for at,actions in entries:
                sequence = padded(sequence,at+1)
                sequence[at] = frame(actions)
            return sequence

        rocket = fixture("rocket-minute",tier="small",count=5,miss=True,funds=1000000)
        firing = [frame({"WeaponRocket":True,"ToggleAuto":True})]
        first = run(rocket,firing,frames=2)
        assert len(first["shots"]) == 5 and first["stats"]["spent"] == 150 and first["stats"]["shots"] == 1
        minute = run(rocket,firing,frames=3600)
        assert minute["auto"] and minute["roundInterval"] == .2 and minute["stats"]["shots"] == 300 and minute["stats"]["spent"] == 45000
        assert len(minute["lastRound"]["targetIds"]) == len(set(minute["lastRound"]["targetIds"])) == 5
        assert run(rocket,firing,frames=12)["stats"]["shots"] == 1 and run(rocket,firing,frames=14)["stats"]["shots"] == 2
        checks.append("rocket-200ms-300-rounds-per-minute-five-distinct-targets-and-15x-single-paid-cost")

        incoming = fixture("incoming",tier="small",miss=True,incoming=True,funds=100000)
        waiting = run(incoming,firing,frames=120)
        resumed = run(incoming,firing,frames=360)
        assert waiting["auto"] and waiting["stats"]["shots"] == 0
        assert resumed["auto"] and resumed["stats"]["shots"] > 0 and resumed["stats"]["spent"] == resumed["stats"]["shots"]*150
        poor = fixture("poor",bet=100,funds=10)
        poor_sequence = schedule((0,{"ToggleAuto":True}),(120,{"BetDown":True}))
        before = run(poor,poor_sequence,frames=120)
        first_paid = run(poor,poor_sequence,frames=121)
        still_one = run(poor,poor_sequence,frames=122)
        assert before["auto"] and before["stats"]["shots"] == 0 and before["displayBalance"] == 10
        assert first_paid["auto"] and first_paid["stats"]["shots"] == still_one["stats"]["shots"] == 1 and first_paid["stats"]["spent"] == 5
        checks.append("missing-target-or-insufficient-funds-pauses-with-AUTO-intent-and-resumes-without-catching-up")

        natural = {}
        for tier,seed in (("medium",27),("large",6)):
            board = fixture("natural-"+tier,tier=tier,bet=100,funds=100)
            sequence = [frame({"ToggleAuto":True})]
            award = run(board,sequence,frames=150,seed=seed)
            assert award["auto"] and award["stats"]["shots"] == 1 and award["stats"]["captures"] == 1 and award["pendingWin"] > 0 and award["displayBalance"] == 0
            if tier == "large": assert award["reveal"] and award["reveal"]["stage"] == "video"
            else: assert award["mediumReveals"] and award["mediumReveals"][0]["stage"] == "video"
            after = run(board,sequence,frames=1000,seed=seed)
            assert after["auto"] and after["pendingWin"] == 0 and after["stats"]["shots"] > 1
            assert after["collectedWin"] == award["stats"]["won"] and after["stats"]["captures"] == 1
            natural[tier] = {"award":award["stats"]["won"],"resumedShots":after["stats"]["shots"]}
        medium = fixture("medium-continuous",tier="medium")
        continuous = run(medium,[frame({"ToggleAuto":True})],frames=150,seed=6)
        assert continuous["auto"] and continuous["mediumReveals"] and continuous["stats"]["shots"] >= 20
        checks.append("natural-medium-and-large-awards-retain-AUTO-through-zero-spendable-wallet-and-resume-after-heart-credit")

        empty = fixture("empty")
        for name,sequence in (
            ("toggle",schedule((0,{"ToggleAuto":True}),(10,{"ToggleAuto":True}))),
            ("gallery",schedule((0,{"ToggleAuto":True}),(10,{"GalleryOpen":True}),(12,{"GalleryClose":True}))),
            ("portrait",schedule((0,{"ToggleAuto":True}),(10,{"ViewportPortrait":True}),(12,{"ViewportLandscape":True}))),
            ("lock-off",schedule((0,{"ToggleLock":True}),(10,{"ToggleLock":True}))),
            ("reset",schedule((0,{"ToggleAuto":True}),(10,{"DemoReset":True}))),
            ("preview",schedule((0,{"ToggleAuto":True}),(10,{"PreviewLarge":True}))),
        ):
            assert not run(empty,sequence,frames=20)["auto"],name
        aiming = fixture("aiming-explicit-stop",tier="small",miss=True)
        aiming_sequence = schedule((0,{"ToggleLock":True}),(10,{"ToggleAuto":True}))
        before_stop = run(aiming,aiming_sequence,frames=10)
        after_stop = run(aiming,aiming_sequence,frames=40)
        assert before_stop["auto"] and before_stop["lock"] and before_stop["stats"]["shots"] > 0
        assert not after_stop["auto"] and after_stop["lock"] and after_stop["stats"]["shots"] == before_stop["stats"]["shots"]
        checks.append("explicit-auto-lock-off-gallery-portrait-reset-and-preview-still-stop-as-requested")

        queue = fixture("queued",queued=True)
        sequence = [frame({"ToggleAuto":True})]
        paused = run(queue,sequence,frames=270)
        assert paused["auto"] and paused["stats"]["shots"] == 0
        low,high = 270,360
        while high-low > 1:
            middle = (low+high)//2
            if run(queue,sequence,frames=middle)["stats"]["shots"]: high=middle
            else: low=middle
        resumed_first = run(queue,sequence,frames=high)
        no_burst = run(queue,sequence,frames=high+6)
        second = run(queue,sequence,frames=high+9)
        assert resumed_first["auto"] and resumed_first["stats"]["shots"] == no_burst["stats"]["shots"] == 1 and second["stats"]["shots"] == 2
        assert resumed_first["pendingWin"] == 0 and resumed_first["collectedWin"] == 495 and resumed_first["walletArrivalsSerial"] == 52
        checks.append("FIFO-large-reward-pauses-retain-AUTO-and-resume-one-shot-without-banked-debt-after-all-52-hearts")
    print(json.dumps({"ok":True,"mode":"auto-intent-focused","nativeRuns":runs,"checks":checks,"evidence":{"rocket60sRounds":minute["stats"]["shots"],"natural":natural,"queueResumeFrame":high}},ensure_ascii=False))


if __name__ == "__main__":
    main()
