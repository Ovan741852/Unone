
-- Test-only fixture injected in memory; never exported to the playable game.
function Game.start(api:any)
 apiRef=api
 local checks=0
 local function check(ok:boolean,label:string)assert(ok,label);checks+=1 end
 local function prepare(k:number,sources:any?)
  reset();S.phase="battle";S.selected=k;S.aimX=0;S.aimZ=0
  S.skillSources[k]=sources or {};fire()
  return troops[1]
 end
 local function monster(id:number,x:number,z:number)
  return {id=id,rank=4,x=x,z=z,guard=100000,damage=0,alive=true,scale=1,slow=0,flash=0,angle=0,turn=100,breaks=0,name="fixture"}
 end
 local t=prepare(1,{{id="pierce"}})
 check(t.skills.critChance==.1 and t.skills.critMultiplier==1.5,"sword innate crit")
 local m=monster(1,0,0)
 contactHit(t,m);check(t.alive and t.pierceRemaining==0,"sword survives first contact")
 local n=monster(2,0,1);contactHit(t,n)
 check(not t.alive and S.contactDeaths==1 and S.piercesUsed==1 and n.damage>0,"sword dies on damaging second contact")
 t=prepare(3,{{id="pierce"},{id="pierce"}})
 check(t.pierceRemaining==22,"cavalry innate twenty plus two equipment sources")
 for i=1,22 do contactHit(t,monster(i,0,0));check(t.alive,"twenty-two pierces survive")end
 contactHit(t,monster(23,0,0));check(not t.alive and S.contactHits==23,"twenty-third contact kills upgraded cavalry")
 t=prepare(3)
 for i=1,20 do contactHit(t,monster(i,0,0))end
 check(t.alive and t.pierceRemaining==0,"base cavalry survives twenty")
 contactHit(t,monster(21,0,0));check(not t.alive and S.contactHits==21,"base cavalry dies on twenty-first")
 t=prepare(1,{{id="pierce"},{id="landing_spin"},{id="critical"}})
 check(t.state=="airborne" and t.skills.critChance==.2 and t.pierceRemaining==1,"three skills compose on sword")
 table.insert(S.skillSources[1],{id="pierce"});S.radius+=1
 check(t.pierceRemaining==1 and t.skills.spinRadius==2.9 and composeSkills(1).pierce==2,"deployed snapshot independent from later equipment")
 -- Crit boundary and multiplication test uses a deterministic RNG only in this fixture.
 local savedApi=apiRef;local rolls={.099,.1};local cursor=0
 apiRef={random={nextFloat=function()cursor+=1;return rolls[cursor]end}}
 t=prepare(1);m=monster(1,0,0);hit(m,24,t);hit(m,24,t)
 check(m.damage==60 and S.criticalHits==1,"crit threshold and 1.5x on shared hit pipeline")
 apiRef=savedApi
 -- Real movement must consume nearest intersections, regardless of monster array order.
 t=prepare(3);t.pierceRemaining=4;t.x=0;t.z=0;t.dx=1;t.dz=0
 monsters={};for i=6,1,-1 do table.insert(monsters,monster(i,i,0))end
 moveTroop(t,6.5)
 check(not t.alive and S.contactHits==5 and monsters[1].damage==0 and monsters[2].damage==90,"ordered swept contacts stop at fifth")
 check(math.abs(t.x-4.1)<1e-6,"death position is terminal contact")
 -- The same survivor may receive one spin hit AND one later contact hit.
 t=prepare(2);t.x=0;t.z=0;t.state="spin";t.dx=1;t.dz=0
 m=monster(1,0,0);monsters={m};updateCombat(.3);updateCombat(.3)
 check(S.spinHits==1 and S.contactHits==0 and t.alive,"one spin hit during full animation")
 updateCombat(.01)
 check(S.contactHits==1 and S.contactDeaths==1 and #troops==0 and math.abs(m.damage-96)<1e-6,"spin survivor takes contact damage then spear dies")
 -- AoE does not consume piercing and flight cannot hit contacts.
 t=prepare(1,{{id="landing_spin"},{id="pierce"}});t.x=0;t.z=0;t.dx=1;t.dz=0
 monsters={monster(1,1,0)};moveTroop(t,2)
 check(S.contactHits==0 and t.pierceRemaining==1,"airborne ignores collision")
 t.x=0;t.state="spin";updateCombat(.6)
 check(S.spinHits==1 and t.pierceRemaining==1,"spin leaves penetration budget intact")
 t=prepare(3);t.x=WALL_X-.5;t.z=6;t.dx=1;t.dz=0;monsters={};moveTroop(t,1)
 check(S.bounces==1 and t.pierceRemaining==20 and t.alive,"wall bounce does not spend pierce")
 t=prepare(3);monsters={};t.age=t.life-.01;updateCombat(.02)
 check(S.expired==1 and S.contactDeaths==0 and #troops==0,"lifetime still limits piercing")
 t=prepare(3);monsters={};settleSurvivors()
 check(S.refunded==20 and S.coins==320 and S.returnedTotal==1,"survivor refunds actual discounted deployment once")

 -- Cavalry movement, lifespan, reflected sweeps and targeting regression.
 t=prepare(3);monsters={};t.x=0;t.z=0;t.dx=1;t.dz=0
 updateCombat(.1)
 check(math.abs(t.x-2.4)<1e-6 and t.life==8 and t.life>baseLife[1] and t.life>baseLife[2],"cavalry double ground speed and longest base life")
 t=prepare(3,{{id="haste"},{id="longlife"}});monsters={};t.x=0;t.z=0;t.dx=1;t.dz=0
 updateCombat(.1)
 check(math.abs(t.x-2.76)<1e-6 and math.abs(t.life-9.2)<1e-6,"speed and lifespan equipment scale new bases")
 t=prepare(3);monsters={};t.x=0;t.z=0;t.dx=1;t.dz=0
 for i=22,1,-1 do local target=monster(i,0,0);target.scale=0;target.x=i*.5;monsters[#monsters+1]=target end
 moveTroop(t,12)
 check(not t.alive and S.contactHits==21 and monsters[1].damage==0 and monsters[2].damage==90,"high-speed swept contacts stop exactly at twenty-first")
 check(math.abs(t.x-10.1)<1e-6,"twenty-first contact sets terminal position")
 t=prepare(3);monsters={};t.x=0;t.z=0;t.dx=1;t.dz=0
 moveTroop(t,100)
 check(t.alive and t.bounceCount==4 and t.pierceRemaining==20 and math.abs(t.x)<1e-6,"multiple wall bounces preserve budget and square bounds")
 for _,mode in ipairs({"auto","lock"})do
  reset();S.phase="battle";S.selected=3;S.fireMode=mode;S.lockEnabled=mode=="lock";S.autoEnabled=mode=="auto";S.targetId=1;S.aimX=0;S.aimZ=0;fire();t=troops[1]
  t.x=0;t.z=0;t.dx=1;t.dz=0;monsters={monster(1,1,0),monster(2,2,0)}
  moveTroop(t,3)
  check(S.contactHits==(mode=="auto" and 2 or 1),"AUTO pierces other targets; LOCK remains exclusive")
  check(monsters[2].damage==(mode=="auto" and 90 or 0),"target mode damage follows hit restrictions")
 end
 reset();publish(api);api.observation.set("skill_checks",checks)
end
