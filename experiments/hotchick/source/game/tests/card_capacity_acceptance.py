"""Run the production Luau card module with settled-spend inputs.

These focused native fixtures exercise capacity and opening independently of
projectile travel. Financial settlement remains covered by remote/RTP tests.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


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

    def validate(cards):
        assert cards["capacity"] == 9999
        assert cards["batchLimit"] == cards["maxOpen"] == 10
        assert 0 <= cards["drawsAvailable"] == cards["drawsEarned"] - cards["drawsUsed"] <= 9999
        assert cards["spentTotal"] == cards["creditedSpend"] + cards["ignoredSpend"]
        assert cards["creditedSpend"] == cards["drawsEarned"] * 1000 + cards["progress"]
        assert 0 <= cards["progress"] < 1000
        assert sum(card["count"] for card in cards["catalog"]) == cards["drawsUsed"]
        assert cards["isFull"] == (cards["drawsAvailable"] == 9999)
        if cards["isFull"]:
            assert cards["progress"] == 0
        if cards.get("lastBatch"):
            assert 1 <= cards["lastBatch"]["size"] <= 10
            assert cards["lastBatch"]["size"] == len(cards["lastBatch"]["items"])

    with tempfile.TemporaryDirectory(prefix="hotchick-card-capacity-") as scratch:
        root = Path(scratch)

        def run(name, body):
            nonlocal runs
            directory = root / name
            directory.mkdir()
            driver = '''function Game.start(api: EngineApi)
    local cards = createCardSystem()
    local settledSpend = 0
    local function spend(cost: number)
        settledSpend += cost
        cards.spend(cost)
    end
    local function snapshot(): ObservationValue
        return cards.observe(settledSpend,true,false)
    end
''' + body + '''
end
function Game.update(api: EngineApi,dt: number) end
return Game
'''
            script = source[:source.index("function Game.start(api: EngineApi)")] + driver
            (directory / "main.luau").write_text(script, encoding="utf-8")
            (directory / "project.unone.json").write_text(json.dumps(dict(
                config, entry_script="main.luau", main_scene="main.scene.json", test_files=[]
            )), encoding="utf-8")
            shutil.copyfile(project / "scenes/main.scene.json", directory / "main.scene.json")
            result = subprocess.run([
                str(args.sdk.resolve()), "run", "--project", str(directory),
                "--frames", "1", "--seed", "72", "--json",
            ], capture_output=True, text=True, encoding="utf-8")
            payload = json.loads(result.stdout)
            assert result.returncode == 0 and payload["ok"], payload.get("diagnostics", result.stderr)
            states = payload["value"]["world"]["observations"]["audit"]
            for state in states.values():
                validate(state)
            runs += 1
            return states

        threshold = run("threshold-and-eleven", '''
    spend(999)
    local below = snapshot()
    spend(1)
    local exact = snapshot()
    spend(10500)
    local eleven = snapshot()
    cards.drawAll(true,false)
    local tenOpened = snapshot()
    cards.drawAll(true,false)
    api.observation.set("audit",{below=below,exact=exact,eleven=eleven,tenOpened=tenOpened,lastOpened=snapshot()})
''')
        assert threshold["below"]["progress"] == 999 and threshold["below"]["drawsAvailable"] == 0
        assert threshold["exact"]["progress"] == 0 and threshold["exact"]["drawsAvailable"] == 1
        assert threshold["eleven"]["drawsAvailable"] == 11 and threshold["eleven"]["progress"] == 500
        assert threshold["tenOpened"]["drawsUsed"] == 10 and threshold["tenOpened"]["drawsAvailable"] == 1
        assert threshold["tenOpened"]["lastBatch"]["size"] == 10
        assert threshold["lastOpened"]["drawsUsed"] == 11 and threshold["lastOpened"]["drawsAvailable"] == 0
        assert threshold["lastOpened"]["lastBatch"]["size"] == 1 and threshold["lastOpened"]["progress"] == 500
        checks.append("threshold remainder persists; opening11 consumes10 then1 without losing the last pack")

        capacity = run("capacity-stop-and-resume", '''
    spend(9998500)
    local nearFull = snapshot()
    spend(2500)
    local full = snapshot()
    spend(2500)
    local ignored = snapshot()
    cards.drawAll(true,false)
    local opened = snapshot()
    spend(500)
    local resumedHalf = snapshot()
    spend(500)
    local resumedPack = snapshot()
    spend(9000)
    local fullAgain = snapshot()
    spend(750)
    api.observation.set("audit",{nearFull=nearFull,full=full,ignored=ignored,opened=opened,
        resumedHalf=resumedHalf,resumedPack=resumedPack,fullAgain=fullAgain,ignoredAgain=snapshot()})
''')
        assert capacity["nearFull"]["drawsAvailable"] == 9998 and capacity["nearFull"]["progress"] == 500
        assert capacity["full"]["drawsAvailable"] == 9999 and capacity["full"]["ignoredSpend"] == 2000
        assert capacity["ignored"]["drawsAvailable"] == 9999 and capacity["ignored"]["ignoredSpend"] == 4500
        assert capacity["opened"]["drawsAvailable"] == 9989 and capacity["opened"]["drawsUsed"] == 10
        assert capacity["resumedHalf"]["progress"] == 500 and capacity["resumedHalf"]["ignoredSpend"] == 4500
        assert capacity["resumedPack"]["drawsAvailable"] == 9990 and capacity["resumedPack"]["progress"] == 0
        assert capacity["fullAgain"]["drawsAvailable"] == 9999 and capacity["fullAgain"]["drawsEarned"] == 10009
        assert capacity["ignoredAgain"]["ignoredSpend"] == 5250
        checks.append("capacity9999 clamps settled-spend overflow; full spending pauses and new progress resumes after opening10")

        overflow = run("large-overflow", '''
    spend(1000000000)
    local full = snapshot()
    cards.drawAll(true,false)
    spend(1)
    api.observation.set("audit",{full=full,afterOneNewChip=snapshot()})
''')
        assert overflow["full"]["ignoredSpend"] == 990001000
        assert overflow["afterOneNewChip"]["drawsAvailable"] == 9989
        assert overflow["afterOneNewChip"]["progress"] == 1
        assert overflow["afterOneNewChip"]["drawsEarned"] == 9999
        checks.append("large overflow creates no hidden bank that could refill opened packs")

        equivalent = run("batch-versus-singles", '''
    spend(11000)
    local singles = createCardSystem()
    singles.spend(11000)
    cards.drawAll(true,false)
    for _=1,10 do singles.draw(true,false) end
    local batchTen = snapshot()
    local singlesTen = singles.observe(11000,true,false)
    cards.drawAll(true,false)
    singles.draw(true,false)
    api.observation.set("audit",{batchTen=batchTen,singlesTen=singlesTen,
        batchEleven=snapshot(),singlesEleven=singles.observe(11000,true,false)})
''')
        for suffix in ("Ten", "Eleven"):
            batch, singles = equivalent["batch" + suffix], equivalent["singles" + suffix]
            assert batch["catalog"] == singles["catalog"]
            assert batch["lastDraw"] == singles["lastDraw"]
            assert batch["drawsUsed"] == singles["drawsUsed"]
        assert equivalent["batchTen"]["lastBatch"]["size"] == 10
        assert equivalent["batchEleven"]["lastBatch"]["items"][0]["serial"] == 11
        checks.append("capped batches consume exactly the same independent card RNG stream and duplicate counts as individual draws")

        guards = run("guards-and-reset", '''
    cards.drawAll(true,false)
    local empty = snapshot()
    spend(11000)
    local before = snapshot()
    cards.drawAll(false,false)
    cards.drawAll(true,true)
    local blocked = snapshot()
    cards.drawAll(true,false)
    cards.drawAll(true,false)
    local finished = snapshot()
    cards.drawAll(true,false)
    local noExtra = snapshot()
    cards.reset()
    settledSpend = 0
    api.observation.set("audit",{empty=empty,before=before,blocked=blocked,finished=finished,noExtra=noExtra,reset=snapshot()})
''')
        assert guards["before"] == guards["blocked"]
        assert guards["finished"] == guards["noExtra"]
        assert guards["reset"]["drawsUsed"] == 0 and guards["reset"]["drawsAvailable"] == 0
        assert not guards["reset"].get("lastBatch") and not any(card["count"] for card in guards["reset"]["catalog"])
        checks.append("empty closed and blocked opening guards preserve packs; a session reset clears counts and batch state")

        thousand = run("thousand-draws", '''
    spend(1000000)
    for _=1,100 do cards.drawAll(true,false) end
    api.observation.set("audit",{finished=snapshot()})
''')["finished"]
        assert thousand["drawsUsed"] == 1000 and thousand["drawsAvailable"] == 0
        assert all(card["count"] > 0 for card in thousand["catalog"])
        rarity = Counter()
        for card in thousand["catalog"]:
            rarity[card["rarity"]] += card["count"]
        assert 625 <= rarity["N"] <= 775 and 190 <= rarity["R"] <= 310 and 20 <= rarity["SR"] <= 80
        checks.append("all14 cards remain reachable across100 real capped batches with unchanged rarity odds")

    print(json.dumps({"passed": True, "native_runs": runs, "capacity": 9999, "batch_limit": 10,
                      "checks": checks, "thousand_draw_rarities": dict(rarity)}, indent=2))


if __name__ == "__main__":
    main()
