"""Native checks for exact-clip, completed-large-video skip preferences.

Fixtures vary starting board/collection state and seed already-confirmed queued
awards; production transitions, paid captures, randomness and collection run as-is.
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
    runs, checks, evidence = 0, [], {}
    classic = "eunbi-classic-large"

    with tempfile.TemporaryDirectory(prefix="hotchick-skip-large-") as scratch:
        root = Path(scratch)
        input_file = root/"input.json"

        def fixture(name, *, tier=None, character="eunbi", bet=10, watched=(), unlocked=(), enabled=False, queued=False, queue_same=False):
            directory = root/name
            directory.mkdir()
            text = source
            for kind, total in (("small",18),("medium",6),("large",3)):
                line = f'for _ = 1, {total} do table.insert(targets, createTarget(api, "{kind}", true)) end'
                assert text.count(line) == 1
                text = text.replace(line,line.replace(f"1, {total}",f'1, {int(kind == tier)}'))
            line = 'local characterId = SPAWN_CHARACTER_ORDER[(spawnCharacterSequence-1)%#SPAWN_CHARACTER_ORDER+1]'
            assert text.count(line) == 1
            text = text.replace(line,f'local characterId = "{character}"')
            text = text.replace("local lane = randomRange(api, -2.65, 2.85)","local lane = 0")
            text = text.replace("speed=randomRange(api, 0.30, 0.65)","speed=0")
            text = text.replace("local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4","local x = if initial then 0 else -direction * 9.4")
            if bet == 50: text = text.replace("betIndex = 3","betIndex = 5")
            else: assert bet == 10
            watched_map = "{"+",".join(f'["{clip}"]=true' for clip in watched)+"}"
            unlocked_map = "{"+",".join(f'["{clip}"]=true' for clip in set(unlocked)|set(watched))+"}"
            text = text.replace("    largePlayback.skipSeen = false",f"    largePlayback.skipSeen = {str(enabled).lower()}")
            text = text.replace("    largePlayback.watched = {}","    largePlayback.watched = "+watched_map)
            text = text.replace("    unlockedClips = {}","    unlockedClips = "+unlocked_map)
            if queued or queue_same:
                # Three previously confirmed awards with deliberately distinct
                # heart levels; two watched videos surround a new style.
                injection = '\n'.join((
                    "    balance = 10495", "    displayBalance = 10000", "    pendingWin = 495", "    won = 495",
                    '    enqueueReveal("large","small",17,false,clipFor("eunbi","classic","large"))',
                    '    enqueueReveal("large","medium",101,false,clipFor("eunbi","summer","large"))',
                    '    enqueueReveal("large","large",377,false,clipFor("yeseul","classic","large"))',
                ))
                if queue_same:
                    injection = '\n'.join(("    balance = 10300", "    displayBalance = 10000", "    pendingWin = 300", "    won = 300",
                        '    enqueueReveal("large","small",100,false,clipFor("eunbi","classic","large"))',
                        '    enqueueReveal("large","large",200,false,clipFor("eunbi","classic","large"))'))
                line = '    for _ = 1, 0 do table.insert(targets, createTarget(api, "large", true)) end'
                assert text.count(line) == 1
                text = text.replace(line,line+"\n"+injection)
            (directory/"project.unone.json").write_text(json.dumps(dict(config,entry_script="main.luau",main_scene="main.scene.json",test_files=[])),encoding="utf-8")
            (directory/"main.luau").write_text(text,encoding="utf-8")
            shutil.copyfile(project/"scenes/main.scene.json",directory/"main.scene.json")
            return directory

        def run(board, sequence=(), *, frames=120, seed=6):
            nonlocal runs
            input_file.write_text(json.dumps(padded(list(sequence),frames)),encoding="utf-8")
            result = subprocess.run([str(sdk),"run","--project",str(board),"--frames",str(frames),"--seed",str(seed),"--input-sequence",str(input_file),"--json"],capture_output=True,text=True,encoding="utf-8")
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"],payload.get("diagnostics",result.stderr)
            value = payload["value"]["world"]["observations"]["game"]
            runs += 1
            assert value["balance"] == 10000-value["stats"]["spent"]+value["stats"]["won"]
            assert value["balance"] == value["displayBalance"]+value["pendingWin"]
            assert value["stats"]["won"] == value["collectedWin"]+value["pendingWin"]
            assert set(value["watchedLargeClipIds"]) <= {key for key,item in catalog(value).items() if item["available"] and item["unlocked"] and item["prizeTier"] == "large"}
            assert {key for key,item in catalog(value).items() if item["watched"]} == set(value["watchedLargeClipIds"])
            return value

        def catalog(value):
            return {item["clipId"]:item for character in value["gallery"]["characters"] for style in character["styles"] for item in style["items"]}

        def watched(value):
            return set(value["watchedLargeClipIds"])

        def schedule(*entries):
            sequence = []
            for at, actions in entries:
                sequence = padded(sequence,at+1)
                sequence[at] = frame(actions)
            return sequence

        once = [frame(point=(0,0),down=True),frame()]
        empty = fixture("empty")
        initial = run(empty,frames=1)
        assert initial["preferences"] == {"skipSeenLargeVideos":False} and not watched(initial)
        toggled = run(empty,[frame({"ToggleSkipSeenLargeVideos":True})],frames=2)
        assert toggled["preferences"]["skipSeenLargeVideos"]
        portrait_toggle = run(empty,schedule((0,{"ViewportPortrait":True,"GalleryOpen":True}),(1,{"ToggleSkipSeenLargeVideos":True})),frames=3)
        assert portrait_toggle["viewportBlocked"] and portrait_toggle["preferences"]["skipSeenLargeVideos"]
        reset = run(empty,schedule((0,{"ToggleSkipSeenLargeVideos":True}),(2,{"DemoReset":True})),frames=4)
        assert reset["preferences"] == initial["preferences"] and not watched(reset)
        checks.append("default-off-session-reset-and-toggle-with-gallery-or-portrait-no-wallet-change")

        board = fixture("natural",tier="large")
        playing = run(board,once)
        assert playing["stats"]["captures"] == 1 and playing["reveal"]["stage"] == "video" and playing["reveal"]["clipId"] == classic,(playing["stats"],playing.get("reveal"))
        full = padded(once,606)
        full[120] = frame({"RevealVideoStarted":True})
        full[605] = frame({"RevealDone":True})
        completed = run(board,full,frames=607)
        assert watched(completed) == {classic} and completed["reveal"]["stage"] == "reward"
        assert not completed["reveal"]["skippedSeenVideo"] and completed["pendingWin"] > 0
        settled = run(board,full,frames=780)
        assert settled["pendingWin"] == 0 and not settled.get("reveal") and settled["stats"] == completed["stats"]
        checks.append("only-full-started-natural-large-ended-marks-exact-clip-before-normal-heart-collection")

        for name, changes, finish in (
            ("early",{130:{"RevealDone":True}},132),
            ("skip",{605:{"CloseReveal":True}},780),
            ("skip-with-ended",{605:{"CloseReveal":True,"RevealDone":True}},780),
            ("timeout-or-error",{},800),
            ("ended-without-start",{120:{},605:{"RevealDone":True}},780),
            ("late-ended-after-timeout",{750:{"RevealDone":True}},800),
        ):
            sequence = padded(once,finish)
            sequence[120] = frame({"RevealVideoStarted":True})
            for at,actions in changes.items(): sequence[at] = frame(actions)
            result = run(board,sequence,frames=finish)
            assert not watched(result),name
            if finish >= 780: assert result["pendingWin"] == 0 and not result.get("reveal"),name
        preview = padded(schedule((0,{"PreviewLarge":True}),(120,{"RevealVideoStarted":True}),(605,{"RevealDone":True})),780)
        preview_done = run(empty,preview,frames=780)
        assert not watched(preview_done) and preview_done["stats"]["spent"] == preview_done["stats"]["won"] == 0
        checks.append("early-end-manual-skip-concurrent-skip-timeout-error-unstarted-end-and-preview-never-mark-watched")

        off_seen = fixture("off-seen",tier="large",watched=[classic])
        on_seen = fixture("on-seen",tier="large",watched=[classic],enabled=True)
        off = run(off_seen,once)
        auto_reward = run(on_seen,once,frames=30)
        assert off["reveal"]["stage"] == "video" and not off["reveal"]["skippedSeenVideo"]
        assert auto_reward["reveal"]["stage"] == "reward" and auto_reward["reveal"]["skippedSeenVideo"]
        assert auto_reward["reveal"]["videoStarted"] is False
        assert auto_reward["rewardFx"][0]["count"] == {"small":4,"medium":16,"large":32}[auto_reward["reveal"]["rewardTier"]]
        assert auto_reward["stats"] == playing["stats"] and auto_reward["variantStats"] == playing["variantStats"]
        auto_settled = run(on_seen,once,frames=140)
        assert auto_settled["pendingWin"] == 0 and not auto_settled.get("reveal") and auto_settled["balance"] == settled["balance"]
        on_unknown = fixture("on-unknown",tier="large",enabled=True)
        unknown = run(on_unknown,once)
        assert unknown["reveal"]["stage"] == "video" and not unknown["reveal"]["skippedSeenVideo"]
        crossed_role = fixture("other-role-seen",tier="large",watched=["yeseul-classic-large"],enabled=True)
        crossed = run(crossed_role,once)
        assert crossed["reveal"]["stage"] == "video" and crossed["reveal"]["clipId"] == classic
        crossed_style = fixture("other-style-seen",tier="large",bet=50,watched=[classic],enabled=True)
        new_style = run(crossed_style,once,seed=27)
        assert new_style["reveal"]["clipId"] == "eunbi-summer-large" and new_style["reveal"]["stage"] == "video"
        preview_seen = fixture("preview-seen",watched=[classic],enabled=True)
        preview_playing = run(preview_seen,[frame({"PreviewLarge":True})])
        assert preview_playing["reveal"]["stage"] == "video" and preview_playing["reveal"]["preview"] and not preview_playing["reveal"]["skippedSeenVideo"]
        checks.append("off-seen-plays-on-exact-seen-skips-intro-video-unknown-other-role-style-and-preview-still-play")

        # A legitimately won but manually skipped clip can be marked by a later
        # fully completed replay, without adding another award or unlocking peers.
        replay = padded(once,700)
        replay[100] = frame({"CloseReveal":True})
        replay += schedule((0,{"GalleryOpen":True}),(1,{"GalleryLargeStarted:"+classic:True}),(486,{"GalleryLargeEnded:"+classic:True}))
        replay_before = run(board,replay,frames=702)
        replay_done = run(board,replay,frames=1188)
        assert not watched(replay_before) and watched(replay_done) == {classic}
        for key in ("stats","balance","displayBalance","pendingWin","collectedWin","variantStats","cards"):
            assert replay_before[key] == replay_done[key],key
        assert {key for key,item in catalog(replay_done).items() if item["unlocked"]} == {classic}
        checks.append("full-gallery-replay-marks-an-actual-unlocked-large-without-award-unlock-or-card-side-effects")

        unlocked_only = fixture("unlocked-only",unlocked=[classic,"eunbi-classic-medium"])
        invalid_cases = {
            "ended-without-start":schedule((0,{"GalleryOpen":True}),(500,{"GalleryLargeEnded:"+classic:True})),
            "closed-gallery":schedule((0,{"GalleryLargeStarted:"+classic:True}),(500,{"GalleryLargeEnded:"+classic:True})),
            "closed-before-ended":schedule((0,{"GalleryOpen":True}),(1,{"GalleryLargeStarted:"+classic:True}),(400,{"GalleryClose":True}),(500,{"GalleryLargeEnded:"+classic:True})),
            "cancelled-replay":schedule((0,{"GalleryOpen":True}),(1,{"GalleryLargeStarted:"+classic:True}),(400,{"GalleryLargeCancelled":True}),(500,{"GalleryLargeEnded:"+classic:True})),
            "early-replay":schedule((0,{"GalleryOpen":True}),(1,{"GalleryLargeStarted:"+classic:True}),(20,{"GalleryLargeEnded:"+classic:True})),
            "locked-style":schedule((0,{"GalleryOpen":True}),(1,{"GalleryLargeStarted:eunbi-summer-large":True}),(500,{"GalleryLargeEnded:eunbi-summer-large":True})),
            "different-clip-ended":schedule((0,{"GalleryOpen":True}),(1,{"GalleryLargeStarted:"+classic:True}),(500,{"GalleryLargeEnded:eunbi-summer-large":True})),
            "medium-ended":schedule((0,{"GalleryOpen":True}),(1,{"GalleryLargeStarted:eunbi-classic-medium":True}),(500,{"GalleryLargeEnded:eunbi-classic-medium":True})),
            "invalid-id":schedule((0,{"GalleryOpen":True}),(1,{"GalleryLargeStarted:unknown-large":True}),(500,{"GalleryLargeEnded:unknown-large":True})),
        }
        for name,sequence in invalid_cases.items():
            result = run(unlocked_only,sequence,frames=510)
            assert not watched(result) and result["stats"]["spent"] == result["stats"]["won"] == 0,name
        switched = fixture("switch-replay",unlocked=[classic,"eunbi-summer-large"])
        switch_result = run(switched,schedule((0,{"GalleryOpen":True}),(1,{"GalleryLargeStarted:"+classic:True}),(400,{"GalleryLargeStarted:eunbi-summer-large":True}),(500,{"GalleryLargeEnded:"+classic:True})),frames=510)
        assert not watched(switch_result)
        # Use an actual natural completion to test the production reset rather
        # than the fixtures whose starting collection intentionally seeds seen.
        full_reset = padded(full,801)
        full_reset[800] = frame({"DemoReset":True})
        result = run(board,full_reset,frames=803)
        assert not watched(result) and not result["preferences"]["skipSeenLargeVideos"] and not any(item["unlocked"] for item in catalog(result).values())
        checks.append("replay-needs-active-exact-unlocked-large-full-duration-no-cancel-close-switch-or-reset-bypass")

        medium_off = fixture("medium-off",tier="medium",watched=[classic])
        medium_on = fixture("medium-on",tier="medium",watched=[classic],enabled=True)
        a, b = run(medium_off,once), run(medium_on,once)
        assert a["mediumReveals"] == b["mediumReveals"] and a["mediumReveals"][0]["stage"] == "video"
        assert not a["mediumReveals"][0]["skippedSeenVideo"]
        for key in ("stats","targets","shots","variantStats","cards"):
            assert a[key] == b[key],key
        checks.append("medium-performances-and-outcome-style-card-randomness-are-unaffected")

        queue_clips = [classic,"eunbi-summer-large","yeseul-classic-large"]
        queue = fixture("queue",watched=[queue_clips[0],queue_clips[2]],unlocked=queue_clips,enabled=True,queued=True)
        first = run(queue,frames=30)
        assert first["reveal"]["clipId"] == queue_clips[0] and first["reveal"]["skippedSeenVideo"] and first["rewardFx"][0]["count"] == 4
        second = run(queue,frames=200)
        assert second["reveal"]["clipId"] == queue_clips[1] and second["reveal"]["stage"] == "video" and not second["reveal"]["skippedSeenVideo"]
        seq = schedule((201,{"CloseReveal":True}))
        third = run(queue,seq,frames=320)
        assert third["reveal"]["clipId"] == queue_clips[2] and third["reveal"]["skippedSeenVideo"] and third["rewardFx"][0]["count"] == 32
        final = run(queue,seq,frames=450)
        assert not final.get("reveal") and final["largeQueueCount"] == 0 and final["pendingWin"] == 0
        assert final["walletArrivalsSerial"] == 4+16+32 and final["balance"] == final["displayBalance"] == 10495
        assert final["collectedWin"] == 495 and final["stats"]["shots"] == final["stats"]["spent"] == 0
        assert watched(final) == {queue_clips[0],queue_clips[2]}
        checks.append("mixed-watched-and-new-large-FIFO-queue-keeps-4-16-32-hearts-and-every-confirmed-chip-exactly-once")
        compressed = padded(once,122)
        compressed[120] = frame({"RevealVideoStarted":True})
        compressed[121] = frame({"LargeVideoCompleted:1:"+classic:True})
        verified = run(board,compressed,frames=123)
        assert watched(verified) == {classic} and verified["reveal"]["stage"] == "reward"
        assert verified["time"]-verified["reveal"]["videoStartedAt"] < .1
        for name,actions in (("wrong-serial",{"LargeVideoCompleted:2:"+classic:True}),
                             ("wrong-clip",{"LargeVideoCompleted:1:eunbi-summer-large":True}),
                             ("manual-skip",{"LargeVideoCompleted:1:"+classic:True,"CloseReveal":True})):
            invalid = compressed.copy();invalid[121] = frame(actions)
            assert not watched(run(board,invalid,frames=123)),name
        unstarted = compressed.copy();unstarted[120] = frame()
        assert not watched(run(board,unstarted,frames=123))
        verified_preview = schedule((0,{"PreviewLarge":True}),(120,{"RevealVideoStarted":True}),(121,{"LargeVideoCompleted:1:"+classic:True}))
        result = run(empty,verified_preview,frames=123)
        assert not watched(result) and result["reveal"]["stage"] == "reward" and result["stats"]["spent"] == result["stats"]["won"] == 0
        # The renderer verifies full played coverage on its media clock. These
        # events intentionally arrive before the slower fixed game clock has
        # advanced by the clip duration; identity/start guards remain in Luau.
        replay_fast = padded(once,704)
        replay_fast[100] = frame({"CloseReveal":True})
        replay_fast[700] = frame({"GalleryOpen":True})
        replay_fast[701] = frame({"GalleryLargeStarted:"+classic:True})
        replay_fast[702] = frame({"GalleryLargeCompleted:"+classic:True})
        result = run(board,replay_fast,frames=704)
        assert watched(result) == {classic} and result["stats"] == replay_done["stats"]
        same = fixture("same-clip-queue",enabled=True,queue_same=True,unlocked=[classic])
        first_watch = schedule((90,{"RevealVideoStarted":True}),(91,{"LargeVideoCompleted:1:"+classic:True}))
        next_same = run(same,first_watch,frames=210)
        assert next_same["reveal"]["serial"] == 2 and next_same["reveal"]["skippedSeenVideo"] and watched(next_same) == {classic}
        same_done = run(same,first_watch,frames=350)
        assert same_done["pendingWin"] == 0 and same_done["collectedWin"] == 300 and same_done["walletArrivalsSerial"] == 36
        replay_watch = schedule((0,{"GalleryOpen":True}),(1,{"GalleryLargeStarted:"+classic:True}),(2,{"GalleryLargeCompleted:"+classic:True}),(3,{"GalleryClose":True}),(4,{"CloseReveal":True}))
        next_after_replay = run(same,replay_watch,frames=120)
        assert next_after_replay["reveal"]["serial"] == 2 and next_after_replay["reveal"]["skippedSeenVideo"] and watched(next_after_replay) == {classic}
        checks.append("verified-media-clock-completion-ignores-slow-game-time-validates-identity-and-skips-every-next-exact-natural-clip")
        evidence = {"naturalAward":settled["stats"]["won"],"queueCollected":final["collectedWin"],"queueHearts":final["walletArrivalsSerial"],"watchedClipId":classic}

    print(json.dumps({"ok":True,"mode":"skip-large-focused","nativeRuns":runs,"checks":checks,"evidence":evidence},ensure_ascii=False))


if __name__ == "__main__":
    main()
