-- Controlled fixtures injected into the actual WASM only, never the served payload.
function Game.start(api:any)
 apiRef=api;local checks=0
 local function check(ok:boolean,name:string)assert(ok,"TRIGGERS: "..name);checks+=1 end
 local function near(a:number,b:number)return math.abs(a-b)<.00001 end
 local function fresh(k:number,sources:any?)
  reset();S.phase="battle";S.selected=k;S.aimX=0;S.aimZ=0;S.skillSources[k]=sources or {};frame=1;S.hordeAt=-1
  fire();local t=troops[1];t.x=0;t.z=0;t.dx=1;t.dz=0;return t
 end
 local function monster(x:number?,z:number?)addMonster(1,x or 0,z or 0);local m=monsters[#monsters];m.guard=1e9;m.turn=100;return m end
 local savedApi=apiRef;apiRef={random={nextFloat=function()return .99 end}}
 for k=1,3 do
  local t=fresh(k,{{id="plunder"},{id="longlife"}})
  check(near(t.life,baseLife[k]*1.15*.5),"plunder halves complete lifetime for unit "..k)
  skillRuntime:spawn(t);check(near(t.life,baseLife[k]*1.15*.5),"spawn is idempotent")
 end
 local t=fresh(3,{{id="plunder",stacks=2}})
 check(t.life==4,"duplicate plunder does not halve twice")
 local m=monster();local initial=S.coins
 hit(m,90,t);check(S.coins==initial+1 and S.plunderEarned==1 and S.earned==1,"primary damage guarantees one coin without a lottery")
 hit(m,90,t,true,"burn");check(S.plunderEarned==1,"DoT cannot farm plunder")
 t.targetId=999;hit(m,90,t);check(S.plunderEarned==1,"rejected LOCK damage grants no gold")
 t.targetId=0;m.guard=1;m.damage=0;hit(m,90,t)
 check(m.alive and S.lotteryMisses==1 and S.plunderEarned==2 and S.kills==0,"failed lottery pays only the earned plunder coin, not a kill")
 check((skillRuntime.triggers.counts.grave_bloom or 0)==0,"miss is not enemy death")
 t.playerId=2;local localGold=S.coins;local remoteGold=S.playerGold[2];hit(m,90,t)
 check(S.coins==localGold and S.playerGold[2]==remoteGold+1,"plunder belongs to the deploying player")
 t=fresh(3,{{id="plunder"}})
 for i=1,21 do contactHit(t,monster(i,0))end
 check(S.plunderEarned==21 and not t.alive and S.contactDeaths==1,"twenty-first terminal cavalry hit also earns exactly one coin")
 t=fresh(3,{{id="plunder"},{id="bounce_life"},{id="hunter_vigor"}});monsters={}
 moveTroop(t,13);check(near(t.life,4.1),"bounce extension is halved too")
 recordKill(t,{id=999,x=0,z=0,alive=false});check(near(t.life,4.225),"kill extension is halved too")
 t=fresh(3,{{id="firstborn"},{id="plunder"}})
 local f=skillRuntime.triggers
 check(near(f:speedBonus(t,0),1.8)and near(f:speedBonus(t,1.5),.9)and f:speedBonus(t,3)==0,"birth speed decays linearly over three seconds")
 check(f:speedBonus(t,4)==0 and t.life==4,"rush ending does not alter remaining lifetime")
 t.skills.firstborn=100;check(near(f:speedBonus(t,0),2.7),"repeat-source burst has a declared cap")
 for _,dt in ipairs({1/60,1/15})do
  t=fresh(3,{{id="firstborn"}});monsters={}
  for _=1,math.floor(3/dt+.5)do updateCombat(dt)end
  check(near(t.travel,136.8),"integrated birth decay gives the same travel at dt "..dt)
  check(t.bounceCount>=5,"high speed still splits wall reflections")
 end
 t=fresh(3,{{id="firstborn"},{id="momentum"}});m=monster();hit(m,90,t)
 check(near(m.damage,144),"birth speed contributes to capped momentum damage")
 t=fresh(2,{{id="firstborn"}});local landingX,landingZ=t.landingX,t.landingZ
 for _=1,120 do updateCombat(1/60);if t.state=="spin"then break end end
 check(t.state=="spin"and near(t.x,landingX)and near(t.z,landingZ),"accelerated spear retains the exact saved landing point")
 t=fresh(3,{{id="delayed_bloom"}});f=skillRuntime.triggers
 table.insert(f.rules,{id="later_fixture",modifier="delayedBloom",trigger="age",action="burst",after=4,radius=1,damage=.1})
 t.age=2;f:update({t});check(#f.queue==1 and f.queue[1].rule.id=="delayed_bloom","two age rules do not trigger each other early")
 t.age=4;f:update({t});check(#f.queue==2 and f.queue[2].rule.id=="later_fixture","each delayed rule keeps its own timer")
 table.remove(f.rules)
 t=fresh(3,{{id="march_capacitor"}});m=monster(9,0);m.scale=0
 moveTroop(t,10)
 check(near(m.damage,117),"crossing eight units before contact applies its charge to that hit")
 check((t.marchCharges or 0)==0,"primary contact consumes distance charges")
 monsters={};moveTroop(t,32);check(t.marchCharges==2,"distance charges cap at two across rebounds")
 m=monster();hit(m,90,t,true,"burn");check(t.marchCharges==2,"secondary damage cannot consume stored charge")
 hit(m,90,t);check(t.marchCharges==0 and near(m.damage,234),"two charges add sixty percent once")
 t=fresh(2,{{id="march_capacitor"}});moveTroop(t,8);check(not t.marchCharges,"airborne travel does not count for ground distance triggers")
 t=fresh(3,{{id="third_pulse"},{id="plunder"}});m=monster()
 for _=1,2 do hit(m,90,t)end
 check(#skillRuntime.triggers.queue==0,"nth hit waits for the threshold")
 hit(m,90,t);check(#skillRuntime.triggers.queue==1,"third primary hit queues one pulse")
 local earned=S.plunderEarned;skillRuntime:flush()
 check(t.mainHits==3 and S.plunderEarned==earned and near(m.damage,306),"pulse damage neither re-counts nor farms gold")
 for _=1,3 do hit(m,90,t)end;skillRuntime:flush()
 check(skillRuntime.triggers.counts.third_pulse==2,"sixth primary hit triggers the next pulse")
 t=fresh(3,{{id="delayed_bloom"}});f=skillRuntime.triggers;m=monster()
 t.age=1.99;f:update({t});check(#f.queue==0,"delayed cast waits for two seconds")
 t.age=2;f:update({t});f:flush();check(near(m.damage,45),"birth plus two seconds releases the fire burst")
 t.age=3;f:update({t});f:flush();check(near(m.damage,45),"age trigger fires only once")
 t=fresh(3,{{id="delayed_bloom"}});m=monster();t.age=2;t.alive=false;skillRuntime.triggers:update({t});skillRuntime:flush()
 check(m.damage==0,"dead source cannot release the delayed burst")
 t=fresh(3,{{id="last_echo"}});m=monster();t.age=5.99;skillRuntime.triggers:update({t});check(#skillRuntime.triggers.queue==0,"life threshold waits")
 t.age=6;skillRuntime.triggers:update({t});skillRuntime:flush();check(near(m.damage,31.5)and m.slow==1.5,"quarter-life frost deals damage and slows")
 t.life+=2;t.age=7.6;skillRuntime.triggers:update({t});skillRuntime:flush();check(near(m.damage,31.5),"extending life cannot rearm the threshold trigger")
 t=fresh(3,{{id="battle_elegy"}});local ally={visualId=900,alive=false,playerId=t.playerId,x=1,z=0,skills={}}
 f=skillRuntime.triggers;f:death(ally,"recall");check(not t.elegyUntil,"recall does not count as an allied death")
 f:death(ally,"contact");check(near(t.elegyUntil,2),"nearby own death inspires living wearer")
 f:death(ally,"expired");check(f.counts.battle_elegy==1,"a death is dispatched once")
 ally={visualId=901,alive=false,playerId=2,x=1,z=0,skills={}};f:death(ally,"contact");check(f.counts.battle_elegy==1,"another player's casualty is not an ally trigger")
 ally={visualId=902,alive=false,playerId=1,x=9,z=0,skills={}};f:death(ally,"contact");check(f.counts.battle_elegy==1,"allied-death radius is respected")
 m=monster();hit(m,90,t);check(near(m.damage,112.5),"inspiration modifies primary damage")
 ally={visualId=903,alive=false,playerId=1,x=1,z=0,skills={}};skillRuntime.clock=1;f:death(ally,"contact");hit(m,90,t)
 check(near(m.damage,225)and t.elegyUntil==3,"inspiration refreshes duration without stacking")
 skillRuntime.clock=3.1;hit(m,90,t);check(near(m.damage,315),"expired inspiration has no effect")
 t=fresh(3,{{id="grave_bloom"},{id="plunder"}});m=monster();m.guard=1
 hit(m,90,t);skillRuntime:flush();check(m.alive and not skillRuntime.triggers.counts.grave_bloom,"nonwinning guard break cannot trigger a funeral")
 apiRef={random={nextFloat=function()return 0 end}}
 local nearby=monster(.5,0);nearby.guard=1
 hit(m,90,t);skillRuntime:flush()
 check(not m.alive and not nearby.alive and S.kills==2,"real kill triggers damaging corpse burst")
 check(skillRuntime.triggers.counts.grave_bloom==1 and #skillRuntime.triggers.queue==0,"burst kill cannot trigger another funeral")
 check(S.plunderEarned==2,"corpse burst earns no plunder")
 t=fresh(3,{{id="grave_bloom"}});m=monster();m.guard=1;nearby=monster(.5,0)
 hit(m,90,t,true,"burn");skillRuntime:flush();check(near(nearby.damage,36),"a genuine DoT kill can trigger one funeral")
 t=fresh(3,{{id="delayed_bloom"}});m=monster();nearby=monster(.5,0);t.targetId=m.id;t.age=2
 skillRuntime.triggers:update({t});skillRuntime:flush();check(m.damage>0 and nearby.damage==0,"new AoE skills keep LOCK damage exclusive")
 t=fresh(3,{{id="delayed_bloom"}});m=monster();t.age=2;skillRuntime.triggers:update({t});S.phase="clear";skillRuntime:flush()
 check(m.damage==0 and #skillRuntime.triggers.queue==0 and #skillRuntime.triggers.events==0,"round end cancels queued damage and presentation")
 apiRef=savedApi;reset();publish(api);api.observation.set("trigger_checks",checks)
end
