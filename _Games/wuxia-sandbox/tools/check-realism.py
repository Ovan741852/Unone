"""Synthetic production-Luau execution checks, not live or model-behaviour evidence."""
from pathlib import Path
import subprocess
import tempfile

project = Path(__file__).resolve().parents[1]
engine = project.parents[1]
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
for fabricated in ("顧行舟準備接下巡查", "聽見了新的江湖傳聞", "原因可追溯為怨恨、利益或失控的武力", "未知兇手"):
    assert fabricated not in source

fixture = r'''
local observed,transforms={},{}
local roll=.5
local api={debug={enabled=false},log=function() end,ui={setRoot=function() end},
    camera3d={setPosition=function() end,setTarget=function() end},
    observation={set=function(k,v) observed[k]=v end},random={nextFloat=function() return roll end},
    entity={getTransform3D=function(id) return transforms[id] or {position={x=0,y=0,z=0}} end,
        setTransform3D=function(id,t) transforms[id]=t end}}
local function near(a,b) assert(math.abs(a-b)<1e-8,tostring(a).." ~= "..tostring(b)) end
local function audit()
    local e=Economy.snapshot(); assert(e.money_delta==0)
    for _,g in ipairs(e.goods) do assert(g.stock+g.carried==g.initial_stock+g.produced-g.consumed) end
end
local function fresh(index)
    resetWorld(api); frame=1; worldMinutes=720; roll=.5
    for _,n in ipairs(npcs) do
        n.routeCells=nil; n.reservedX=nil; n.reservedZ=nil; n.lastNeedsMinute=720; n.lastTaskMinute=720; n.executionSince=720
        n.fatigue=0; n.hunger=0; n.injury=0; n.martial=40
    end
    local n=npcs[index or 9]
    n.task={ticks=0,minutes=0,complete=false}; n.action="work"; n.location=n.job.zone
    n.nextPlan={action="rest",target="none",timing="after_current",request_id="synthetic-only",created_frame=1}
    return n
end
local function fourMinutes()
    worldMinutes+=4
    for _,n in ipairs(npcs) do n.lastNeedsMinute=worldMinutes end -- Fixed needs comparison; real-time-changing needs checked below.
    applyAction(api)
end
near(Condition.factor({}),1); near(Condition.factor({alive=false}),0)
local function signature(n) return n.action..":"..tostring(n.interactionTargetId)..":"..n.nextPlan.action..":"..n.nextPlan.target..":"..n.nextPlan.timing end
local function sample(fatigue,injury,hunger)
    local n=fresh(); n.fatigue=fatigue; n.injury=injury; n.hunger=hunger
    local factor=Condition.factor(n); assert(factor>=.25 and factor<=1)
    local intent=signature(n)
    n.x=0; n.z=-34; n.gridX=0; n.gridZ=-17
    n.routeReachable=true; n.routeCells={{x=0,z=-18}}; n.routeIndex=1
    moveOneGridStep(n); local movement=math.abs(n.z+34); near(movement,.075*factor)
    n.reservedX=nil; n.reservedZ=nil; n.routeCells=nil
    local cash=n.wealth; local ticks=0
    while not n.task.complete do
        ticks+=1; assert(ticks<=33)
        fourMinutes()
        if not n.task.complete then assert(n.finance.shifts==0 and n.wealth==cash) end
        assert(signature(n)==intent); audit()
    end
    near(n.task.effort,8); assert(n.task.ticks==ticks and n.task.ticks%1==0); near(n.finance.work_ticks,0)
    assert(n.finance.shifts==1 and n.wealth==cash+n.job.wage)
    assert(Economy.production.food==6 and Economy.consumption.ingredients==1)
    applyAction(api); assert(n.finance.shifts==1 and n.wealth==cash+n.job.wage,"completed unit cannot keep paying")
    n=fresh(); n.fatigue=fatigue; n.injury=injury; n.hunger=hunger; n.action="train"; n.location="training"
    local skill=n.martial; fourMinutes(); near(n.martial-skill,.7*factor); near(n.task.effort,factor); assert(n.task.ticks==1)
    n=fresh(); n.fatigue=fatigue; n.injury=injury; n.hunger=hunger; n.action="hunt"; n.location="monster_den"
    skill=n.martial; fourMinutes(); near(n.martial-skill,.3*factor); near(n.task.effort,factor); assert(n.task.ticks==1)
    assert(n.injury==injury+1 and n.alive); audit()
    n=fresh(1); n.fatigue=fatigue; n.injury=injury; n.hunger=hunger; n.action="gather"; n.location="herb_field"
    fourMinutes(); near(n.task.effort,factor); near(n.finance.work_ticks,factor); assert(n.task.ticks==1); audit()
    return movement,ticks
end
local good,time=sample(0,0,0); assert(time==8)
for _,needs in ipairs({{80,0,0},{0,80,0},{0,0,80},{100,98,100}}) do
    local movement,ticks=sample(needs[1],needs[2],needs[3]); assert(movement<good and ticks>time)
end
for _,stat in ipairs({"fatigue","injury","hunger"}) do
    local n={alive=true}; local previous=1
    for value=0,100 do n[stat]=value; local factor=Condition.factor(n); assert(factor<=previous and factor>=.25); previous=factor end
end
-- Real time advances: changing needs must feed one identical effort into wage and task completion.
local timed=fresh(); timed.fatigue=50; timed.injury=20; timed.hunger=60
local cash=timed.wealth; local steps=0
while not timed.task.complete do
    steps+=1; assert(steps<=40); worldMinutes+=4; applyAction(api)
    near(timed.finance.work_ticks+timed.finance.shifts*8,timed.task.effort)
    assert(timed.task.ticks==steps and timed.task.ticks%1==0)
    if not timed.task.complete then assert(timed.wealth==cash and timed.finance.shifts==0) end
    audit()
end
assert(timed.finance.shifts==1 and timed.wealth==cash+timed.job.wage)
assert(timed.fatigue>50 and timed.hunger>60); near(timed.task.effort,8)
-- Existing partial shifts carry through an explicitly supplied model interruption; they are not free wages.
timed=fresh(); cash=timed.wealth
for _=1,3 do worldMinutes+=4; applyAction(api) end
local carried=timed.finance.work_ticks; assert(carried>0 and carried<8 and timed.wealth==cash)
Brain.startPlan(api,timed,{action="rest",target="none",timing="interrupt_now",request_id="synthetic-rest",created_frame=frame})
timed.location=timed.residence; timed.executionSince=worldMinutes; worldMinutes+=4; applyAction(api); near(timed.finance.work_ticks,carried)
Brain.startPlan(api,timed,{action="work",target="none",timing="interrupt_now",request_id="synthetic-return",created_frame=frame})
timed.location=timed.job.zone; timed.executionSince=worldMinutes; steps=0
while not timed.task.complete do
    steps+=1; assert(steps<=40); worldMinutes+=4; applyAction(api)
    near(timed.finance.work_ticks+timed.finance.shifts*8,carried+timed.task.effort)
    audit()
end
assert(timed.finance.shifts==1 and timed.wealth==cash+timed.job.wage); near(timed.finance.work_ticks,carried)
local n=fresh(); n.fatigue=80; n.action="rest"; n.location=n.residence
local before=Condition.factor(n); local plan=n.nextPlan; Life.tick(n,30,Life.clock(720))
assert(Condition.factor(n)>before and n.action=="rest" and n.nextPlan==plan); near(n.fatigue,65)
-- Work cannot progress/pay while a grid reservation is held, nor after death.
n=fresh(); n.reservedX=0; n.reservedZ=0; applyAction(api); assert(n.finance.work_ticks==0 and n.task.ticks==0)
-- Living legacy terminal state is not inferred dead or silently productive.
for _,action in ipairs({"work","gather","train","hunt"}) do
    n=fresh(); n.injury=100; n.action=action; n.location=targetZone(n)
    local cash,skill,energy=n.wealth,n.martial,n.jobEnergy
    for _=1,10 do applyAction(api) end
    assert(n.alive and n.wealth==cash and n.martial==skill and n.jobEnergy==energy and n.task.ticks==0 and n.finance.shifts==0)
    assert(n.task.failed and n.task.complete and string.find(n.interactionResult,"執行失敗",1,true))
    audit()
end
-- Failure at a safe boundary releases only the already model-chosen after_current plan.
for _,action in ipairs({"work","attack"}) do
    n=fresh(); n.injury=100; n.action=action
    local queued=n.nextPlan; n.reservedX=0; n.reservedZ=0
    Brain.progress(n,1); Brain.advancePlans(api); assert(not n.task.complete and n.nextPlan==queued and n.action==action)
    n.reservedX=nil; n.reservedZ=nil
    if action=="attack" then assert(not Combat.begin(api,n,npcs[2],"attack")) else Brain.progress(n,1) end
    assert(n.task.failed and n.task.complete and n.nextPlan==queued and queued.timing=="after_current" and n.finance.shifts==0)
    Brain.advancePlans(api); assert(n.action=="rest" and n.thinking.request_id==queued.request_id and not n.nextPlan)
end
-- A real hunt injury kills once; no actor invented, all estate/plan/route state retained or cleared correctly.
n=fresh(24); n.action="hunt"; n.location="monster_den"; n.injury=99
local cash,food,herbs,skill=n.wealth,n.inventory.food,n.inventory.herbs,n.martial
n.routeTarget={x=1,z=1}; Brain.requests[n.id]={id="pending"}; n.planningRequestId="queued"
fourMinutes(); assert(not n.alive and n.deathCause=="狩獵受傷，傷勢累積致死" and not n.deathActorId)
assert(n.wealth==cash and n.inventory.food==food and n.inventory.herbs==herbs and n.martial==skill)
assert(not n.task and not n.nextPlan and not Brain.requests[n.id] and not n.planningRequestId)
assert(not n.routeCells and not n.routeTarget and not n.reservedX and not n.reservedZ and not n.goalCell)
local slot=n.cemeterySlot; assert(storyStats.deaths==1 and cemeteryReservations[slot]==n.id)
local x,z=n.x,n.z; applyDamage(api,n,30,nil,"repeat",false); applyAction(api); moveOneGridStep(n); Economy.work(n)
assert(storyStats.deaths==1 and n.cemeterySlot==slot and n.x==x and n.z==z and n.wealth==cash and n.martial==skill)
publish(api); local view=observed.view_model.npc[24]
assert(view.alive==false and view.cemetery_slot==slot and view.death_actor_id=="" and view.condition_factor==0)
audit()
-- Actual combat begin -> windup -> hit/MISS. Only positive attack damage can kill.
local function strike(injury,random,mode,needs)
    local a=fresh(1); local b=npcs[2]; a.action=mode; b.action=mode=="duel" and "duel" or "wait"
    a.x=0; a.z=0; b.x=2; b.z=0; b.injury=injury; a.fatigue=needs or 0; roll=random
    if mode=="duel" then
        Brain.startPlan(api,a,{action="duel",target=b.id,timing="interrupt_now",request_id="duel_offer",created_frame=frame})
        Pair.tick(api,.01); local p=a.pair; assert(p)
        Brain.startPlan(api,b,{action="accept",target=a.id,timing="interrupt_now",request_id="duel_accept",created_frame=frame,pair_id=p.id,pair_basis=Pair.basis(b)})
        Pair.tick(api,.01); assert(a.combat and b.combat==a.combat)
    else assert(Combat.begin(api,a,b,mode)) end
    Combat.tick(api,.01); Combat.tick(api,.31); Combat.tick(api,.25)
    audit(); return a,b
end
local a,b=strike(99,.5,"attack"); assert(not b.alive and b.deathActorId==a.id and storyStats.deaths==1)
assert(b.deathCause=="NanoJev 選擇攻擊，交鋒中傷重死亡" and not a.combat)
a,b=strike(99,.99,"attack"); assert(b.alive and b.injury==99 and storyStats.deaths==0 and Combat.misses==1)
a,b=strike(100,.99,"attack"); assert(b.alive and storyStats.deaths==0,"MISS cannot kill an already terminal legacy resident")
a,b=strike(74,.5,"duel"); assert(b.alive and b.injury==75 and storyStats.deaths==0)
a,b=strike(0,.5,"attack"); local healthyDamage=b.injury
a,b=strike(0,.5,"attack",80); assert(b.injury>0 and b.injury<healthyDamage)
n=fresh(); n.injury=50; applyDamage(api,n,0,nil,"none",false); applyDamage(api,n,-2,nil,"none",false); assert(n.injury==50 and n.alive)
-- Authoritative observer/model explanation uses identical unrounded factor; no fake periodic narratives.
n=fresh(); n.fatigue=80
local view=snapshotNPC(n); near(view.condition_factor,Condition.factor(n)); assert(string.find(view.emotion_cause,view.condition_summary,1,true))
local request=buildDecisionRequest(n); assert(string.find(request.state,string.format("Condition=%.2f",Condition.factor(n)),1,true))
assert(string.find(request.state,"Condition=",1,true)<string.find(request.state,"Nearby people:",1,true))
frame=60; local count=eventCount; applyAction(api); assert(eventCount==count)
resetWorld(api); assert(storyStats.deaths==0 and not npcs[24].cemeterySlot and npcs[24].alive); audit()
print("Realism checks passed: production movement/effort/work/skills, monotonic bounds/rest, unchanged choices, exact paid output, shared lethal hunt/hit versus MISS/duel, terminal/dead guards, estate/stock conservation, cleanup/reset, truthful observations and removed fabricated events. Synthetic execution only.")
'''
with tempfile.TemporaryDirectory(prefix="wuxia-realism-") as directory:
    script = Path(directory) / "realism.luau"
    script.write_text(source.rsplit("return Game", 1)[0] + fixture, encoding="utf-8")
    result = subprocess.run([str(engine / ".toolcache/luau-0.734/luau.exe"), str(script)],
                            capture_output=True, text=True, encoding="utf-8")
    print(result.stdout + result.stderr)
    raise SystemExit(result.returncode)
