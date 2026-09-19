-- Injected only into the test payload. Exercises the production Luau factories.
function Game.start(api:any)
 apiRef=api;local checks=0
 local function check(ok:boolean,name:string)assert(ok,"RESONANCE: "..name);checks+=1 end
 local function near(a:number,b:number)return math.abs(a-b)<1e-5 end
 local time=0;local active=true;local targets={};local receipts={};local r:any=nil
 local function fresh()
  time=0;active=true;targets={};receipts={}
  r=createResonanceRuntime({clock=function()return time end,active=function()return active end,monsters=function()return targets end,
   damage=function(m:any,amount:number,t:any,kind:string)receipts[#receipts+1]={m=m,amount=amount,owner=t,kind=kind}end})
  return {visualId=1,playerId=1,targetId=0,alive=true,age=0,k=3,x=0,z=0,dx=1,dz=0,state="run",damage=100,mainHits=1,skills={}}
 end
 local function monster(x:number,z:number)
  local m={id=#targets+1,alive=true,x=x,z=z,scale=0};targets[#targets+1]=m;return m
 end
 local function advance(dt:number,live:any?)time+=dt;r:update(dt,live or {})end
 local function hitPrimary(t:any,m:any)r:onDamage(t,m,{amount=100,secondary=false})end
 local t=fresh();t.skills.cinderSeal=1;local m=monster(0,0);hitPrimary(t,m)
 check(#r.jobs==1 and near(r.jobs[1].due,1.2),"cinder starts a 1.2 second fuse")
 advance(.5);local t2=table.clone(t);t2.visualId=2;t2.damage=500;hitPrimary(t2,m)
 check(#r.jobs==1 and r.jobs[1].owner==t and near(r.jobs[1].due,1.2),"repeated mark neither steals attribution nor resets deadline")
 m.x=3;monster(4,0);advance(.69);check(#receipts==0 and r:view().jobs[1].x==3,"mark follows its target without early damage")
 t.alive=false;advance(.01);check(#receipts==2 and receipts[1].amount==60 and receipts[1].owner==t,"released mark survives its source and explodes at the new position")
 check(not r:hasPendingDamage(),"resolved marks release pending-damage hold")
 t=fresh();t.skills.cinderSeal=1;m=monster(0,0);hitPrimary(t,m);m.alive=false;monster(.5,0);advance(.4)
 check(#receipts==0,"enemy death does not explode its mark early")
 advance(.8);check(#receipts==1 and receipts[1].m.id==2,"dead marked enemy leaves a timed ground detonation")
 t=fresh();t.skills.cinderSeal=1;m=monster(0,0);t.targetId=m.id;hitPrimary(t,m);monster(.1,0);advance(1.2)
 check(#receipts==1 and receipts[1].m==m,"delayed area damage honors captured LOCK")
 t=fresh();t.skills.cinderSeal=1;m=monster(0,0);hitPrimary(t,m);t2=table.clone(t);t2.playerId=2;hitPrimary(t2,m)
 check(#r.jobs==2,"different players own independent marks")
 t=fresh();t.skills.cinderSeal=1;m=monster(0,0);r:onDamage(t,m,{amount=100,secondary=true});r:onDamage(t,m,{amount=0})
 check(#r.jobs==0,"secondary and zero damage cannot seed marks")
 for i=1,28 do hitPrimary(t,monster(i/100,0))end
 check(#r.jobs==24 and #receipts==0,"bounded mark pool drops oldest without awarding an early explosion")
 advance(1.2);check(#receipts==24*4,"circle damage has a four-target cap even in a dense wave")
 t=fresh();t.skills.chainFuse=1;m=monster(0,0);hitPrimary(t,m);advance(.6)
 for i=1,6 do hitPrimary(t,monster(i*.2,0))end
 t2=table.clone(t);t2.playerId=2;hitPrimary(t2,monster(.1,0));advance(1.2)
 check(#receipts==4 and #r.jobs==7,"initial fuse resolves alone before linked marks")
 local linked=0;for _,j in ipairs(r.jobs)do if j.wave then linked+=1;check(j.owner.playerId==1,"chain ownership stays local");check(near(j.due,1.92),"linked seed is advanced to a visible 120ms step")end end
 check(linked==5,"one chain may contain at most six seeds including its root")
 advance(.119);check(#receipts==4,"link animation precedes secondary explosions")
 advance(.001);check(#receipts==24 and #r.jobs==2,"only the five linked neighbors release; unlinked seeds keep their timers")
 advance(.48);check(#r.jobs==0,"remaining independent fuses still resolve normally")
 t=fresh();t.skills.chainFuse=1;for i=0,1 do hitPrimary(t,monster(i*1.8,0))end
 advance(1.8);check(#r.jobs==1,"same-frame ready neighbor rechecks a changed deadline")
 advance(.12);check(#r.jobs==0,"same-frame chain finishes on the following beat")
 t=fresh();t.skills.chainFuse=1;hitPrimary(t,monster(0,0));advance(.6)
 for i=1,3 do hitPrimary(t,monster(i*1.8,0))end
 advance(1.2);check(#r.jobs==3,"staggered chain begins with only its first fuse")
 advance(.12);check(#r.jobs==2,"a long chain propagates one hop per beat")
 advance(.12);check(#r.jobs==1,"third hop remains sequential")
 advance(.12);check(#r.jobs==0,"last hop terminates")
 t=fresh();t.skills.thunderFan=1;t.mainHits=2;m=monster(.8,0);hitPrimary(t,m);check(#r.jobs==0,"fan waits until the third primary contact")
 t.mainHits=3;hitPrimary(t,m);targets={}
 for _,a in ipairs({-40,-20,0,20,40})do monster(math.cos(math.rad(a))*3,math.sin(math.rad(a))*3)end
 local outside=monster(-1,0);monster(5,0);monster(4,0);advance(.179);check(#receipts==0,"fan telegraph has an 180ms windup")
 advance(.001);check(#receipts==5,"five spokes each choose their closest in-cone target")
 for _,receipt in ipairs(receipts)do check(receipt.m.id<=5 and receipt.amount==45,"fan excludes behind, out-of-range and same-sector rear targets")end
 check(#r.events[1].rays==5 and near(r.events[1].range,4.8),"render receipts contain actual five ray endpoints")
 t=fresh();t.skills.echoBlade=1;m=monster(0,0);hitPrimary(t,m);hitPrimary(t,m)
 check(#r.jobs==1,"echo blade is once per troop")
 m.x=8;local inside=monster(2,.54);local outside=monster(2,.56);advance(.55)
 check(#receipts==1 and receipts[1].m==inside and near(receipts[1].amount,55),"echo fixed capsule permits dodging and respects the exact edge")
 t=fresh();t.skills.starfall=1;for i=1,5 do monster(i*3,0)end
 t.age=2.79;r:update(0,{t});check(#r.jobs==0,"starfall does not cast before age 2.8")
 t.age=2.8;r:update(0,{t});check(#r.jobs==3,"starfall marks the nearest three")
 targets[1].x=20;t.alive=false;advance(.65)
 check(#receipts==0 and #r.jobs==2,"starfall keeps a fixed point after source death and can miss")
 advance(.15);check(#receipts==1 and receipts[1].m.id==2,"second meteor arrives 150ms later")
 advance(.15);check(#receipts==2 and #r.jobs==0,"third meteor arrives and completes")
 t=fresh();t.skills.starfall=1;t.age=3;t.alive=false;r:update(0,{t});check(#r.jobs==0,"dead troop never begins an unreleased starfall")
 t=fresh();t.skills.soulReturn=1;r:moved(t,0,0,12,0);r:moved(t,12,0,12,6);t.x=12;t.z=6
 check(#t.returnPath==2 and near(t.returnPath[1].ax,6),"return path trims to the last twelve traveled units")
 r:death(t,"contact",12,6);r:death(t,"expired",12,6);check(#r.ghosts==1,"death spawns only one returning soul")
 local wrong=monster(9,3);local good=monster(12,3);advance(.3)
 check(#receipts==1 and receipts[1].m==good and r.ghosts[1].x==12 and near(r.ghosts[1].z,0),"return soul follows the actual corner, not the diagonal chord")
 monster(8,0);advance(.3);check(#receipts==2 and #r.ghosts==0,"return soul finishes its twelve-unit path")
 t=fresh();t.skills.soulReturn=1;r:moved(t,0,0,10,0);t.x=10;for i=1,8 do monster(i,0)end
 r:death(t,"expired");advance(.5);check(#receipts==4,"return soul hits at most four distinct enemies")
 check(receipts[1].m.id==8 and receipts[4].m.id==5,"return contacts resolve in reverse travel order")
 t=fresh();t.skills.soulReturn=1;r:moved(t,0,0,5,0);t.x=5;r:death(t,"recall");check(#r.ghosts==0,"recall refunds without creating death damage")
 t=fresh();t.skills.soulReturn=1;t.state="airborne";r:moved(t,0,0,5,0);check(t.returnPath==nil,"airborne movement does not create a ground return path")
 t=fresh();t.skills.cinderSeal=1;hitPrimary(t,monster(0,0));active=false;advance(2);check(#receipts==0 and #r.jobs==0 and #r.events==0,"round end clears all delayed damage")
 -- Integration: actual collision, gameplay damage classification, currency and settlement.
 reset();S.phase="battle";S.selected=1;S.aimX=0;S.aimZ=0;S.skillSources[1]={{id="soul_return"}};frame=1;S.hordeAt=-1;fire();t=troops[1];t.x=0;t.z=0;t.dx=1;t.dz=0
 addMonster(1,4,0);m=monsters[#monsters];m.guard=1e9;m.scale=0
 moveTroop(t,8)
 check(not t.alive and #skillRuntime.resonance.ghosts==1,"first-frame terminal sword contact records its path before death")
 check(near(skillRuntime.resonance.ghosts[1].total,t.x),"terminal return path stops at contact rather than requested movement endpoint")
 reset();S.phase="battle";S.selected=3;S.aimX=0;S.aimZ=0;S.skillSources[3]={{id="cinder_seal"},{id="chain_fuse"},{id="plunder"}};frame=1;fire();t=troops[1]
 addMonster(1,0,0);m=monsters[#monsters];m.guard=1e9;hit(m,90,t)
 check(S.plunderEarned==1 and #skillRuntime.resonance.jobs==2,"actual primary hit earns one coin and schedules both marks")
 skillRuntime:update(1.2,{t});check(S.plunderEarned==1 and #skillRuntime.resonance.jobs==1,"delayed secondary damage cannot farm gold or schedule itself")
 skillRuntime:update(.6,{t});check(S.plunderEarned==1 and #skillRuntime.resonance.jobs==0,"chain explosion does not recursively seed new marks")
 reset();check(#skillRuntime.resonance.jobs==0 and #skillRuntime.resonance.ghosts==0,"reset removes previous expedition jobs")
 local savedApi=apiRef;apiRef={random={nextFloat=function()return 0 end},save=api.save}
 for _,kind in ipairs({"cinder_seal","chain_fuse","thunder_fan","echo_blade","starfall","soul_return"})do
  reset();S.phase="battle";S.selected=3;S.aimX=0;S.aimZ=0;S.skillSources[3]={{id=kind}};frame=1;fire();t=troops[1];t.x=0;t.z=0;t.dx=1;t.dz=0;t.mainHits=3
  addMonster(5,1,0);m=monsters[#monsters];m.guard=1;m.scale=0
  addMonster(1,kind=="soul_return"and -.3 or 1.3,0);local bystander=monsters[#monsters];bystander.guard=1;bystander.scale=0
  local runtime=skillRuntime.resonance
  if kind=="soul_return"then runtime:moved(t,0,0,4,0);t.x=4;t.alive=false;runtime:death(t,"expired")
  elseif kind=="starfall"then t.age=3;skillRuntime:update(0,{t})
  else runtime:onDamage(t,m,{amount=100})end
  skillRuntime:update(2,{t})
  check(S.won and S.phase=="celebration" and not m.alive,"actual "..kind.." can trigger the boss finale")
  check(bystander.alive and S.kills==1 and S.earned==1100,"winning "..kind.." stops remaining hits in the same release")
  check(#runtime.jobs==0 and #runtime.ghosts==0 and #runtime.events==0,"winning "..kind.." clears pending effects before result")
 end
 apiRef=savedApi
 api.observation.set("resonance_checks",checks)
end
