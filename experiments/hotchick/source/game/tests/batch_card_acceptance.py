"""Native checks for atomic open-all card packs and actual-clip gallery lists."""
from __future__ import annotations

import argparse
from collections import Counter
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
    project, sdk = args.project.resolve(), args.sdk.resolve()
    source = (project/"scripts/main.luau").read_text(encoding="utf-8")
    config = json.loads((project/"project.unone.json").read_text(encoding="utf-8-sig"))
    runs, checks, evidence = 0, [], {}
    with tempfile.TemporaryDirectory(prefix="hotchick-batch-cards-") as scratch:
        root = Path(scratch)
        input_file = root/"input.json"

        def fixture(name, *, cost=1000, bets=None, medium=False, large=False, empty_r=False, extra_clips=False):
            directory = root/name
            directory.mkdir()
            text = source
            for tier,total in (("small",18),("medium",6),("large",3)):
                line = f'for _ = 1, {total} do table.insert(targets, createTarget(api, "{tier}", true)) end'
                assert text.count(line) == 1
                text = text.replace(line,line.replace(f"1, {total}",f'1, {int((medium and tier == "medium") or (large and tier == "large"))}'))
            if medium or large:
                text = text.replace('local characterId = SPAWN_CHARACTER_ORDER[(spawnCharacterSequence-1)%#SPAWN_CHARACTER_ORDER+1]','local characterId = "eunbi"')
                text = text.replace("local lane = randomRange(api, -2.65, 2.85)","local lane = 0")
                text = text.replace("speed=randomRange(api, 0.30, 0.65)","speed=0")
                text = text.replace("local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4","local x = if initial then 0 else -direction * 9.4")
            bets = bets or [1,5,cost,20000,30000]
            text = text.replace("local BETS = {1, 5, 10, 20, 50}","local BETS = {"+", ".join(map(str,bets))+"}")
            text,changed = re.subn(r"(?m)^([ \t]*(?:local )?(?:balance|displayBalance) = )10000$",lambda m:m[1]+"100000",text)
            assert changed == 4
            if empty_r:
                text,changed = re.subn(r'(?m)^\s*card\("[^\n]+,"R"\),\n',"",text)
                assert changed == 4
            if extra_clips:
                # Only catalog starting data is extended. These entries reuse
                # known assets; no production award-selection rule is changed.
                insertion = []
                for tier in ("medium","large"):
                    insertion.extend(("do",f'    local extra: Clip = table.clone(CLIPS["eunbi-classic-{tier}"])',
                        f'    extra.clipId = "eunbi-classic-{tier}-fixture-extra"',
                        '    CLIPS[extra.clipId] = extra','    table.insert(CLIP_ORDER,extra.clipId)',"end"))
                text = text.replace("local FX_DURATION = 1.6","\n".join(insertion)+"\nlocal FX_DURATION = 1.6")
            (directory/"project.unone.json").write_text(json.dumps(dict(config,entry_script="main.luau",main_scene="main.scene.json",test_files=[])),encoding="utf-8")
            (directory/"main.luau").write_text(text,encoding="utf-8")
            shutil.copyfile(project/"scenes/main.scene.json",directory/"main.scene.json")
            return directory

        def run(board, sequence=(), *, frames=50, seed=42, with_world=False):
            nonlocal runs
            input_file.write_text(json.dumps(padded(list(sequence),frames)),encoding="utf-8")
            result = subprocess.run([str(sdk),"run","--project",str(board),"--frames",str(frames),"--seed",str(seed),"--input-sequence",str(input_file),"--json"],capture_output=True,text=True,encoding="utf-8")
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"],payload.get("diagnostics",result.stderr)
            world = payload["value"]["world"]
            world.setdefault("particles",[])
            value = world["observations"]["game"]
            runs += 1
            cards = value["cards"]
            assert value["balance"] == 100000-value["stats"]["spent"]+value["stats"]["won"]
            assert value["balance"] == value["displayBalance"]+value["pendingWin"]
            assert cards["drawsAvailable"] == cards["drawsEarned"]-cards["drawsUsed"] and 0 <= cards["drawsAvailable"] <= 10
            assert cards["creditedSpend"]+cards["ignoredSpend"] == cards["spentTotal"] == value["stats"]["spent"]
            assert cards["creditedSpend"] == cards["drawsEarned"]*1000+cards["progress"]
            assert sum(card["count"] for card in cards["catalog"]) == cards["drawsUsed"]
            if cards.get("lastBatch"):
                batch = cards["lastBatch"]
                assert batch["size"] == len(batch["items"]) and batch["size"] > 0
                assert cards["lastDraw"] == batch["items"][-1]
            return (value,world) if with_world else value

        def schedule(*entries):
            sequence = []
            for at,actions in entries:
                sequence = padded(sequence,at+1)
                sequence[at] = frame(actions)
            return sequence

        def catalog(value):
            return [item for character in value["gallery"]["characters"] for style in character["styles"] for item in style["items"]]

        empty = fixture("zero")
        zero = run(empty,schedule((0,{"GalleryOpen":True}),(1,{"CardDrawAll":True}),(3,{"CardDrawAll":True})))
        assert zero["cards"]["drawsUsed"] == 0 and not zero["cards"].get("lastBatch") and not zero["cards"].get("lastDraw")
        assert len(catalog(zero)) == 23 and all(item["available"] for item in catalog(zero))
        assert not any(item["unlocked"] for item in catalog(zero))
        row_sizes = {(c["id"],s["id"]):len(s["items"]) for c in zero["gallery"]["characters"] for s in c["styles"]}
        assert row_sizes["yeseul","summer"] == 1 and row_sizes["eunbi","summer"] == 2
        extra = run(fixture("extra",extra_clips=True),frames=1)
        extra_items = next(s["items"] for c in extra["gallery"]["characters"] if c["id"] == "eunbi" for s in c["styles"] if s["id"] == "classic")
        assert len(catalog(extra)) == 25 and Counter(item["prizeTier"] for item in extra_items) == {"small":1,"medium":2,"large":2}
        assert [item["clipId"] for item in extra_items][-2:] == ["eunbi-classic-medium-fixture-extra","eunbi-classic-large-fixture-extra"]
        checks.append("zero-packs-no-new-batch-and-gallery-lists23-real-clips-plus-arbitrary-same-tier-entries")

        records = {}
        for count in (1,3,10):
            board = fixture(f"packs-{count}",cost=count*1000)
            batch_sequence = schedule((0,{"Fire":True}),(2,{"GalleryOpen":True}),(3,{"CardDrawAll":True,"CardDraw":True}))
            before = run(board,batch_sequence,frames=3)
            result = run(board,batch_sequence,frames=5)
            cards, batch = result["cards"],result["cards"]["lastBatch"]
            assert cards["drawsUsed"] == cards["drawsEarned"] == count and cards["drawsAvailable"] == 0
            assert batch["serial"] == 1 and batch["size"] == count
            assert [item["serial"] for item in batch["items"]] == list(range(1,count+1))
            seen = Counter()
            for item in batch["items"]:
                seen[item["cardId"]] += 1
                assert item["count"] == seen[item["cardId"]] and item["isNew"] == (seen[item["cardId"]] == 1)
            assert seen == Counter({card["id"]:card["count"] for card in cards["catalog"] if card["count"]})
            for field in ("stats","balance","displayBalance","pendingWin","collectedWin","gallery","preferences","watchedLargeClipIds"):
                assert before[field] == result[field],field
            for field in ("spentTotal","progress","creditedSpend","ignoredSpend","drawsEarned"):
                assert before["cards"][field] == cards[field],field
            single_sequence = schedule((0,{"Fire":True}),(2,{"GalleryOpen":True}),*((3+index*2,{"CardDraw":True}) for index in range(count)))
            for index,item in enumerate(batch["items"]):
                one = run(board,single_sequence,frames=4+index*2)
                assert one["cards"]["lastDraw"] == item
            singles = run(board,single_sequence,frames=25)
            assert singles["cards"]["catalog"] == cards["catalog"] and singles["cards"]["lastDraw"] == cards["lastDraw"]
            assert singles["cards"]["lastBatch"]["serial"] == count and singles["cards"]["lastBatch"]["size"] == 1
            next_sequence = schedule((30,{"GalleryClose":True}),(40,{"Fire":True}),(42,{"GalleryOpen":True}),(43,{"CardDrawAll":True}))
            next_batch = run(board,padded(batch_sequence,30)+next_sequence[30:],frames=46)
            next_singles = run(board,padded(single_sequence,30)+next_sequence[30:],frames=46)
            assert next_batch["cards"]["lastBatch"]["items"] == next_singles["cards"]["lastBatch"]["items"]
            assert next_batch["cards"]["lastBatch"]["serial"] == 2 and next_singles["cards"]["lastBatch"]["serial"] == count+1
            records[count] = batch["items"]
        assert max(item["count"] for item in records[10]) >= 3 and any(not item["isNew"] for item in records[10])
        checks.append("one-three-ten-packs-atomic-snapshot-ordered-duplicate-flags-and-RNG-identical-to-N-singles")

        three = fixture("three",cost=3000)
        held = schedule((0,{"Fire":True}),(2,{"GalleryOpen":True}),*((at,{"CardDrawAll":True}) for at in range(3,7)),(8,{"CardDrawAll":True}),(10,{"CardDrawAll":True}))
        repeated = run(three,held,frames=13)
        assert repeated["cards"]["lastBatch"]["serial"] == 1 and repeated["cards"]["drawsUsed"] == 3
        for name,sequence in (
            ("closed",schedule((0,{"Fire":True}),(3,{"CardDrawAll":True}))),
            ("portrait",schedule((0,{"Fire":True}),(2,{"GalleryOpen":True,"ViewportPortrait":True}),(3,{"CardDrawAll":True}))),
        ):
            blocked = run(three,sequence,frames=5)
            assert blocked["cards"]["drawsAvailable"] == 3 and blocked["cards"]["drawsUsed"] == 0 and not blocked["cards"].get("lastBatch"),name
            resume = padded(sequence,10)+schedule((0,{"ViewportLandscape":True,"GalleryOpen":True}),(1,{"CardDrawAll":True}))
            resumed = run(three,resume,frames=13)
            assert resumed["cards"]["lastBatch"]["items"] == records[3],name
        pool = fixture("empty-pool",cost=3000,empty_r=True)
        guarded = run(pool,schedule((0,{"Fire":True}),(2,{"GalleryOpen":True}),(3,{"CardDrawAll":True})))
        assert not guarded["cards"]["ready"] and guarded["cards"]["drawsAvailable"] == 3 and guarded["cards"]["drawsUsed"] == 0 and not guarded["cards"].get("lastBatch")
        reset = run(three,schedule((0,{"Fire":True}),(2,{"GalleryOpen":True}),(3,{"CardDrawAll":True}),(10,{"DemoReset":True})),frames=12)
        assert reset["cards"]["drawsEarned"] == reset["cards"]["drawsUsed"] == 0 and not reset["cards"].get("lastBatch") and not reset["cards"].get("lastDraw")
        reset_again = run(three,schedule((0,{"Fire":True}),(2,{"GalleryOpen":True}),(3,{"CardDrawAll":True}),(10,{"DemoReset":True}),(20,{"Fire":True}),(22,{"GalleryOpen":True}),(23,{"CardDrawAll":True})),frames=26)
        assert reset_again["cards"]["lastBatch"]["serial"] == 1 and reset_again["cards"]["lastBatch"]["items"] == records[3]
        checks.append("held-repeated-empty-inputs-closed-portrait-empty-pool-guards-no-RNG-or-batch-history-mutation-and-session-reset")

        cap = fixture("cap",bets=[1,5,9500,2500,1000])
        cap_sequence = schedule((0,{"Fire":True}),(1,{"BetUp":True}),(10,{"Fire":True}),(20,{"Fire":True}),(30,{"GalleryOpen":True}),(31,{"CardDrawAll":True}),(33,{"GalleryClose":True}),(34,{"BetUp":True}),(40,{"Fire":True}),(42,{"GalleryOpen":True}),(43,{"CardDrawAll":True}))
        opened = run(cap,cap_sequence,frames=34)
        assert opened["cards"]["drawsUsed"] == 10 and opened["cards"]["drawsAvailable"] == 0 and opened["cards"]["progress"] == 0 and opened["cards"]["ignoredSpend"] == 4500
        refill = run(cap,cap_sequence,frames=46)
        assert refill["cards"]["lastBatch"]["serial"] == 2 and refill["cards"]["lastBatch"]["size"] == 1
        assert refill["cards"]["drawsEarned"] == refill["cards"]["drawsUsed"] == 11 and refill["cards"]["drawsAvailable"] == refill["cards"]["progress"] == 0
        assert refill["cards"]["ignoredSpend"] == 4500 and refill["stats"]["spent"] == 15500
        checks.append("full-cap-overflow-discard-and-open-all-do-not-refill-until-fresh-paid-spend")

        rng_board = fixture("rng",cost=3000,medium=True)
        control_sequence = padded([frame(point=(.8,-4.349),down=True),frame()],145)
        control_sequence[10] = frame({"GalleryOpen":True})
        control_sequence[14] = frame({"GalleryClose":True})
        control_sequence[30] = frame(point=(0,0),down=True)
        control_sequence[31] = frame()
        draw_sequence = control_sequence.copy()
        draw_sequence[11] = frame({"CardDrawAll":True})
        control = run(rng_board,control_sequence,frames=145,seed=27)
        actual = run(rng_board,draw_sequence,frames=145,seed=27)
        for field in ("stats","targets","shots","variantStats","mediumReveals","rewardFx","fxHearts","lastRound","gallery"):
            assert control[field] == actual[field],field
        assert actual["cards"]["drawsUsed"] == 3 and control["cards"]["drawsUsed"] == 0
        assert actual["cards"]["lastBatch"]["items"] == records[3]
        checks.append("batch-draws-never-consume-outcome-style-RNG-or-charge-pay-unlock-and-progress")

        viewer_sequence = schedule((0,{"GalleryOpen":True}),(1,{"CardViewerOpen":True}))
        closed, world = run(empty,[frame({"CardViewerOpen":True})],frames=3,with_world=True)
        assert not closed["cardViewerOpen"] and not world["particles"]
        portrait, world = run(empty,schedule((0,{"GalleryOpen":True,"ViewportPortrait":True}),(1,{"CardViewerOpen":True})),frames=3,with_world=True)
        assert not portrait["cardViewerOpen"] and not world["particles"]
        viewer, world = run(empty,viewer_sequence,frames=3,with_world=True)
        assert viewer["cardViewerOpen"] and not viewer["cardViewerReducedMotion"] and viewer["cardViewerParticleHandles"] == 1
        assert len(world["particles"]) == 18
        assert {key:material["uniforms"] for key,material in world["shader_materials"].items()} == {
            "card_foil":{"strength":1,"motion":1},"card_diamond":{"strength":1,"motion":1}}
        assert Counter(particle["emitter"] for particle in world["particles"]) == {"soft_gold":12,"pink_glow":6}
        assert all(abs(p["position"]["x"]) <= 8.1 and abs(p["position"]["y"]) <= 4.6 and p["color"][3] < .35 for p in world["particles"])
        repeat_viewer, repeat_world = run(empty,viewer_sequence,frames=3,seed=9999,with_world=True)
        assert world["particles"] == repeat_world["particles"]
        overlapping, overlap_world = run(empty,viewer_sequence,frames=240,with_world=True)
        assert overlapping["cardViewerParticleHandles"] == 2 and len(overlap_world["particles"]) == 36
        long_viewer, long_world = run(empty,viewer_sequence,frames=1000,with_world=True)
        assert long_viewer["cardViewerOpen"] and 1 <= long_viewer["cardViewerParticleHandles"] <= 2 and 0 < len(long_world["particles"]) <= 36
        checks.append("viewer-guards-official-particles-fixed-seed-world-spread-low-count-and-bounded-continuous-waves")

        for action in ("CardViewerClose","GalleryClose","DemoReset"):
            sequence = padded(viewer_sequence,11)
            sequence[10] = frame({action:True})
            stopped, stopped_world = run(empty,sequence,frames=13,with_world=True)
            assert not stopped["cardViewerOpen"] and stopped["cardViewerParticleHandles"] == 0 and not stopped_world["particles"],action
        reduced_sequence = padded(viewer_sequence,11)
        reduced_sequence[10] = frame({"CardViewerReducedMotion":True})
        reduced, reduced_world = run(empty,reduced_sequence,frames=13,with_world=True)
        assert reduced["cardViewerOpen"] and reduced["cardViewerReducedMotion"] and not reduced_world["particles"]
        assert all(material["uniforms"] == {"strength":1,"motion":0} for material in reduced_world["shader_materials"].values())
        reduced_sequence = padded(reduced_sequence,21)
        reduced_sequence[20] = frame({"CardViewerFullMotion":True})
        resumed, resumed_world = run(empty,reduced_sequence,frames=23,with_world=True)
        assert resumed["cardViewerOpen"] and not resumed["cardViewerReducedMotion"] and len(resumed_world["particles"]) == 18
        assert all(material["uniforms"] == {"strength":1,"motion":1} for material in resumed_world["shader_materials"].values())
        portrait_sequence = padded(viewer_sequence,11)
        portrait_sequence[10] = frame({"ViewportPortrait":True})
        rotated, rotated_world = run(empty,portrait_sequence,frames=13,with_world=True)
        assert rotated["cardViewerOpen"] and not rotated_world["particles"]
        portrait_sequence = padded(portrait_sequence,21)
        portrait_sequence[20] = frame({"ViewportLandscape":True})
        rotated_back, rotated_back_world = run(empty,portrait_sequence,frames=23,with_world=True)
        assert rotated_back["cardViewerOpen"] and len(rotated_back_world["particles"]) == 18
        checks.append("viewer-close-gallery-close-reset-reduced-motion-and-portrait-dispose-official-handles-and-resume-safely")

        large_board = fixture("viewer-large",large=True,cost=1000)
        large_sequence = [frame(point=(0,0),down=True),frame({"GalleryOpen":True}),frame({"CardViewerOpen":True})]
        overlaid = run(large_board,large_sequence,frames=145,seed=6)
        assert overlaid["cardViewerOpen"] and overlaid["reveal"]["stage"] == "video" and not overlaid["reveal"]["preview"]
        after_sequence = padded(large_sequence,161)
        after_sequence[160] = frame({"CloseReveal":True})
        after_large = run(large_board,after_sequence,frames=300,seed=6)
        assert after_large["cardViewerOpen"] and after_large["galleryOpen"] and not after_large.get("reveal") and after_large["pendingWin"] == 0
        assert after_large["stats"] == overlaid["stats"] and after_large["cards"] == overlaid["cards"]
        no_viewer_sequence = large_sequence.copy()
        no_viewer_sequence[2] = frame()
        no_viewer = run(large_board,no_viewer_sequence,frames=145,seed=6)
        for field in ("stats","targets","shots","variantStats","reveal","cards","gallery"):
            assert no_viewer[field] == overlaid[field],field
        checks.append("natural-large-reveal-keeps-viewer-open-before-and-after-overlay-with-identical-awards-cards-and-outcome-RNG")
        evidence = {"batchSizes":[0,1,3,10],"tenCards":records[10],"capIgnoredSpend":refill["cards"]["ignoredSpend"],"actualGalleryClips":23,
            "viewerParticleWave":18,"viewerParticleMax":36,"viewerOverlayAward":after_large["stats"]["won"]}
    print(json.dumps({"ok":True,"mode":"batch-cards-focused","nativeRuns":runs,"checks":checks,"evidence":evidence},ensure_ascii=False))


if __name__ == "__main__":
    main()
