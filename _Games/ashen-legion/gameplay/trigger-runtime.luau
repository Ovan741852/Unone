-- Game-owned event rules. Primary hits, real deaths and clocks are separate inputs.
local function createTriggerRuntime(hooks:any)
 local F:any={units={},queue={},events={},counts={},serial=0,wraiths={},ghostSerial=0}
 F.rules={
  {id="plunder",modifier="plunder",trigger="damage",action="gold"},
  {id="firstborn",modifier="firstborn",trigger="spawn",action="rush",duration=3,bonus=1.8},
  {id="march_capacitor",modifier="marchCapacitor",trigger="distance",action="charge",distance=8,cap=2},
  {id="delayed_bloom",modifier="delayedBloom",trigger="age",action="burst",after=2,radius=2.2,damage=.5},
  {id="third_pulse",modifier="thirdPulse",trigger="nth_hit",action="burst",nth=3,radius=1.8,damage=.4},
  {id="battle_elegy",modifier="battleElegy",trigger="ally_death",action="inspire",radius=4,duration=2,bonus=.25},
  {id="grave_bloom",modifier="graveBloom",trigger="enemy_death",action="burst",radius=2.4,damage=.4},
  {id="last_echo",modifier="lastEcho",trigger="life_threshold",action="burst",ratio=.25,radius=2.3,damage=.35},
  {id="legacy_gift",modifier="legacyGift",trigger="death",action="bequeath",bonus=.2,cap=3},
  {id="guard_bequest",modifier="guardBequest",trigger="death",action="burst",radius=2.8,targets=3,guardFraction=.2,damageCap=1},
  {id="necromancer",modifier="necromancer",trigger="death",action="wraith",chance=.38,range=5.8,duration=.34,direct=.34,splash=.16,radius=1.25,targets=3,cap=6},
 }
 local function now()return hooks.clock()end
 local function signal(kind:string,t:any,x:number?,z:number?,radius:number?,targetId:number?,extra:any?)
  F.serial+=1
  F.events[#F.events+1]={id=F.serial,kind=kind,sourceId=t.visualId,playerId=t.playerId,targetId=targetId,time=now(),x=x or t.x,z=z or t.z,radius=radius or .6}
  if extra then for k,v in pairs(extra)do F.events[#F.events][k]=v end end
  if #F.events>96 then table.remove(F.events,1)end
 end
 function F:dispatch(trigger:string,t:any,c:any)
  if not hooks.active()then return end
  for _,r in ipairs(self.rules)do if r.trigger==trigger and (not c.ruleId or c.ruleId==r.id) and (t.skills[r.modifier]or 0)>0 then
   local eligible=true;local recipient:any=nil
   if r.action=="wraith"then
    local x,z=c.x or t.x,c.z or t.z;local nearest:any=nil;local best=r.range*r.range
    for _,m in ipairs(hooks.monsters())do if m.alive and(t.targetId==0 or t.targetId==m.id)then
     local d=(m.x-x)^2+(m.z-z)^2
     if d<=best and(not nearest or d<best or d==best and m.id<nearest.id)then nearest=m;best=d end
    end end
    c.wraithTarget=nearest
    local owned=0;for _,g in ipairs(self.wraiths)do if g.owner.playerId==t.playerId then owned+=1 end end
    eligible=nearest~=nil and owned<r.cap and hooks.random()<r.chance
   end
   if trigger=="damage"or trigger=="nth_hit"then eligible=not c.secondary and (c.amount or 0)>0 end
   if r.nth then eligible=eligible and (t.mainHits or 0)>0 and t.mainHits%r.nth==0 end
   if trigger=="ally_death"then eligible=t.alive and t~=c.source and t.playerId==c.source.playerId and (t.x-c.x)^2+(t.z-c.z)^2<=r.radius^2 end
   if r.action=="bequeath"then
    local choices={}
    for _,other in ipairs(hooks.troops())do
     if other~=t and other.alive and other.playerId==t.playerId and (not other.life or (other.age or 0)<other.life) and (other.legacyStacks or 0)<r.cap then choices[#choices+1]=other end
    end
    table.sort(choices,function(a:any,b:any)return a.visualId<b.visualId end)
    eligible=#choices>0
    if eligible then recipient=choices[math.clamp(1+math.floor(hooks.random()*#choices),1,#choices)]end
   end
   if eligible then
    self.counts[r.id]=(self.counts[r.id]or 0)+1
    if r.action=="gold"then hooks.gold(t,c.target,1)
    elseif r.action=="charge"then
     local before=t.marchCharges or 0;t.marchCharges=math.min(r.cap,before+1)
     if t.marchCharges>before then signal(r.id,t)end
    elseif r.action=="inspire"then t.elegyUntil=now()+r.duration;signal(r.id,t,nil,nil,r.radius,c.source.visualId)
    elseif r.action=="bequeath"then
     -- The fixed gift does not copy skills, price, lifetime or inherited stacks.
     recipient.legacyStacks=(recipient.legacyStacks or 0)+1
     signal(r.id,t,c.x,c.z,.7,recipient.visualId,{tx=recipient.x,tz=recipient.z,stacks=recipient.legacyStacks})
    elseif r.action=="wraith"then
     local target=c.wraithTarget;local x,z=c.x or t.x,c.z or t.z
     self.ghostSerial+=1
     local g:any={id=self.ghostSerial,owner=t,target=target,x=x,z=z,ox=x,oz=z,tx=target.x,tz=target.z,dx=target.x-x,dz=target.z-z,born=now(),duration=r.duration,direct=r.direct,splash=r.splash,radius=r.radius*(1+math.min(.6,t.skills.areaBonus or 0)),splashScale=math.max(.5,1-(t.skills.areaPenalty or 0)),targets=r.targets,range=r.range,progress=0}
     self.wraiths[#self.wraiths+1]=g
     signal("necromancer",t,x,z,r.radius,target.id,{tx=target.x,tz=target.z,ghostId=g.id})
    elseif r.action=="burst"then
     self.queue[#self.queue+1]={rule=r,owner=t,x=c.x or t.x,z=c.z or t.z}
    else signal(r.id,t)end
   end
  end end
 end
 function F:attach(t:any)
  if self.units[t.visualId]then return end
  self.units[t.visualId]={owner=t,distances={},timers={}}
  if not t.triggerBorn then
   t.triggerBorn=true;t.lifeScale=(t.skills.plunder or 0)>0 and .5 or 1
   if t.life then t.life*=t.lifeScale end
   self:dispatch("spawn",t,{})
  end
 end
 function F:speedBonus(t:any,age:number?)
  if (t.skills.firstborn or 0)<=0 then return 0 end
  return 1.8*math.min(1.5,1+((t.skills.firstborn or 1)-1)*.25)*math.max(0,1-(age or t.age or 0)/3)
 end
 function F:movementBonus(t:any,dt:number)
  if (t.skills.firstborn or 0)<=0 or dt<=0 then return 0 end
  local a=math.max(0,(t.age or 0)-dt);local b=math.max(a,t.age or 0)
  local function integral(x:number)local v=math.min(3,x);return v-v*v/6 end
  return 1.8*math.min(1.5,1+((t.skills.firstborn or 1)-1)*.25)*(integral(b)-integral(a))/dt
 end
 function F:consumeDamageBonus(t:any)
  local charges=t.marchCharges or 0;t.marchCharges=0
  return charges*.3+((t.elegyUntil or 0)>now()and .25 or 0)+math.min(3,t.legacyStacks or 0)*.2
 end
 function F:onDamage(t:any,m:any,c:any)
  self:dispatch("damage",t,{target=m,amount=c.amount,secondary=c.secondary})
  self:dispatch("nth_hit",t,{x=m.x,z=m.z,amount=c.amount,secondary=c.secondary})
 end
 function F:moved(t:any,ox:number,oz:number,x:number,z:number)
  if not hooks.active()or t.state=="airborne"then return end
  local length=math.sqrt((x-ox)^2+(z-oz)^2);if length<1e-8 then return end
  for _,r in ipairs(self.rules)do if r.trigger=="distance"and(t.skills[r.modifier]or 0)>0 then
   self:attach(t);local u=self.units[t.visualId];local previous=u.distances[r.id]or 0
   local step=r.distance-previous
   while step<=length+1e-8 do
    local q=math.min(1,step/length);self:dispatch("distance",t,{ruleId=r.id,x=ox+(x-ox)*q,z=oz+(z-oz)*q});step+=r.distance
   end
   local remainder=(previous+length)%r.distance
   u.distances[r.id]=(remainder<1e-8 or r.distance-remainder<1e-8)and 0 or remainder
  end end
 end
 function F:death(t:any,reason:string,x:number?,z:number?)
  if not hooks.active()or(reason~="contact"and reason~="expired")or t.triggerDeathDone then return end
  t.triggerDeathDone=true
  local c={source=t,x=x or t.x,z=z or t.z}
  self:dispatch("death",t,c)
  for _,other in ipairs(hooks.troops())do if other.alive then self:dispatch("ally_death",other,c)end end
 end
 function F:enemyDeath(t:any,m:any,c:any)
  if not hooks.active()or m.triggerDeathDone then return end
  m.triggerDeathDone=true
  -- DoT kills qualify, but triggered bursts/reactions cannot start another death chain.
  if c.reaction or c.triggered then return end
  self:dispatch("enemy_death",t,{x=m.x,z=m.z})
 end
 function F:update(live:any)
  local present={}
  for _,t in ipairs(live)do if t.alive then
   self:attach(t);present[t.visualId]=true;local u=self.units[t.visualId]
   for _,r in ipairs(self.rules)do
    if (t.skills[r.modifier]or 0)>0 and not u.timers[r.id] and ((r.trigger=="age"and(t.age or 0)>=r.after)or(r.trigger=="life_threshold"and t.life and(t.age or 0)>=t.life*(1-r.ratio)))then
     u.timers[r.id]=true;self:dispatch(r.trigger,t,{ruleId=r.id})
    end
   end
  end end
  for i=#self.wraiths,1,-1 do
   local g=self.wraiths[i];local t=g.owner
   if g.target and not g.target.alive then
    local nearest:any=nil;local best=2.4^2
    for _,m in ipairs(hooks.monsters())do if m.alive and(t.targetId==0 or t.targetId==m.id)then
     local dist=(m.x-g.x)^2+(m.z-g.z)^2
     if dist<=best and(not nearest or dist<best or dist==best and m.id<nearest.id)then nearest=m;best=dist end
    end end
    g.target=nearest
   end
   if g.target and g.target.alive then g.tx=g.target.x;g.tz=g.target.z end
   local p=math.clamp((now()-g.born)/g.duration,0,1)
   g.x=g.ox+(g.tx-g.ox)*p;g.z=g.oz+(g.tz-g.oz)*p;g.progress=p
   local length=math.sqrt((g.tx-g.ox)^2+(g.tz-g.oz)^2)
   if length>1e-8 then g.dx=(g.tx-g.ox)/length;g.dz=(g.tz-g.oz)/length end
   if p>=1 then
    signal("necromancer_burst",t,g.x,g.z,g.radius,g.target and g.target.alive and g.target.id or nil,{ghostId=g.id})
    local candidates={}
    for _,m in ipairs(hooks.monsters())do if m.alive and(t.targetId==0 or t.targetId==m.id)then
     local dist=(m.x-g.x)^2+(m.z-g.z)^2;if dist<=g.radius*g.radius then candidates[#candidates+1]={m=m,d=dist}end
    end end
    table.sort(candidates,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
    for n=1,math.min(g.targets,#candidates)do
     if not hooks.active()then break end
     hooks.damage(candidates[n].m,t.damage*(n==1 and g.direct or g.splash*g.splashScale),t,"soul_wraith",false)
    end
    table.remove(self.wraiths,i)
   end
  end
  for id in pairs(self.units)do if not present[id]then self.units[id]=nil end end
  for i=#self.events,1,-1 do if now()-self.events[i].time>1 then table.remove(self.events,i)end end
 end
 function F:flush()
  local jobs=self.queue;self.queue={}
  for _,job in ipairs(jobs)do
   if not hooks.active()then break end
   local t,r=job.owner,job.rule;local radius=r.radius*(1+math.min(.6,t.skills.areaBonus or 0))
   signal(r.id,t,job.x,job.z,radius)
   local candidates={}
   for _,m in ipairs(hooks.monsters())do if m.alive and(t.targetId==0 or t.targetId==m.id)then
    local d=(m.x-job.x)^2+(m.z-job.z)^2;if d<=radius^2 then candidates[#candidates+1]={m=m,d=d}end
   end end
   table.sort(candidates,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
   for i=1,math.min(r.targets or 4,#candidates)do
    if not hooks.active()then break end
    local m=candidates[i].m
    if r.id=="last_echo"then m.slow=math.max(m.slow or 0,1.5)end
    local amount=r.guardFraction and math.min(m.guard*r.guardFraction,t.damage*r.damageCap)or t.damage*r.damage
    hooks.damage(m,amount*math.max(.5,1-(t.skills.areaPenalty or 0)),t,r.id)
   end
  end
 end
 function F:hasPendingDamage()return #self.queue>0 or #self.wraiths>0 end
 function F:view()
  local buffs={};local wraiths={}
  for _,g in ipairs(self.wraiths)do wraiths[#wraiths+1]={id=g.id,sourceId=g.owner.visualId,playerId=g.owner.playerId,x=g.x,z=g.z,tx=g.tx,tz=g.tz,dx=g.dx,dz=g.dz,progress=g.progress,targetId=g.target and g.target.id or nil,radius=g.radius}end
  for _,u in pairs(self.units)do local t=u.owner
   if t.alive then
    local speed=self:speedBonus(t)
    if speed>0 then buffs[#buffs+1]={kind="firstborn",sourceId=t.visualId,x=t.x,z=t.z,remaining=math.max(0,3-(t.age or 0)),strength=speed/1.8}end
    if(t.marchCharges or 0)>0 then buffs[#buffs+1]={kind="march_capacitor",sourceId=t.visualId,x=t.x,z=t.z,stacks=t.marchCharges}end
    if(t.elegyUntil or 0)>now()then buffs[#buffs+1]={kind="battle_elegy",sourceId=t.visualId,x=t.x,z=t.z,remaining=t.elegyUntil-now()}end
    if(t.legacyStacks or 0)>0 then buffs[#buffs+1]={kind="legacy_gift",sourceId=t.visualId,x=t.x,z=t.z,stacks=t.legacyStacks,remaining=math.max(0,(t.life or 0)-(t.age or 0))}end
   end
  end
  table.sort(buffs,function(a:any,b:any)return a.sourceId<b.sourceId or a.sourceId==b.sourceId and a.kind<b.kind end)
  return {events=self.events,counts=self.counts,buffs=buffs,wraiths=wraiths}
 end
 function F:clear()self.units={};self.queue={};self.events={};self.wraiths={}end
 function F:reset()self:clear();self.counts={};self.serial=0;self.ghostSerial=0 end
 return F
end
