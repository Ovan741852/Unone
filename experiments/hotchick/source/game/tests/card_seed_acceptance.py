"""Native per-session card-seed handshake, independent RNG and reachability."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from acceptance import frame,padded


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--sdk",required=True,type=Path)
    parser.add_argument("--project",type=Path,default=Path(__file__).resolve().parents[1])
    args=parser.parse_args()
    project,sdk=args.project.resolve(),args.sdk.resolve()
    source=(project/"scripts/main.luau").read_text(encoding="utf-8")
    config=json.loads((project/"project.unone.json").read_text(encoding="utf-8-sig"))
    runs,checks=0,[]
    with tempfile.TemporaryDirectory(prefix="hotchick-card-seed-") as scratch:
        root=Path(scratch);input_file=root/"input.json"

        def fixture(name,medium=False):
            directory=root/name;directory.mkdir()
            text=source
            for tier,total in (("small",18),("medium",6),("large",3)):
                line=f'for _ = 1, {total} do table.insert(targets, createTarget(api, "{tier}", true)) end'
                assert text.count(line)==1
                text=text.replace(line,line.replace(f"1, {total}",f'1, {int(medium and tier=="medium")}'))
            if medium:
                text=text.replace('local characterId = SPAWN_CHARACTER_ORDER[(spawnCharacterSequence-1)%#SPAWN_CHARACTER_ORDER+1]','local characterId = "eunbi"')
                text=text.replace("local lane = randomRange(api, -2.65, 2.85)","local lane = 0")
                text=text.replace("speed=randomRange(api, 0.30, 0.65)","speed=0")
                text=text.replace("local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4","local x = if initial then 0 else -direction * 9.4")
            text=text.replace("local BETS = {1, 5, 10, 20, 50}","local BETS = {1, 5, 10000, 20000, 30000}")
            text,changed=re.subn(r"(?m)^([ \t]*(?:local )?(?:balance|displayBalance) = )10000$",lambda m:m[1]+"2000000",text)
            assert changed==4
            (directory/"project.unone.json").write_text(json.dumps(dict(config,entry_script="main.luau",main_scene="main.scene.json",test_files=[])),encoding="utf-8")
            (directory/"main.luau").write_text(text,encoding="utf-8")
            shutil.copyfile(project/"scenes/main.scene.json",directory/"main.scene.json")
            return directory

        def run(board,sequence=(),frames=30,outcome_seed=42):
            nonlocal runs
            input_file.write_text(json.dumps(padded(list(sequence),frames)),encoding="utf-8")
            result=subprocess.run([str(sdk),"run","--project",str(board),"--frames",str(frames),"--seed",str(outcome_seed),"--input-sequence",str(input_file),"--json"],capture_output=True,text=True,encoding="utf-8")
            payload=json.loads(result.stdout)
            assert result.returncode==0 and payload["ok"],payload.get("diagnostics",result.stderr)
            value=payload["value"]["world"]["observations"]["game"];runs+=1
            assert value["balance"]==2000000-value["stats"]["spent"]+value["stats"]["won"]
            assert value["balance"]==value["displayBalance"]+value["pendingWin"]
            cards=value["cards"]
            assert cards["spentTotal"]==value["stats"]["spent"]==cards["creditedSpend"]+cards["ignoredSpend"]
            assert cards["drawsAvailable"]==cards["drawsEarned"]-cards["drawsUsed"]
            assert sum(c["count"] for c in cards["catalog"])==cards["drawsUsed"]
            return value

        def seed_actions(seed):
            return {"CardSeedReady":True,**{f"CardSeedBit{bit}":True for bit in range(31) if seed&(1<<bit)}}

        def scheduled(*entries):
            sequence=[]
            for at,actions in entries:
                sequence=padded(sequence,at+1);sequence[at]=frame(actions)
            return sequence

        empty=fixture("empty")
        initial=run(empty,frames=1)
        assert not initial["cards"]["seedReady"]
        catalog=initial["cards"]["catalog"]
        pools={rarity:[c["id"] for c in catalog if c["rarity"]==rarity] for rarity in ("N","R","SR")}

        def expected(seed,count):
            state=seed;modulus=2147483647;span=modulus-1;counts=Counter();records=[]
            def raw():
                nonlocal state
                state=state*48271%modulus
                return state-1
            for serial in range(1,count+1):
                roll=raw()/span
                rarity="N" if roll<.7 else ("R" if roll<.95 else "SR")
                pool=pools[rarity];limit=span-span%len(pool)
                choice=raw()
                while choice>=limit: choice=raw()
                card=pool[choice%len(pool)];counts[card]+=1
                records.append({"serial":serial,"cardId":card,"count":counts[card],"isNew":counts[card]==1})
            return records,counts

        for invalid in (0,2147483647):
            value=run(empty,[frame(seed_actions(invalid))],frames=2)
            assert not value["cards"]["seedReady"] and value["cards"]==initial["cards"]
        ignored_high=run(empty,[frame({"CardSeedReady":True,"CardSeedBit31":True})],frames=2)
        assert not ignored_high["cards"]["seedReady"]
        seeds=(1,104729,123456789,1500000001,2147483646)
        samples=[]
        for seed in seeds:
            sequence=scheduled((0,seed_actions(seed)),(2,{"Fire":True}),(4,{"GalleryOpen":True}),(5,{"CardDrawAll":True}))
            value=run(empty,sequence,frames=7)
            records,_=expected(seed,10)
            assert value["cards"]["seedReady"] and value["cards"]["lastBatch"]["items"]==records
            assert value["cards"]["rarityOdds"]=={"N":.7,"R":.25,"SR":.05}
            samples.append(records[0]["cardId"])
        assert len(set(samples))>1
        checks.append("31-bit-once-only-session-seed-valid-bounds-ack-and-identical-independent-reference-stream")

        control_sequence=scheduled((0,seed_actions(123456789)),(2,{"Fire":True}),(4,{"GalleryOpen":True}),(5,{"CardDrawAll":True}),(10,{"GalleryClose":True}),(20,{"Fire":True}),(22,{"GalleryOpen":True}),(23,{"CardDrawAll":True}))
        changed_sequence=control_sequence.copy()
        changed_sequence[1]=frame(seed_actions(1))
        changed_sequence[12]=frame(seed_actions(2147483646))
        control=run(empty,control_sequence,frames=26)
        rejected=run(empty,changed_sequence,frames=26)
        assert control["cards"]==rejected["cards"] and control["cards"]["lastBatch"]["items"]==expected(123456789,20)[0][10:]
        native_sequence=control_sequence.copy();native_sequence[0]=frame()
        native=run(empty,native_sequence,frames=26)
        native_change=native_sequence.copy();native_change[12]=frame(seed_actions(123456789))
        native_after=run(empty,native_change,frames=26)
        assert not native_after["cards"]["seedReady"] and native_after["cards"]==native["cards"]
        assert native["cards"]["lastBatch"]["items"]==expected(104729,20)[0][10:]
        reset_sequence=scheduled((0,seed_actions(1)),(2,{"Fire":True}),(4,{"GalleryOpen":True}),(5,{"CardDrawAll":True}),(10,{"DemoReset":True}))
        reset=run(empty,reset_sequence,frames=12)
        assert not reset["cards"]["seedReady"] and reset["cards"]["drawsUsed"]==0
        reset_sequence+=scheduled((0,seed_actions(123456789)),(2,{"Fire":True}),(4,{"GalleryOpen":True}),(5,{"CardDrawAll":True}))
        restarted=run(empty,reset_sequence,frames=20)
        assert restarted["cards"]["seedReady"] and restarted["cards"]["lastBatch"]["serial"]==1
        assert restarted["cards"]["lastBatch"]["items"]==expected(123456789,10)[0]
        checks.append("duplicate-handshakes-and-mid-collection-reseeds-rejected-native-default-stable-and-reset-allows-new-session")

        reachability=[]
        for seed in seeds:
            sequence=padded([frame(seed_actions(seed))],2001)
            for cycle in range(100):
                at=1+cycle*20
                sequence[at]=frame({"Fire":True});sequence[at+2]=frame({"GalleryOpen":True});sequence[at+3]=frame({"CardDrawAll":True});sequence[at+5]=frame({"GalleryClose":True})
            value=run(empty,sequence,frames=2001)
            records,counts=expected(seed,1000)
            actual_counts={c["id"]:c["count"] for c in value["cards"]["catalog"]}
            assert actual_counts==dict(counts) and all(actual_counts[card["id"]]>0 for card in catalog)
            sr_counts={card["id"]:actual_counts[card["id"]] for card in catalog if card["rarity"]=="SR"}
            first_yeseul=next(index for index,item in enumerate(records,1) if item["cardId"]=="yeseul-sr-01")
            reachability.append({"seed":seed,"all14Reached":True,"srCounts":sr_counts,"firstYeseulSR":first_yeseul})
        checks.append("all14-cards-and-every-SR-including-Yeseul-reachable-across-five-real-seeded-1000-draw-sessions")

        medium=fixture("medium",medium=True)
        base=padded([frame(point=(.8,-4.349),down=True),frame()],145)
        base[10]=frame({"GalleryOpen":True});base[11]=frame({"CardDrawAll":True});base[14]=frame({"GalleryClose":True});base[30]=frame(point=(0,0),down=True);base[31]=frame()
        variations=[]
        for seed in (1,123456789):
            sequence=base.copy();sequence[0]=frame(seed_actions(seed),(.8,-4.349),True)
            variations.append(run(medium,sequence,frames=145,outcome_seed=27))
        for field in ("stats","targets","shots","variantStats","mediumReveals","rewardFx","fxHearts","lastRound","gallery"):
            assert variations[0][field]==variations[1][field],field
        assert variations[0]["cards"]["lastBatch"]["items"]!=variations[1]["cards"]["lastBatch"]["items"]
        checks.append("new-card-session-seeds-never-consume-outcome-style-RNG-or-change-wagers-awards-and-video-unlocks")
    print(json.dumps({"ok":True,"mode":"card-seed-focused","nativeRuns":runs,"checks":checks,"evidence":{"pools":{r:len(p) for r,p in pools.items()},"seedSessions":reachability}},ensure_ascii=False))


if __name__=="__main__":
    main()
