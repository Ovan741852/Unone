"""Focused native acceptance for Eunbi and existing per-character styles.

Only starting board, role and bet data are varied. Production selection,
outcome randomness, input handling and wallet rules execute unchanged.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from acceptance import frame, padded


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk", required=True, type=Path)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    project, sdk = args.project.resolve(), args.sdk.resolve()
    source = (project/"scripts/main.luau").read_text(encoding="utf-8")
    config = json.loads((project/"project.unone.json").read_text(encoding="utf-8-sig"))
    checks, settlements = [], []
    runs = 0
    with tempfile.TemporaryDirectory(prefix="hotchick-eunbi-") as scratch:
        root = Path(scratch)
        sequence_file = root/"input.json"

        def fixture(name, *, character="eunbi", tier="medium", bet=10, counts=None):
            directory = root/name
            directory.mkdir()
            text = source
            counts = counts if counts is not None else {tier:1}
            for kind,total in (("small",18),("medium",6),("large",3)):
                line = f'for _ = 1, {total} do table.insert(targets, createTarget(api, "{kind}", true)) end'
                assert text.count(line) == 1
                text = text.replace(line,line.replace(f"1, {total}",f'1, {counts.get(kind,0)}'))
            if character:
                line = 'local characterId = SPAWN_CHARACTER_ORDER[(spawnCharacterSequence-1)%#SPAWN_CHARACTER_ORDER+1]'
                assert text.count(line) == 1
                text = text.replace(line,f'local characterId = "{character}"')
            if sum(counts.values()) == 1:
                text = text.replace("local lane = randomRange(api, -2.65, 2.85)","local lane = 0")
                text = text.replace("speed=randomRange(api, 0.30, 0.65)","speed=0")
                text = text.replace("local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4","local x = if initial then 0 else -direction * 9.4")
            if bet in (19,49):
                text = text.replace("local BETS = {1, 5, 10, 20, 50}",f"local BETS = {{1, 5, {bet}, {20 if bet == 19 else 50}, 100}}")
            elif bet in (20,50):
                text = text.replace("betIndex = 3",f"betIndex = {4 if bet == 20 else 5}")
            else:
                assert bet == 10
            (directory/"project.unone.json").write_text(json.dumps(dict(config,entry_script="main.luau",main_scene="main.scene.json",test_files=[])),encoding="utf-8")
            (directory/"main.luau").write_text(text,encoding="utf-8")
            shutil.copyfile(project/"scenes/main.scene.json",directory/"main.scene.json")
            return directory

        def run(board=project, *, frames=90, sequence=None, seed=42):
            nonlocal runs
            sequence_file.write_text(json.dumps(padded(sequence or [],frames)),encoding="utf-8")
            completed = subprocess.run([str(sdk),"run","--project",str(board),"--frames",str(frames),"--seed",str(seed),"--input-sequence",str(sequence_file),"--json"],capture_output=True,text=True,encoding="utf-8")
            payload = json.loads(completed.stdout)
            assert completed.returncode == 0 and payload["ok"],payload.get("diagnostics",completed.stderr)
            result = payload["value"]["world"]["observations"]["game"]
            runs += 1
            assert result["balance"] == 10000-result["stats"]["spent"]+result["stats"]["won"]
            assert result["balance"] == result["displayBalance"]+result["pendingWin"]
            assert result["stats"]["won"] == result["collectedWin"]+result["pendingWin"]
            return result

        def catalog(value):
            return {item["clipId"]:item for c in value["gallery"]["characters"] for style in c["styles"] for item in style["items"]}

        def unlocked(value):
            return {key for key,item in catalog(value).items() if item["unlocked"]}

        def reveal(value,tier):
            return value.get("reveal") if tier == "large" else next(iter(value["mediumReveals"]),None)

        once = [frame(point=(0,0),down=True),frame()]
        boards = {(tier,bet):fixture(f"eunbi-{tier}-{bet}",tier=tier,bet=bet) for tier in ("medium","large") for bet in (10,49,50)}
        empty = fixture("empty",counts={})
        originals = fixture("original-board",character="original",counts={"small":18,"medium":6,"large":3})
        mixed,old = run(frames=1),run(originals,frames=1)
        assert len(mixed["targets"]) == 27
        assert [t["characterId"] for t in mixed["targets"]] == [("eunbi","yeseul","original","mugi","jiayi")[i%5] for i in range(27)]
        assert {t["tier"] for t in mixed["targets"] if t["characterId"] == "eunbi"} == {"small","medium","large"}
        assert [(t["id"],t["x"],t["y"],t["phase"]) for t in mixed["targets"]] == [(t["id"],t["x"],t["y"],t["phase"]) for t in old["targets"]]
        assert [c["name"] for c in mixed["gallery"]["characters"]] == ["恩妃","藝瑟","嘉儀","むぎ","恩智"]
        assert mixed["gallery"]["defaultCharacterId"] == "eunbi"
        items = catalog(mixed)
        assert len(items) == 23 and all(item["available"] for item in items.values())
        assert "eunbi-summer-small" not in items
        assert "yeseul-summer-medium" not in items
        assert items["eunbi-classic-small"]["duration"] == 5.041667
        for style in ("classic","summer"):
            assert items[f"eunbi-{style}-medium"]["duration"] == 5.041667
            assert items[f"eunbi-{style}-large"]["duration"] == 8.041667
            assert items[f"eunbi-{style}-medium"]["aspectRatio"] == 270/480
            assert items[f"eunbi-{style}-large"]["aspectRatio"] == 16/9
        for tier in ("medium","large"):
            assert items[f"eunbi-summer-{tier}"]["chanceBands"] == [{"minBaseBet":50,"chance":.5}]
            assert "恩妃" in items[f"eunbi-summer-{tier}"]["unlockHint"] and "50%" in items[f"eunbi-summer-{tier}"]["unlockHint"]
        assert [mixed["demoConfig"][name] for name in ("smallWinChance","mediumWinChance","largeWinChance")] == [.4,.16,.1]
        assert mixed["demoConfig"]["rewardHearts"] == {"small":4,"medium":16,"large":32}
        assert set(mixed["demoConfig"]["christmasCharacterIds"]) == {"jiayi","mugi"}
        checks.append("five-role-spawn-no-RNG-shift-23-actual-clips-and-correct-source-durations")

        captures = {}
        for tier in ("medium","large"):
            for bet in (49,50):
                for seed,style in ((6,"classic"),(27,"summer")):
                    value = run(boards[tier,bet],sequence=once,seed=seed)
                    entry = reveal(value,tier)
                    assert entry and entry["baseBet"] == bet and value["stats"]["shots"] == 1
                    expected = style if bet == 50 else "classic"
                    assert entry["styleId"] == expected and not entry["christmasEligible"]
                    assert entry["styleEligible"] == (bet == 50) and entry["styleRollApplied"] == (bet == 50)
                    assert value["variantStats"]["styleRolls"] == (1 if bet == 50 else 0)
                    assert unlocked(value) == {f"eunbi-{expected}-{tier}"}
                    if bet == 50:
                        assert entry["eligibleStyleIds"] == ["summer"]
                        assert (entry["styleRoll"] < .5) == (expected == "summer")
                        captures[tier,expected] = (seed,value,entry)
                    else: assert entry["styleRoll"] == -1
        checks.append("summer49-50-gate-both-tiers-and-classic-summer-50-50-natural-branches")

        for weapon,mult in (("Flower",6),("Rocket",15)):
            won = False
            for seed in range(1,101):
                value = run(boards["medium",10],sequence=[frame({"Weapon"+weapon:True},(0,0),True),frame()],seed=seed)
                if value["stats"]["captures"]:
                    entry = reveal(value,"medium")
                    assert value["stats"]["shots"] == 1 and value["stats"]["spent"] == 10*mult
                    assert entry["baseBet"] == 10 and entry["styleId"] == "classic" and not entry["styleEligible"]
                    assert value["variantStats"]["styleRolls"] == 0
                    won = True;break
            assert won
        small = fixture("eunbi-small-50",tier="small",bet=50)
        for seed in range(1,101):
            value = run(small,sequence=once,seed=seed)
            if value["stats"]["captures"]:
                assert unlocked(value) == {"eunbi-classic-small"} and value["variantStats"]["styleRolls"] == 0
                assert value["rewardFx"][0]["clipDuration"] == 5.041667
                break
        else: raise AssertionError("No natural small capture")
        checks.append("round-cost-never-substitutes-for-base-bet-and-small-never-consumes-style-RNG")

        for tier in ("medium","large"):
            raised = run(boards[tier,49],sequence=[once[0],frame({"BetUp":True})],seed=27)
            assert raised["bet"] == 50 and reveal(raised,tier)["baseBet"] == 49 and reveal(raised,tier)["styleId"] == "classic"
            assert raised["variantStats"]["styleRolls"] == 0
            lowered = run(boards[tier,50],sequence=[once[0],frame({"BetDown":True})],seed=27)
            assert lowered["bet"] == 20 and reveal(lowered,tier)["baseBet"] == 50 and reveal(lowered,tier)["styleId"] == "summer"
        checks.append("inflight49-to50-and50-to20-use-the-immutable-firing-base-bet")

        for tier in ("medium","large"):
            for bet in (19,20,49,50):
                board = fixture(f"yeseul-{tier}-{bet}",character="yeseul",tier=tier,bet=bet)
                for seed in (6,27,105):
                    value = run(board,sequence=once,seed=seed)
                    entry = reveal(value,tier)
                    assert entry
                    expected = "classic"
                    if bet >= 20:
                        expected = "halloween" if entry["styleRoll"] < .5 else "classic"
                        if tier == "large" and bet >= 50: expected = "halloween" if entry["styleRoll"] < .25 else ("summer" if entry["styleRoll"] < .5 else "classic")
                    assert entry["styleId"] == expected
                    assert value["variantStats"]["styleRolls"] == (1 if bet >= 20 else 0)
                    if tier == "medium" and bet >= 20: assert entry["eligibleStyleIds"] == ["halloween"]
        for character in ("mugi","jiayi"):
            for tier in ("medium","large"):
                board = fixture(f"{character}-{tier}-50",character=character,tier=tier,bet=50)
                for seed,expected in ((6,"classic"),(27,"christmas")):
                    value = run(board,sequence=once,seed=seed)
                    entry = reveal(value,tier)
                    assert entry and entry["styleId"] == expected and entry["eligibleStyleIds"] == ["christmas"]
                    assert entry["christmasEligible"] and value["variantStats"]["styleRolls"] == 1
        checks.append("Yeseul-Halloween20-summer-large-only-and-legacy-Christmas-seeds-preserved")

        for clip_id in ("eunbi-summer-medium","eunbi-summer-large","yeseul-summer-large","yeseul-halloween-medium","mugi-christmas-medium"):
            value = run(empty,frames=3,sequence=[frame({"PreviewClip:"+clip_id:True})])
            assert not value.get("reveal") and not value["mediumReveals"] and not unlocked(value)
            assert value["stats"]["spent"] == value["stats"]["won"] == value["variantStats"]["styleRolls"] == 0
        for tier,action in (("small","PreviewSmall"),("medium","PreviewMedium"),("large","PreviewLarge")):
            value = run(empty,frames=3,sequence=[frame({action:True})])
            entry = value["rewardFx"][0] if tier == "small" else reveal(value,tier)
            assert entry["clipId"] == f"eunbi-classic-{tier}" and entry["preview"] and not unlocked(value)
            assert value["stats"]["spent"] == value["stats"]["won"] == value["variantStats"]["styleRolls"] == 0
        checks.append("all-nonclassic-preview-locks-and-zero-credit-default-Eunbi-classic-previews")

        for (tier,style),(seed,_,entry) in captures.items():
            seq = padded(once,400)
            seq[100] = frame({"CloseReveal" if tier == "large" else "CloseMediumReveal:1":True})
            done = run(boards[tier,50],frames=400,sequence=seq,seed=seed)
            assert done["pendingWin"] == 0 and done["balance"] == done["displayBalance"]
            assert not done.get("reveal") and not done["mediumReveals"]
            assert done["stats"]["shots"] == 1 and unlocked(done) == {entry["clipId"]}
            seq += [frame({"PreviewClip:yeseul-summer-large":True}),frame()]
            crossed = run(boards[tier,50],frames=402,sequence=seq,seed=seed)
            assert not crossed.get("reveal") and not crossed["mediumReveals"] and crossed["stats"] == done["stats"]
            assert unlocked(crossed) == unlocked(done)
            seq += [frame({"PreviewClip:"+entry["clipId"]:True}),frame()]
            replayed = run(boards[tier,50],frames=404,sequence=seq,seed=seed)
            assert reveal(replayed,tier)["preview"] and reveal(replayed,tier)["clipId"] == entry["clipId"]
            assert replayed["stats"] == done["stats"] and replayed["variantStats"] == done["variantStats"] and unlocked(replayed) == unlocked(done)
            settlements.append({"tier":tier,"style":style,"seed":seed,"won":done["stats"]["won"],"collected":done["collectedWin"]})
        checks.append("all-four-natural-performance-branches-settle-once-and-cross-role-replay-stays-locked")
    print(json.dumps({"ok":True,"mode":"eunbi-focused","nativeRuns":runs,"checks":checks,"settlements":settlements},ensure_ascii=False))


if __name__ == "__main__":
    main()
