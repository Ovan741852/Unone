"""Synthetic age/lifespan and conservative combat/rest balance checks."""
from pathlib import Path
import subprocess
import tempfile

project = Path(__file__).resolve().parents[1]
engine = project.parents[1]
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
fixture = r'''
local observed,transforms={},{}
local roll=.5
local api={debug={enabled=false},log=function() end,ui={setRoot=function() end},
    camera3d={setPosition=function() end,setTarget=function() end},
    observation={set=function(k,v) observed[k]=v end},random={nextFloat=function() return roll end},
    entity={getTransform3D=function(id) return transforms[id] or {position={x=0,y=0,z=0}} end,
        setTransform3D=function(id,t) transforms[id]=t end}}
resetWorld(api)
assert(#npcs==80)
local ages={}
for _,n in ipairs(npcs) do
    assert(n.startingAge>=20 and n.startingAge<=60)
    ages[n.startingAge]=true; assert(n.age==n.startingAge and n.age<n.lifespan)
end
local parentA,parentB=npcs[79],npcs[80]
assert(Family.canHaveChild(parentA,parentB)); assert(Family.birth(api,parentA,parentB))
assert(Family.births==1 and parentA.childrenCount==1 and #Family.children==1)
local first=npcs[1]; local initial=first.age
worldMinutes=1440; applyAction(api); assert(first.age>initial and Life.ageStage(first)=="adult")
local advanced=first.age; worldMinutes=2880; applyAction(api); assert(first.age>advanced)
for _,n in ipairs(npcs) do assert(n.age<n.lifespan and n.alive) end
for i,n in ipairs(npcs) do n.lifespan=i==1 and n.age or n.age+1000; n.lastNaturalDeathCheckDay=0 end
for day=3,160 do
    worldMinutes=day*1440; applyAction(api)
    local live=0
    for _,n in ipairs(npcs) do if n.alive then live+=1 end end
    if live==0 then break end
end
local deaths=0
for _,n in ipairs(npcs) do if not n.alive then deaths+=1 end end
assert(deaths>0 and deaths<80)
local dead=npcs[1]
if dead.alive then
    for _,n in ipairs(npcs) do if not n.alive then dead=n; break end end
end
assert(not dead.alive and dead.deathKind=="natural" and dead.deathCause=="自然死亡：壽終" and dead.memorial.kind=="natural" and dead.cemeterySlot)
local target=npcs[2]; target.alive=true; target.injury=40; target.action="rest"; target.location=target.residence
target.routeCells=nil; target.routeIndex=nil; target.lastNeedsMinute=worldMinutes
local before=target.injury; Life.tick(target,10,Life.clock(worldMinutes)); assert(target.injury<before and target.injury==before-0.25)
target.injury=40; target.location="road"; Life.tick(target,10,Life.clock(worldMinutes)); assert(target.injury==40)
target.injury=100; target.alive=true; target.action="wait"; target.location=target.residence
applyDamage(api,target,0,nil,"none",false); assert(target.alive,"zero damage must not infer death")
applyDamage(api,target,1,nil,"injury fixture",false); assert(not target.alive and target.deathKind=="injury")
resetWorld(api)
local attacker,target=npcs[1],npcs[2]
attacker.x,attacker.z,target.x,target.z=0,0,2,0
attacker.martial,target.martial=80,20; attacker.action,target.action="attack","wait"
roll=.5; frame=1; assert(Combat.begin(api,attacker,target,"attack"))
for _=1,80 do frame+=1; Combat.tick(api,.4) end
assert(target.alive and target.injury>0 and target.injury<100,"four-hit attack should injure without routine healthy kill")
resetWorld(api)
attacker,target=npcs[1],npcs[2]
attacker.x,attacker.z,target.x,target.z=0,0,2,0
attacker.martial,target.martial=80,20; target.injury=75
attacker.action,target.action="attack","wait"; roll=.5; frame=1
assert(Combat.begin(api,attacker,target,"attack"))
for _=1,80 do frame+=1; Combat.tick(api,.4) end
assert(not target.alive,"repeated attacks must still be able to kill")
resetWorld(api)
local route=npcs[1]
route.action="travel"; route.interactionTargetId=nil; route.routeCells={{x=0,z=0},{x=1,z=0}}; route.routeIndex=1
route.task={ticks=0,minutes=0,duration_minutes=10,complete=false}; local same={action="travel",target="none",timing="after_current",request_id="same-route",created_frame=1}
Brain.startPlan(api,route,same); assert(route.action=="travel" and route.routeIndex==1 and route.routeCells~=nil,"same intent must preserve the in-flight route")
local urgent={action="rest",target="none",timing="interrupt_now",request_id="urgent",created_frame=2}; route.reservedX=nil
Brain.startPlan(api,route,urgent); assert(route.action=="rest" and not route.routeCells,"urgent plan must interrupt")
resetWorld(api); assert(npcs[1].age==npcs[1].startingAge and storyStats.deaths==0 and npcs[1].alive)
print("Age/balance checks passed: distinct reset ages, monotonic aging, bounded natural death, memorial/cemetery, slow home rest recovery, no travel healing, injury kill/reset.")
'''
with tempfile.TemporaryDirectory(prefix="wuxia-age-") as directory:
    script = Path(directory) / "age.luau"
    script.write_text(source.rsplit("return Game", 1)[0] + fixture, encoding="utf-8")
    subprocess.run([str(engine / ".toolcache/luau-0.734/luau.exe"), str(script)], check=True)
