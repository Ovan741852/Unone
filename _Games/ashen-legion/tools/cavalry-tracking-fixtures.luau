-- In-memory WASM regression scene; never exported to the playable build.
function Game.start(api:any)
 apiRef=api
 local checks=0;local reports={}
 local function check(ok:boolean,label:string)assert(ok,"TRACKING: "..label);checks+=1 end
 for _,locked in ipairs({false,true})do
  for _,dt in ipairs({1/60,1/15})do
   reset();beginBattle();monsters={};frame=1;S.hordeAt=-1
   S.selected=3;S.autoEnabled=true;S.lockEnabled=locked;S.autoTargets={elder=true}
   addMonster(4,0,-3);local tree=monsters[1];tree.guard=1e9;tree.angle=.65;tree.turn=100
   addMonster(1,0,-8);local bystander=monsters[2];bystander.guard=1e9;bystander.angle=.65;bystander.turn=100
   targeting(api);local t=troops[1]
   check(t~=nil and S.targetId==tree.id,"AUTO acquires the tree and deploys cavalry")
   check(t.pierceRemaining==20 and t.life==8,"base cavalry retains 20 pierces and eight second lifetime")
   local contactAt=0;local exitAt=0;local dwell=0;local maxDwell=0;local initialDamage=0
   for step=1,math.floor(8/dt+.5)do
    updateCombat(dt)
    if t.hits[tree.id] and contactAt==0 then contactAt=t.age;initialDamage=tree.damage end
    if contactAt>0 and t.alive then
     local inside=(t.x-tree.x)^2+(t.z-tree.z)^2<=(.4+tree.scale*.5)^2
     if inside then dwell+=dt;maxDwell=math.max(maxDwell,dwell)
     else dwell=0;if exitAt==0 then exitAt=t.age end end
    end
   end
   reports[#reports+1]={lock=locked,dt=dt,contactAt=contactAt,exitAt=exitAt,maxDwell=maxDwell,bounces=t.bounceCount,pierces=t.usedPierces or 0,treeDamage=tree.damage,bystanderDamage=bystander.damage}
   check(contactAt>0,"cavalry actually contacts the moving tree")
   check(exitAt>contactAt and exitAt-contactAt<.4 and maxDwell<.4,"cavalry crosses the tree instead of orbiting its centre")
   check(t.bounceCount>=4,"post-contact cavalry continues to reach and rebound from walls")
   check(not t.alive and S.expired==1 and S.contactDeaths==0,"unspent pierces survive until normal lifetime expiry")
   check(tree.damage==initialDamage,"the same troop cannot repeatedly damage the same tree")
   check(t.targetId==(locked and tree.id or 0),"damage ownership remains captured at launch")
   if locked then check(bystander.damage==0 and S.lockViolations==0,"LOCK does not damage or retarget bystanders")
   else check(bystander.damage>0,"AUTO-only cavalry still pierces other monsters behind its aim target")end
  end
 end
 -- All reusable piercing sources share the fix, including a spear's post-spin contact.
 for _,k in ipairs({1,2})do
  reset();beginBattle();monsters={};frame=1;S.hordeAt=-1;S.selected=k
  S.skillSources[k]={{id="pierce"}};S.autoEnabled=true;S.lockEnabled=true;S.autoTargets={elder=true}
  addMonster(4,0,1);local tree=monsters[1];tree.guard=1e9;tree.angle=0;tree.turn=100
  targeting(api);local t=troops[1];local exitAt=0;local contactAt=0
  for _=1,300 do
   updateCombat(1/60)
   if t.hits[tree.id] and contactAt==0 then contactAt=t.age end
   if contactAt>0 and exitAt==0 and (t.x-tree.x)^2+(t.z-tree.z)^2>(.4+tree.scale*.5)^2 then exitAt=t.age end
  end
  check(contactAt>0 and exitAt>contactAt and exitAt-contactAt<.65,"equipment pierce exits target for unit "..k)
  check(S.contactHits==1 and t.targetId==tree.id,"one primary contact and exclusive target for unit "..k)
  if k==2 then check(S.spinHits==1,"spear still spins once before its separate primary contact")end
 end
 -- Losing a target in flight does not redirect an already deployed LOCK troop.
 reset();beginBattle();monsters={};frame=1;S.hordeAt=-1;S.selected=3
 S.autoEnabled=true;S.lockEnabled=true;S.autoTargets={elder=true}
 addMonster(4,0,-3);local first=monsters[1];first.guard=1e9
 targeting(api);local t=troops[1];first.alive=false
 addMonster(4,5,-3);monsters[2].guard=1e9
 for _=1,90 do updateCombat(1/60)end
 check(t.targetId==first.id and S.contactHits==0 and monsters[2].damage==0,"dead target cannot unlock or redirect an existing troop")
 check(t.bounceCount>0,"troop whose target died keeps moving to the wall")
 reset();publish(api);api.observation.set("tracking_checks",checks);api.observation.set("tracking_reports",reports)
end
