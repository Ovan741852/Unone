-- Injected into the actual Unone WASM for verification only.
function Game.start(api:any)
 apiRef=api;local checks=0
 local function check(ok:boolean,name:string)assert(ok,"BEQUEST: "..name);checks+=1 end
 local function near(a:number,b:number)return math.abs(a-b)<1e-5 end
 local clock,active,roll,randomCalls=0,true,.99,0
 local live,creatures,receipts={},{},{};local f:any=nil
 local function unit(id:number,skills:any?)return {visualId=id,playerId=1,targetId=0,alive=true,age=1,life=8,x=0,z=0,damage=100,skills=skills or {}}end
 local function fresh(skills:any?)
  clock=0;active=true;roll=.99;randomCalls=0;live={};creatures={};receipts={}
  f=createTriggerRuntime({clock=function()return clock end,active=function()return active end,troops=function()return live end,monsters=function()return creatures end,
   random=function()randomCalls+=1;return roll end,gold=function()error("bequests may not grant gold")end,
   damage=function(m:any,amount:number,t:any,kind:string)receipts[#receipts+1]={target=m,amount=amount,owner=t,kind=kind}end})
  local t=unit(1,skills);live={t};f:attach(t);return t
 end
 local function addAlly(id:number)local t=unit(id);live[#live+1]=t;f:attach(t);return t end
 local function enemy(id:number,x:number,guard:number)local m={id=id,x=x,z=0,alive=true,guard=guard};creatures[#creatures+1]=m;return m end
 local t=fresh({legacyGift=1});local a=addAlly(3);local b=addAlly(2);local other=addAlly(4);other.playerId=2
 local expired=addAlly(5);expired.age=expired.life;local dead=addAlly(6);dead.alive=false
 t.alive=false;f:death(t,"recall");check(not a.legacyStacks and randomCalls==0,"recall grants no gift and consumes no random value")
 f:death(t,"contact");check(a.legacyStacks==1 and not b.legacyStacks and not other.legacyStacks and not expired.legacyStacks and not dead.legacyStacks,"sorted random candidates include only own living unexpired soldiers")
 check(randomCalls==1 and f.counts.legacy_gift==1,"exactly one recipient and one RNG draw")
 f:death(t,"expired");check(a.legacyStacks==1 and randomCalls==1,"death is idempotent")
 check(near(f:consumeDamageBonus(a),.2)and a.legacyStacks==1,"inherited primary bonus persists after a hit")
 local e=f.events[#f.events];check(e.kind=="legacy_gift"and e.targetId==a.visualId and e.tx==a.x and e.tz==a.z,"receipt identifies exact recipient and endpoints")
 for i=1,2 do local donor=addAlly(10+i);donor.skills.legacyGift=1;donor.alive=false;f:death(donor,"expired")end
 check(a.legacyStacks==3 and near(f:consumeDamageBonus(a),.6),"three gifts cap at sixty percent")
 local donor=addAlly(14);donor.skills.legacyGift=10;donor.legacyStacks=3;donor.alive=false;f:death(donor,"contact")
 check(b.legacyStacks==1 and a.legacyStacks==3,"capped recipients are skipped; duplicate skill and inherited stacks transfer only one gift")
 a.elegyUntil=2;a.marchCharges=2;check(near(f:consumeDamageBonus(a),1.45)and a.marchCharges==0,"gift composes additively with elegy and consumed distance charges")
 clock=3;check(near(f:consumeDamageBonus(a),.6),"gift remains after short buffs expire")
 local before=f.counts.legacy_gift;a.alive=false;f:death(a,"contact");check(f.counts.legacy_gift==before,"receiving a gift does not grant the death skill")
 local view=f:view();local found=false;for _,v in ipairs(view.buffs)do if v.kind=="legacy_gift"and v.sourceId==b.visualId then found=v.stacks==1 end end
 check(found,"recipient without equipment still has a persistent buff visual")
 t=fresh({legacyGift=1});t.alive=false;f:death(t,"expired");check(randomCalls==0 and not f.counts.legacy_gift,"no eligible recipient is a quiet no-op")
 t=fresh({legacyGift=1});a=addAlly(2);b=addAlly(3);roll=0;t.targetId=999;t.alive=false;f:death(t,"contact")
 check(a.legacyStacks==1 and not b.legacyStacks,"lower RNG endpoint is valid; LOCK does not forbid allied support")
 t=fresh({legacyGift=1});a=addAlly(2);active=false;t.alive=false;f:death(t,"contact");check(not a.legacyStacks,"round end cannot grant a gift")
 t=fresh({guardBequest=1});local m=enemy(1,.1,100);local n=enemy(2,.2,1000);local third=enemy(3,.3,200);local fourth=enemy(4,.4,200);local far=enemy(5,3,200)
 t.alive=false;f:death(t,"contact");check(#f.queue==1 and #receipts==0,"death queues one guard burst before resolution")
 f:flush();check(#receipts==3 and receipts[1].target==m and receipts[3].target==third,"nearest three targets only")
 check(near(receipts[1].amount,20)and near(receipts[2].amount,100),"twenty percent guard contribution is capped at source base damage")
 check(receipts[1].kind=="guard_bequest"and receipts[1].owner==t,"guard burst retains dead owner attribution")
 f:death(t,"expired");f:flush();check(#receipts==3,"same death cannot burst twice")
 t=fresh({guardBequest=1});m=enemy(1,1,100);n=enemy(2,2,200);t.targetId=n.id;t.alive=false;f:death(t,"expired");f:flush()
 check(#receipts==1 and receipts[1].target==n,"LOCK keeps the guard burst target-exclusive")
 t=fresh({guardBequest=1});m=enemy(1,0,100);t.alive=false;f:death(t,"recall");f:flush();check(#receipts==0,"recall never bursts")
 t=fresh({guardBequest=1});m=enemy(1,0,100);t.alive=false;f:death(t,"expired");active=false;f:flush();check(#receipts==0 and #f.queue==0,"queued burst cancels outside combat")
 t=fresh({guardBequest=1,areaBonus=.2,areaPenalty=.1});m=enemy(1,3,100);t.alive=false;f:death(t,"expired");f:flush()
 check(#receipts==1 and near(receipts[1].amount,18),"area modifiers apply to guard burst")

 -- Integration with real damage, lotteries, economy, death and round boundaries.
 local savedApi=apiRef;apiRef={random={nextFloat=function()return .99 end},save=api.save}
 local function realFresh(k:number,sources:any?)
  reset();S.phase="battle";S.selected=k;S.aimX=0;S.aimZ=0;S.skillSources[k]=sources or {};frame=1;S.hordeAt=-1
  fire();local v=troops[1];v.x=0;v.z=0;v.dx=1;v.dz=0;return v
 end
 local function realEnemy(x:number,guard:number,rank:number?)addMonster(rank or 1,x,0);local v=monsters[#monsters];v.guard=guard;v.damage=0;v.turn=100;return v end
 a=realFresh(3);local paid,life,base=a.paid,a.life,a.damage
 cooldown=0;S.selected=1;S.skillSources[1]={{id="legacy_gift"}};fire();t=troops[2];t.x=0;t.z=0;m=realEnemy(0,1e6)
 contactHit(t,m);check(not t.alive and a.legacyStacks==1,"real terminal sword hit grants one surviving cavalry gift")
 check(a.paid==paid and a.life==life and a.damage==base and a.skills.legacyGift==0,"gift changes no equipment snapshot, price, lifespan or skill ownership")
 m.damage=0;hit(m,a.damage,a);check(near(m.damage,a.damage*1.2),"gift increases actual primary damage")
 m.damage=0;hit(m,a.damage,a,true,"burn");check(near(m.damage,a.damage),"gift does not increase DoT or secondary damage")
 S.won=false;S.phase="clear";settleSurvivors();check(S.roundRefund==paid,"gifted survivor refunds only original purchase price")
 t=realFresh(3,{{id="guard_bequest"},{id="plunder"},{id="overload_script"}});m=realEnemy(0,200);n=realEnemy(1,1e5)
 t.alive=false;skillRuntime:onDeath(t,"expired");skillRuntime:flush()
 check(near(m.damage,80)and near(n.damage,t.damage*2),"overload doubles guard burst once after the per-source cap")
 check(S.plunderEarned==0 and not t.mainHits,"guard burst farms no plunder and no primary hit counter")
 t=realFresh(3,{{id="guard_bequest"}});m=realEnemy(0,100);m.damage=80;local coins=S.coins
 t.alive=false;skillRuntime:onDeath(t,"expired");skillRuntime:flush()
 check(m.alive and m.breaks==1 and S.lotteryMisses==1 and m.damage==0 and S.coins==coins,"death burst can break guard and miss; monster stays alive and no coins appear")
 t=realFresh(3,{{id="guard_bequest"},{id="grave_bloom"}});m=realEnemy(0,100);m.damage=80;n=realEnemy(.5,10000)
 apiRef={random={nextFloat=function()return 0 end},save=api.save};t.alive=false;skillRuntime:onDeath(t,"expired");skillRuntime:flush()
 check(not m.alive and S.kills==1 and S.earned>0 and S.lotteryMisses==0,"winning death burst uses normal award and kill rules")
 check(not skillRuntime.triggers.counts.grave_bloom,"triggered burst kill cannot recurse through enemy funeral")
 t=realFresh(3,{{id="guard_bequest"}});m=realEnemy(0,100,5);m.damage=80;n=realEnemy(.5,10000)
 t.alive=false;skillRuntime:onDeath(t,"expired");skillRuntime:flush()
 check(S.phase=="celebration"and n.damage==0 and #skillRuntime.triggers.queue==0,"boss jackpot stops remaining burst targets before settlement")
 apiRef=savedApi;reset();publish(api);api.observation.set("bequest_checks",checks)
end
