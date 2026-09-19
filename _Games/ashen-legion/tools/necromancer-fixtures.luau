function Game.start(api:any)
 apiRef=api;reset();local checks=0
 local function check(ok:boolean,name:string)assert(ok,"NECROMANCER: "..name);checks+=1 end
 local function near(a:number,b:number)return math.abs(a-b)<1e-5 end
 local clock,roll,randomCalls=0,.1,0
 local live,creatures,receipts={},{},{};local f:any=nil
 local function unit(id:number,skills:any?,playerId:number?)return {visualId=id,playerId=playerId or 1,targetId=0,alive=true,age=1,life=8,x=0,z=0,damage=100,skills=skills or {}}end
 local necroGear:any=nil;for _,item in ipairs(gearCatalog)do if item.skill=="necromancer"then necroGear=item end end
 check(necroGear~=nil and necroGear.name=="招魂骨冠"and necroGear.slot==1 and necroGear.price==116,"the necromancer passive is obtainable as a distinct wearable helmet")
 S.skillSources[1]={{id="necromancer"}};local composed=composeSkills(1)
 check(composed.necromancer==1 and sourcePrices.necromancer==4,"loadout composition attaches the proc and its deployment surcharge")
 local function fresh(value:number)
  clock=0;roll=value;randomCalls=0;live={};creatures={};receipts={}
  f=createTriggerRuntime({clock=function()return clock end,active=function()return true end,troops=function()return live end,monsters=function()return creatures end,
   random=function()randomCalls+=1;return roll end,gold=function()error("ghosts never grant plunder gold")end,
   damage=function(m:any,amount:number,t:any,kind:string,reaction:boolean?)receipts[#receipts+1]={target=m,amount=amount,owner=t,kind=kind,reaction=reaction}end})
  local t=unit(1,{necromancer=1});live={t};f:attach(t);return t
 end
 local function enemy(id:number,x:number,z:number?)local m={id=id,x=x,z=z or 0,alive=true,guard=10000};creatures[#creatures+1]=m;return m end

 local t=fresh(.1);local nearTarget=enemy(1,.5);local second=enemy(2,.9,.1);local third=enemy(3,.8,-.2);enemy(4,3)
 t.alive=false;f:death(t,"recall");check(#f.wraiths==0 and randomCalls==0,"manual recall does not roll the necromancer proc")
 f:death(t,"contact");check(#f.wraiths==1 and randomCalls==1 and f.counts.necromancer==1,"real death passes the 38 percent seeded roll and creates one ghost")
 check(f:hasPendingDamage(),"living ghost keeps combat settlement pending")
 local view=f:view();check(#view.wraiths==1 and near(view.wraiths[1].progress,0),"presentation receives the ghost's initial trajectory")
 clock=.17;f:update({});view=f:view();check(#view.wraiths==1 and near(view.wraiths[1].progress,.5)and near(view.wraiths[1].x,.25),"ghost visibly dashes along its saved heading")
 clock=.34;f:update({});check(#f.wraiths==0 and not f:hasPendingDamage(),"ghost resolves at the end of its 0.34 second dash")
 check(#receipts==3 and receipts[1].target==nearTarget and near(receipts[1].amount,34),"closest enemy takes 34 percent of source damage")
 check(receipts[2].target==third and near(receipts[2].amount,16)and receipts[3].target==second and near(receipts[3].amount,16),"nearby enemies take 16 percent splash, with a three-target cap")
 check(receipts[1].kind=="soul_wraith"and receipts[1].owner==t and receipts[1].reaction==false,"ghost damage keeps its source and distinct damage kind")
 local burst=false;for _,event in ipairs(f.events)do if event.kind=="necromancer_burst"then burst=event.targetId==nearTarget.id end end;check(burst,"the arrival event exposes a target-linked burst to VFX")

 t=fresh(.9);enemy(1,.3);f:death(t,"expired");check(#f.wraiths==0 and randomCalls==1 and not f.counts.necromancer,"failed chance creates no ghost")
 t=fresh(0);enemy(1,6);f:death(t,"expired");check(#f.wraiths==0 and randomCalls==0,"no nearby target cannot waste a death roll")
 t=fresh(0);local unlocked=enemy(1,.2);local locked=enemy(2,1);t.targetId=locked.id;f:death(t,"expired");check(f.wraiths[1].target==locked,"LOCK directs the ghost at the selected target even if another is closer")
 clock=.34;f:update({});check(#receipts==1 and receipts[1].target==locked,"LOCK excludes all other enemies from ghost splash")
 t=fresh(0);enemy(1,.5);local seventh=nil
 for i=1,7 do local donor=unit(i+1,{necromancer=1});live[#live+1]=donor;donor.alive=false;f:death(donor,"contact");if i==7 then seventh=donor end end
 check(#f.wraiths==6 and randomCalls==6,"each player can hold at most six ghosts; capped deaths consume no extra roll")
 check(seventh~=nil and f.counts.necromancer==6,"the seventh death cannot create a recursive or unbounded wave")

 local savedApi=apiRef;apiRef={random={nextFloat=function()return 0 end},save=api.save}
 local function realFresh(sources:any)
  reset();S.phase="battle";S.selected=1;S.aimX=0;S.aimZ=0;S.skillSources[1]=sources;frame=1;S.hordeAt=-1;fire()
  local troop=troops[1];troop.x=0;troop.z=0;troop.dx=1;troop.dz=0;return troop
 end
 local t2=realFresh({{id="necromancer"},{id="grave_bloom"}})
 -- Use the production monster constructor and keep enough guard for the sword's first contact.
 addMonster(1,1,0);local first=monsters[#monsters];first.guard=t2.damage*1.2;first.damage=0;first.turn=100
 addMonster(1,1.4,0);local splash=monsters[#monsters];splash.guard=10000;splash.damage=0;splash.turn=100
 contactHit(t2,first,0,0);check(not t2.alive and #skillRuntime:view().triggers.wraiths==1,"production sword death runs the real composed skill")
 local primaryHits=t2.mainHits;local primaryCrits=S.criticalHits
 skillRuntime:update(.34,troops);skillRuntime:flush()
 check(not first.alive and S.kills==1 and skillRuntime.triggers.counts.grave_bloom==1,"a ghost kill can start one compatible grave-bloom chain")
 check(t2.mainHits==primaryHits and S.criticalHits==primaryCrits and S.plunderEarned==0,"ghost bursts add no main hits, crit roll, or plunder")
 check(S.damageEvent>=3,"contact, ghost, and linked burst all have ordinary hit receipts")
 local ghostHits=0;for _,receipt in ipairs(S.damageEvents)do if receipt.damageType=="soul_wraith"then ghostHits+=1 end end
 check(ghostHits>=1 and splash.damage>0,"real ghost damage uses normal guard damage and propagates fire to elemental reactions")
 local count=skillRuntime.triggers.counts.necromancer or 0;skillRuntime:onDeath(t2,"contact");check((skillRuntime.triggers.counts.necromancer or 0)==count,"the same dead troop cannot summon twice")
 apiRef=savedApi;reset();publish(api);api.observation.set("necromancer_checks",checks)
end
