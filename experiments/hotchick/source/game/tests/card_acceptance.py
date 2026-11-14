"""Native acceptance for paid-spend card packs and independent card randomness."""
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
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
    project, sdk = args.project.resolve(), args.sdk.resolve()
    source = (project/"scripts/main.luau").read_text(encoding="utf-8")
    config = json.loads((project/"project.unone.json").read_text(encoding="utf-8-sig"))
    runs,checks = 0,[]
    evidence = {}
    with tempfile.TemporaryDirectory(prefix="hotchick-cards-") as scratch:
        root = Path(scratch)
        sequence_file = root/"input.json"

        def fixture(name, *, counts=None, bets=None, funds=10000, miss=False, seed=None, empty_r=False):
            directory = root/name
            directory.mkdir()
            text = source
            counts = counts or {}
            for tier,total in (("small",18),("medium",6),("large",3)):
                line = f'for _ = 1, {total} do table.insert(targets, createTarget(api, "{tier}", true)) end'
                assert text.count(line) == 1
                text = text.replace(line,line.replace(f"1, {total}",f'1, {counts.get(tier,0)}'))
            line = 'local characterId = SPAWN_CHARACTER_ORDER[(spawnCharacterSequence-1)%#SPAWN_CHARACTER_ORDER+1]'
            text = text.replace(line,'local characterId = "eunbi"')
            if sum(counts.values()):
                text = text.replace("local lane = randomRange(api, -2.65, 2.85)","local lane = 0")
                text = text.replace("speed=randomRange(api, 0.30, 0.65)","speed=0")
                text = text.replace("local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4","local x = if initial then 0 else -direction * 9.4")
            if bets:
                assert len(bets) == 5
                text = text.replace("local BETS = {1, 5, 10, 20, 50}","local BETS = {"+", ".join(map(str,bets))+"}")
            if funds != 10000:
                text,n = re.subn(r"(?m)^([ \t]*(?:local )?(?:balance|displayBalance) = )10000$",lambda m:m[1]+str(funds),text)
                assert n == 4
            if miss:
                text,n = re.subn(r"(?m)^(local ODDS: .*? = )\{[^\n]+\}$",lambda m:m[1]+"{small=0,medium=0,large=0}",text)
                assert n == 1
            if seed is not None:
                assert text.count("local CARD_RNG_SEED = 104729") == 1
                text = text.replace("local CARD_RNG_SEED = 104729",f"local CARD_RNG_SEED = {seed}")
            if empty_r:
                text,n = re.subn(r'(?m)^\s*card\("[^\n]+,"R"\),\n',"",text)
                assert n == 4
            (directory/"project.unone.json").write_text(json.dumps(dict(config,entry_script="main.luau",main_scene="main.scene.json",test_files=[])),encoding="utf-8")
            (directory/"main.luau").write_text(text,encoding="utf-8")
            shutil.copyfile(project/"scenes/main.scene.json",directory/"main.scene.json")
            return directory,funds

        def run(board, sequence=None, frames=60, outcome_seed=42):
            nonlocal runs
            directory,funds = board
            sequence_file.write_text(json.dumps(padded(sequence or [],frames)),encoding="utf-8")
            result = subprocess.run([str(sdk),"run","--project",str(directory),"--frames",str(frames),"--seed",str(outcome_seed),"--input-sequence",str(sequence_file),"--json"],capture_output=True,text=True,encoding="utf-8")
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"],payload.get("diagnostics",result.stderr)
            value = payload["value"]["world"]["observations"]["game"]
            runs+=1
            assert value["balance"] == funds-value["stats"]["spent"]+value["stats"]["won"]
            assert value["balance"] == value["displayBalance"]+value["pendingWin"]
            cards = value["cards"]
            assert cards["spentTotal"] == value["stats"]["spent"] == cards["creditedSpend"]+cards["ignoredSpend"]
            assert cards["creditedSpend"] == cards["drawsEarned"]*1000+cards["progress"]
            assert 0 <= cards["drawsAvailable"] == cards["drawsEarned"]-cards["drawsUsed"] <= 10
            assert 0 <= cards["progress"] < 1000 and cards["capacity"] == 10
            assert sum(c["count"] for c in cards["catalog"]) == cards["drawsUsed"]
            if cards["isFull"]: assert cards["drawsAvailable"] == 10 and cards["progress"] == 0
            if cards["drawsUsed"]: assert cards["lastDraw"]["serial"] == cards["drawsUsed"]
            return value

        def ids(value):
            return {c["id"]:c for c in value["cards"]["catalog"]}

        def unlocked(value):
            return {item["clipId"] for c in value["gallery"]["characters"] for style in c["styles"] for item in style["items"] if item["unlocked"]}

        empty = fixture("empty")
        initial = run(empty,frames=1)
        assert initial["cards"]["rarityOdds"] == {"N":.7,"R":.25,"SR":.05}
        assert Counter(c["rarity"] for c in initial["cards"]["catalog"]) == {"N":6,"R":4,"SR":4}
        for card in initial["cards"]["catalog"]:
            assert card["effect"] == {"N":"normal","R":"foil","SR":"diamond"}[card["rarity"]]
            assert card["imageAsset"] == "cards/"+card["id"]+".webp" and card["count"] == 0
        for character in initial["gallery"]["characters"]:
            assert character["profileTitle"] and character["profileText"]
        checks.append("14-card-catalog-N6-R4-SR4-effects-paths-and-fictional-profiles")

        threshold = fixture("threshold",bets=[1,5,999,1000,2500])
        seq = padded([frame({"Fire":True}),frame({"BetDown":True}),frame(),frame({"BetDown":True})],11)
        seq[9] = frame({"Fire":True})
        below = run(threshold,seq,frames=9)
        exact = run(threshold,seq,frames=11)
        assert below["cards"]["spentTotal"] == below["cards"]["progress"] == 999 and below["cards"]["drawsEarned"] == 0
        assert exact["cards"]["spentTotal"] == 1000 and exact["cards"]["drawsAvailable"] == 1 and exact["cards"]["progress"] == 0
        multi = fixture("multi",bets=[1,5,2500,3000,5000])
        seq = padded([frame({"Fire":True}),frame({"BetUp":True})],11);seq[9]=frame({"Fire":True})
        value = run(multi,seq,frames=11)
        assert value["stats"]["shots"] == 2 and value["cards"]["spentTotal"] == 5500
        assert value["cards"]["drawsEarned"] == 5 and value["cards"]["progress"] == 500
        checks.append("actual-paid999-1000-threshold-multiple-packs-and-kept-remainder")

        for weapon,steps,cost in (("Flower",[0,18,36,54],300),("Rocket",[0,30],750)):
            board = fixture("round-"+weapon,counts={"small":12},bets=[1,5,50,100,200],miss=True)
            seq = padded([],steps[-1]+3)
            for index in steps:
                seq[index]=frame({"Weapon"+weapon:True} if index == 0 else {},(0,0),True)
                seq[index+1]=frame()
            value = run(board,seq,frames=len(seq))
            assert value["stats"]["shots"] == len(steps)
            assert value["cards"]["spentTotal"] == len(steps)*cost
        won_board = fixture("won",counts={"small":1},bets=[1,5,1000,2000,3000])
        won = None
        for seed in range(1,30):
            candidate = run(won_board,[frame(point=(0,0),down=True),frame()],frames=400,outcome_seed=seed)
            if candidate["stats"]["won"]:
                won=candidate;break
        assert won and won["pendingWin"] == 0 and won["cards"]["spentTotal"] == 1000 and won["cards"]["drawsEarned"] == 1
        preview = padded([],950)
        preview[0]=frame({"PreviewSmall":True});preview[100]=frame({"PreviewMedium":True});preview[300]=frame({"PreviewLarge":True})
        value = run(empty,preview,frames=950)
        assert value["cards"]["spentTotal"] == value["cards"]["drawsEarned"] == value["cards"]["drawsUsed"] == 0
        checks.append("whole-weapon-round-cost-once-winnings-and-previews-never-credit-card-progress")

        cap = fixture("cap",bets=[1,5,9500,2500,1000],funds=100000)
        seq = padded([],43)
        seq[0]=frame({"Fire":True});seq[1]=frame({"BetUp":True});seq[10]=frame({"Fire":True});seq[20]=frame({"Fire":True})
        seq[30]=frame({"GalleryOpen":True});seq[31]=frame({"CardDraw":True});seq[33]=frame({"GalleryClose":True});seq[34]=frame({"BetUp":True});seq[40]=frame({"Fire":True})
        nine = run(cap,seq,frames=2);full=run(cap,seq,frames=12);ignored=run(cap,seq,frames=22);opened=run(cap,seq,frames=33);refilled=run(cap,seq,frames=43)
        assert nine["cards"]["drawsAvailable"] == 9 and nine["cards"]["progress"] == 500
        assert full["cards"]["isFull"] and full["cards"]["ignoredSpend"] == 2000
        assert ignored["cards"]["drawsEarned"] == 10 and ignored["cards"]["progress"] == 0 and ignored["cards"]["ignoredSpend"] == 4500
        assert opened["cards"]["drawsAvailable"] == 9 and opened["cards"]["progress"] == 0 and opened["cards"]["drawsEarned"] == 10
        assert refilled["cards"]["drawsAvailable"] == 10 and refilled["cards"]["drawsEarned"] == 11 and refilled["cards"]["ignoredSpend"] == 4500
        checks.append("capacity10-clamps-multi-earn-discards-overflow-and-full-spend-no-hidden-bank")

        one = fixture("one",bets=[1,5,1000,2000,3000])
        base = padded([frame({"Fire":True})],20);base[10]=frame({"GalleryOpen":True});base[11]=frame({"CardDraw":True})
        drawn = run(one,base,frames=13)
        assert drawn["cards"]["drawsUsed"] == 1 and drawn["cards"]["drawsAvailable"] == 0 and not unlocked(drawn)
        assert drawn["stats"]["spent"] == 1000 and drawn["displayBalance"] == 9000
        no_token = base.copy();no_token[14]=frame({"CardDraw":True});no_token[16]=frame({"CardDraw":True})
        invalid = run(one,no_token,frames=20)
        assert invalid["cards"] == drawn["cards"]
        closed = run(one,[frame({"Fire":True}),frame({"CardDraw":True})],frames=4)
        assert closed["cards"]["drawsUsed"] == 0 and closed["cards"]["drawsAvailable"] == 1
        blocked_seq=base.copy();blocked_seq[10]=frame({"GalleryOpen":True,"ViewportPortrait":True})
        assert run(one,blocked_seq,frames=13)["cards"]["drawsUsed"] == 0
        empty_pool = fixture("empty-r-pool",bets=[1,5,1000,2000,3000],empty_r=True)
        guarded = run(empty_pool,base,frames=13)
        assert not guarded["cards"]["ready"] and guarded["cards"]["drawsUsed"] == 0 and guarded["cards"]["drawsAvailable"] == 1
        reset_seq=base.copy();reset_seq[15]=frame({"DemoReset":True})
        reset=run(one,reset_seq,frames=18)
        assert reset["cards"]["spentTotal"] == reset["cards"]["drawsEarned"] == reset["cards"]["drawsUsed"] == 0 and not reset["cards"].get("lastDraw")
        assert not any(c["count"] for c in reset["cards"]["catalog"])
        checks.append("manual-draw-no-cost-closed-portrait-empty-token-empty-pool-guards-and-session-reset")

        modulus,random_range = 2147483647,2147483646
        inverse=pow(48271,-1,modulus)
        boundaries=[]
        for boundary,low,high in ((.7,"N","R"),(.95,"R","SR")):
            for raw,expected in ((math.floor(boundary*random_range),low),(math.ceil(boundary*random_range),high)):
                seed=((raw+1)*inverse)%modulus
                board=fixture(f"boundary-{raw}",bets=[1,5,1000,2000,3000],seed=seed)
                result=run(board,base,frames=13)
                last=result["cards"]["lastDraw"]
                assert ids(result)[last["cardId"]]["rarity"] == expected
                boundaries.append({"roll":raw/random_range,"rarity":expected})
        checks.append("closest-representable-70-and95-percent-rarity-boundaries")

        many = fixture("many",bets=[1,5,1000,2000,3000],funds=2000000)
        seq=padded([],20000)
        for index in range(1000):
            at=index*20
            seq[at]=frame({"Fire":True});seq[at+2]=frame({"GalleryOpen":True});seq[at+3]=frame({"CardDraw":True});seq[at+5]=frame({"GalleryClose":True})
        value=run(many,seq,frames=len(seq))
        assert value["cards"]["drawsUsed"] == value["cards"]["drawsEarned"] == 1000 and value["cards"]["drawsAvailable"] == 0
        rarity_counts=Counter()
        for card in value["cards"]["catalog"]:
            rarity_counts[card["rarity"]]+=card["count"]
            assert card["count"] > 0
        assert 625 <= rarity_counts["N"] <= 775 and 190 <= rarity_counts["R"] <= 310 and 20 <= rarity_counts["SR"] <= 80
        for card in value["cards"]["catalog"]:
            expected=rarity_counts[card["rarity"]]/{"N":6,"R":4,"SR":4}[card["rarity"]]
            assert abs(card["count"]-expected) <= max(6,expected*.4)
        repeat_seq=padded([frame({"Fire":True})],40)
        repeat_board=fixture("repeats",bets=[1,5,10000,20000,30000],funds=100000)
        repeat_seq[9]=frame({"GalleryOpen":True})
        for index in range(10):repeat_seq[10+index*2]=frame({"CardDraw":True})
        repeated=run(repeat_board,repeat_seq,frames=40)
        assert repeated["cards"]["drawsUsed"] == 10 and max(c["count"] for c in repeated["cards"]["catalog"]) >= 3
        seventh=run(repeat_board,repeat_seq,frames=23)
        assert seventh["cards"]["lastDraw"]["count"] == 2 and not seventh["cards"]["lastDraw"]["isNew"]
        checks.append("duplicates-increment-count-and-1000-draw-deterministic-rarity-pool-sanity")

        rng_board=fixture("rng-isolation",counts={"medium":1},bets=[1,5,1000,2000,3000])
        neutral=padded([frame(point=(.8,-4.349),down=True),frame()],145)
        neutral[10]=frame({"GalleryOpen":True});neutral[14]=frame({"GalleryClose":True});neutral[30]=frame(point=(0,0),down=True);neutral[31]=frame()
        with_card=neutral.copy();with_card[11]=frame({"CardDraw":True})
        control=run(rng_board,neutral,frames=145,outcome_seed=27);actual=run(rng_board,with_card,frames=145,outcome_seed=27)
        for field in ("stats","targets","shots","variantStats","mediumReveals","rewardFx","fxHearts","lastRound"):
            assert control[field] == actual[field],field
        assert actual["cards"]["drawsUsed"] == 1 and control["cards"]["drawsUsed"] == 0
        assert unlocked(actual) == unlocked(control)
        first_cards=[]
        for outcome_seed in (6,27):
            seq=padded([frame(point=(0,0),down=True),frame()],95);seq[90]=frame({"GalleryOpen":True});seq[91]=frame({"CardDraw":True})
            first_cards.append(run(rng_board,seq,frames=95,outcome_seed=outcome_seed)["cards"]["lastDraw"])
        assert first_cards[0] == first_cards[1] == drawn["cards"]["lastDraw"]
        checks.append("card-RNG-does-not-change-outcomes-styles-identities-or-asset-unlocks-and-is-not-seeded-by-outcomes")
        evidence={"rarityBoundarySamples":boundaries,"thousandDrawRarityCounts":dict(rarity_counts),"cap":{"spent":refilled["stats"]["spent"],"earned":refilled["cards"]["drawsEarned"],"used":refilled["cards"]["drawsUsed"],"available":refilled["cards"]["drawsAvailable"],"ignored":refilled["cards"]["ignoredSpend"]},"firstCard":drawn["cards"]["lastDraw"]}
    print(json.dumps({"ok":True,"mode":"cards-focused","nativeRuns":runs,"checks":checks,"evidence":evidence},ensure_ascii=False))


if __name__ == "__main__":
    main()
