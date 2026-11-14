"""Native remote-settlement packet, escrow and visual-credit regression checks."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from acceptance import frame, padded


def packet(serial, kind, *, balance=10000, round_id=0, mode=0, awards=(), multipliers=(), styles=()):
    actions = {"GSReady": True}
    fields = [("GSPacketId", serial, 31), ("GSKind", kind, 3),
              ("GSRound", round_id, 31), ("GSBalance", balance, 40), ("GSMode", mode, 1)]
    fields += [(f"GSWin{index}", value, 20) for index, value in enumerate(awards)]
    fields += [(f"GSMult{index}", value, 8) for index, value in enumerate(multipliers)]
    fields += [(f"GSStyle{index}", value, 2) for index, value in enumerate(styles)]
    for name, value, count in fields:
        for bit in range(count):
            if value & (1 << bit):
                actions[f"{name}Bit{bit}"] = True
    return actions


def profile_packet(serial, *, mode=0, revision=1, progress_ack=0, draw_ack=0,
                   counts=None, packs=0, progress=0, used=0, earned=0,
                   unlocked=0, watched=0, skip=False, batch=(), batch_serial=1,
                   selected_bet=3, selected_weapon=0):
    actions = packet(serial, 4, mode=mode)
    fields = [("GSProfileRevision", revision, 31), ("GSProgressAck", progress_ack, 31),
              ("GSDrawAck", draw_ack, 31), ("GSPacks", packs, 14), ("GSProgress", progress, 10),
              ("GSEarned", earned, 32), ("GSUsed", used, 32),
              ("GSCredited", earned * 1000 + progress, 40),
              ("GSProfileSpent", earned * 1000 + progress, 40),
              ("GSUnlocked", unlocked, 32), ("GSWatched", watched, 32),
              ("GSSkip", int(skip), 1), ("GSBet", selected_bet, 3), ("GSWeapon", selected_weapon, 2),
              ("GSBatchSize", len(batch), 4)]
    fields += [(f"GSCard{index}", count, 32) for index, count in enumerate(counts or [0] * 14)]
    if batch:
        fields += [("GSBatchSerial", batch_serial, 31), ("GSBatchStart", used - len(batch) + 1, 32)]
        for index, item in enumerate(batch):
            card_index, count, is_new = item
            fields += [(f"GSBatchCard{index}", card_index, 4), (f"GSBatchOwned{index}", count, 32),
                       (f"GSBatchNew{index}", int(is_new), 1)]
    for name, value, width in fields:
        for bit in range(width):
            if value & (1 << bit):
                actions[f"{name}Bit{bit}"] = True
    return actions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk", type=Path, required=True)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    project = args.project.resolve()
    source = (project / "scripts/main.luau").read_text(encoding="utf-8")
    config = json.loads((project / "project.unone.json").read_text(encoding="utf-8-sig"))
    checks = []
    runs = 0

    with tempfile.TemporaryDirectory(prefix="hotchick-remote-") as scratch:
        root = Path(scratch)
        input_file = root / "input.json"

        def fixture(name, count=1, *, reject_local_roll=True, character_id=None, inspect_unlocks=False, target_tier="small", slow_shots=False, simultaneous_hits=False):
            directory = root / name
            directory.mkdir()
            text = source
            for tier, original in (("small", 18), ("medium", 6), ("large", 3)):
                original_line = f'for _ = 1, {original} do table.insert(targets, createTarget(api, "{tier}", true)) end'
                assert text.count(original_line) == 1
                text = text.replace(original_line, original_line.replace(f"1, {original}", f"1, {count if tier == target_tier else 0}"))
            text = text.replace("local lane = randomRange(api, -2.65, 2.85)", "local lane = 0")
            text = text.replace("speed=randomRange(api, 0.30, 0.65)", "speed=0")
            text = text.replace("local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4", "local x = 0")
            if slow_shots:
                text = text.replace("local NORMAL_SPEED = 170*DT2_SPEED_SCALE", "local NORMAL_SPEED = 0.001")
            if simultaneous_hits:
                text = text.replace("function Game.update(api: EngineApi, dt: number)", "local testHitsFlushed = false\nfunction Game.update(api: EngineApi, dt: number)")
                resolution_loop = "    for index = #attacks, 1, -1 do\n        local attack = attacks[index]"
                assert text.count(resolution_loop) == 1
                text = text.replace(resolution_loop, '''    if not testHitsFlushed and time >= 10 then
        testHitsFlushed = true
        for _, attack in attacks do
            attack.hitTargetIds = {targets[1].id}
            attack.pendingShots = 0
        end
        shots = {}
    end
''' + resolution_loop)
            if character_id is not None:
                character_line = "local characterId = SPAWN_CHARACTER_ORDER[(spawnCharacterSequence-1)%#SPAWN_CHARACTER_ORDER+1]"
                assert text.count(character_line) == 1
                text = text.replace(character_line, f'local characterId = "{character_id}"')
            if inspect_unlocks:
                # Observe private state only in this native fixture. Production
                # retains the same catalog and has no test-only grant inputs.
                text = text.replace('api.observation.set("game", {', 'api.observation.set("game", {testUnlockedClipIds=unlockedClips,')
            if reject_local_roll:
                marker = "local function rollTargetAward(api: EngineApi, tier: string, cost: number, targetCount: number): (boolean, number, number)\n"
                assert marker in text
                text = text.replace(marker, marker + '    error("remote mode called local financial RNG")\n')
                style_marker = "local function chooseAwardClip(api: EngineApi,target: Target,baseBet: number): (Clip,boolean,number)\n"
                text = text.replace(style_marker, style_marker + '    error("remote mode called local style RNG")\n')
                draw_marker = "    local function drawCards(open: boolean,blocked: boolean,all: boolean)\n"
                text = text.replace(draw_marker, draw_marker + '        error("remote mode called local card RNG")\n')
            (directory / "main.luau").write_text(text, encoding="utf-8")
            (directory / "project.unone.json").write_text(json.dumps(dict(config, entry_script="main.luau", main_scene="main.scene.json", test_files=[])), encoding="utf-8")
            shutil.copyfile(project / "scenes/main.scene.json", directory / "main.scene.json")
            return directory

        def sequence(*, balance=10000, mode=0, fire_frames=(4,)):
            result = [frame(dict(packet(1, 0, balance=balance, mode=mode), GSConnecting=True))]
            result = padded(result, 70)
            result[1] = frame(profile_packet(2, mode=mode))
            for index in fire_frames:
                result[index] = frame({"Fire": True})
            return result

        def at(sequence, index, actions):
            result = padded(list(sequence), index + 1)
            result[index] = frame(actions)
            return result

        def run(board, inputs, frames=71):
            nonlocal runs
            input_file.write_text(json.dumps(padded(inputs, frames)), encoding="utf-8")
            completed = subprocess.run([str(args.sdk.resolve()), "run", "--project", str(board), "--frames", str(frames), "--seed", "72", "--input-sequence", str(input_file), "--json"], capture_output=True, text=True, encoding="utf-8")
            result = json.loads(completed.stdout)
            assert completed.returncode == 0 and result["ok"], result.get("diagnostics", completed.stderr)
            value = result["value"]["world"]["observations"]["game"]
            runs += 1
            base = value["platform"]["funding"] if value["platform"]["enabled"] else 10000
            assert value["balance"] == base - value["stats"]["spent"] - value["reservedWager"] + value["stats"]["won"]
            assert value["balance"] == value["displayBalance"] + value["pendingWin"]
            assert value["stats"]["won"] == value["pendingWin"] + value["collectedWin"]
            if not value["platform"]["enabled"]:
                assert value["cards"]["spentTotal"] == value["stats"]["spent"]
            status = value["wagerStatus"]
            assert value["canShoot"] == status["canShoot"] == (status["blockReason"] == "")
            assert status["roundCost"] == value["bet"] * {"like": 1, "flower": 6, "rocket": 15}[value["weapon"]]
            assert status["availableBalance"] == value["displayBalance"]
            assert status["pendingCredits"] == value["pendingWin"]
            if value["platform"]["enabled"]:
                assert status["outstandingRounds"] == status["pendingRounds"] + status["inflightCount"]
                assert status["outstandingRounds"] <= status["totalBudget"] == 64
                assert status["pendingRounds"] <= status["maxPendingRounds"] == 64
                assert status["inflightCount"] <= status["maxInFlightRounds"] == 64
                assert status["settlementPauseAt"] == 32
            return value

        board = fixture("remote")
        connecting = run(board, [frame({"GSConnecting": True, "Fire": True})], 5)
        assert connecting["platform"]["enabled"] and not connecting["platform"]["ready"]
        assert connecting["stats"]["shots"] == 0
        assert connecting["wagerStatus"]["blockReason"] == "connecting"
        empty_paid = run(board, sequence(balance=0, mode=1), 80)
        assert empty_paid["balance"] == 0 and empty_paid["stats"]["shots"] == 0
        checks.append("connecting and a zero-chip paid wallet cannot start wagers")

        pending = run(board, sequence(), 100)
        assert pending["platform"]["packetAck"] == 2 and pending["platform"]["ready"]
        assert pending["platform"]["mode"] == "demo"
        assert pending["platform"]["pendingRounds"] == 1 and pending["reservedWager"] == 10
        assert pending["stats"]["spent"] == pending["stats"]["won"] == 0
        assert pending["platform"]["requests"][0]["roundId"] == 1
        assert len(pending["platform"]["requests"][0]["targets"]) == 1
        checks.append("a real hit produces a retained outbox without invoking local award RNG")

        receipt = packet(3, 1, round_id=1, balance=10010, awards=(20,), multipliers=(2,))
        accepted = run(board, at(sequence(), 70, receipt))
        assert accepted["platform"]["packetAck"] == 3 and not accepted["platform"]["packetError"]
        assert accepted["stats"]["spent"] == 10 and accepted["stats"]["won"] == 20
        assert accepted["reservedWager"] == 0 and accepted["pendingWin"] == 20
        assert accepted["displayBalance"] == 9990 and accepted["balance"] == 10010
        assert accepted["cards"]["progress"] == 10
        repeated = at(sequence(), 70, receipt)
        repeated = padded(repeated, 110)
        for index in range(71, 110):
            repeated[index] = frame(receipt)
        duplicate = run(board, repeated, 110)
        assert duplicate["stats"] == accepted["stats"] and duplicate["platform"]["pendingRounds"] == 0
        collected = run(board, at(sequence(), 70, receipt), 280)
        assert collected["pendingWin"] == 0 and collected["displayBalance"] == 10010
        checks.append("a receipt commits once, preserves heart-delayed credits and ignores held duplicates")

        for character_id in ("eunbi", "yeseul", "original", "mugi", "jiayi"):
            role_board = fixture(f"small-{character_id}", character_id=character_id, inspect_unlocks=True)
            role_inputs = at(sequence(), 70, receipt)
            role_capture = run(role_board, role_inputs)
            assert role_capture["platform"]["ready"] and not role_capture["platform"]["packetError"]
            assert role_capture["stats"]["captures"] == 1 and role_capture["stats"]["won"] == 20
            assert role_capture["pendingWin"] == 20 and role_capture["reservedWager"] == 0
            clip_id = f"{character_id}-classic-small"
            if character_id == "original":
                assert clip_id not in role_capture["testUnlockedClipIds"]
                all_clips = [item for role in role_capture["gallery"]["characters"] for style in role["styles"] for item in style["items"]]
                assert not any(item["clipId"] == clip_id for item in all_clips)
                original_board = role_board
                original_inputs = role_inputs
            else:
                assert role_capture["testUnlockedClipIds"][clip_id]
            role_collected = run(role_board, role_inputs, 280)
            assert role_collected["pendingWin"] == 0 and role_collected["displayBalance"] == 10010
            assert role_collected["canShoot"] and role_collected["platform"]["ready"]
        valid_profile = run(original_board, at(original_inputs, 72, profile_packet(4, revision=2, progress=10)), 280)
        assert valid_profile["platform"]["ready"] and not valid_profile["platform"]["packetError"]
        original_clip_mask = 1 << valid_profile["platform"]["clipIds"].index("original-classic-small")
        fake_unlock = run(original_board, at(original_inputs, 72, profile_packet(4, revision=2, progress=10, unlocked=original_clip_mask)), 74)
        assert fake_unlock["platform"]["packetError"] == "profile-clips"
        for invalid_style in (1, 2, 3):
            bad_style = packet(3, 1, round_id=1, balance=10010, awards=(20,), multipliers=(2,), styles=(invalid_style,))
            unsupported = run(original_board, at(sequence(), 70, bad_style))
            assert unsupported["platform"]["packetError"] == "style-range"
            assert unsupported["reservedWager"] == 10 and unsupported["stats"]["won"] == 0
        checks.append("all five small captures pay and collect; Enzhi's sprite-only classic capture creates no replay unlock while unavailable styles remain rejected")

        large_board = fixture("large-multiplier", target_tier="large")
        large_inputs = sequence(mode=1)
        large_inputs[1] = frame(profile_packet(2, mode=1, selected_bet=1))
        for multiplier in (100, 240):
            large_receipt = packet(3, 1, mode=1, round_id=1, balance=9999+multiplier, awards=(multiplier,), multipliers=(multiplier,))
            awarded_large = run(large_board, at(large_inputs, 70, large_receipt))
            assert awarded_large["platform"]["ready"] and not awarded_large["platform"]["packetError"]
            assert awarded_large["stats"]["spent"] == 1 and awarded_large["stats"]["won"] == multiplier
            assert awarded_large["pendingWin"] == multiplier and awarded_large["reservedWager"] == 0
            assert awarded_large["rtp"]["captureDenominators"]["large"] == 17000
            assert awarded_large["demoConfig"]["largePayout"] == {"min": 100, "max": 240}
        for multiplier in (60, 241):
            illegal_receipt = packet(3, 1, mode=1, round_id=1, balance=9999+multiplier, awards=(multiplier,), multipliers=(multiplier,))
            rejected_large = run(large_board, at(large_inputs, 70, illegal_receipt))
            assert rejected_large["platform"]["packetError"] == "multiplier-range"
            assert rejected_large["reservedWager"] == 1 and rejected_large["stats"]["won"] == 0
        maximum_inputs = sequence(mode=1, fire_frames=())
        maximum_inputs[1] = frame(profile_packet(2, mode=1, selected_bet=5, selected_weapon=2))
        maximum_inputs[4] = frame({"Fire": True}, point=(0, 0), down=True)
        maximum_receipt = packet(3, 1, mode=1, round_id=1, balance=189250, awards=(180000,), multipliers=(240,))
        maximum_large = run(large_board, at(maximum_inputs, 70, maximum_receipt))
        assert maximum_large["platform"]["ready"] and not maximum_large["platform"]["packetError"]
        assert maximum_large["stats"]["spent"] == 750 and maximum_large["stats"]["won"] == 180000
        assert maximum_large["pendingWin"] == 180000 and maximum_large["reservedWager"] == 0
        checks.append("eight-bit large multipliers accept100/240 and maximum180000 award while rejecting old60 and out-of-range241")

        for name, payload in (
            ("unexpected-round", packet(3, 1, round_id=99, balance=10010, awards=(20,), multipliers=(2,))),
            ("award-range", packet(3, 1, round_id=1, balance=10011, awards=(21,), multipliers=(2,))),
            ("multiplier-range", packet(3, 1, round_id=1, balance=10070, awards=(80,), multipliers=(8,))),
            ("extra-target", packet(3, 1, round_id=1, balance=10030, awards=(20,20), multipliers=(2,2))),
            ("settlement-balance", packet(3, 1, round_id=1, balance=10020, awards=(20,), multipliers=(2,))),
        ):
            invalid = run(board, at(sequence(), 70, payload))
            assert invalid["platform"]["packetAck"] == 3
            assert invalid["platform"]["packetError"] == name
            assert not invalid["platform"]["ready"] and not invalid["canShoot"]
            assert invalid["wagerStatus"]["blockReason"] == "platformError"
            assert invalid["stats"]["spent"] == invalid["stats"]["won"] == 0
            assert invalid["reservedWager"] == 10 and invalid["platform"]["pendingRounds"] == 1
        checks.append("invalid receipts acknowledge an error and retain escrow without money effects")

        refused = run(board, at(sequence(), 70, packet(3, 2, round_id=1)))
        assert refused["balance"] == refused["displayBalance"] == 10000
        assert refused["reservedWager"] == 0 and refused["platform"]["pendingRounds"] == 0
        assert refused["stats"]["spent"] == refused["stats"]["won"] == 0
        assert refused["cards"]["progress"] == 0
        checks.append("a definitive server rejection releases escrow without minting card progress")

        two = sequence(fire_frames=(4, 30))
        both_pending = run(board, two)
        assert both_pending["platform"]["pendingRounds"] == 2
        two = at(two, 70, receipt)
        two = at(two, 73, packet(4, 1, round_id=2, balance=10030, awards=(30,), multipliers=(3,)))
        both = run(board, two, 75)
        assert both["stats"]["spent"] == 20 and both["stats"]["won"] == 50
        assert both["displayBalance"] == 9980 and both["pendingWin"] == 50
        assert both["platform"]["pendingRounds"] == 0
        checks.append("ordered pipelined receipts survive an already-caught visual target")

        automatic = sequence(fire_frames=())
        automatic = at(automatic, 4, {"ToggleAuto": True})
        saturated = run(board, automatic, 300)
        pending_count = saturated["platform"]["pendingRounds"]
        shot_count = saturated["stats"]["shots"]
        assert saturated["auto"] and 32 <= pending_count <= shot_count <= 64
        assert saturated["platform"]["inflightCount"] == 0
        assert saturated["reservedWager"] == shot_count * 10
        assert not saturated["canShoot"] and saturated["stats"]["spent"] == 0
        assert saturated["wagerStatus"]["blockReason"] == "settlementBacklog"
        freed = automatic
        release_count = pending_count - 31
        for index in range(release_count):
            round_id = saturated["platform"]["requests"][index]["roundId"]
            freed = at(freed, 300 + index, packet(3 + index, 1, round_id=round_id, balance=10000 - 10*(index+1)))
        resumed_auto = run(board, freed, 301 + release_count)
        assert resumed_auto["auto"] and resumed_auto["stats"]["shots"] == shot_count + 1
        assert resumed_auto["stats"]["spent"] == release_count*10 and resumed_auto["stats"]["won"] == 0
        assert resumed_auto["reservedWager"] == (shot_count + 1 - release_count)*10
        held_auto = run(board, freed, 500)
        assert held_auto["auto"] and held_auto["platform"]["pendingRounds"] >= 32
        assert held_auto["stats"]["shots"] <= 64 + release_count
        checks.append("real settlement pressure pauses new shots at32 within a hard64 total budget and resumes AUTO without a burst")

        normal_miss = fixture("normal-miss-cadence", 0)
        local_miss_inputs = padded([], 5)
        local_miss_inputs[4] = frame({"ToggleAuto": True})
        for frames in (120, 300):
            remote_miss = run(normal_miss, automatic, frames)
            local_miss = run(normal_miss, local_miss_inputs, frames)
            assert remote_miss["stats"]["shots"] == local_miss["stats"]["shots"] > 12
            assert remote_miss["platform"]["pendingRounds"] == 0
            assert remote_miss["wagerStatus"]["blockReason"] not in ("settlementBacklog", "flightCapacity")
            assert remote_miss["platform"]["inflightCount"] > 12
        slow_miss = fixture("hard-flight-budget", 0, slow_shots=True)
        bounded_miss = run(slow_miss, automatic, 700)
        assert bounded_miss["auto"] and bounded_miss["stats"]["shots"] == 64
        assert bounded_miss["platform"]["pendingRounds"] == 0 and bounded_miss["platform"]["inflightCount"] == 64
        assert bounded_miss["wagerStatus"]["blockReason"] == "flightCapacity"
        assert bounded_miss["reservedWager"] == 640 and bounded_miss["stats"]["spent"] == 0
        simultaneous = fixture("simultaneous-flight-hits", slow_shots=True, simultaneous_hits=True)
        all_pending = run(simultaneous, automatic, 700)
        assert all_pending["auto"] and all_pending["stats"]["shots"] == 64
        assert all_pending["platform"]["pendingRounds"] == 64 and all_pending["platform"]["inflightCount"] == 0
        assert all_pending["wagerStatus"]["blockReason"] == "settlementBacklog"
        assert all_pending["reservedWager"] == 640 and all_pending["stats"]["spent"] == 0
        checks.append("ordinary missed-projectile flight keeps local cadence beyond12 in flight; only the hard64 flight budget pauses pathological flights")
        checks.append("sixty-four existing projectiles may hit together without overflowing the total escrow or settlement queue budget")

        wallet_pause = padded(sequence(fire_frames=()), 81)
        for index in range(4, 81):
            wallet_pause[index] = frame({"GSConnecting": True, **({"ToggleAuto": True} if index == 4 else {})})
        held_wallet = run(board, wallet_pause, 81)
        assert held_wallet["platform"]["ready"] and held_wallet["platform"]["connecting"]
        assert held_wallet["auto"] and not held_wallet["canShoot"]
        assert held_wallet["wagerStatus"]["blockReason"] == "connecting"
        assert held_wallet["stats"]["shots"] == 0 and held_wallet["reservedWager"] == 0
        after_wallet = run(board, at(wallet_pause, 81, {}), 82)
        assert not after_wallet["platform"]["connecting"] and after_wallet["auto"]
        assert after_wallet["stats"]["shots"] == 1 and after_wallet["reservedWager"] == 10
        checks.append("held wallet connection blocks new wagers after bootstrap and releases AUTO without catch-up")

        paused_inputs = at(sequence(), 69, {"PlatformPause": True})
        paused_inputs = at(paused_inputs, 70, receipt)
        paused = run(board, paused_inputs, 180)
        assert paused["platform"]["paused"] and paused["pendingWin"] == 20
        assert paused["wagerStatus"]["blockReason"] == "platformPaused"
        assert paused["displayBalance"] == 9990 and paused["stats"]["won"] == 20
        resumed = run(board, at(paused_inputs, 180, {"PlatformResume": True}), 400)
        assert resumed["pendingWin"] == 0 and resumed["displayBalance"] == 10010
        checks.append("financial receipts can acknowledge during platform pause while heart collection waits")

        wallet = sequence(balance=0, mode=1, fire_frames=())
        wallet = at(wallet, 4, packet(3, 3, balance=500, mode=1))
        funded = run(board, wallet, 6)
        assert funded["displayBalance"] == 500 and funded["platform"]["funding"] == 500
        reset_ignored = run(board, at(wallet, 6, {"DemoReset": True}), 8)
        assert reset_ignored["displayBalance"] == 500 and reset_ignored["platform"]["enabled"]
        checks.append("idle wallet updates follow the platform and remote demo reset cannot grant chips")

        def low_balance_inputs(amount, selected_weapon=0):
            inputs = sequence(balance=amount, mode=1, fire_frames=())
            inputs[1] = frame(profile_packet(2, mode=1, selected_bet=1, selected_weapon=selected_weapon))
            inputs[4] = frame({"Fire": True}, point=(0, 0), down=True)
            return inputs

        for weapon_index, weapon_name, cost in ((0, "like", 1), (1, "flower", 6), (2, "rocket", 15)):
            low_paid = run(board, low_balance_inputs(61, weapon_index), 6)
            assert low_paid["bet"] == 1 and low_paid["weapon"] == weapon_name
            assert low_paid["stats"]["shots"] == 1 and low_paid["reservedWager"] == cost
            assert low_paid["displayBalance"] == 61 - cost
            assert low_paid["wagerStatus"]["attemptSerial"] == 0
            assert low_paid["wagerStatus"]["attemptReason"] == ""

            zero_inputs = low_balance_inputs(0, weapon_index)
            for index in range(5, 70):
                zero_inputs[index] = frame({"Fire": True})
            zero_paid = run(board, zero_inputs, 70)
            assert zero_paid["stats"]["shots"] == zero_paid["reservedWager"] == 0
            assert zero_paid["wagerStatus"]["blockReason"] == "insufficientFunds"
            assert zero_paid["wagerStatus"]["attemptSerial"] == 1
            assert zero_paid["wagerStatus"]["attemptReason"] == "insufficientFunds"
            assert zero_paid["wagerStatus"]["attemptCost"] == cost
            assert zero_paid["wagerStatus"]["attemptAvailableBalance"] == 0

        repeated_zero = at(zero_inputs, 71, {"Fire": True})
        assert run(board, repeated_zero, 73)["wagerStatus"]["attemptSerial"] == 2
        auto_zero = low_balance_inputs(0)
        auto_zero[4] = frame({"ToggleAuto": True})
        no_toast_spam = run(board, auto_zero, 200)
        assert no_toast_spam["auto"] and no_toast_spam["stats"]["shots"] == 0
        assert no_toast_spam["wagerStatus"]["attemptSerial"] == 0
        assert no_toast_spam["wagerStatus"]["blockReason"] == "insufficientFunds"
        checks.append("paid61 at base1 fires costs1/6/15; zero funds report one manual failure and AUTO never spams attempts")

        limited_inputs = low_balance_inputs(17)
        limited_inputs[4] = frame({"ToggleAuto": True})
        limited = run(slow_miss, limited_inputs, 300)
        assert limited["auto"] and limited["stats"]["shots"] == 17
        assert limited["reservedWager"] == 17 and limited["displayBalance"] == 0
        assert limited["platform"]["pendingRounds"] == 0
        assert limited["wagerStatus"]["blockReason"] == "insufficientFunds"
        assert limited["wagerStatus"]["attemptSerial"] == 0
        refund_resume = run(slow_miss, limited_inputs, 2500)
        assert refund_resume["auto"] and refund_resume["stats"]["shots"] > 17
        assert refund_resume["stats"]["spent"] == refund_resume["stats"]["won"] == 0
        assert refund_resume["displayBalance"] + refund_resume["reservedWager"] == 17
        checks.append("a low bankroll stops at actual available funds and miss refunds resume AUTO without minting or spending pending awards")

        stale_page = low_balance_inputs(61)
        stale_page[4] = frame({"GSConnecting": True, "Fire": True})
        held_stale = run(board, stale_page, 5)
        assert held_stale["displayBalance"] == 61 and held_stale["stats"]["shots"] == 0
        assert held_stale["wagerStatus"]["blockReason"] == "connecting"
        assert held_stale["wagerStatus"]["attemptReason"] == "connecting"
        released_page = run(board, at(stale_page, 6, {"Fire": True}), 8)
        assert released_page["stats"]["shots"] == 1 and released_page["reservedWager"] == 1
        assert released_page["wagerStatus"]["attemptReason"] == ""
        checks.append("a connected paid61 wallet is distinct from a held connection gate and can fire after release")

        pending_credit = low_balance_inputs(1)
        pending_credit = at(pending_credit, 70, dict(packet(3, 1, mode=1, round_id=1, balance=2, awards=(2,), multipliers=(2,)), Fire=True))
        collecting = run(board, pending_credit, 71)
        assert collecting["displayBalance"] == 0 and collecting["pendingWin"] == 2
        assert collecting["wagerStatus"]["blockReason"] == "pendingCredits"
        assert collecting["wagerStatus"]["attemptReason"] == "pendingCredits"
        assert collecting["wagerStatus"]["attemptSerial"] == 1
        collected_credit = run(board, pending_credit, 280)
        assert collected_credit["pendingWin"] == 0 and collected_credit["canShoot"]
        assert collected_credit["wagerStatus"]["blockReason"] == ""
        checks.append("uncollected winnings explain pending credit blockage and become available only after hearts arrive")

        empty = fixture("empty", 0)
        missed = run(empty, sequence(), 2200)
        assert missed["reservedWager"] == 0 and missed["balance"] == 10000
        assert missed["platform"]["pendingRounds"] == 0 and missed["cards"]["progress"] == 0
        checks.append("fully missed remote rounds refund locally without a financial server call")

        local = fixture("local", reject_local_roll=False)
        local_state = run(local, [frame({"Fire": True})], 70)
        assert not local_state["platform"]["enabled"] and local_state["stats"]["spent"] == 10
        checks.append("without the SDK, existing local settlement remains active")

        # Hydration is the only source of remote collection ownership. Use the
        # real catalog ordering instead of hardcoding a bit position for a role.
        clean = sequence(fire_frames=())
        baseline = run(board, clean, 3)
        clip_index = baseline["platform"]["clipIds"].index("eunbi-classic-large")
        clip_mask = 1 << clip_index
        counts = [0] * 14
        counts[0], counts[7] = 2, 1
        saved = dict(counts=counts, packs=2, progress=250, used=3, earned=5,
                     unlocked=clip_mask, watched=clip_mask, skip=True,
                     batch=((1, 1, True), (8, 1, True), (1, 2, False)),
                     selected_bet=5, selected_weapon=2)
        hydrated_sequence = clean.copy()
        hydrated_sequence[1] = frame(profile_packet(2, **saved))
        hydrated = run(board, hydrated_sequence, 5)
        catalog = hydrated["cards"]["catalog"]
        assert catalog[0]["count"] == 2 and catalog[7]["count"] == 1
        assert hydrated["cards"]["drawsAvailable"] == 2 and hydrated["cards"]["progress"] == 250
        assert hydrated["cards"]["spentTotal"] == 5250
        assert hydrated["cards"]["lastBatch"]["size"] == 3
        assert hydrated["cards"]["lastDraw"]["count"] == 2
        assert hydrated["watchedLargeClipIds"] == ["eunbi-classic-large"]
        assert hydrated["preferences"]["skipSeenLargeVideos"]
        assert hydrated["bet"] == 50 and hydrated["weapon"] == "rocket"
        assert not hydrated["auto"] and not hydrated["lock"]
        reloaded = run(board, hydrated_sequence, 5)
        assert reloaded["cards"] == hydrated["cards"]
        assert reloaded["preferences"] == hydrated["preferences"]
        checks.append("server profiles restore cards, duplicate counts, packs, history, watched clips and settings on a new runtime")

        max_saved = dict(saved, packs=9999, progress=0, earned=10002)
        full_profile_inputs = clean.copy()
        full_profile_inputs[1] = frame(profile_packet(2, **max_saved))
        restored_maximum = run(board, full_profile_inputs, 5)
        assert restored_maximum["platform"]["ready"] and not restored_maximum["platform"]["packetError"]
        assert restored_maximum["cards"]["capacity"] == restored_maximum["cards"]["drawsAvailable"] == 9999
        assert restored_maximum["cards"]["batchLimit"] == restored_maximum["cards"]["maxOpen"] == 10
        assert restored_maximum["cards"]["isFull"] and restored_maximum["cards"]["drawsUsed"] == 3
        assert restored_maximum["cards"]["catalog"][0]["count"] == 2
        assert restored_maximum["cards"]["catalog"][7]["count"] == 1
        too_many_inputs = clean.copy()
        too_many_inputs[1] = frame(profile_packet(2, **dict(max_saved, packs=10000, earned=10003)))
        assert run(board, too_many_inputs, 5)["platform"]["packetError"] == "profile-progress"
        portrait_inputs = at(full_profile_inputs, 5, {"GalleryOpen": True})
        portrait_inputs = at(portrait_inputs, 7, {"ViewportPortrait": True, "CardDrawAll": True})
        portrait_cards = run(board, portrait_inputs, 9)
        assert portrait_cards["viewportBlocked"] and not portrait_cards["cards"]["canDraw"]
        assert portrait_cards["platform"]["cardDrawRequest"] == 0
        assert portrait_cards["cards"]["drawsAvailable"] == 9999 and portrait_cards["cards"]["drawsUsed"] == 3
        portrait_inputs = at(portrait_inputs, 9, {"ViewportLandscape": True})
        landscape_cards = run(board, at(portrait_inputs, 11, {"CardDrawAll": True}), 13)
        assert not landscape_cards["viewportBlocked"] and landscape_cards["platform"]["cardDrawRequest"] == 1
        assert landscape_cards["platform"]["cardDrawPending"] and landscape_cards["cards"]["drawsAvailable"] == 9999
        checks.append("fourteen-bit pack profiles restore9999 with prior card ownership intact and reject10000")
        checks.append("a9999-pack collection still rejects new opening in portrait and accepts a fresh request after landscape")

        eleven_inputs = clean.copy()
        eleven_inputs[1] = frame(profile_packet(2, **dict(saved, packs=11, earned=14)))
        eleven_inputs = at(eleven_inputs, 5, {"GalleryOpen": True})
        eleven_inputs = at(eleven_inputs, 7, {"CardDrawAll": True})
        eleven_waiting = run(board, eleven_inputs, 9)
        assert eleven_waiting["platform"]["cardDrawPending"]
        assert eleven_waiting["cards"]["drawsAvailable"] == 11 and eleven_waiting["cards"]["drawsUsed"] == 3
        ten_counts = counts.copy()
        ten_counts[0] += 10
        ten_items = tuple((1, owned, False) for owned in range(3, 13))
        after_ten = dict(saved, counts=ten_counts, packs=1, earned=14, used=13,
                         batch=ten_items, batch_serial=2)
        eleven_inputs = at(eleven_inputs, 10, profile_packet(3, revision=2, draw_ack=1, **after_ten))
        ten_received = run(board, eleven_inputs, 12)
        assert ten_received["platform"]["ready"] and not ten_received["platform"]["cardDrawPending"]
        assert ten_received["cards"]["drawsAvailable"] == 1 and ten_received["cards"]["drawsUsed"] == 13
        assert ten_received["cards"]["lastBatch"]["size"] == 10
        assert ten_received["cards"]["catalog"][0]["count"] == 12 and ten_received["cards"]["catalog"][7]["count"] == 1
        last_counts = ten_counts.copy()
        last_counts[0] += 1
        eleven_inputs = at(eleven_inputs, 13, {"CardDrawAll": True})
        eleven_inputs = at(eleven_inputs, 15, profile_packet(4, revision=3, draw_ack=2,
            **dict(after_ten, counts=last_counts, packs=0, used=14, batch=((1, 13, False),), batch_serial=3)))
        final_received = run(board, eleven_inputs, 17)
        assert final_received["platform"]["ready"] and not final_received["platform"]["cardDrawPending"]
        assert final_received["cards"]["drawsAvailable"] == 0 and final_received["cards"]["drawsUsed"] == 14
        assert final_received["cards"]["lastBatch"]["size"] == 1 and final_received["cards"]["catalog"][0]["count"] == 13
        assert final_received["cards"]["catalog"][7]["count"] == 1 and final_received["balance"] == 10000
        oversized_batch = profile_packet(5, revision=4, draw_ack=2,
            **dict(after_ten, counts=last_counts, packs=0, used=14, batch=((1, 13, False),)*11, batch_serial=4))
        oversized_received = run(board, at(eleven_inputs, 18, oversized_batch), 20)
        assert oversized_received["platform"]["packetError"] == "profile-batch-size"
        assert oversized_received["cards"]["drawsUsed"] == 14 and oversized_received["cards"]["catalog"][0]["count"] == 13
        checks.append("server-owned opening of11 packs returns10 then1 while preserving existing cards and draw acknowledgements")

        drawing = at(hydrated_sequence, 5, {"GalleryOpen": True})
        blocked_draw = run(board, at(drawing, 7, {"CardDrawAll": True, "GSConnecting": True}), 8)
        assert blocked_draw["platform"]["connecting"] and blocked_draw["platform"]["cardDrawRequest"] == 0
        assert not blocked_draw["cards"]["canDraw"] and blocked_draw["cards"]["drawsUsed"] == 3
        drawing = at(drawing, 7, {"CardDrawAll": True})
        waiting = run(board, drawing, 10)
        assert waiting["platform"]["cardDrawRequest"] == 1 and waiting["platform"]["cardDrawPending"]
        assert waiting["cards"]["drawsUsed"] == 3
        assert waiting["cards"]["catalog"][0]["count"] == 2
        assert not waiting["cards"]["canDraw"]
        drawn_counts = counts.copy()
        drawn_counts[0] = 3
        drawn_counts[2] = 1
        drawn = dict(saved, counts=drawn_counts, packs=0, used=5,
                     batch=((3, 1, True), (1, 3, False)), batch_serial=2)
        drawing = at(drawing, 10, profile_packet(3, revision=2, draw_ack=1, **drawn))
        received = run(board, drawing, 12)
        assert not received["platform"]["cardDrawPending"] and received["cards"]["drawsUsed"] == 5
        assert received["cards"]["lastBatch"]["serial"] == 2
        assert received["cards"]["catalog"][0]["count"] == 3
        assert received["balance"] == 10000 and received["stats"]["won"] == 0
        stale = run(board, at(drawing, 13, profile_packet(4, revision=1, **saved)), 15)
        assert stale["cards"]["catalog"][0]["count"] == 3
        assert stale["cards"]["drawsAvailable"] == 0 and not stale["platform"]["packetError"]
        regressed_counts = drawn_counts.copy()
        regressed_counts[0] -= 1
        regressed_counts[2] += 1
        regressed = run(board, at(drawing, 13, profile_packet(4, revision=3, **dict(drawn, counts=regressed_counts))), 15)
        assert regressed["platform"]["packetError"] == "profile-card-regression"
        checks.append("remote card opening waits for server ownership and stale profiles cannot regress collections")

        dirty = at(hydrated_sequence, 7, {"ToggleSkipSeenLargeVideos": True, "BetDown": True, "WeaponLike": True})
        dirty = at(dirty, 9, profile_packet(3, revision=2, progress_ack=0, **saved))
        unsaved = run(board, dirty, 11)
        assert not unsaved["preferences"]["skipSeenLargeVideos"]
        assert unsaved["bet"] == 20 and unsaved["weapon"] == "like"
        assert unsaved["platform"]["progressRevision"] == 2
        confirmed = dict(saved, skip=False, selected_bet=4, selected_weapon=0)
        acknowledged = run(board, at(dirty, 11, profile_packet(4, revision=3, progress_ack=2, **confirmed)), 13)
        assert acknowledged["platform"]["progressAck"] == 2
        assert not acknowledged["preferences"]["skipSeenLargeVideos"]
        checks.append("newer local setting edits survive old profiles until the matching save acknowledgement")

    print(json.dumps({"passed": True, "native_runs": runs, "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
