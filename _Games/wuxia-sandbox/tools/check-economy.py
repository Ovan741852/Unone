"""Check the production Luau accounting functions and actual Unone town replays.

No Python economy: the small generated fixture runs the unchanged Economy block
from main.luau with only world inputs replaced. Requires the repo's Luau CLI.
"""
import json
from pathlib import Path
import subprocess
import tempfile

project = Path(__file__).resolve().parents[1]
engine = project.parents[1]
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
economy = source[source.index("-- Town economy is gameplay"):source.index("local function residentPageCount")]
fixture = '''
local npcs,resources={},{}
local frame,worldMinutes,simulationTickCount=0,0,0
local Pair={occupied=function() return false end} -- Pair settlement is covered by the whole-module fixture.
local function clamp(v,a,b) return math.max(a,math.min(b,v)) end
''' + economy + '''
local function fresh()
    npcs={}; resources={}; frame=0; worldMinutes=0; simulationTickCount=0
    for i=1,40 do table.insert(npcs,{id="npc_"..i,name="Resident "..i,role="Job "..i,
        wealth=28+(i*17)%65,alive=true,action="work",location="road",hunger=0,injury=0}) end
    Economy.reset()
end
local function audit()
    local e=Economy.snapshot()
    assert(e.total_money==e.initial_money,"money was created or lost")
    for _,n in ipairs(npcs) do
        assert(n.wealth>=0 and n.wealth==math.floor(n.wealth))
        assert(n.wealth==n.finance.initial_balance+n.finance.income-n.finance.spent)
        assert(#n.finance.receipts<=5)
    end
    for _,b in ipairs(e.businesses) do
        assert(b.balance>=0)
        for _,q in pairs(b.inventory) do assert(q>=0 and q==math.floor(q)) end
    end
    for _,g in ipairs(e.goods) do assert(g.stock+g.carried==g.initial_stock+g.produced-g.consumed) end
    assert(#e.ledger<=24)
end
fresh()
assert(not Economy.transfer(npcs[1],npcs[2],10000,"test","insufficient cash"))
assert(not Economy.transfer(npcs[1],npcs[1],1,"test","self transfer"))
assert(not Economy.transfer(npcs[1],npcs[2],-4,"test","negative transfer"))
for i=1,40 do if i~=2 then Economy.transfer(npcs[i],npcs[2],1,"theft","test transfer") end end
assert(npcs[2].wealth>100,"wealth is still clamped as a stat")
audit()
-- Healthy workers require arrival and eight effective work ticks; cooking consumes ingredients.
fresh()
local cook=npcs[9]
for _=1,16 do Economy.work(cook) end
assert(cook.finance.shifts==0)
cook.location=cook.job.zone
for _=1,8 do Economy.work(cook) end
assert(cook.finance.shifts==1 and Economy.production.food==6 and Economy.consumption.ingredients==1)
audit()
-- Purchases fail atomically; relief uses the treasury, not new money.
fresh()
local poor=npcs[1]
Economy.transfer(poor,npcs[2],poor.wealth,"test","empty purse")
local food=Economy.stock("food")
assert(not Economy.buy(poor,"inn","food"))
assert(Economy.stock("food")==food and poor.wealth==0)
poor.hunger=80
assert(Economy.buy(poor,"inn","food"))
assert(Economy.stock("food")==food-1 and Economy.totals.relief>0)
audit()
Economy.transfer(Economy.accounts.treasury,npcs[2],Economy.accounts.treasury.wealth,"test","empty treasury")
assert(not Economy.buy(poor,"inn","food"))
audit()
-- Empty inventory cannot be sold; scarcity changes prices, restocking moves goods.
fresh()
local before=Economy.price("food")
Economy.consume(Economy.accounts.inn,"food",Economy.stock("food"))
assert(Economy.price("food")>before and not Economy.buy(npcs[2],"inn","food"))
local stock=Economy.stock("wares")
Economy.restock("market","workshop","wares",24)
assert(Economy.stock("wares")==stock and Economy.accounts.market.inventory.wares==24)
audit()
-- Insolvent firms cannot create stock or wages, and depleted inputs stop cooks.
fresh()
cook=npcs[9]; cook.location=cook.job.zone
Economy.transfer(Economy.accounts.inn,npcs[2],500,"test","insolvent inn")
for _=1,8 do Economy.work(cook) end
assert(cook.finance.shifts==0 and Economy.production.food==0)
audit()
fresh()
cook=npcs[9]; cook.location=cook.job.zone
Economy.consume(Economy.accounts.inn,"ingredients",20)
for _=1,8 do Economy.work(cook) end
assert(cook.finance.shifts==0 and Economy.production.food==0)
audit()
-- Active contracts stay fixed; only a suspended contract exposes job search.
fresh()
local contracted=npcs[1]
assert(contracted.job.contract_status=="active" and not Economy.jobSearchNeeded(contracted))
contracted.location=contracted.job.zone
local contractedFirm=Economy.accounts[contracted.job.firm]
Economy.transfer(contractedFirm,npcs[2],contractedFirm.wealth,"test","suspend contract")
for _=1,24 do Economy.work(contracted,1) end
assert(contracted.job.contract_status=="suspended" and Economy.jobSearchNeeded(contracted))
assert(Economy.findJob(contracted) and contracted.job.contract_status=="active" and contracted.finance.job_changes==1)
audit()
-- Day boundary resets daily cash flow, not lifetime cash flow. Estates stay accounted.
fresh()
Economy.transfer(npcs[1],npcs[2],10,"theft","theft audit")
npcs[2].alive=false
assert(Economy.snapshot().estate_cash==npcs[2].wealth)
worldMinutes=1440; Economy.tick()
assert(Economy.day==2 and npcs[1].finance.today_spent==0 and npcs[1].finance.spent==10)
audit()
print("Luau economy edge cases passed")
'''
with tempfile.TemporaryDirectory(prefix="wuxia-economy-") as directory:
    script = Path(directory) / "economy-check.luau"
    script.write_text(fixture, encoding="utf-8")
    subprocess.run([str(engine / ".toolcache/luau-0.734/luau.exe"), str(script)], check=True)

