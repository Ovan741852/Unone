-- Controlled input to the real Luau factories; never bundled in production.
function Game.start(api:any)
 apiRef=api;local checks=0
 local function check(ok:boolean,name:string)assert(ok,"COMPOSITION: "..name);checks+=1 end
 local function near(a:number,b:number)return math.abs(a-b)<1e-5 end
 local clock=0;local active=true;local creatures={};local receipts={};local c:any=nil
 local function troop(id:number,skills:any?)return {visualId=id,playerId=1,targetId=0,alive=true,age=1,life=8,travel=2,k=3,state="run",x=0,z=0,dx=1,dz=0,damage=100,skills=skills or {}}end
 local function fresh(skills:any?)
  clock=0;active=true;creatures={};receipts={};c=createCompositionRuntime({clock=function()return clock end,active=function()return active end,monsters=function()return creatures end,wallX=12.5,
   damage=function(m:any,amount:number,t:any,kind:string)receipts[#receipts+1]={m=m,amount=amount,owner=t,kind=kind}end})
  local t=troop(1,skills);c:attach(t);return t
 end
 local function monster(x:number,z:number,rank:number?)local m={id=#creatures+1,alive=true,x=x,z=z,rank=rank or 1,scale=0};creatures[#creatures+1]=m;return m end
 local function advance(dt:number,live:any?)clock+=dt;c:update(dt,live or {})end
 local t=fresh({quickChant=1});check(c:period(t,2)==1.5,"quick chant reduces a periodic cooldown by 25 percent")
 t.skills.quickChant=9;check(c:period(t,2)==1,"cooldown reduction caps at 50 percent")
 t.skills.overloadScript=3;check(c:spellPower(t)==2 and c:period(t,2)==1.5,"overload grants one double multiplier and multiplies cooldown once")
 t=fresh({stepOrb=1});c.recipes.step_orb.cap=4;c:moved(t,0,0,5.9,0);check(#c.nodes==0,"orb waits for its six-unit crossing")
 c:moved(t,5.9,0,6,0);check(#c.nodes==1 and near(c.nodes[1].x,6),"orb is placed at the exact threshold")
 c:moved(t,6,0,12,0);c:moved(t,12,0,0,0);check(#c.nodes==4 and c.nodes[3].x==6 and c.nodes[4].x==0,"reverse segments count distance, not displacement")
 c:moved(t,0,0,6,0);check(#c.nodes==4 and c.counts.step_orb==4,"full pool keeps committed fuses and skips the newest orb")
 local m=monster(6,0);advance(1.399);check(#receipts==0,"orb does not explode before 1.4 seconds")
 t.alive=false;advance(.001);check(#receipts==2 and near(receipts[1].amount,45),"released orbs persist after source death and respect actual centers")
 t=fresh({stepOrb=1,quickChant=2,overloadScript=1});c:moved(t,0,0,6,0);check(c.nodes[1].due==1.4,"passives do not change delayed fuse times")
 t.state="airborne";c:moved(t,6,0,30,0);check(#c.nodes==1,"airborne movement lays no orbs")
 t=fresh({contactMine=1});advance(1.99,{t});check(#c.nodes==0,"mine periodic first cast waits two seconds")
 advance(.01,{t});check(#c.nodes==1 and c.nodes[1].armed==2.35,"mine begins a separate arming phase")
 m=monster(0,0);advance(.349,{t});check(#receipts==0,"unarmed mine does not hit a standing enemy")
 advance(.001,{t});check(#receipts==1 and #c.nodes==0 and receipts[1].kind=="contact_mine","armed mine explodes on contact exactly once")
 advance(.1,{t});check(#receipts==1,"spent mine cannot hit twice")
 t=fresh({contactMine=1});advance(2,{t});t.alive=false;advance(5);check(#c.nodes==0 and #receipts==0,"unstomped mine expires without damage after source death")
 t=fresh({contactMine=1,quickChant=1});advance(1.5,{t});check(#c.nodes==1,"cooldown passive applies to mine placement")
 t=fresh({contactMine=1});advance(2,{t});m=monster(-4,0);advance(.35,{t});c:beginFrame({t},creatures);m.x=4;advance(.1,{t})
 check(#receipts==1 and receipts[1].m==m,"fast crossing triggers the armed mine and damages the crossing monster")
 t=fresh({contactMine=1});advance(2,{t});m=monster(-4,0);c:beginFrame({t},creatures);m.x=4;advance(.35,{t})
 check(#receipts==0,"mine cannot retroactively hit a path crossed before arming")
 t=fresh({contactMine=1});m=monster(0,0);local other=monster(.1,0);t.targetId=m.id;advance(2,{t});advance(.35,{t});check(#receipts==1 and receipts[1].m==m,"mine explosion obeys original LOCK")
 t=fresh({resonantDebt=1});m=monster(0,0);local info={amount=100,kind="physical"};c:onDamage(t,m,info)
 check(c:view().marks[1].hits==0,"initial hit applies debt without counting itself")
 local friend=troop(2);local rival=troop(3);rival.playerId=2;c:onDamage(rival,m,info);check(c:view().marks[1].hits==0,"other player's damage cannot progress or steal the mark")
 for _=1,4 do c:onDamage(friend,m,{amount=10,secondary=true,kind="poison"})end
 check(c:view().marks[1].hits==4 and #c.queue==0,"four friendly DoT ticks visibly fill four pips")
 c:onDamage(friend,m,{amount=50,secondary=true,kind="resonant_debt"});check(c:view().marks[1].hits==4,"debt explosions cannot advance other debts")
 c:onDamage(friend,m,info);check(#c.queue==1 and #c:view().marks==0,"fifth subsequent hit consumes mark and queues its payload")
 c:flush();check(#receipts==1 and receipts[1].owner==t and near(receipts[1].amount,70),"mark placer owns the resulting damage")
 c:onDamage(t,m,info);advance(4);check(#c:view().marks==0 and #receipts==1,"expired mark does not explode")
 t=fresh({resonantDebt=1,stormPayload=1});m=monster(0,0);c:onDamage(t,m,info);for _=1,5 do c:onDamage(t,m,info)end
 check(c.queue[1].element=="lightning","transferable payload modifier changes the recipe element")
 t=fresh({gravityLaw=1});m=monster(3,0);local minor=monster(2,0,3);local boss=monster(2,1,5);advance(2.4,{t});check(#c.wells==1 and m.x==3,"gravity starts with a 250ms telegraph")
 advance(.25,{t});check(m.x==3,"gravity deals no instant teleport at windup boundary")
 for _=1,4 do advance(.1,{t})end
 check(near(m.x,1)and minor.x==2 and boss.x==2,"gravity pulls small enemies at most two units and excludes all kings")
 t=fresh({gravityLaw=1});m=monster(1,0);advance(2.65,{t});advance(.25,{t});for _=1,4 do advance(.1,{t})end
 check(m.x>=.9-1e-8,"gravity leaves a gap around the source")
 t=fresh({gravityLaw=1});for i=1,10 do monster(3,i*.05)end;advance(2.4,{t});advance(.25,{t});advance(.4,{t})
 local moved=0;for _,v in ipairs(creatures)do if v.x<3 then moved+=1 end end;check(moved==8,"gravity targets at most eight small enemies")
 t=fresh({gravityLaw=1});m=monster(3,0);local t2=troop(2,{gravityLaw=1});c:attach(t2);advance(2.4,{t,t2});advance(.25,{t,t2});advance(.1,{t,t2})
 check(near(m.x,2.5),"overlapping gravity wells share a per-monster speed cap")
 t.alive=false;t2.alive=false;local before=m.x;advance(.2);check(m.x==before and #c.wells==0,"source death cancels unreleased or active attraction")
 t=fresh({gravityLaw=1});m=monster(3,0);other=monster(2,0);t.targetId=m.id;advance(2.4,{t});advance(.25,{t});advance(.4,{t});check(m.x<3 and other.x==2,"LOCK also restricts attraction")
 -- Contacts use simultaneous piecewise trajectories, not two unrelated segment sweeps.
 t=fresh({comradeOath=1});t2=troop(2);t.x=-2;t2.x=2;c:attach(t2);c:beginFrame({t,t2},{});c:planMove(t,4);c:planMove(t2,4)
 c:moved(t,-2,0,2,0);c:moved(t2,2,0,-2,0);t.x=2;t2.x=-2;advance(.1,{t,t2})
 check(c.counts.comrade_oath==1 and c:damageBonus(t)==.25 and c:damageBonus(t2)==.25,"fast allies crossing each other both receive the oath")
 advance(2.5,{t,t2});check(c:damageBonus(t)==0,"oath expires without stacking")
 t=fresh({comradeOath=1});t2=troop(2);t.x=-2;t2.x=0;c:beginFrame({t,t2},{});c:planMove(t,2);c:planMove(t2,2);c:moved(t,-2,0,0,0);c:moved(t2,0,0,2,0);t.x=0;t2.x=2;advance(.1,{t,t2})
 check((c.counts.comrade_oath or 0)==0,"same trail at different times is not physical contact")
 t=fresh({comradeOath=1});t2=troop(2);t2.playerId=2;c:beginFrame({t,t2},{});advance(.1,{t,t2});check((c.counts.comrade_oath or 0)==0,"different players cannot share oath")
 t2.playerId=1;t.age=0;c:beginFrame({t,t2},{});advance(.1,{t,t2});check((c.counts.comrade_oath or 0)==0,"spawn overlap cannot farm oath")
 t.age=1;c:beginFrame({t,t2},{});advance(.1,{t,t2});check(c.counts.comrade_oath==1,"eligible contact applies once")
 c:beginFrame({t,t2},{});advance(1.3,{t,t2});check(c.counts.comrade_oath==1,"standing together does not repeatedly refresh oath")
 t2.x=3;c:beginFrame({t,t2},{});advance(.1,{t,t2});t2.x=0;c:beginFrame({t,t2},{});advance(.1,{t,t2});check(c.counts.comrade_oath==2,"leaving and re-entering after cooldown permits another oath")
 t=fresh({stepOrb=1});c:moved(t,0,0,6,0);monster(6,0);active=false;advance(2);check(#c.nodes==0 and #receipts==0 and not c:hasPendingDamage(),"round end removes all traps and pending damage")
 -- Actual gameplay integration: modifiers apply once to skill damage and not gold.
 local function real(sources:any)
  reset();S.phase="battle";S.selected=3;S.aimX=0;S.aimZ=0;S.skillSources[3]=sources;frame=1;S.hordeAt=-1;fire();local unit=troops[1];unit.x=0;unit.z=0;unit.dx=1;unit.dz=0
  addMonster(1,6,0);local target=monsters[#monsters];target.guard=1e9;target.scale=0;return unit,target
 end
 t,m=real({{id="overload_script"},{id="step_orb"},{id="plunder"}});hit(m,90,t);check(S.plunderEarned==1 and near(m.damage,90),"overload neither doubles primary collision nor plunder gold")
 skillRuntime:moved(t,0,0,6,0);skillRuntime:update(1.4,{t});check(near(m.damage,171)and S.plunderEarned==1,"overloaded orb deals exactly twice 45 percent base damage once")
 t,m=real({{id="resonant_debt"},{id="phoenix_fire"}});hit(m,90,t);for _=1,5 do hit(m,1,t,true,"burn")end;skillRuntime:flush()
 check(skillRuntime.composition.counts.resonant_debt==1 and near(m.damage,158),"actual damage pipeline forwards typed DoT hits into a 63-damage debt payload")
 t,m=real({{id="rain_strike"},{id="step_orb"},{id="storm_payload"}});hit(m,90,t);skillRuntime:moved(t,0,0,6,0);skillRuntime:update(1.4,{t});skillRuntime:flush()
 check(skillRuntime.elements.reactions>0,"lightning payload actually conducts on a previously wet enemy")
 t,m=real({{id="flame_cloak"},{id="quick_chant"}});m.x=1;skillRuntime:update(0,{t});skillRuntime:update(.28,{t});skillRuntime:update(.08,{t})
 local cast=skillRuntime.casts[1];check(near(cast.nextTick,.88),"cooldown reduction reaches existing flame-cloak ticks")
 t,m=real({{id="phoenix_fire"},{id="quick_chant"},{id="overload_script"}});skillRuntime:update(.01,{t})
 check(near(skillRuntime.units[t.visualId].nextPhoenix,2.035),"existing phoenix recurrence composes haste and overload multiplicatively")
 -- High movement frequency must not evict every orb before it can detonate.
 t=fresh({stepOrb=1});local fired=0
 for _=1,120 do c:moved(t,t.x,0,t.x+67.2/60,0);t.x+=67.2/60;advance(1/60,{t})end
 check((c.counts.step_orb_detonate or 0)>0,"continuous birth-speed movement still allows delayed orbs to detonate while source lives")
 check(#c.nodes<=16,"high-speed source remains bounded")
 local savedApi=apiRef;apiRef={random={nextFloat=function()return 0 end},save=api.save}
 for _,kind in ipairs({"contact_mine","step_orb","resonant_debt"})do
  t,m=real({{id=kind}});monsters={};addMonster(5,0,0);m=monsters[#monsters];m.guard=1;m.scale=0
  addMonster(1,.1,0);local bystander=monsters[#monsters];bystander.guard=1;bystander.scale=0
  c=skillRuntime.composition
  if kind=="step_orb"then skillRuntime:moved(t,-6,0,0,0);skillRuntime:update(1.4,{t})
  elseif kind=="contact_mine"then skillRuntime:update(2,{t});skillRuntime:update(.35,{t})
  else c:onDamage(t,m,{amount=1});for _=1,5 do c:onDamage(t,m,{amount=1})end;skillRuntime:flush()end
  check(S.won and S.phase=="celebration"and not m.alive,"actual "..kind.." can finish the boss")
  check(bystander.alive and S.earned==1100,"winning "..kind.." stops remaining payload hits")
  check(#c.nodes==0 and #c.queue==0 and #c.events==0,"winning "..kind.." cancels all remaining traps and effects")
 end
 apiRef=savedApi;reset();api.observation.set("composition_checks",checks)
end
