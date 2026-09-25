"""Run the production Luau life/inventory code and synthetic transport checks.

Synthetic decisions below test execution only, not NanoJev judgement quality.
"""
import json
from pathlib import Path
import subprocess
import tempfile

project = Path(__file__).resolve().parents[1]
engine = project.parents[1]
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
block = source[source.index("-- Town economy is gameplay"):source.index("local function residentPageCount")]
fixture = '''
local npcs,resources={},{}
local frame,worldMinutes,simulationTickCount=0,0,0
local Pair={occupied=function() return false end} -- This extracted unit fixture has no pair sessions.
local function clamp(v,a,b) return math.max(a,math.min(b,v)) end
''' + source[source.index("local Persona = {}"):source.index("local BUILDINGS = {")] + block + '''
for i=1,40 do table.insert(npcs,{id="npc_"..i,name="R"..i,role="J"..i,wealth=28+(i*17)%65,
    alive=true,action="wait",location="home",residence="home",hunger=60,fatigue=70,injury=24,
    loneliness=18,morale=50,fear=10,jealousy=0,resentment=0,tool=Life.tools[i]}) end
Economy.reset()
local n=npcs[1]
assert(#Life.inventory(n)==3 and n.inventory.food==1 and n.inventory.herbs==1)
local function audit()
    assert(Economy.snapshot().money_delta==0)
    for _,g in ipairs(Economy.snapshot().goods) do
        assert(g.stock+g.carried==g.initial_stock+g.produced-g.consumed)
    end
    for _,r in ipairs(npcs) do for _,q in pairs(r.inventory) do assert(q>=0 and q==math.floor(q)) end end
end
-- Carrying a purchase moves stock, consumption occurs only when used.
local total=Economy.stock("food")+Economy.carried("food")
n.action="buy_food"; Life.itemAction(n)
assert(n.inventory.food==2 and Economy.consumption.food==0)
Life.itemAction(n); assert(n.inventory.food==2,"purchase repeated within one decision")
assert(Economy.stock("food")+Economy.carried("food")==total)
n.action="eat_packed"; n.itemActionDone=false; Life.itemAction(n)
assert(n.inventory.food==1 and n.hunger==24 and Economy.consumption.food==1)
Life.itemAction(n); assert(n.inventory.food==1 and n.hunger==24)
n.action="use_medicine"; n.itemActionDone=false; Life.itemAction(n)
assert(n.inventory.herbs==0 and n.injury==12)
n.itemActionDone=false; Life.itemAction(n); assert(n.injury==12)
n.action="shop"; n.itemActionDone=false; Life.itemAction(n)
assert(n.inventory.wares==1)
n.action="use_supplies"; n.itemActionDone=false; n.finance.need_wares=80; Life.itemAction(n)
assert(n.inventory.wares==0 and n.finance.need_wares==35)
audit()
-- Work and night wakefulness tire residents; choosing rest while travelling does not recover.
n.action="work"; n.fatigue=50; Life.tick(n,10,Life.clock(720)); assert(n.fatigue>50)
n.action="rest"; n.location="road"; n.fatigue=50
Life.tick(n,10,Life.clock(0)); assert(n.fatigue>50 and not Life.resting(n))
n.location="home"; n.fatigue=70; Life.tick(n,10,Life.clock(720))
assert(n.fatigue==65 and n.restMinutes==10 and not n.sleepMinutes)
n.fatigue=70; Life.tick(n,10,Life.clock(0))
assert(n.fatigue==62.5 and n.sleepMinutes==10 and n.restMinutes==20)
assert(Life.mood(n)=="sleeping")
n.reservedX=2; assert(not Life.resting(n)); n.reservedX=nil
n.routeCells={{x=0,z=0}}; n.routeIndex=1; assert(not Life.resting(n))
n.routeIndex=2; assert(Life.resting(n))
n.alive=false; local fatigue=n.fatigue; Life.tick(n,20,Life.clock(720)); assert(n.fatigue==fatigue)
assert(not Economy.useItem(n,"food")); audit()
-- Midnight rollover, sunrise/day/sunset/night and bounded continuous light.
assert(Life.clock(0).is_night and Life.clock(0).daylight==0)
assert(Life.clock(360).phase=="清晨" and not Life.clock(360).is_night)
assert(Life.clock(720).daylight==1 and Life.clock(720).phase=="白晝")
assert(Life.clock(1080).phase=="黃昏")
assert(Life.clock(1200).is_night and Life.clock(1440).day==2)
for m=0,2880 do local c=Life.clock(m); assert(c.daylight>=0 and c.daylight<=1 and c.twilight>=0 and c.twilight<=1) end
print("Life checks passed: items, money/stock conservation, fatigue, arrival, rest/sleep, clock.")
'''
with tempfile.TemporaryDirectory(prefix="wuxia-life-") as directory:
    script = Path(directory) / "life.luau"
    script.write_text(fixture, encoding="utf-8")
    subprocess.run([str(engine / ".toolcache/luau-0.734/luau.exe"), str(script)], check=True)
    inputs = Path(directory) / "inputs.json"
    inputs.write_text(json.dumps([{}, {"actions": {"nano_reply": True, "nano_npc_1_1_1_apply": True,
        "nano_npc_1_1_1_rest": True, "nano_npc_1_1_1_target_none": True, "nano_npc_1_1_1_timing_after_current": True}},
        {"actions": {"nano_reply": True, "nano_npc_2_1_2_apply": True,
        "nano_npc_2_1_2_eat_packed": True, "nano_npc_2_1_2_target_none": True, "nano_npc_2_1_2_timing_after_current": True}}]), encoding="utf-8")
    for frames in (120, 5400, 8100, 10800):
        run = subprocess.run([str(engine / "target/release/game.exe"), "--project", str(project), "--json", "run",
            "--frames", str(frames), "--seed", "42", "--input-sequence", str(inputs)],
            capture_output=True, text=True, encoding="utf-8", check=True)
        result = json.loads(run.stdout)
        assert result["ok"], result.get("diagnostics")
        obs = result["value"]["world"]["observations"]
        people = obs["view_model"]["npc"]
        assert len(people) == 40 and obs["decision_count"] == 2
        assert people[0]["resting"] and people[0]["rest_minutes"] > 0 and people[0]["fatigue"] < 20
        assert people[1]["inventory_counts"]["food"] == 0
        assert all(n["inventory"][0]["name"] and n["emotion_cause"] and n["thought_source"] for n in people)
        assert obs["economy"]["money_delta"] == 0
        clock = obs["day_cycle"]
        if frames == 120:
            assert people[0]["sleeping"] and people[0]["sleep_minutes"] > 0
            request = next(r for r in obs["decision_requests"] if r["npc_id"] == "npc_3")
            assert "Inventory:" in request["state"] and "Time: day" in request["state"]
            assert "eat_packed" in request["questions"]["action"]["criteria"]
        if frames == 5400:
            assert clock["phase"] == "白晝" and clock["daylight"] > .99 and not people[0]["sleeping"]
        if frames == 8100:
            assert clock["phase"] == "黃昏"
        if frames == 10800:
            assert clock["is_night"]
        print(json.dumps({"frames": frames, "phase": clock["phase"], "rest_minutes": people[0]["rest_minutes"],
            "sleep_minutes": people[0]["sleep_minutes"], "fatigue": people[0]["fatigue"], "money_delta": obs["economy"]["money_delta"]}, ensure_ascii=True))
