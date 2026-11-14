"""Focused native acceptance for Yeseul and the shared style selector.

Fixtures change starting board/character/bet data; the production gameplay and
random source are unchanged. Run with TEMP/TMP on D: and --sdk <game.exe>.
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
    runs = 0
    checks = []
    with tempfile.TemporaryDirectory(prefix="hotchick-yeseul-") as scratch:
        root = Path(scratch)
        input_file = root/"input.json"

        def fixture(name, tier="medium", character="yeseul", bet=10, counts=None):
            directory = root/name
            directory.mkdir()
            text = source
            counts = counts if counts is not None else {tier: 1}
            for kind, old in (("small",18),("medium",6),("large",3)):
                line = f'for _ = 1, {old} do table.insert(targets, createTarget(api, "{kind}", true)) end'
                assert text.count(line) == 1
                text = text.replace(line,line.replace(f"1, {old}",f'1, {counts.get(kind,0)}'))
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
            elif bet != 10:
                # The only changed starting indices are the existing 20/50 bets.
                assert bet in (20,50)
                text = text.replace("betIndex = 3",f"betIndex = {4 if bet == 20 else 5}")
            (directory/"project.unone.json").write_text(json.dumps(dict(config,entry_script="main.luau",main_scene="main.scene.json",test_files=[])),encoding="utf-8")
            (directory/"main.luau").write_text(text,encoding="utf-8")
            shutil.copyfile(project/"scenes/main.scene.json",directory/"main.scene.json")
            return directory

        def run(board=project, frames=90, sequence=None, seed=42):
            nonlocal runs
            input_file.write_text(json.dumps(padded(sequence or [],frames)),encoding="utf-8")
            result = subprocess.run([str(sdk),"run","--project",str(board),"--frames",str(frames),"--seed",str(seed),"--input-sequence",str(input_file),"--json"],capture_output=True,text=True,encoding="utf-8")
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"],payload.get("diagnostics",result.stderr)
            value = payload["value"]["world"]["observations"]["game"]
            runs += 1
            assert value["balance"] == 10000-value["stats"]["spent"]+value["stats"]["won"]
            assert value["balance"] == value["displayBalance"]+value["pendingWin"]
            assert value["stats"]["won"] == value["collectedWin"]+value["pendingWin"]
            return value

        def clips(value):
            return {item["clipId"]:item for c in value["gallery"]["characters"] for s in c["styles"] for item in s["items"]}

        def unlocked(value):
            return {key for key,item in clips(value).items() if item["unlocked"]}

        def reveal(value, tier):
            return value.get("reveal") if tier == "large" else next(iter(value["mediumReveals"]),None)

        shot = [frame(point=(0,0),down=True),frame()]
        boards = {(tier,bet):fixture(f"yeseul-{tier}-{bet}",tier=tier,bet=bet) for tier in ("medium","large") for bet in (10,19,20,49,50)}
        empty = fixture("empty",counts={})
        originals = fixture("original-board",character="original",counts={"small":18,"medium":6,"large":3})
        mixed, old = run(frames=1),run(originals,frames=1)
        assert len(mixed["targets"]) == 27
        assert [t["characterId"] for t in mixed["targets"]] == [("yeseul","original","mugi","jiayi")[i%4] for i in range(27)]
        assert {t["tier"] for t in mixed["targets"] if t["characterId"] == "yeseul"} == {"small","medium","large"}
        assert [(t["id"],t["tier"],t["x"],t["y"],t["phase"]) for t in mixed["targets"]] == [(t["id"],t["tier"],t["x"],t["y"],t["phase"]) for t in old["targets"]]
        assert [c["name"] for c in mixed["gallery"]["characters"]] == ["藝瑟","嘉儀","むぎ","恩智"]
        catalog = clips(mixed)
        assert len(catalog) == 24 and sum(c["available"] for c in catalog.values()) == 18
        assert mixed["gallery"]["defaultCharacterId"] == "yeseul"
        for key in ("yeseul-halloween-small","yeseul-summer-small","yeseul-summer-medium"):
            assert not catalog[key]["available"] and catalog[key]["replayAsset"] == ""
        assert catalog["yeseul-classic-small"]["duration"] == catalog["yeseul-classic-medium"]["duration"] == 4.041667
        assert catalog["yeseul-halloween-medium"]["duration"] == 4.041667
        assert catalog["yeseul-summer-large"]["duration"] == 8.041667
        assert catalog["yeseul-halloween-large"]["chanceBands"] == [{"minBaseBet":20,"chance":.5},{"minBaseBet":50,"chance":.25}]
        assert catalog["yeseul-summer-large"]["chanceBands"] == [{"minBaseBet":50,"chance":.25}]
        assert "20～49時50%" in catalog["yeseul-halloween-large"]["unlockHint"] and "50以上時25%" in catalog["yeseul-halloween-large"]["unlockHint"]
        assert mixed["demoConfig"]["rewardHearts"] == {"small":4,"medium":16,"large":32}
        assert [mixed["demoConfig"][key] for key in ("smallWinChance","mediumWinChance","largeWinChance")] == [.4,.16,.1]
        checks.append("four-way-spawn-no-RNG-shift-and-24-item-18-video-catalog")

        variants = {}
        for seed in range(1,181):
            value = run(boards["large",50],sequence=shot,seed=seed)
            entry = reveal(value,"large")
            if entry:
                expected = "halloween" if entry["styleRoll"] < .25 else ("summer" if entry["styleRoll"] < .5 else "classic")
                assert entry["styleId"] == expected and entry["styleEligible"] and not entry["christmasEligible"]
                assert entry["eligibleStyleIds"] == ["halloween","summer"]
                assert value["variantStats"]["styleRolls"] == 1 and value["variantStats"]["christmasWins"] == 0
                assert unlocked(value) == {f"yeseul-{expected}-large"}
                variants.setdefault(expected,(seed,value,entry))
                if len(variants) == 3: break
            else: assert value["variantStats"]["styleRolls"] == 0
        assert set(variants) == {"classic","halloween","summer"}
        for style,(seed,_,entry50) in variants.items():
            for tier in ("medium","large"):
                for bet in (19,20,49,50):
                    value = run(boards[tier,bet],sequence=shot,seed=seed)
                    entry = reveal(value,tier)
                    assert entry and entry["baseBet"] == bet and value["stats"]["shots"] == 1
                    if bet < 20:
                        assert entry["styleId"] == "classic" and not entry["styleEligible"] and entry["styleRoll"] == -1
                        assert value["variantStats"]["styleRolls"] == 0
                    else:
                        assert entry["styleEligible"] and entry["styleRollApplied"] and value["variantStats"]["styleRolls"] == 1
                        expected = "halloween" if entry["styleRoll"] < .5 else "classic"
                        if tier == "large" and bet >= 50: expected = "halloween" if entry["styleRoll"] < .25 else ("summer" if entry["styleRoll"] < .5 else "classic")
                        assert entry["styleId"] == expected
                        assert entry["eligibleStyleIds"] == (["halloween","summer"] if tier == "large" and bet >= 50 else ["halloween"])
                    assert unlocked(value) == {entry["clipId"]}
        checks.append("19-20-and-49-50-boundaries-with-constant-50-percent-special-total")

        for weapon,mult in (("Flower",6),("Rocket",15)):
            winning = None
            seq = [frame({"Weapon"+weapon:True},(0,0),True),frame()]
            for seed in range(1,101):
                value = run(boards["medium",10],sequence=seq,seed=seed)
                if value["stats"]["captures"]:
                    entry = reveal(value,"medium")
                    assert value["stats"]["spent"] == 10*mult and entry["baseBet"] == 10
                    assert entry["styleId"] == "classic" and not entry["styleEligible"] and value["variantStats"]["styleRolls"] == 0
                    winning = seed;break
            assert winning is not None
        checks.append("high-round-cost-does-not-bypass-base-bet-20-or-50")

        small_board = fixture("yeseul-small-50",tier="small",bet=50)
        small_winning = None
        for seed in range(1,101):
            value = run(small_board,sequence=shot,seed=seed)
            if value["stats"]["captures"]:
                assert value["variantStats"]["styleRolls"] == 0 and unlocked(value) == {"yeseul-classic-small"}
                assert value["rewardFx"][0]["clipId"] == "yeseul-classic-small"
                assert value["rewardFx"][0]["clipDuration"] == 4.041667
                small_winning = seed;break
        assert small_winning is not None
        checks.append("natural-small-remains-classic-without-style-RNG-at-high-base")

        summer_seed = variants["summer"][0]
        upward = [shot[0],frame({"BetUp":True})]
        for bet in (19,49):
            value = run(boards["large",bet],sequence=upward,seed=summer_seed)
            entry = reveal(value,"large")
            assert entry and entry["baseBet"] == bet and value["bet"] == (20 if bet == 19 else 50)
            assert entry["styleEligible"] == (bet >= 20) and entry["styleId"] != "summer"
        downward = [shot[0],frame({"BetDown":True})]
        value = run(boards["large",50],sequence=downward,seed=summer_seed)
        assert value["bet"] == 20 and reveal(value,"large")["baseBet"] == 50 and reveal(value,"large")["styleId"] == "summer"
        checks.append("immutable-firing-base-bet-controls-inflight-style-eligibility")

        for character in ("mugi","jiayi"):
            for tier in ("medium","large"):
                board = fixture(f"{character}-{tier}-50",tier=tier,character=character,bet=50)
                for seed,expected in ((6,"classic"),(27,"christmas")):
                    value = run(board,sequence=shot,seed=seed)
                    entry = reveal(value,tier)
                    assert entry and entry["styleId"] == expected and entry["christmasEligible"] and entry["eligibleStyleIds"] == ["christmas"]
                    assert value["variantStats"]["styleRolls"] == 1 and value["variantStats"]["christmasWins"] == (expected == "christmas")
        checks.append("legacy-Mugi-Jiayi-Christmas-seeds-and-one-roll-contract-preserved")

        for clip_id in ("yeseul-halloween-medium","yeseul-halloween-large","yeseul-summer-large","mugi-christmas-medium"):
            value = run(empty,frames=3,sequence=[frame({"PreviewClip:"+clip_id:True})])
            assert not value.get("reveal") and not value["mediumReveals"] and not unlocked(value)
            assert value["stats"]["spent"] == value["stats"]["won"] == value["variantStats"]["styleRolls"] == 0
        for tier in ("small","medium","large"):
            action = {"small":"PreviewSmall","medium":"PreviewMedium","large":"PreviewLarge"}[tier]
            value = run(empty,frames=3,sequence=[frame({action:True})])
            entry = value["rewardFx"][0] if tier == "small" else reveal(value,tier)
            assert entry["clipId"] == f"yeseul-classic-{tier}" and entry["preview"] and not unlocked(value)
            assert value["stats"]["spent"] == value["stats"]["won"] == value["variantStats"]["styleRolls"] == 0
        checks.append("nonclassic-preview-lock-and-zero-credit-default-classic-previews")

        settled = {}
        for style,(seed,_,entry) in variants.items():
            seq = padded(shot,400)
            seq[100] = frame({"CloseReveal":True})
            value = run(boards["large",50],frames=400,sequence=seq,seed=seed)
            assert value["pendingWin"] == 0 and value["balance"] == value["displayBalance"] and not value.get("reveal")
            assert unlocked(value) == {f"yeseul-{style}-large"} and value["stats"]["shots"] == 1
            settled[style] = {"seed":seed,"amount":value["stats"]["won"],"collected":value["collectedWin"]}
            before = value
            seq += [frame({"PreviewClip:mugi-christmas-large":True}),frame()]
            crossed = run(boards["large",50],frames=402,sequence=seq,seed=seed)
            assert not crossed.get("reveal") and crossed["stats"] == before["stats"] and unlocked(crossed) == unlocked(before)
            seq += [frame({"PreviewClip:"+entry["clipId"]:True}),frame()]
            value = run(boards["large",50],frames=404,sequence=seq,seed=seed)
            assert reveal(value,"large")["preview"] and reveal(value,"large")["clipId"] == entry["clipId"]
            assert value["stats"] == before["stats"] and value["variantStats"] == before["variantStats"] and unlocked(value) == unlocked(before)
        checks.append("all-three-natural-large-styles-settle-exactly-and-replay-without-duplicate-credit")

    print(json.dumps({"ok":True,"mode":"yeseul-focused","nativeRuns":runs,"variantSeeds":{style:value[0] for style,value in variants.items()},"settled":settled,"checks":checks},ensure_ascii=False))


if __name__ == "__main__":
    main()
