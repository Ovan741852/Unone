-- Injected into actual Unone WASM in memory only. Never shipped to players.
function Game.start(api:any)
 apiRef=api;reset();local checks=0
 local function check(ok:boolean,label:string)assert(ok,"LIFECYCLE: "..label);checks+=1 end
 local function near(a:number,b:number)return math.abs(a-b)<.00001 end
 local function target(id:number,x:number,z:number)return {id=id,x=x,z=z,alive=true,damage=0}end
 local function unit(id:number,skills:any,amount:number?)return {visualId=id,playerId=id,alive=true,x=0,z=0,dx=1,dz=0,targetId=0,damage=amount or 100,skills=skills,state="run"}end
 local function context(ms:any)
  local active=true;local receipts={};local randomCalls=0
  local rt=createSkillRuntime({wallX=12.5,wallZ=12.5,active=function()return active end,monsters=function()return ms end,random=function()randomCalls+=1;return .5 end,
   damage=function(m:any,amount:number,t:any,kind:string)m.damage+=amount;receipts[#receipts+1]={amount=amount,player=t.playerId,kind=kind}end})
  return rt,receipts,function()active=false end,function()return randomCalls end
 end
 local function advance(rt:any,units:any,seconds:number)for _=1,math.floor(seconds*60+.5)do rt:update(1/60,units)end end
 local function count(t:any)local n=0;for _ in pairs(t)do n+=1 end;return n end
 local m=target(1,1,0);local rt,receipts,stop=context({m});local t=unit(1,{flameCloak=1})
 rt:attach(t);check(rt.casts[1].phase=="windup","cast starts in windup")
 advance(rt,{t},.30);check(rt.casts[1].phase=="release" and m.damage==0,"release visible before periodic damage")
 advance(rt,{t},.12);check(rt.casts[1].phase=="channel","sustained channel phase")
 advance(rt,{t},.70);check(near(m.damage,18) and #receipts==1,"cloak first tick .8 seconds after release")
 t.alive=false;advance(rt,{},1);check(#receipts==1 and #rt.casts==0,"dead source ends channel without more damage")
 local phases={};for _,e in ipairs(rt.events)do if e.domain=="cast" then phases[e.phase]=true end end
 check(phases.windup and phases.release and phases.channel and phases["end"],"four cast stages recorded")
 rt,receipts=context({target(1,1,0),target(2,2,0),target(3,3,0),target(4,4,0),target(5,9,0)})
 t=unit(1,{phoenixFire=1});advance(rt,{t},.4)
 check(#rt.entities==3,"phoenix releases three distinct targets")
 local selected={};for _,e in ipairs(rt.entities)do selected[e.target.id]=true;check(e.target.id~=5,"phoenix honours range")end
 check(count(selected)==3,"phoenix samples without replacement")
 t.alive=false;advance(rt,{},.6);check(count(rt.buffs)==3,"released phoenix survives source death")
 advance(rt,{},3.3);check(#receipts==12,"each burn gives four timed ticks")
 check(not rt:hasPendingDamage(),"burn expires and no pending damage remains")
 rt,receipts=context({target(10,1,0),target(11,2,0)});t=unit(1,{phoenixFire=1,flameCloak=1});t.targetId=11
 advance(rt,{t},1.3);check(#rt.entities<=1,"lock permits only its one target")
 for _,b in pairs(rt.buffs)do check(b.target.id==11,"lock also restricts burns")end
 local killed=target(20,1,0);rt,receipts=context({killed});t=unit(1,{phoenixFire=1});advance(rt,{t},.4);killed.alive=false;advance(rt,{t},.5)
 check(count(rt.buffs)==0 and #receipts==0,"dead target fizzles, no retarget")
 -- Split travel includes rebounds. Two sources overlap poison, globally nonstacking.
 m=target(30,7.5,0);rt,receipts=context({m});local weak=unit(1,{plagueVial=1});local strong=unit(2,{plagueVial=1},200)
 rt:moved(weak,0,0,5.9,0);check(#rt.casts==0,"below travel threshold gives no vial")
 rt:moved(weak,5.9,0,6,0);rt:moved(strong,0,0,6,0)
 check(#rt.casts==2 and near(rt.casts[1].x,6),"precise crossing creates one vial per source")
 advance(rt,{weak,strong},1.3)
 check(count(rt.buffs)==1,"overlapping poison has one global status")
 check(#receipts==1 and near(receipts[1].amount,20) and receipts[1].player==2,"strongest dose owns a single poison tick")
 advance(rt,{weak,strong},1.0);check(#receipts==3,"cloud refresh never postpones tick cadence")
 m.x=-10;advance(rt,{weak,strong},2.6);check(not rt:hasPendingDamage(),"cloud N seconds and poison M seconds both expire")
 for _,r in ipairs(receipts)do check(r.player==2 and near(r.amount,20),"poison never stacks or loses strongest ownership")end
 local after=#receipts;advance(rt,{weak,strong},1);check(#receipts==after,"expired poison cannot keep damaging")
 rt,receipts=context({});t=unit(1,{plagueVial=1});rt:moved(t,0,0,12,0);rt:moved(t,12,0,-12,0)
 check(#rt.casts==6 and near(rt.units[1].distance,0),"multiple thresholds across reverse segment count full path")
 advance(rt,{t},.9);local cloudCount=0;for _,e in ipairs(rt.entities)do if e.phase=="active" then cloudCount+=1 end end
 check(cloudCount==4,"per-source poison field cap replaces oldest fields")
 rt,receipts,stop=context({target(40,1,0)});t=unit(1,{phoenixFire=1,flameCloak=1});advance(rt,{t},1.4);local before=#receipts
 stop();advance(rt,{t},2);check(#receipts==before and #rt.entities==0 and #rt.casts==0 and count(rt.buffs)==0,"round end cancels all gameplay effects")
 rt:reset();check(rt.clock==0 and #rt.events==0 and count(rt.units)==0,"reset clears ownership and lifecycle history")
 -- Integration: real movement helper, real hit pipeline and price snapshots.
 reset();S.phase="battle";S.selected=3;S.aimX=0;S.aimZ=0;S.skillSources[3]={{id="plague_vial"}};fire();t=troops[1];t.x=0;t.z=0;t.dx=1;t.dz=0;monsters={}
 moveTroop(t,50);check(t.bounceCount==2 and #skillRuntime.casts==8 and near(skillRuntime.units[t.visualId].distance,2),"actual wall reflections count 50 travel, not zero displacement")
 reset();S.phase="battle";S.selected=3;S.aimX=0;S.aimZ=0;S.skillSources[3]={{id="flame_cloak"},{id="phoenix_fire"},{id="plague_vial"}};fire();t=troops[1]
 check(t.skills.flameCloak==1 and t.skills.phoenixFire==1 and t.skills.plagueVial==1 and t.paid==27,"three new skills compose and deployment cost includes gear sources")
 m={id=91,rank=1,x=t.x+1,z=t.z,guard=1,damage=0,alive=true,scale=1,slow=0,flash=0,breaks=0,name="fixture",special=""};monsters={m}
 local savedApi=apiRef;apiRef={random={nextFloat=function()return .99 end}}
 advance(skillRuntime,{t},1.3)
 check(S.lotteryMisses>=1 and m.alive,"DoT breaks still can miss and leave small monsters alive")
 check(S.criticalHits==0 and S.procHits>0,"periodic hits are secondary and cannot crit or recursively proc")
 check(S.damageEvents[#S.damageEvents].damageType=="flame_cloak","damage receipts include skill type")
 apiRef=savedApi
 reset();publish(api);api.observation.set("skill_lifecycle_checks",checks)
end
