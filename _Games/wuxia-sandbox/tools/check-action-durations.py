"""Synthetic production-Luau timing tests; optional local tokenizer, no model or live inputs."""
import argparse
import json
import re
from pathlib import Path
import subprocess
import sys
import tempfile

project = Path(__file__).resolve().parents[1]
engine = project.parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--tokens", action="store_true")
args = parser.parse_args()
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
fixture = r'''
local observations,transforms,inputs={},{},{}
local api={debug={enabled=false},log=function() end,ui={setRoot=function() end},
    input={isDown=function(k) return inputs[k]==true end,isPointerDown=function() return false end},
    camera3d={setPosition=function() end,setTarget=function() end},
    observation={set=function(k,v) observations[k]=v end},random={nextFloat=function() return .5 end},
    entity={getTransform3D=function(id) return transforms[id] or {position={x=0,y=0,z=0}} end,setTransform3D=function(id,t) transforms[id]=t end}}
local function near(a,b) assert(math.abs(a-b)<1e-7,tostring(a).." ~= "..tostring(b)) end
local function audit()
    local e=Economy.snapshot(); assert(e.money_delta==0)
    for _,g in ipairs(e.goods) do assert(g.stock+g.carried==g.initial_stock+g.produced-g.consumed) end
end
local serial=0
local function choose(n,action,target,extra)
    serial+=1
    local plan={action=action,target=target or "none",timing="interrupt_now",request_id="synthetic_duration_"..serial,created_frame=frame}
    if extra then for k,v in pairs(extra) do plan[k]=v end end
    Brain.startPlan(api,n,plan)
    return plan
end
local function fresh(index)
    resetWorld(api); worldMinutes=720; frame=1
    for _,n in ipairs(npcs) do
        n.lastNeedsMinute=720; n.lastTaskMinute=720; n.routeCells=nil; n.reservedX=nil; n.reservedZ=nil
        n.fatigue=0; n.hunger=0; n.injury=0; n.nextDecisionFrame=100000
    end
    return npcs[index or 1]
end
local function arrive(n)
    n.location=targetZone(n); n.routeCells=nil; n.reservedX=nil; n.executionSince=worldMinutes
end
local function step(minutes,needs)
    worldMinutes+=minutes
    if not needs then for _,n in ipairs(npcs) do n.lastNeedsMinute=worldMinutes end end -- Same-condition controlled comparison.
    applyAction(api); audit()
end
local limits={rest={20,90},eat={12,30},eat_packed={8,18},use_medicine={6,15},use_supplies={6,15},buy_food={5,15},buy_herbs={5,15},shop={5,15},wait={10,30},travel={2,6}}
for action,range in pairs(limits) do
    local n=fresh(); n.hunger=80; n.injury=30; n.fatigue=50
    if action=="use_supplies" then n.inventory.wares=1; Economy.initial_stock.wares+=1 end
    choose(n,action); arrive(n)
    local duration=n.task.duration_minutes; assert(duration>=range[1] and duration<=range[2])
    local food,herbs,wares,cash,hunger,injury=n.inventory.food,n.inventory.herbs,n.inventory.wares,n.wealth,n.hunger,n.injury
    step(duration-.01)
    assert(not n.task.complete and not n.itemActionDone)
    assert(n.inventory.food==food and n.inventory.herbs==herbs and n.inventory.wares==wares and n.wealth==cash and n.hunger==hunger and n.injury==injury)
    step(.01); assert(n.task.complete and n.task.duration_minutes==duration)
    near(n.task.elapsed_minutes,duration); near(n.task.progress,1); near(n.task.remaining_minutes,0)
    if action=="eat" then assert(n.hunger==hunger-36 and n.wealth<cash)
    elseif action=="eat_packed" then assert(n.hunger==hunger-36 and n.inventory.food==food-1)
    elseif action=="use_medicine" then assert(n.injury==injury-12 and n.inventory.herbs==herbs-1)
    elseif action=="use_supplies" then assert(n.inventory.wares==wares-1)
    elseif action=="buy_food" then assert(n.inventory.food==food+1 and n.wealth<cash)
    elseif action=="buy_herbs" then assert(n.inventory.herbs==herbs+1 and n.wealth<cash)
    elseif action=="shop" then assert(n.inventory.wares==wares+1 and n.wealth<cash) end
    local state={n.wealth,n.inventory.food,n.inventory.herbs,n.inventory.wares,n.hunger,n.martial,n.patrolZone,n.loneliness}
    step(100); for i,v in ipairs({n.wealth,n.inventory.food,n.inventory.herbs,n.inventory.wares,n.hunger,n.martial,n.patrolZone,n.loneliness}) do assert(v==state[i],action.." repeated after completion") end
end
-- One sample per start, variation across people and instances; observations are read-only.
local seen,instances={},{}
for i=1,40 do
    local n=fresh(i); choose(n,"eat"); seen[n.task.duration_minutes]=true
    local duration=n.task.duration_minutes
    for _=1,10 do snapshotNPC(n); buildDecisionRequest(n); assert(n.task.duration_minutes==duration) end
end
local n=fresh()
for _=1,30 do choose(n,"eat"); instances[n.task.duration_minutes]=true end
local function count(t) local c=0; for _ in pairs(t) do c+=1 end; return c end
assert(count(seen)>1 and count(instances)>1)
n=fresh(); worldMinutes=0; n.lastNeedsMinute=0; n.fatigue=80; choose(n,"rest"); arrive(n)
assert(n.task.duration_minutes>=240 and n.task.duration_minutes<=480)
step(n.task.duration_minutes,true); assert(n.task.complete and n.fatigue<80 and Life.resting(n))
n.fatigue=30; step(4,true); near(n.fatigue,30-4*(Life.clock(worldMinutes).is_night and .75 or .5)); assert(n.action=="rest" and Life.resting(n),"no forced wake")
-- No arrival credit: actual grid arrival occurs between simulation boundaries.
n=fresh(); choose(n,"rest"); n.fatigue=50
frame=2; for _,other in ipairs(npcs) do other.routeCells={}; other.routeIndex=1; other.routeReachable=true; other.routeZone=other.location end
local home=ZONES[n.residence]; n.x=home.x; n.z=home.z-.01; n.gridX=home.x/2; n.gridZ=home.z/2-1
n.routeCells={{x=home.x/2,z=home.z/2}}; n.routeIndex=1; n.routeReachable=true; n.routeZone=n.residence
n.location="road"; n.executionSince=nil; n.reservedX=home.x/2; n.reservedZ=home.z/2
worldMinutes+=4; updateMovement(api,1/60)
assert(n.location==n.residence and n.executionSince==worldMinutes and n.fatigue>50)
applyAction(api); assert(n.task.minutes==0 and n.restMinutes==0)
local fatigue=n.fatigue; step(4,true); near(n.task.minutes,4); near(n.fatigue,fatigue-2)
-- Explicit model timing: deferred plan waits, interrupt loses unfinished meal but not earned rest.
n=fresh(); n.hunger=80; choose(n,"eat_packed"); arrive(n); local duration=n.task.duration_minutes
n.nextPlan={action="wait",target="none",timing="after_current",request_id="queued",created_frame=frame}
step(duration/2); Brain.advancePlans(api); assert(n.action=="eat_packed" and n.nextPlan)
step(duration/2); Brain.advancePlans(api); assert(n.action=="wait" and n.thinking.request_id=="queued")
n=fresh(); n.hunger=80; choose(n,"eat_packed"); arrive(n); step(n.task.duration_minutes/2)
choose(n,"wait"); step(100); assert(n.inventory.food==1 and n.hunger==80)
-- Productive effort uses game minutes, one wage/output per eight effort, never after completion.
for _,action in ipairs({"work","train","gather","hunt"}) do
    n=fresh(action=="work" and 9 or 1); choose(n,action); arrive(n)
    local unit=n.task.effort_minutes; local cash=n.wealth; local skill=n.martial
    step(unit/2); near(n.task.effort,.5); assert(n.finance.shifts==0 and n.wealth==cash)
    if action=="train" then near(n.martial-skill,.35) end
    if action=="hunt" then assert(n.injury>0 and n.injury<1) end
    local loops=0
    while not n.task.complete do step(1); loops+=1; assert(loops<200) end
    near(n.task.effort,8)
    if action=="work" or action=="gather" then assert(n.finance.shifts==1 and n.wealth==cash+n.job.wage) end
    cash=n.wealth; skill=n.martial; local injury=n.injury; step(100)
    assert(n.wealth==cash and n.martial==skill and n.injury==injury)
end
n=fresh(9); choose(n,"work"); arrive(n); step(5); local carried=n.finance.work_ticks
choose(n,"wait"); arrive(n); step(10); near(n.finance.work_ticks,carried)
choose(n,"work"); arrive(n); local loops=0
while not n.task.complete do step(1,true); loops+=1; assert(loops<200) end
near(n.finance.work_ticks+n.finance.shifts*8,carried+8); assert(n.finance.shifts==1)
-- Frame-rate independence at constant needs; same game minutes, not count of apply calls.
local function labor(part)
    n=fresh(9); choose(n,"work"); arrive(n)
    for _=1,16/part do step(part) end
    return n.task.effort,n.wealth
end
local effort,cash=labor(4); local otherEffort,otherCash=labor(.5); near(effort,otherEffort); assert(cash==otherCash)
-- Pause freezes all physical and response clocks; speed scales physical but not response deadline.
local function pair()
    local a=fresh(); local b=npcs[2]; a.x=0; a.z=0; b.x=2; b.z=0
    choose(a,"social",b.id); Pair.tick(api,.01); local p=a.pair
    choose(b,"accept",a.id,{pair_id=p.id,pair_basis=Pair.basis(b)}); Pair.tick(api,.01)
    return a,b,p
end
local a,b,p=pair(); local duration=p.duration_minutes
paused=true; Pair.tick(api,20); Combat.tick(api,20); applyAction(api)
assert(p.elapsed_minutes==0 and p.a.loneliness==18); paused=false
Pair.tick(api,duration/32); near(p.elapsed_minutes,duration/4); near(a.task.minutes,b.task.minutes)
assert(a.task.duration_minutes==b.task.duration_minutes and a.task.timing_kind=="shared_execution")
speed=4; Pair.tick(api,duration/32); assert(p.done and a.task.complete and b.task.complete)
-- Actual paused Game.update does not advance world time, needs or a queued meal.
n=fresh(); n.hunger=80; choose(n,"eat_packed"); arrive(n); paused=true
local now=worldMinutes; for _=1,60 do Game.update(api,1/60) end
assert(worldMinutes==now and n.task.minutes==0 and n.inventory.food==1)
paused=false; speed=2; frame=29; Game.update(api,.5); near(worldMinutes-now,8); assert(n.task.minutes<=8)
audit()
-- Production request sweep retains all actual profiles and truthful sampled timing (no truncation).
local function json(v)
    if type(v)=="string" then return '"'..v:gsub('\\','\\\\'):gsub('"','\\"'):gsub('\n','\\n'):gsub('\r','\\r')..'"' end
    if type(v)=="number" or type(v)=="boolean" then return tostring(v) end
    local entries={}; for k,item in pairs(v) do table.insert(entries,json(k)..":"..json(item)) end
    return "{"..table.concat(entries,",").."}"
end
for i=1,40 do
    n=fresh(i)
    for _,action in ipairs({"rest","eat","eat_packed","use_medicine","buy_food","shop","wait","travel","work"}) do
        frame+=1; choose(n,action)
        for k,other in ipairs(npcs) do if other~=n and (k<=5 or k==25) then other.x=n.x+2; other.z=n.z+2; other.injury=99 end end
        local r=buildDecisionRequest(n)
        assert(string.find(r.state,"Character profile=",1,true) and string.find(r.state,"minutes elapsed/planned/remaining=",1,true))
        print("DURATION_REQUEST:"..json({id=tostring(i)..":"..r.id,state=r.state,questions=r.questions}))
    end
end
print("Duration checks passed: delayed once-only consumption, variable stable samples, arrival, timed recovery, handoff/interruption, productive game-time effort and conservation, shared clocks, pause/speed. Synthetic execution only.")
'''
with tempfile.TemporaryDirectory(prefix="wuxia-durations-") as directory:
    script = Path(directory) / "durations.luau"
    script.write_text(source.rsplit("return Game", 1)[0] + fixture, encoding="utf-8")
    result = subprocess.run([str(engine / ".toolcache/luau-0.734/luau.exe"), str(script)], capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        print(result.stdout + result.stderr)
        match = re.search(r"durations\.luau:(\d+):", result.stderr)
        if match:
            print("Failed production/fixture line:", (source.rsplit("return Game", 1)[0] + fixture).splitlines()[int(match[1])-1])
        raise SystemExit(result.returncode)
    requests = [json.loads(line.removeprefix("DURATION_REQUEST:")) for line in result.stdout.splitlines() if line.startswith("DURATION_REQUEST:")]
    print(result.stdout.splitlines()[-1])
if args.tokens:
    repo = Path("C:/Users/liNao/Documents/ComfyUI/NanoJev")
    assert Path(sys.prefix).resolve() == (repo / ".venv-town").resolve(), "Use isolated .venv-town"
    sys.path.insert(0, str(repo / "scripts"))
    from transformers import AutoTokenizer
    from predict_toy_decisions import prepare_examples
    tokenizer = AutoTokenizer.from_pretrained(str(repo / "checkpoints/NanoJev/tokenizer"), local_files_only=True)
    maximum = max(len(path) for ex in prepare_examples({"states": requests}, tokenizer, 1024) for path in ex["leaf_tokens"])
    print(json.dumps({"duration_tokens_passed": True, "production_requests": len(requests), "max_tokens": maximum, "model_loaded": False}))
