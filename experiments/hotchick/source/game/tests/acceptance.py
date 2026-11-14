"""Native Unone acceptance; fixtures change starting data, never gameplay rules.

Run with TEMP/TMP on a drive with space and --sdk <final-sdk/bin/game.exe>.
"""
from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def frame(actions=None, point=None, down=False):
    value = {"actions": actions or {}}
    if point is not None:
        value["pointer"] = {"position": {"x": point[0], "y": point[1]}, "down": down}
    return value


def padded(sequence, count):
    return sequence[:count]+[frame() for _ in range(max(0,count-len(sequence)))]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk", required=True, type=Path)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--viewport-only", action="store_true", help="Run only portrait/landscape input and in-flight settlement checks")
    args = parser.parse_args()
    project, sdk = args.project.resolve(), args.sdk.resolve()
    source = (project/"scripts/main.luau").read_text(encoding="utf-8")
    config = json.loads((project/"project.unone.json").read_text(encoding="utf-8-sig"))
    runs = 0
    with tempfile.TemporaryDirectory(prefix="hotchick-native-") as scratch:
        root = Path(scratch)
        input_file = root/"input.json"

        def fixture(name, counts=(0,0,0), lane=None, x=None, miss=False, funds=10000, slow=False, extra=()):
            directory = root/name
            directory.mkdir()
            text = source
            for tier, old, count in zip(("small","medium","large"),(18,6,3),counts):
                old_line = f'for _ = 1, {old} do table.insert(targets, createTarget(api, "{tier}", true)) end'
                assert text.count(old_line) == 1
                text = text.replace(old_line,old_line.replace(f"1, {old}",f"1, {count}"))
            if lane is not None:
                text = text.replace("local lane = randomRange(api, -2.65, 2.85)",f"local lane = {lane}")
                text = text.replace("speed=randomRange(api, 0.30, 0.65)","speed=0")
            if x is not None:
                text = text.replace("local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4",
                                    f"local x = if initial then {x} else -direction * 9.4")
            if miss:
                text, changed = re.subn(r"(?m)^(local ODDS: .*? = )\{[^\n]+\}$",
                                        lambda m:m[1]+"{small=0, medium=0, large=0}",text)
                assert changed == 1
            if funds != 10000:
                text, changed = re.subn(r"(?m)^([ \t]*(?:local )?(?:balance|displayBalance) = )10000$",
                                        lambda m:m[1]+str(funds),text)
                assert changed == 4
            if slow: text = text.replace("local NORMAL_SPEED = 170*DT2_SPEED_SCALE","local NORMAL_SPEED = 0.001")
            for old,new in extra:
                assert old in text
                text = text.replace(old,new)
            (directory/"project.unone.json").write_text(json.dumps(dict(config,entry_script="main.luau",main_scene="main.scene.json",test_files=[])),encoding="utf-8")
            (directory/"main.luau").write_text(text,encoding="utf-8")
            shutil.copyfile(project/"scenes/main.scene.json",directory/"main.scene.json")
            return directory,sum(counts),funds

        default = project,27,10000
        empty = fixture("empty")
        near = fixture("near",(1,0,0),lane=-1.8,x=0,miss=True)
        far = fixture("far",(1,0,0),lane=2.6,x=0,miss=True)
        slow = fixture("ttl",slow=True)
        low = fixture("low",(1,0,0),lane=0,x=0,funds=10)
        rate_empty = fixture("rate-empty",funds=1000000)
        rate_near = fixture("rate-near",(1,0,0),lane=-1.8,x=0,miss=True,funds=1000000)
        rate_five = fixture("rate-five",(5,0,0),lane=-1.8,x=0,miss=True,funds=1000000)
        dense_medium = fixture("dense-medium",(0,60,0),lane=0,x=0)
        dense_small = fixture("dense-small",(400,0,0),lane=0,x=0)
        character_line = 'local characterId = SPAWN_CHARACTER_ORDER[(spawnCharacterSequence-1)%#SPAWN_CHARACTER_ORDER+1]'
        force_mugi = ((character_line,'local characterId = "mugi"'),)
        force_jiayi = ((character_line,'local characterId = "jiayi"'),)
        force_original = ((character_line,'local characterId = "original"'),)
        start_at_50 = (("betIndex = 3","betIndex = 5"),)
        mugi10 = fixture("mugi10",(0,1,0),lane=0,x=0,extra=force_mugi)
        mugi49 = fixture("mugi49",(0,1,0),lane=0,x=0,extra=force_mugi+(("local BETS = {1, 5, 10, 20, 50}","local BETS = {1, 5, 49, 50, 100}"),))
        mugi50 = fixture("mugi50",(0,1,0),lane=0,x=0,extra=force_mugi+start_at_50)
        mugi_large50 = fixture("mugi-large50",(0,0,1),lane=0,x=0,extra=force_mugi+start_at_50)
        original50 = fixture("original50",(0,1,0),lane=0,x=0,extra=force_original+start_at_50)
        mugi_small1 = fixture("mugi-small1",(1,0,0),lane=0,x=0,extra=force_mugi+(("betIndex = 3","betIndex = 1"),))
        mugi_small50 = fixture("mugi-small50",(1,0,0),lane=0,x=0,extra=force_mugi+start_at_50)
        jiayi10 = fixture("jiayi10",(0,1,0),lane=0,x=0,extra=force_jiayi)
        jiayi49 = fixture("jiayi49",(0,1,0),lane=0,x=0,extra=force_jiayi+(("local BETS = {1, 5, 10, 20, 50}","local BETS = {1, 5, 49, 50, 100}"),))
        jiayi50 = fixture("jiayi50",(0,1,0),lane=0,x=0,extra=force_jiayi+start_at_50)
        jiayi_large50 = fixture("jiayi-large50",(0,0,1),lane=0,x=0,extra=force_jiayi+start_at_50)
        jiayi_small50 = fixture("jiayi-small50",(1,0,0),lane=0,x=0,extra=force_jiayi+start_at_50)
        all_original = fixture("all-original",(18,6,3),extra=force_original)
        crossing = fixture("crossing",(1,1,0),lane=-1.8,x='(if tier == "small" then 0 else 1.4)',miss=True,extra=(
            ("speed=0",'speed=if tier == "small" then 0 else 1.2'),
            ("phase=randomRange(api, 0, math.pi * 2)","phase=0"),
            ("local direction = if api.random.nextInt(0, 1) == 0 then -1 else 1","local direction = -1"),
        ))

        def run(frames=1, sequence=None, seed=42, board=default):
            nonlocal runs
            directory,count,initial = board
            input_file.write_text(json.dumps(padded(sequence or [],frames)),encoding="utf-8")
            result = subprocess.run([str(sdk),"run","--project",str(directory),"--frames",str(frames),"--seed",str(seed),
                                     "--input-sequence",str(input_file),"--json"],text=True,encoding="utf-8",capture_output=True)
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"],payload.get("diagnostics",result.stderr)
            state = payload["value"]["world"]["observations"]["game"]
            runs += 1
            assert len(state["targets"]) == count
            assert state["balance"] == initial-state["stats"]["spent"]+state["stats"]["won"]
            assert state["displayBalance"] == initial-state["stats"]["spent"]+state["collectedWin"] >= 0
            assert state["balance"]-state["displayBalance"] == state["pendingWin"] >= 0
            assert state["pendingWin"]+state["collectedWin"] == state["stats"]["won"]
            if state["viewportBlocked"]:
                assert not state["canShoot"] and not state["auto"] and not state["lock"]
            assert len(state["rewardFx"]) <= 6 and len(state["fxHearts"]) <= 192
            assert 0 <= state["cooldownProgress"] <= 1
            assert abs(state["roundsPerSecond"]*state["roundInterval"]-1) < 1e-9
            videos = [entry for entry in state["mediumReveals"] if entry["stage"] == "video"]
            assert len(videos) == state["mediumVideoCount"] <= 6
            assert len({entry["slot"] for entry in videos}) == len(videos)
            assert len({entry["serial"] for entry in state["mediumReveals"]}) == len(state["mediumReveals"])
            assert all(1 <= entry["slot"] <= 6 for entry in state["mediumReveals"])
            assert state["mediumPreviewOutstanding"] <= 6
            if state.get("reveal"):
                assert state["reveal"]["tier"] == "large" and not state["mediumReveals"]
            if state["largeQueueCount"] > 0: assert not state["canShoot"]
            assert len({h["id"] for h in state["fxHearts"]}) == len(state["fxHearts"])
            assert 0 <= state["walletPulse"] <= 1
            for fx in state["rewardFx"]:
                assert fx["collectedAmount"] == fx["amount"]*fx["arrivedCount"]//fx["count"]
                assert fx["count"] == {"small":4,"medium":16,"large":32}[fx["rewardTier"]]
                assert fx["clipId"].startswith(fx["characterId"]+"-"+fx["styleId"]+"-")
                if fx["preview"]: assert fx["amount"] == fx["collectedAmount"] == 0
            for shot in state["shots"]:
                assert all(math.isfinite(shot[k]) for k in ("x","y","rotation","vx","vy"))
                assert shot["trajectory"] in ("straight","track","arc","snapshot")
                assert shot["cost"] == shot["bet"]*{"like":1,"flower":6,"rocket":15}[shot["weapon"]]
            return state

        def target(seed,tier,board=default):
            state = run(seed=seed,board=board)
            rank = {"small":1,"medium":2,"large":3}
            for candidate in state["targets"]:
                if candidate["tier"] != tier or not -7 < candidate["x"] < 6: continue
                if not any(rank[t["tier"]] > rank[tier] and math.hypot(t["x"]-candidate["x"],t["y"]-candidate["y"]) < t["diameter"]*.6 for t in state["targets"]):
                    return candidate
            raise AssertionError("No unobscured fixture target")

        def locked_once(t):
            return [frame({"ToggleLock":True},(t["x"],t["y"]),True),frame(),frame({"ToggleLock":True})]

        def gallery_items(state):
            return {item["clipId"]:item for character in state["gallery"]["characters"]
                    for style in character["styles"] for item in style["items"]}

        def unlocked_ids(state):
            return {clip_id for clip_id,item in gallery_items(state).items() if item["unlocked"]}

        def capture(board,tier="medium",weapon="Like",seed_limit=100):
            for seed in range(1,seed_limit+1):
                t = target(seed,tier,board)
                seq = locked_once(t) if weapon == "Like" else [frame({"Weapon"+weapon:True},(t["x"],t["y"]),True)]
                state = run(90,seq,seed=seed,board=board)
                if state["stats"]["captures"]:
                    entry = state["reveal"] if tier == "large" else (state["mediumReveals"][0] if tier == "medium" else state["rewardFx"][0])
                    return seed,seq,state,entry
                assert state["variantStats"]["styleRolls"] == 0
            raise AssertionError("No natural capture in replay seeds")

        def round_count(frames,interval,start=1):
            return 0 if frames < start else 1+math.floor((frames-start)/60/interval+1e-8)

        def assert_schedule(state,interval,first_frame=1):
            count = state["stats"]["shots"]
            frames = round(state["time"]*60)
            expected = round_count(frames,interval,first_frame)
            assert expected-1 <= count <= expected,(count,expected,interval,frames)
            ideal_last = first_frame/60+(count-1)*interval
            assert -1e-7 <= state["lastRound"]["firedAt"]-ideal_last <= 1/60+1e-7
            assert state["time"] < first_frame/60+count*interval+1/60+1e-7
            assert abs(state["roundInterval"]-interval) < 1e-12
            assert abs(state["cooldownDuration"]-interval) < 1e-12

        def check_viewport():
            desktop = run(board=near)
            assert not desktop["viewportBlocked"] and not desktop["viewportNeedsFreshInput"] and desktop["canShoot"]
            t = desktop["targets"][0]
            point = t["x"],t["y"]
            simultaneous = run(1,[frame({"ViewportPortrait":True,"ToggleAuto":True,"ToggleLock":True,"Fire":True},point,True)],board=near)
            assert simultaneous["viewportBlocked"] and simultaneous["stats"]["shots"] == 0
            held = [frame({"ToggleLock":True},point,True)]+[frame(point=point,down=True) for _ in range(29)]
            held.extend(frame({"Fire":True},point,True) for _ in range(61))
            held[30] = frame({"ViewportPortrait":True,"Fire":True},point,True)
            held[31] = frame({"ToggleAuto":True,"ToggleLock":True,"Fire":True},point,True)
            portrait = run(90,held[:90],board=near)
            paid_before = round_count(30,.12)
            assert portrait["stats"]["shots"] == paid_before and portrait["stats"]["spent"] == paid_before*10
            held[90] = frame({"ViewportLandscape":True,"Fire":True},point,True)
            landscape = run(91,held,board=near)
            assert not landscape["viewportBlocked"] and landscape["viewportNeedsFreshInput"]
            assert not landscape["auto"] and not landscape["lock"] and not landscape["canShoot"]
            assert landscape["stats"]["shots"] == paid_before
            pointer_resume = held+[frame(),frame(point=(5,2),down=True),frame(point=(5,2),down=True)]
            pointer = run(94,pointer_resume,board=near)
            assert pointer["stats"]["shots"] == paid_before+1 and not pointer["viewportNeedsFreshInput"]
            assert not pointer["auto"] and not pointer["lock"]
            assert abs(pointer["lastRound"]["firedAt"]-93/60) < 1e-7
            key_resume = held+[frame(),frame({"Fire":True}),frame({"Fire":True})]
            key = run(94,key_resume,board=near)
            assert key["stats"]["shots"] == paid_before+1 and not key["viewportNeedsFreshInput"]
            assert abs(key["lastRound"]["firedAt"]-93/60) < 1e-7
            reset_seq = [frame({"ViewportPortrait":True,"Fire":True},point,True),
                         frame({"DemoReset":True,"Fire":True},point,True),
                         frame({"ToggleAuto":True,"ToggleLock":True,"Fire":True},point,True)]
            reset_portrait = run(3,reset_seq,board=near)
            assert reset_portrait["viewportBlocked"] and reset_portrait["stats"]["shots"] == 0
            reset_seq.append(frame({"ViewportLandscape":True,"Fire":True},point,True))
            reset_landscape = run(4,reset_seq,board=near)
            assert not reset_landscape["viewportBlocked"] and reset_landscape["viewportNeedsFreshInput"]
            assert reset_landscape["stats"]["shots"] == 0
            reset_seq.extend([frame(),frame({"Fire":True})])
            reset_fresh = run(6,reset_seq,board=near)
            assert reset_fresh["stats"]["shots"] == 1 and not reset_fresh["viewportNeedsFreshInput"]

            inflight = {}
            # Find a natural capture, then replay exactly its shot with only
            # orientation/input changed. No odds or outcome override is used.
            for tier,board in (("small",jiayi_small50),("medium",jiayi50),("large",jiayi_large50)):
                seed,winning_seq,baseline,_ = capture(board,tier)
                point_data = winning_seq[0]["pointer"]["position"]
                point = point_data["x"],point_data["y"]
                seq = [winning_seq[0]]
                seq.extend(frame({"Fire":True},point,True) for _ in range(899))
                seq[1] = frame({"ViewportPortrait":True,"Fire":True},point,True)
                seq[2] = frame({"ToggleAuto":True,"ToggleLock":True,"Fire":True},point,True)
                before_collect = run(90,seq[:90],seed=seed,board=board)
                assert before_collect["viewportBlocked"] and before_collect["stats"]["shots"] == before_collect["stats"]["captures"] == 1,(tier,seed,before_collect["stats"])
                assert before_collect["stats"] == baseline["stats"]
                assert before_collect["pendingWin"] == before_collect["stats"]["won"] > 0
                settled = run(900,seq,seed=seed,board=board)
                assert settled["viewportBlocked"] and settled["stats"] == before_collect["stats"]
                assert settled["pendingWin"] == 0 and settled["displayBalance"] == settled["balance"]
                assert not settled.get("reveal") and not settled["mediumReveals"] and not settled["rewardFx"]
                assert settled["rewardFxPendingCount"] == 0 and len(unlocked_ids(settled)) == 1
                inflight[tier] = {"shots":settled["stats"]["shots"],"won":settled["stats"]["won"],
                                  "displayBalance":settled["displayBalance"],"pendingWin":settled["pendingWin"]}
            return {"checks":["native-desktop-default-unblocked","portrait-cancels-AUTO-Lock-and-all-new-shots",
                              "blocked-toggle-and-Fire-rejected","landscape-never-resumes-stale-held-input",
                              "fresh-pointer-and-key-resume-once-without-catchup","portrait-survives-DemoReset",
                              "small-medium-large-inflight-settlement-continues"],"inflight":inflight}

        viewport_report = check_viewport()
        if args.viewport_only:
            print(json.dumps({"ok":True,"mode":"viewport-only","nativeRuns":runs,**viewport_report},ensure_ascii=False))
            return

        # Character assignment is separate from all outcome randomness. Gallery
        # availability and unlock state come exclusively from the Luau catalog.
        mixed = run()
        original_board = run(board=all_original)
        assert [t["characterId"] for t in mixed["targets"]] == [("eunbi","yeseul","original","mugi","jiayi")[i%5] for i in range(27)]
        for tier in ("small","medium"):
            assert {t["characterId"] for t in mixed["targets"] if t["tier"] == tier} == {"original","mugi","jiayi","yeseul","eunbi"}
        assert {t["characterId"] for t in mixed["targets"] if t["tier"] == "large"} == {"jiayi","eunbi","yeseul"}
        assert [(t["id"],t["x"],t["y"]) for t in mixed["targets"]] == [(t["id"],t["x"],t["y"]) for t in original_board["targets"]]
        assert mixed["gallery"]["defaultCharacterId"] == "eunbi"
        assert [c["id"] for c in mixed["gallery"]["characters"]] == ["eunbi","yeseul","jiayi","mugi","original"]
        assert mixed["gallery"]["characters"][0]["name"] == "恩妃"
        assert set(mixed["demoConfig"]["christmasCharacterIds"]) == {"jiayi","mugi"}
        assert mixed["demoConfig"]["smallWinChance"] == .40 and mixed["demoConfig"]["mediumWinChance"] == .16 and mixed["demoConfig"]["largeWinChance"] == .10
        catalog = gallery_items(mixed)
        assert len(catalog) == 23 and all(item["available"] for item in catalog.values())
        assert "mugi-christmas-small" not in catalog
        assert "original-classic-small" not in catalog and not unlocked_ids(mixed)
        assert catalog["mugi-classic-small"]["replayAsset"] == "mugi/field-small.mp4"
        assert catalog["mugi-classic-small"]["duration"] == 4.041667
        assert catalog["jiayi-classic-small"]["duration"] == 5.041667
        assert catalog["jiayi-classic-small"]["replayAsset"] == "jiayi/field-small.mp4"
        assert "jiayi-christmas-small" not in catalog
        for clip_id in ("mugi-christmas-medium","mugi-christmas-large","jiayi-christmas-medium","jiayi-christmas-large"):
            rejected = run(2,[frame({"PreviewClip:"+clip_id:True})],board=empty)
            assert not rejected.get("reveal") and not rejected["mediumReveals"]
            assert rejected["variantStats"]["styleRolls"] == 0 and rejected["stats"]["won"] == 0
            assert not unlocked_ids(rejected)
        classic_preview = run(2,[frame({"PreviewClip:mugi-classic-medium":True})],board=mugi50)
        assert classic_preview["mediumReveals"][0]["preview"] and classic_preview["mediumReveals"][0]["baseBet"] == 0
        assert classic_preview["variantStats"]["styleRolls"] == 0 and not unlocked_ids(classic_preview)

        seed49,seq49,below49,entry49 = capture(mugi49)
        assert below49["bet"] == entry49["baseBet"] == 49
        assert entry49["clipId"] == "mugi-classic-medium" and not entry49["christmasEligible"] and not entry49["styleRollApplied"]
        assert below49["variantStats"]["styleRolls"] == 0 and entry49["styleRoll"] == -1
        assert unlocked_ids(below49) == {"mugi-classic-medium"}
        high_cost_cases = {}
        for weapon,cost in (("Flower",60),("Rocket",150)):
            high_seed,high_seq,high_cost,high_entry = capture(mugi10,weapon=weapon)
            high_cost_cases[weapon] = high_seed,high_seq,high_cost,high_entry
            assert high_cost["stats"]["lastCost"] == cost and high_entry["baseBet"] == 10
            assert not high_entry["christmasEligible"] and high_entry["clipId"] == "mugi-classic-medium"
            assert high_cost["variantStats"]["styleRolls"] == 0
        _,_,old_character,old_entry = capture(original50)
        assert old_entry["baseBet"] == 50 and old_entry["clipId"] == "original-classic-medium"
        assert not old_entry["christmasEligible"] and old_character["variantStats"]["styleRolls"] == 0
        assert unlocked_ids(old_character) == {"original-classic-medium"}
        small_seed,small_seq,small_high,small_high_fx = capture(mugi_small50,"small")
        assert small_high_fx["baseBet"] == 50 and small_high_fx["clipId"] == "mugi-classic-small"
        assert small_high["variantStats"]["styleRolls"] == 0 and unlocked_ids(small_high) == {"mugi-classic-small"}

        # Natural qualified wins cover both sides of the actual 50% draw for
        # medium and large symbols. Each success unlocks exactly its own clip.
        qualified = {}
        for tier,board in (("medium",mugi50),("large",mugi_large50)):
            variants = {}
            low_reward_large = False
            for seed in range(1,201):
                t = target(seed,tier,board)
                seq = locked_once(t)
                state = run(90,seq,seed=seed,board=board)
                if not state["stats"]["captures"]:
                    assert state["variantStats"]["styleRolls"] == 0
                    continue
                entry = state["mediumReveals"][0] if tier == "medium" else state["reveal"]
                assert entry["baseBet"] == 50 and entry["christmasEligible"] and entry["styleRollApplied"]
                style = "christmas" if entry["styleRoll"] < .5 else "classic"
                assert entry["styleId"] == style and entry["clipId"] == f"mugi-{style}-{tier}"
                assert state["variantStats"]["styleRolls"] == 1
                assert state["variantStats"]["christmasWins"] == (1 if style == "christmas" else 0)
                assert unlocked_ids(state) == {entry["clipId"]}
                assert entry["symbolTier"] == tier and entry["videoAsset"].endswith("medium-480.mp4" if tier == "medium" else "large.mp4")
                assert entry["duration"] == (5.041667 if tier == "medium" else 8.041667)
                if tier == "large" and entry["rewardTier"] == "small":
                    low_reward_large = True
                    assert entry["duration"] > 8
                variants.setdefault(style,(seed,seq,state,entry))
                if len(variants) == 2 and (tier == "medium" or low_reward_large): break
            assert set(variants) == {"classic","christmas"}
            assert tier != "large" or low_reward_large
            qualified[tier] = variants

        # The immutable round bet controls eligibility even if the UI changes
        # 10->50 or 50->10 before the already-fired tracking shot arrives.
        t = target(seed49,"medium",mugi10)
        switched_up = locked_once(t)
        switched_up[1] = frame({"BetUp":True})
        switched_up.append(frame({"BetUp":True}))
        old_ten = run(90,switched_up,seed=seed49,board=mugi10)
        assert old_ten["bet"] == 50 and old_ten["mediumReveals"][0]["baseBet"] == 10
        assert old_ten["variantStats"]["styleRolls"] == 0
        t = target(seed49,"medium",mugi50)
        switched_down = locked_once(t)
        switched_down[1] = frame({"BetDown":True})
        switched_down.append(frame({"BetDown":True}))
        old_fifty = run(90,switched_down,seed=seed49,board=mugi50)
        assert old_fifty["bet"] == 10 and old_fifty["mediumReveals"][0]["baseBet"] == 50
        assert old_fifty["variantStats"]["styleRolls"] == 1

        santa_seed,santa_seq,_,santa_entry = qualified["medium"]["christmas"]
        santa_done = run(900,santa_seq,seed=santa_seed,board=mugi50)
        replay = padded(santa_seq,906)
        replay[900] = frame({"PreviewClip:"+santa_entry["clipId"]:True})
        replay[902] = frame({"GalleryOpen":True})
        replay[904] = frame({"GalleryClose":True})
        replayed = run(906,replay,seed=santa_seed,board=mugi50)
        assert replayed["mediumReveals"][0]["clipId"] == santa_entry["clipId"] and replayed["mediumReveals"][0]["preview"]
        assert replayed["stats"] == santa_done["stats"] and replayed["balance"] == santa_done["balance"]
        assert replayed["variantStats"] == santa_done["variantStats"] and unlocked_ids(replayed) == {santa_entry["clipId"]}
        reset_collection = padded(replay,907)
        reset_collection[906] = frame({"DemoReset":True})
        cleared = run(907,reset_collection,seed=santa_seed,board=mugi50)
        assert not unlocked_ids(cleared) and cleared["variantStats"]["styleRolls"] == 0

        # Jiayi mirrors the same rules through role data, rather than a second
        # special-case branch. Replaying identical native seeds/inputs preserves
        # outcomes and style draws while selecting only Jiayi's exact clip.
        jiayi_below = run(90,seq49,seed=seed49,board=jiayi49)
        je = jiayi_below["mediumReveals"][0]
        assert jiayi_below["stats"] == below49["stats"] and je["baseBet"] == 49
        assert je["clipId"] == "jiayi-classic-medium" and not je["christmasEligible"]
        assert jiayi_below["variantStats"]["styleRolls"] == 0
        assert unlocked_ids(jiayi_below) == {"jiayi-classic-medium"}
        for weapon,cost in (("Flower",60),("Rocket",150)):
            high_seed,high_seq,old_state,_ = high_cost_cases[weapon]
            js = run(90,high_seq,seed=high_seed,board=jiayi10)
            je = js["mediumReveals"][0]
            assert js["stats"] == old_state["stats"] and js["stats"]["lastCost"] == cost
            assert je["baseBet"] == 10 and not je["christmasEligible"] and je["clipId"] == "jiayi-classic-medium"
            assert js["variantStats"]["styleRolls"] == 0 and unlocked_ids(js) == {"jiayi-classic-medium"}
        jiayi_small = run(90,small_seq,seed=small_seed,board=jiayi_small50)
        assert jiayi_small["stats"] == small_high["stats"]
        assert jiayi_small["rewardFx"][0]["clipId"] == "jiayi-classic-small"
        assert jiayi_small["rewardFx"][0]["clipDuration"] == 5.041667
        assert jiayi_small["variantStats"]["styleRolls"] == 0 and unlocked_ids(jiayi_small) == {"jiayi-classic-small"}
        jiayi_qualified = {}
        for tier,board in (("medium",jiayi50),("large",jiayi_large50)):
            variants = {}
            for style,(seed,seq,old_state,old_entry) in qualified[tier].items():
                js = run(90,seq,seed=seed,board=board)
                je = js["mediumReveals"][0] if tier == "medium" else js["reveal"]
                assert js["stats"] == old_state["stats"] and js["variantStats"] == old_state["variantStats"]
                assert je["styleRoll"] == old_entry["styleRoll"] and je["christmasEligible"] and je["styleRollApplied"]
                assert je["baseBet"] == 50 and je["clipId"] == f"jiayi-{style}-{tier}"
                assert unlocked_ids(js) == {je["clipId"]}
                assert je["videoAsset"] == f'jiayi/{style}-{tier}'+("-480.mp4" if tier == "medium" else ".mp4")
                assert je["duration"] == (5.041667 if tier == "medium" else 8.041667)
                assert abs(je["aspectRatio"]-(9/16 if tier == "medium" else 16/9)) < 1e-12
                variants[style] = seed,seq,js,je
            jiayi_qualified[tier] = variants
        jiayi_up = run(90,switched_up,seed=seed49,board=jiayi10)
        assert jiayi_up["stats"] == old_ten["stats"] and jiayi_up["bet"] == 50
        assert jiayi_up["mediumReveals"][0]["baseBet"] == 10 and jiayi_up["variantStats"]["styleRolls"] == 0
        jiayi_down = run(90,switched_down,seed=seed49,board=jiayi50)
        assert jiayi_down["stats"] == old_fifty["stats"] and jiayi_down["bet"] == 10
        assert jiayi_down["mediumReveals"][0]["baseBet"] == 50 and jiayi_down["variantStats"]["styleRolls"] == 1
        jseed,jseq,_,jentry = jiayi_qualified["medium"]["christmas"]
        jdone = run(900,jseq,seed=jseed,board=jiayi50)
        jreplay = padded(jseq,904)
        jreplay[900] = frame({"PreviewClip:mugi-christmas-medium":True})
        crossed = run(902,jreplay[:902],seed=jseed,board=jiayi50)
        assert not crossed["mediumReveals"] and unlocked_ids(crossed) == {jentry["clipId"]}
        jreplay[902] = frame({"PreviewClip:jiayi-christmas-medium":True})
        jplayed = run(904,jreplay,seed=jseed,board=jiayi50)
        assert jplayed["mediumReveals"][0]["preview"] and jplayed["mediumReveals"][0]["clipId"] == jentry["clipId"]
        assert jplayed["stats"] == jdone["stats"] and jplayed["variantStats"] == jdone["variantStats"]
        assert jplayed["balance"] == jdone["balance"] and unlocked_ids(jplayed) == {jentry["clipId"]}

        # Small monetary awards still use user-confirmed tier counts 4/16/32,
        # including cases with fewer points than hearts. Remainders are exact.
        heart_examples = {}
        for seed in range(1,81):
            t = target(seed,"small",mugi_small1)
            seq = locked_once(t)
            state = run(90,seq,seed=seed,board=mugi_small1)
            if not state["stats"]["captures"]: continue
            fx = state["rewardFx"][0]
            level = fx["rewardTier"]
            if level in heart_examples: continue
            count = {"small":4,"medium":16,"large":32}[level]
            assert fx["count"] == count and 2 <= fx["amount"] <= 6 and fx["baseBet"] == 1
            start = state["lastRound"]["resolvedAt"]+.65
            partial = run(math.ceil((start+1.30)*60),seq,seed=seed,board=mugi_small1)
            assert 9999 < partial["displayBalance"] < partial["balance"]
            complete = run(math.ceil((start+1.46)*60),seq,seed=seed,board=mugi_small1)
            assert complete["rewardFx"][0]["arrivedCount"] == count
            assert complete["rewardFx"][0]["collectedAmount"] == fx["amount"] and complete["pendingWin"] == 0
            assert complete["displayBalance"] == complete["balance"] == 9999+fx["amount"]
            heart_examples[level] = {"amount":fx["amount"],"count":count}
            if len(heart_examples) == 3: break
        assert set(heart_examples) == {"small","medium","large"}

        # Native 60Hz cadence preserves fractional-frame phase for a full minute,
        # unlike restarting .12s from each rounded render/simulation frame.
        rate_target = run(board=rate_near)["targets"][0]
        rate_point = rate_target["x"],rate_target["y"]
        cadence_counts = {}
        for weapon,interval,multiplier in (("Like",.12,1),("Flower",4/15,6),("Rocket",.2,15)):
            board = rate_empty if weapon == "Like" else rate_near
            hold = [frame({"Weapon"+weapon:True,"Fire":weapon == "Like"},None if weapon == "Like" else rate_point,weapon != "Like")]
            hold.extend(frame({"Fire":True}) if weapon == "Like" else frame(point=rate_point,down=True) for _ in range(3599))
            short = run(600,hold[:600],board=board)
            manual = run(3600,hold,board=board)
            automatic = run(3600,[frame({"Weapon"+weapon:True,"ToggleAuto":True})],board=board)
            for state in (short,manual,automatic):
                assert_schedule(state,interval)
                assert state["stats"]["spent"] == state["stats"]["shots"]*10*multiplier
            assert manual["stats"]["shots"] == automatic["stats"]["shots"]
            cadence_counts[weapon] = manual["stats"]["shots"]
            before = {"Like":8,"Flower":16,"Rocket":12}[weapon]
            after = {"Like":9,"Flower":18,"Rocket":14}[weapon]
            assert run(before,hold[:before],board=board)["stats"]["shots"] == 1
            assert run(after,hold[:after],board=board)["stats"]["shots"] == 2
        lock_rate = run(3600,[frame({"ToggleLock":True},rate_point,True)],board=rate_near)
        assert_schedule(lock_rate,.12)
        rockets = run(2,[frame({"WeaponRocket":True},rate_point,True)],board=rate_five)
        assert len(rockets["shots"]) == 5 and rockets["stats"]["shots"] == 1 and rockets["stats"]["spent"] == 150

        # Idle, gallery, and missing-target pauses discard scheduling debt.
        burst_fire = [frame({"Fire":True}) for _ in range(30)]
        idle_resume = padded(burst_fire,602)
        idle_resume[600] = frame({"Fire":True})
        idle_resume[601] = frame({"Fire":True})
        resumed = run(602,idle_resume,board=rate_empty)
        assert resumed["stats"]["shots"] == round_count(30,.12)+1
        assert abs(resumed["lastRound"]["firedAt"]-601/60) < 1e-7
        gallery_resume = burst_fire+[frame({"Fire":True}) for _ in range(572)]
        gallery_resume[30] = frame({"Fire":True,"GalleryOpen":True})
        gallery_resume[600] = frame({"Fire":True,"GalleryClose":True})
        resumed_gallery = run(602,gallery_resume,board=rate_empty)
        assert resumed_gallery["stats"]["shots"] == resumed["stats"]["shots"]
        assert abs(resumed_gallery["lastRound"]["firedAt"]-601/60) < 1e-7
        no_target = [frame({"WeaponFlower":True,"Fire":True})]+[frame({"Fire":True}) for _ in range(601)]
        no_target[600] = frame({"WeaponLike":True,"Fire":True})
        target_resume = run(602,no_target,board=rate_empty)
        assert target_resume["stats"]["shots"] == 1 and abs(target_resume["cooldownDuration"]-.12) < 1e-12
        large_pause = burst_fire+[frame({"Fire":True}) for _ in range(572)]
        large_pause[30] = frame({"Fire":True,"PreviewLarge":True})
        large_pause[39] = frame({"Fire":True,"CloseReveal":True})
        assert run(100,large_pause[:100],board=rate_empty)["stats"]["shots"] == round_count(30,.12)

        # Switching modes cannot cancel the previous shot's global deadline.
        switch = [frame({"WeaponRocket":True},rate_point,True)]
        switch.extend(frame({"Fire":True}) for _ in range(25))
        switch[1] = frame({"WeaponLike":True,"Fire":True})
        waiting = run(10,switch[:10],board=rate_near)
        assert waiting["stats"]["shots"] == 1 and abs(waiting["cooldownDuration"]-.2) < 1e-12
        switched = run(14,switch,board=rate_near)
        assert switched["stats"]["shots"] == 2 and switched["lastRound"]["weapon"] == "like"
        assert .2-1e-7 <= switched["lastRound"]["firedAt"]-1/60 <= .2+1/60+1e-7
        reverse = [frame({"Fire":True}),frame({"WeaponRocket":True,"Fire":True},rate_point,True)]
        reverse.extend(frame({"Fire":True}) for _ in range(7))
        quicker = run(9,reverse,board=rate_near)
        assert quicker["stats"]["shots"] == 2 and quicker["stats"]["spent"] == 160

        # A minute of natural small-award AUTO exercises the faster cadence and
        # six-group collection throughput without changing odds or prize values.
        fx_stress = []
        for frames in (600,1800,3600):
            stress = run(frames,[frame({"ToggleAuto":True})],seed=1,board=dense_small)
            assert stress["auto"] and stress["stats"]["shots"] == round_count(frames,.12)
            fx_stress.append({"seconds":round(stress["time"]),"active":len(stress["rewardFx"]),
                              "queued":stress["rewardFxPendingCount"],"pendingWin":stress["pendingWin"],
                              "won":stress["stats"]["won"],"collectedWin":stress["collectedWin"]})
        stop_stress = padded([frame({"ToggleAuto":True})],3601)
        stop_stress[3600] = frame({"ToggleAuto":True})
        drain_frames = 3601+math.ceil((2+math.ceil((stress["rewardFxPendingCount"]+len(stress["rewardFx"])+6)/6)*1.6)*60)
        stress_done = run(drain_frames,stop_stress,seed=1,board=dense_small)
        assert stress_done["stats"]["shots"] == stress["stats"]["shots"]
        assert stress_done["pendingWin"] == 0 and not stress_done["rewardFx"] and stress_done["rewardFxPendingCount"] == 0
        assert stress_done["displayBalance"] == stress_done["balance"]

        initial,moved = run(),run(60)
        assert initial["balance"] == initial["displayBalance"] == 10000 and initial["bet"] == 10
        assert moved["stats"]["shots"] == 0 and any(abs(a["x"]-b["x"]) > .1 for a,b in zip(initial["targets"],moved["targets"]))
        hover = run(2,[frame(point=(6,3))],board=empty)
        assert hover["aim"]["dirX"] == 0 and hover["aim"]["dirY"] == 1 and hover["stats"]["shots"] == 0
        blank = run(2,[frame(point=(6,2),down=True)],board=empty)
        assert blank["stats"]["shots"] == 1 and blank["balance"] == 9990 and blank["shots"][0]["x"] > 0
        horizontal = [frame(point=(7,-4.35),down=True)]
        released = run(150,horizontal,board=empty)
        assert released["stats"]["shots"] == 1
        drag = run(120,[frame(point=(-6 if i < 40 else 6,2),down=True) for i in range(120)],board=empty)
        assert drag["stats"]["shots"] == round_count(120,.12) and drag["aim"]["dirX"] > 0
        auto = run(120,[frame({"ToggleAuto":True},(7,-4.35),True)]+[frame(point=(-7,3)) for _ in range(119)],board=empty)
        assert auto["stats"]["shots"] == round_count(120,.12) and auto["aim"]["dirX"] == 1 and auto["aim"]["dirY"] == 0
        below = run(1,[frame(point=(-4,-9),down=True)],board=empty)
        assert below["aim"]["dirX"] == -1 and below["aim"]["dirY"] == 0
        wall1,wall2,wall3 = run(60,horizontal,board=empty),run(160,horizontal,board=empty),run(270,horizontal,board=empty)
        assert wall1["shots"][0]["collisionCount"] == 1 and wall1["shots"][0]["vx"] < 0
        assert wall2["shots"][0]["collisionCount"] == 2 and wall2["shots"][0]["vx"] > 0
        assert not wall3["shots"] and wall3["lastRound"]["status"] == "miss" and wall3["stats"]["spent"] == 10
        assert run(2090,horizontal,board=slow)["shots"] and not run(2110,horizontal,board=slow)["shots"]
        up = [frame(point=(0,4),down=True)]
        close,still,hit = run(22,up,board=near),run(22,up,board=far),run(60,up,board=far)
        assert close["lastRound"]["status"] == "hit" and not close["shots"]
        assert still["lastRound"]["status"] == "flying" and still["shots"]
        assert hit["lastRound"]["status"] == "hit" and hit["lastRound"]["resolvedAt"] > .48
        switched = run(60,up+[frame({"WeaponRocket":True,"BetUp":True})],board=far)
        assert switched["stats"] == hit["stats"] and switched["lastRound"]["weapon"] == "like" and switched["lastRound"]["bet"] == 10

        t = run(board=near)["targets"][0]
        locked = [frame({"ToggleLock":True},(t["x"],t["y"]),True)]
        lock_on = run(2,locked,board=near)
        assert lock_on["auto"] and lock_on["lock"] and lock_on["shots"][0]["trajectory"] == "track"
        auto_off = run(125,locked+[frame(),frame({"ToggleAuto":True})],board=near)
        assert auto_off["lock"] and not auto_off["auto"] and auto_off["stats"]["shots"] == round_count(125,.12)
        off = run(125,locked_once(t),board=near)
        assert not off["auto"] and not off["lock"] and off["stats"]["shots"] == 1 and off["lastRound"]["status"] == "hit"
        for action in ("PreviewSmall","PreviewMedium","PreviewLarge","GalleryOpen"):
            stopped = run(80,locked+[frame({action:True})],board=near)
            assert not stopped["auto"] and not stopped["lock"] and stopped["stats"]["shots"] == 1
            assert stopped["lastRound"]["status"] == "hit"
        for weapon in ("Flower","Rocket"):
            assert run(2,[frame({"Weapon"+weapon:True},(8,-3),True)])["stats"]["shots"] == 0
            chosen = run(2,[frame({"Weapon"+weapon:True,"ToggleAuto":True})])
            assert next(t for t in chosen["targets"] if t["id"] == chosen["lockedTargetId"])["tier"] == "large"
            assert chosen["stats"]["shots"] == 1

        # DT2 special selection is a pointer event, not a per-tick re-hit-test.
        # A new blank gesture cannot revive an old target; an existing valid
        # gesture can drag into blank space and keep its chosen target firing.
        point = t["x"],t["y"]
        new_blank = padded([frame({"WeaponFlower":True},point,True)],62)
        new_blank[61] = frame(point=(7,-3),down=True)
        new_blank.extend(frame(point=(7,-3),down=True) for _ in range(88))
        old_target_blank = run(150,new_blank,board=near)
        assert old_target_blank["stats"]["shots"] == 1
        continuous = [frame({"WeaponFlower":True},point,True)]+[frame(point=(7,-3),down=True) for _ in range(124)]
        same_gesture = run(125,continuous,board=near)
        assert same_gesture["stats"]["shots"] == round_count(125,4/15) and same_gesture["lockedTargetId"] == t["id"]
        crossing_initial = run(board=crossing)
        small = next(target for target in crossing_initial["targets"] if target["tier"] == "small")
        still_hold = [frame({"WeaponFlower":True},(small["x"],small["y"]),True)]
        still_hold.extend(frame(point=(small["x"],small["y"]),down=True) for _ in range(84))
        passing = run(85,still_hold,board=crossing)
        medium = next(target for target in passing["targets"] if target["tier"] == "medium")
        assert math.hypot(medium["x"]-small["x"],medium["y"]-small["y"]) < medium["diameter"]*.56
        assert passing["lockedTargetId"] == small["id"] and passing["lastRound"]["primaryId"] == small["id"]
        moved_to_medium = run(86,still_hold+[frame(point=(medium["x"],medium["y"]),down=True)],board=crossing)
        assert moved_to_medium["lockedTargetId"] == medium["id"]
        reset_gesture = padded(continuous[:30],32)
        reset_gesture[30] = frame({"DemoReset":True})
        reset_gesture[31] = frame({"WeaponFlower":True},(7,-3),True)
        clean_gesture = run(32,reset_gesture,board=near)
        assert clean_gesture["stats"]["shots"] == 0 and clean_gesture["lockedTargetId"] == ""

        for seed in (1,3,9,42):
            t = target(seed,"medium")
            point = t["x"],t["y"]
            fseq = [frame({"WeaponFlower":True},point,True)]
            flower = run(90,fseq,seed=seed)
            last = flower["lastRound"]
            assert flower["stats"]["spent"] == 60 and flower["stats"]["shots"] == 1
            assert 2 <= last["secondaryQuota"] <= 5 and len(last["targetIds"]) <= min(6,last["secondaryQuota"]+1)
            assert len(set(last["targetIds"])) == len(last["targetIds"])
            for selected in last["selection"][1:]:
                assert math.hypot(selected["x"]-last["primaryX"],selected["y"]-last["primaryY"]) <= 1.35+1e-8
            rseq = [frame({"WeaponRocket":True},point,True)]
            rocket,later = run(2,rseq,seed=seed),run(5,rseq,seed=seed)
            assert rocket["stats"]["spent"] == 150 and len(rocket["lastRound"]["targetIds"]) <= 5
            assert len(set(rocket["lastRound"]["targetIds"])) == len(rocket["lastRound"]["targetIds"])
            first = {s["id"]:s for s in rocket["shots"]}
            for shot in later["shots"]: assert shot["trajectory"] == "snapshot" and shot["to"] == first[shot["id"]]["to"]
            frozen = run(90,fseq+[frame({"WeaponRocket":True,"BetUp":True})],seed=seed)
            assert frozen["stats"] == flower["stats"] and frozen["lastRound"]["weapon"] == "flower"

        for tier,action,count,lifetime in (("medium","PreviewMedium",16,7.4),("large","PreviewLarge",32,11.8)):
            preview = run(2,[frame({action:True,"ToggleAuto":True})],board=empty)
            entry = preview["mediumReveals"][0] if tier == "medium" else preview["reveal"]
            assert entry["characterId"] == "eunbi" and entry["clipId"] == f"eunbi-classic-{tier}"
            assert entry["stage"] == ("intro" if tier == "large" else "video") and not preview["auto"]
            close_action = f'CloseMediumReveal:{entry["serial"]}' if tier == "medium" else "CloseReveal"
            skipped = run(4,[frame({action:True}),frame(),frame({close_action:True})],board=empty)
            skipped_entry = skipped["mediumReveals"][0] if tier == "medium" else skipped["reveal"]
            assert skipped_entry["stage"] == "reward" and skipped["rewardFx"][0]["count"] == count
            done = run(math.ceil((lifetime+.4)*60),[frame({action:True})],board=empty)
            assert not done.get("reveal") and not done["mediumReveals"] and done["walletArrivalsSerial"] == count and done["walletLastIncrementSerial"] == 0
        spam = [frame({"PreviewSmall":i%6 == 0}) for i in range(90)]
        spam[0]["actions"]["ToggleAuto"] = True
        busy = run(90,spam,board=empty)
        assert len(busy["rewardFx"]) == 1 and busy["rewardFxPendingCount"] == 0
        drained = run(230,spam,board=empty)
        assert not drained["rewardFx"] and drained["walletArrivalsSerial"] == 4 and drained["balance"] == 10000
        started = padded([frame({"PreviewLarge":True})],181)
        started[180] = frame({"RevealVideoStarted":True})
        delayed = run(600,started,board=empty)
        assert delayed["reveal"]["stage"] == "video" and delayed["reveal"]["videoStarted"]
        repeated = padded(started,600)
        repeated[399] = frame({"RevealVideoStarted":True})
        duplicate = run(600,repeated,board=empty)
        assert duplicate["reveal"]["expiresAt"] == delayed["reveal"]["expiresAt"]
        repeated[599] = frame({"RevealDone":True})
        assert run(600,repeated,board=empty)["reveal"]["stage"] == "video"
        ended = padded(repeated,680)
        ended[679] = frame({"RevealDone":True})
        assert run(680,ended,board=empty)["reveal"]["stage"] == "reward"

        # Independent medium callbacks cannot start/end/skip another clip.
        mids = padded([frame({"PreviewMedium":True}),frame(),frame({"PreviewMedium":True}),frame(),frame({"PreviewMedium":True})],240)
        mids[59] = frame({"MediumVideoStarted:1":True})
        mids[119] = frame({"MediumVideoStarted:2":True})
        mids[179] = frame({"MediumVideoStarted:1":True})  # duplicate cannot extend again
        mids[199] = frame({"CloseReveal":True,"RevealDone":True})  # large-only actions
        mids[201] = frame({"CloseMediumReveal:999":True})
        independent = run(240,mids,board=empty)
        entries = {entry["serial"]:entry for entry in independent["mediumReveals"]}
        assert len(entries) == 3 and all(entry["stage"] == "video" for entry in entries.values())
        assert abs(entries[1]["videoStartedAt"]-1) < 1e-6 and abs(entries[1]["expiresAt"]-6.8) < 1e-6
        assert abs(entries[2]["videoStartedAt"]-2) < 1e-6 and not entries[3]["videoStarted"]
        wrong_end = padded(mids,250)
        wrong_end[249] = frame({"MediumRevealDone:1":True})  # only 3.16s after actual first frame
        assert next(e for e in run(250,wrong_end,board=empty)["mediumReveals"] if e["serial"] == 1)["stage"] == "video"
        own_end = padded(wrong_end,365)
        own_end[364] = frame({"MediumRevealDone:1":True})
        ended_one = run(365,own_end,board=empty)
        stages = {entry["serial"]:entry["stage"] for entry in ended_one["mediumReveals"]}
        assert stages[1] == "reward" and stages[2] == "video"
        gone_one = run(470,own_end,board=empty)
        assert 1 not in {entry["serial"] for entry in gone_one["mediumReveals"]}
        assert 2 in {entry["serial"] for entry in gone_one["mediumReveals"]}
        stale = padded(own_end,471)
        stale[470] = frame({"CloseMediumReveal:1":True,"MediumVideoStarted:1":True})
        stale_state = run(471,stale,board=empty)
        assert all(entry["serial"] != 1 for entry in stale_state["mediumReveals"])
        assert stale_state["balance"] == stale_state["displayBalance"] == 10000

        # Previews are bounded, video slots stable and reusable as soon as a
        # clip enters reward, and neither medium stage blocks manual fire.
        burst = [frame({"PreviewMedium":i%2 == 0}) for i in range(24)]
        capped = run(24,burst,board=empty)
        assert capped["mediumVideoCount"] == capped["mediumPreviewOutstanding"] == 6
        assert capped["mediumQueueCount"] == 0
        five = [frame({"PreviewMedium":i%2 == 0}) for i in range(9)]
        reused_seq = padded(five,13)
        reused_seq[11] = frame({"CloseMediumReveal:1":True})
        reused_seq[12] = frame({"PreviewMedium":True})
        reused = run(13,reused_seq,board=empty)
        entries = {entry["serial"]:entry for entry in reused["mediumReveals"]}
        assert entries[1]["stage"] == "reward" and entries[6]["stage"] == "video"
        assert entries[1]["slot"] == entries[6]["slot"] == 1
        firing = [frame({"PreviewMedium":True})]
        firing.extend(frame({"Fire":True}) for _ in range(149))
        firing[2] = frame({"Fire":True,"PreviewMedium":True})
        during_video = run(29,firing[:29],board=empty)
        assert during_video["mediumVideoCount"] == 2 and during_video["stats"]["shots"] == round_count(29,.12,2)
        firing[29] = frame({"Fire":True,"CloseMediumReveal:1":True})
        during_reward = run(80,firing[:80],board=empty)
        assert during_reward["stats"]["shots"] == round_count(80,.12,2)
        assert any(entry["stage"] == "reward" for entry in during_reward["mediumReveals"])
        after_reward = run(150,firing,board=empty)
        assert after_reward["stats"]["shots"] == round_count(150,.12,2) and after_reward["stats"]["won"] == 0
        assert after_reward["mediumVideoCount"] == 1 and all(entry["serial"] != 1 for entry in after_reward["mediumReveals"])

        # Natural dense medium wins remain nonblocking, keep AUTO enabled, and
        # cap only simultaneous video decoders. Overflow awards remain queued.
        medium_load = None
        for seed in range(1,11):
            load_seq = [frame({"WeaponFlower":True,"ToggleAuto":True})]
            loaded = run(330,load_seq,seed=seed,board=dense_medium)
            if loaded["mediumVideoCount"] != 6 or loaded["mediumQueueCount"] == 0: continue
            assert loaded["auto"] and loaded["stats"]["shots"] == round_count(330,4/15) and not loaded.get("reveal")
            medium_load = seed,load_seq,loaded
            break
        assert medium_load is not None
        seed,load_seq,loaded = medium_load
        locked_medium = run(330,[frame({"WeaponFlower":True,"ToggleLock":True})],seed=seed,board=dense_medium)
        assert locked_medium["lock"] and locked_medium["auto"] and locked_medium["stats"]["shots"] == round_count(330,4/15)
        assert locked_medium["mediumVideoCount"] == 6 and locked_medium["mediumQueueCount"] > 0
        queued_previews = padded(load_seq,355)
        for index in range(330,355,2): queued_previews[index] = frame({"PreviewMedium":True})
        bounded_pending = run(355,queued_previews,seed=seed,board=dense_medium)
        assert bounded_pending["mediumPreviewOutstanding"] == 6
        assert bounded_pending["mediumQueueCount"] >= loaded["mediumQueueCount"]+6
        assert bounded_pending["stats"]["shots"] == loaded["stats"]["shots"]
        drain_frames = max(2400,355+math.ceil((math.ceil((len(bounded_pending["mediumReveals"])+bounded_pending["mediumQueueCount"])/6)*7.4+2)*60))
        preview_queue_done = run(drain_frames,queued_previews,seed=seed,board=dense_medium)
        assert not preview_queue_done["mediumReveals"] and preview_queue_done["mediumQueueCount"] == 0
        assert preview_queue_done["stats"] == bounded_pending["stats"] and preview_queue_done["pendingWin"] == 0
        assert preview_queue_done["displayBalance"] == preview_queue_done["balance"]
        waiting_large = padded(load_seq,331)
        waiting_large[330] = frame({"PreviewLarge":True})
        wait = run(331,waiting_large,seed=seed,board=dense_medium)
        assert wait["largeQueueCount"] == 1 and not wait.get("reveal") and wait["mediumVideoCount"] == 6
        assert not wait["canShoot"] and not wait["auto"]
        stopped = run(400,waiting_large,seed=seed,board=dense_medium)
        assert stopped["stats"]["shots"] == loaded["stats"]["shots"]
        full_screen = run(1000,waiting_large,seed=seed,board=dense_medium)
        assert full_screen.get("reveal") and full_screen["reveal"]["tier"] == "large"
        assert not full_screen["mediumReveals"] and full_screen["mediumQueueCount"] > 0
        resume = padded(waiting_large,1001)
        resume[1000] = frame({"CloseReveal":True})
        drain_frames = max(1900,1001+math.ceil((1.6+math.ceil(full_screen["mediumQueueCount"]/6)*7.4+2)*60))
        all_collected = run(drain_frames,resume,seed=seed,board=dense_medium)
        assert all_collected["stats"] == stopped["stats"]
        assert not all_collected.get("reveal") and not all_collected["mediumReveals"]
        assert all_collected["mediumQueueCount"] == all_collected["rewardFxPendingCount"] == all_collected["pendingWin"] == 0
        assert all_collected["displayBalance"] == all_collected["balance"]

        winning_seeds = {}
        for tier in ("small","medium","large"):
            for seed in range(1,31):
                t = target(seed,tier)
                seq = locked_once(t)
                pending = run(90,seq,seed=seed)
                if pending["stats"]["captures"] == 0: continue
                assert pending["stats"]["captures"] == pending["stats"]["shots"] == 1
                assert pending["displayBalance"] == 9990 and pending["pendingWin"] == pending["stats"]["won"]
                if tier == "small":
                    start = pending["lastRound"]["resolvedAt"]+.65
                    partial = run(math.ceil((start+1.25)*60),seq,seed=seed)
                    final = run(math.ceil((start+1.8)*60),seq,seed=seed)
                else:
                    entry = pending["mediumReveals"][0] if tier == "medium" else pending["reveal"]
                    assert entry["symbolTier"] == tier and pending["unlocked"][tier]
                    skip = padded(seq,91)
                    close_action = f'CloseMediumReveal:{entry["serial"]}' if tier == "medium" else "CloseReveal"
                    skip[90] = frame({close_action:True})
                    partial = run(167,skip,seed=seed)
                    visible = run(178,skip,seed=seed)
                    visible_entry = visible["mediumReveals"][0] if tier == "medium" else visible["reveal"]
                    assert visible_entry["stage"] == "reward" and visible["displayBalance"] == visible["balance"]
                    final = run(210,skip,seed=seed)
                    timeout = run(900,seq,seed=seed)
                    assert not timeout.get("reveal") and not timeout["mediumReveals"] and timeout["displayBalance"] == timeout["balance"]
                    assert timeout["stats"] == final["stats"]
                assert 9990 < partial["displayBalance"] < partial["balance"]
                assert final["pendingWin"] == 0 and final["displayBalance"] == final["balance"]
                assert final["collectedWin"] == final["stats"]["won"] and final["walletLastIncrementSerial"] > 0
                winning_seeds[tier] = seed
                break
            assert tier in winning_seeds
        for seed in range(1,31):
            t = target(seed,"small",low)
            seq = padded(locked_once(t),65)
            for i in range(3,65): seq[i] = frame({"Fire":True})
            blocked = run(65,seq,seed=seed,board=low)
            if blocked["stats"]["won"] == 0: continue
            assert blocked["balance"] >= 10 and blocked["displayBalance"] == 0 and not blocked["canShoot"]
            assert blocked["stats"]["shots"] == 1 and blocked["pendingWin"] == blocked["balance"]
            break
        else: raise AssertionError("No natural low-wallet win")
        multiple = False
        for seed in range(1,20):
            t = target(seed,"medium")
            seq = [frame({"WeaponFlower":True},(t["x"],t["y"]),True)]
            pending = run(90,seq,seed=seed)
            if pending["stats"]["captures"] < 2: continue
            full = padded(seq,700)
            for i in range(90,700,2): full[i] = frame({"CloseReveal":True})
            done = run(700,full,seed=seed)
            assert done["stats"] == pending["stats"] and done["pendingWin"] == 0
            assert not done.get("reveal") and not done["mediumReveals"] and not done["rewardFx"] and done["rewardFxPendingCount"] == 0
            multiple = True
            break
        assert multiple
        reset = run(8,[frame({"Fire":True}),frame({"DemoReset":True})])
        assert reset["balance"] == reset["displayBalance"] == 10000 and not reset["shots"]
        assert reset["pendingWin"] == reset["collectedWin"] == reset["walletLastIncrementSerial"] == 0

    print(json.dumps({"ok":True,"nativeRuns":runs,"naturalWinningSeeds":winning_seeds,"viewportChecks":viewport_report["checks"],
        "sixtySecondRounds":cadence_counts,"fxStress":fx_stress,
        "variantSeeds":{tier:{style:record[0] for style,record in variants.items()} for tier,variants in qualified.items()},
        "jiayiVariantSeeds":{tier:{style:record[0] for style,record in variants.items()} for tier,variants in jiayi_qualified.items()},
        "heartExamples":heart_examples,"checks":[
        "DT2-blank-click-hold-drag-hover-auto","special-pointer-gesture-selection","stationary-hold-never-retargets","Lock-AUTO-coupling","continuous-first-hit",
        "two-reflections-third-wall-blank","35s-lifetime","immutable-inflight-weapon-bet-cost",
        "flower-impact-selection","rocket-snapshot-unique","preview-gallery-stop-Lock",
        "video-first-frame-handshake-idempotent","all-tiers-natural-win","ledger-display-pending-conservation",
        "arrival-proportional-exact-credit","pending-money-unspendable","parallel-queued-awards-once",
        "preview-coalescing-no-payout","medium-serial-callback-isolation","medium-video-and-reward-never-block-fire",
        "medium-stable-slots-preview-bound","natural-medium-AUTO-and-overflow-FIFO",
        "large-waits-active-medium-not-future-queue","DT2-60s-subframe-cadence-hold-auto-lock",
        "global-cooldown-survives-switch","idle-gallery-large-no-banked-shots","six-FX-natural-AUTO-stress",
        "spawn-role-roundrobin-no-rng","exact-clip-gallery-unlock","bet49-vs50-Christmas-gate",
        "high-round-cost-low-base-ineligible","qualified-variant-both-branches","inflight-base-bet-immutable",
        "locked-Christmas-preview-rejected","preview-replay-no-unlock-or-credit","reward-tier-hearts-4-16-32-integer-tail",
        "five-way-spawn-no-RNG-shift","jiayi49-50-highcost-gates","jiayi-both-variants-exact-clip-isolation",
        "jiayi-inflight-stake-and-cross-role-preview-lock","jiayi-small-real-duration-and-default-preview","low-ODDS-preserved","reset"]},ensure_ascii=False))


if __name__ == "__main__":
    main()