reports = []
inputs = project / ".runtime/verified-nanojev-inputs.json"
if not inputs.exists():
    inputs = project / "tests/evidence/nanojev-lookahead-inputs.json"
replay = ["--input-sequence", str(inputs)] if inputs.exists() else []
for frames in (1, 600, 7200, 21600):
    run = subprocess.run([str(engine / "target/release/game.exe"), "--project", str(project), "--json", "run", "--frames", str(frames), "--seed", "42", *replay], capture_output=True, text=True, encoding="utf-8", check=True)
    result = json.loads(run.stdout)
    assert result["ok"], result.get("diagnostics")
    obs = result["value"]["world"]["observations"]
    residents = obs["view_model"]["npc"]
    e = obs["economy"]
    assert e["money_delta"] == 0 and e["total_money"] == e["initial_money"] == 9730
    assert sum(n["wealth"] for n in residents) + sum(b["balance"] for b in e["businesses"]) == e["total_money"]
    for npc in residents:
        f = npc["finance"]
        assert npc["wealth"] >= 0 and npc["wealth"] == f["initial_balance"] + f["income"] - f["spent"]
        assert len(f["receipts"]) <= 5
    for business in e["businesses"]:
        assert business["balance"] >= 0 and all(q >= 0 for q in business["inventory"].values())
    for good in e["goods"]:
        assert good["stock"] >= 0 and good["carried"] >= 0 and good["stock"] + good["carried"] == good["initial_stock"] + good["produced"] - good["consumed"]
    assert obs["world_resources"]["food"] == next(g["stock"] for g in e["goods"] if g["id"] == "food")
    assert len(e["ledger"]) <= 24
    if not replay:
        assert obs["decision_count"] == 0, "No checkpoint was present: no fallback decisions allowed"
    # Which professions actually produce depends on model choices, not a test mandate.
    reports.append({"frames": frames, "day": e["day"], "transactions": e["transactions"], "money_delta": e["money_delta"], "poor": e["poor_residents"], "p95_ms": result["value"]["performance"]["p95_frame_ms"]})
    print(json.dumps(reports[-1]), flush=True)
print(json.dumps({"passed": True, "samples": reports}, indent=2))
