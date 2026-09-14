 -- This runs inside the actual exported Luau VM with production combat functions.
 local function build(k:number,ids:any)
  reset();S.phase="battle";S.selected=k;S.aimX=0;S.aimZ=0
  for _,id in ipairs(ids)do table.insert(S.skillSources[k],{id=id})end
  fire();local unit=troops[1];unit.skills.critChance=0;return unit
 end
 local function durable(id:number)
  local target=monster(4,id);target.guard=100000;return target
 end
 rolls(.99)
 local unit=build(1,{"frost_touch","shatter"});local target=durable(1)
 hit(target,24,unit)
 check(target.damage==24 and #pendingProcs==0,"first frost hit cannot also shatter")
 hit(target,24,unit)
 check(math.abs(target.damage-55.2)<1e-6 and #pendingProcs==1,"previous frost enables shatter bonus and wave")
 hit(target,24,unit)
 check(#pendingProcs==1,"one shatter wave per troop")
 local critUnit=build(1,{"ricochet_precision","crit_power"});target=durable(2)
 critUnit.bounceCount=2;rolls(.29);hit(target,24,critUnit)
 check(S.criticalHits==1 and target.damage==42,"two bounces enable 30 percent crit and 1.75 multiplier")
 critUnit.bounceCount=99;rolls(.45);hit(target,24,critUnit)
 check(S.criticalHits==1,"bounce crit capped at 45 percent with strict boundary")
 critUnit=build(3,{"ricochet_precision","crit_power"});critUnit.bounceCount=2;rolls(.29);target=durable(3);hit(target,90,critUnit)
 check(target.damage==157.5,"non-sword crit also receives full critical multiplier upgrade")
 unit=build(3,{"piercing_wave","shock"});target=durable(1)
 contactHit(unit,target);pendingProcs={};contactHit(unit,durable(2))
 check(unit.usedPierces==2 and unit.pierceRemaining==18 and #pendingProcs==1,"second pierce queues exactly one wave")
 local neighbor=durable(3);neighbor.x=.4;monsters={neighbor};updateCombat(0)
 check(math.abs(neighbor.damage-18)<1e-6 and S.procHits==1 and #pendingProcs==0,"pierce wave does not trigger shock recursively")
 unit=build(3,{"hunter_vigor"});local initialLife=unit.life
 for i=1,9 do recordKill(unit)end
 check(math.abs(unit.life-initialLife-1)<1e-6,"kill life capped to one second")
 unit.alive=false;initialLife=unit.life;recordKill(unit)
 check(not unit.alive and unit.life==initialLife,"kill life cannot revive dead troop")
 unit=build(1,{"heavy","slow_force"});target=durable(1);hit(target,unit.damage,unit)
 check(math.abs(target.damage-24*1.35*1.15)<1e-6,"heavy speed penalty converts to damage")
 unit=build(1,{"heavy","haste","slow_force"});target=durable(1);hit(target,unit.damage,unit)
 check(math.abs(target.damage-24*1.35*1.0375)<1e-6,"haste reduces heavy conversion; real tradeoff")
 unit=build(2,{"spin_master"})
 check(math.abs(unit.skills.spinRadius-3.3)<1e-6 and math.abs(unit.skills.spinDamage-1.2)<1e-6,"spin expansion modifies innate spin")
 unit=build(1,{"spin_master"});check(not unit.skills.landingSpin,"spin expansion alone cannot grant spin")
 unit=build(1,{"landing_spin","distance"});monsters={};moveTroop(unit,5)
 check((unit.groundTravel or 0)==0,"flight excluded from distance skill")
 unit.state="run";moveTroop(unit,3)
 check(math.abs(unit.groundTravel-3)<1e-6,"ground movement includes reflected path only")
 unit=build(1,{"distance"});unit.groundTravel=12;target=durable(1);hit(target,24,unit);hit(target,24,unit)
 check(math.abs(target.damage-55.2)<1e-6,"distance bonus consumed once")
 local newIds={"shatter","ricochet_precision","hunter_vigor","piercing_wave","slow_force","spin_master"}
 for _,id in ipairs(newIds)do
  local found=false;for _,gear in ipairs(gearCatalog)do if gear.skill==id then found=true end end
  check(found,"new skill obtainable as equipment: "..id)
 end
 unit=build(1,{"pierce","ricochet_precision","lightning"})
 check(unit.paid==7,"build quote is half of 8+2+1+3")
 S.skillSources[1]={};S.tech[1]={{id="ricochet_precision"}};check(costs(1)==4 and composeSkills(1).bounceCrit==.15,"research strengthens without repeated equipment surcharge")
 publish(api);check(#S.buildGuide==9 and S.activeSkills.ricochet_precision==1,"guide observes active selected loadout")
 unit=build(1,{"fracture"});target=durable(1);target.damage=target.guard*.7;local before=target.damage;hit(target,24,unit)
 check(math.abs(target.damage-before-28.8)<1e-6,"fracture reads pre-hit guard progress")
 unit=build(1,{"solo_hunt","solitary"});target=durable(1);monsters={target};hit(target,24,unit)
 check(math.abs(target.damage-37.2)<1e-6,"isolated target and only paid ally bonuses compose")
 unit=build(1,{"showdown"});target=durable(1);S.time=31;hit(target,24,unit);S.time=30;hit(target,24,unit)
 check(target.damage==54,"showdown only in final thirty seconds")
 unit=build(3,{"hit_echo"});target=durable(1);hit(target,90,unit);hit(target,90,unit);hit(durable(2),90,unit)
 check(#pendingProcs==0,"echo counts unique targets, not repeated hits")
 hit(durable(3),90,unit);hit(durable(4),90,unit)
 check(#pendingProcs==1,"echo fires once on third unique main target")
 unit=build(1,{"recruit"});S.coins=79;troops={};S.recruitUses[1]=0;cooldown=0
 for i=1,3 do cooldown=0;fire()end
 check(S.recruitUses[1]==3 and troops[1].paid==2 and costs(1)==5,"recruit compounds with half-price trial only three times")
 S.skillSources[1]={};S.skillSources[1]={{id="recruit"}}
 check(costs(1)==5,"reequipping cannot reset recruit allowance")
 unit=build(1,{"rapid"});check(math.abs(cooldown-.192)<1e-6,"rapid adjusts interval but still charges deployment")
 unit=build(1,{"rally"});S.roundSpent[1]=399;cooldown=0;fire()
 check(S.rallyUsed[1] and S.rallyUntil[1]==S.rewardClock+10,"rally triggers once from actual paid spending")
 S.rewardClock=12;cooldown=0;fire();check(S.rallyUntil[1]==10,"rally cannot retrigger within same round")
 unit=build(1,{"wall_quake"});monsters={};unit.x=WALL_X-.1;unit.z=0;unit.dx=1;unit.dz=0;moveTroop(unit,.3)
 check(#pendingProcs==1,"first bounce creates quake")
 moveTroop(unit,15);check(#pendingProcs==1,"later bounces cannot repeat first-bounce quake")
 unit=build(2,{"wide_blade"});check(math.abs(unit.skills.spinRadius-3.48)<1e-6 and math.abs(unit.skills.spinDamage-.9)<1e-6,"wide blade expands radius with damage cost")
 unit=build(1,{"short_fuse"});check(unit.life==4 and math.abs(unit.damage-34.8)<1e-6,"short fuse trades life for damage")
 unit=build(1,{"double_pierce","deadly"});unit.skills.critChance=1;target=durable(1);hit(target,24,unit)
 check(unit.pierceRemaining==2 and target.damage==48,"classic double penetration and deadly enchantments")
 unit=build(1,{});S.pendingWheel={{winner=1,result=1,revealAt=.2,id=1}};apiRef=api
 Game.update(api,.1);check(S.playerBuffs[1].haste==0,"wheel effect waits for reveal time")
 S.paused=true;Game.update(api,.3);check(S.rewardClock==.1 and #S.pendingWheel==1,"pause freezes wheel reveal queue")
 S.paused=false;Game.update(api,.2);local untilTime=S.playerBuffs[1].haste
 check(untilTime>10 and #S.pendingWheel==0,"wheel applies effect after unpaused reveal")
 Game.update(api,.1);check(S.playerBuffs[1].haste==untilTime,"wheel cannot apply twice")
 rolls(0)
 for round=1,7 do
  unit=build(1,{});S.round=round;target=monster(5,100+round);hit(target,1000,unit)
  check(S.phase=="celebration" and S.roundOutro.result==(round==7 and "victory" or "clear"),"successful boss prize enters ceremony before round result "..round)
  settleSurvivors();local chests=S.chestCount;local gold=S.earned;hit(target,1000,unit);settleSurvivors()
  check(S.chestCount==chests and S.earned==gold,"boss settlement idempotent round "..round)
 end
