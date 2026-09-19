-- Game-owned skill lifecycle. Bundled by tools/build-skills.mjs; no renderer callbacks.
local function createSkillRuntime(hooks:any)
 local R:any={clock=0,serial=0,units={},casts={},entities={},buffs={},events={},statusViews={}}
 R.definitions={
  flame_cloak={modifier="flameCloak",windup=.28,release=.08,channel=true,ending=.18,period=.8,radius=2,damage=.18},
  phoenix_fire={modifier="phoenixFire",windup=.28,release=.08,channel=.20,ending=.18,period=1.8,range=6,targets=3,flight=.38,duration=3,interval=.75,damage=.16},
  plague_vial={modifier="plagueVial",windup=.12,release=.06,channel=0,ending=.18,distance=6,throw=1.5,flight=.45,radius=1.8,duration=3,linger=2,interval=.5,damage=.10,maxClouds=4},
 }
 local function id()R.serial+=1;return R.serial end
 local function allowed(t:any,m:any)return m.alive and (t.targetId==0 or t.targetId==m.id)end
 local function event(domain:string,kind:string,phase:string,ref:any,reason:string?)
  R.events[#R.events+1]={id=id(),domain=domain,kind=kind,phase=phase,refId=ref.id,time=R.clock,x=ref.x,z=ref.z,sourceId=ref.owner and ref.owner.visualId or ref.sourceId,targetId=ref.target and ref.target.id or nil,reason=reason}
  if #R.events>128 then table.remove(R.events,1)end
 end
 local function stage(ref:any,domain:string,phase:string,reason:string?)ref.phase=phase;ref.since=R.clock;event(domain,ref.kind,phase,ref,reason)end
 local function damage(m:any,amount:number,owner:any,kind:string)
  if hooks.active() and allowed(owner,m)then hooks.damage(m,amount,owner,kind)end
 end
 local function strength(t:any,kind:string)
  local d=R.definitions[kind];return 1+math.min(1,math.max(0,(t.skills[d.modifier] or 1)-1)*.25)
 end
 local function area(t:any,r:number)return r*(1+math.min(.6,t.skills.areaBonus or 0))end
 local function areaDamage(t:any,d:number)return t.damage*d*math.max(.5,1-(t.skills.areaPenalty or 0))end
 local function addBuff(kind:string,m:any,t:any,amount:number,duration:number,interval:number,ignoreElements:boolean?)
  if not allowed(t,m)then return end
  if kind=="burn"and not ignoreElements and R.elements then R.elements:touch("fire",t,m.x,m.z,m)end
  if not hooks.active()or not allowed(t,m)then return end
  local key=tostring(m.id)..":"..kind;local b=R.buffs[key]
  if b and b.phase=="expire"then b=nil end
  if b then
   -- One global timer per status/monster. Refresh never resets tick cadence.
   b.untilTime=math.max(b.untilTime,R.clock+duration)
   if amount>b.damage then b.damage=amount;b.owner=t end
   if R.clock-(b.refreshed or b.since)>=.4 then b.refreshed=R.clock;event("buff",kind,"refresh",b)end
  else
   b={id=id(),kind=kind,phase="apply",since=R.clock,owner=t,target=m,x=m.x,z=m.z,damage=amount,interval=interval,nextTick=R.clock+interval,untilTime=R.clock+duration}
   R.buffs[key]=b;event("buff",kind,"apply",b)
  end
 end
 R.composition=createCompositionRuntime({clock=function()return R.clock end,active=hooks.active,monsters=hooks.monsters,wallX=hooks.wallX,damage=hooks.damage})
 R.elements=createElementRuntime({clock=function()return R.clock end,active=hooks.active,monsters=hooks.monsters,wallX=hooks.wallX,wallZ=hooks.wallZ,damage=hooks.damage,
  burn=function(m:any,amount:number,t:any,duration:number,interval:number)addBuff("burn",m,t,amount,duration,interval,true)end,
  shock=function(m:any,amount:number,t:any,duration:number,interval:number)addBuff("electrified",m,t,amount,duration,interval,true)end})
 R.triggers=createTriggerRuntime({clock=function()return R.clock end,active=hooks.active,monsters=hooks.monsters,troops=hooks.troops or function()return {}end,damage=hooks.damage,gold=hooks.gold or function()end,random=hooks.random})
 R.resonance=createResonanceRuntime({clock=function()return R.clock end,active=hooks.active,monsters=hooks.monsters,damage=hooks.damage})
 function R:spawn(t:any)self.composition:attach(t);self.triggers:attach(t)end
 function R:onDamage(t:any,m:any,info:any)self.composition:onDamage(t,m,info);self.resonance:onDamage(t,m,info);self.triggers:onDamage(t,m,info);self.elements:onDamage(t,m,info)end
 function R:onDeath(t:any,reason:string,x:number?,z:number?)self.resonance:death(t,reason,x,z);self.triggers:death(t,reason,x,z);self.elements:death(t,reason,x,z)end
 function R:onEnemyDeath(t:any,m:any,info:any)self.triggers:enemyDeath(t,m,info)end
 function R:flush()self.triggers:flush();self.elements:flush();self.composition:flush();if not hooks.active()then self:clear("round_end")end end
 function R:slowMultiplier(m:any)
  local shock=self.buffs[tostring(m.id)..":electrified"]
  return math.min(self.elements:slowMultiplier(m),shock and shock.phase~="expire"and shock.untilTime>self.clock and .65 or 1)
 end
 local function entity(kind:string,t:any,x:number,z:number,tx:number,tz:number,target:any?)
  local d=R.definitions[kind];local e:any={id=id(),kind=kind,owner=t,x=x,z=z,ox=x,oz=z,tx=tx,tz=tz,target=target,radius=area(t,d.radius or .35),power=strength(t,kind),born=R.clock}
  R.entities[#R.entities+1]=e;stage(e,"effect","spawn");return e
 end
 local function cast(kind:string,t:any,x:number?,z:number?,dx:number?,dz:number?)
  local c:any={id=id(),kind=kind,owner=t,x=x or t.x,z=z or t.z,dx=dx or t.dx,dz=dz or t.dz,power=strength(t,kind)}
  R.casts[#R.casts+1]=c;stage(c,"cast","windup");return c
 end
 function R:attach(t:any)
  self.composition:attach(t);self.triggers:attach(t)
  if self.units[t.visualId]then return end
  self.units[t.visualId]={owner=t,nextPhoenix=self.clock,distance=0}
  if (t.skills.flameCloak or 0)>0 then cast("flame_cloak",t)end
 end
 function R:moved(t:any,ox:number,oz:number,x:number,z:number,skipTriggers:boolean?)
  self.composition:moved(t,ox,oz,x,z)
  if not skipTriggers then self.resonance:moved(t,ox,oz,x,z)end
  if not skipTriggers then self.triggers:moved(t,ox,oz,x,z)end
  self.elements:moved(t,ox,oz,x,z)
  if not t.alive or (t.skills.plagueVial or 0)<=0 or t.state=="airborne" then return end
  self:attach(t);local u=self.units[t.visualId];local d=self.definitions.plague_vial
  local length=math.sqrt((x-ox)^2+(z-oz)^2);if length<1e-8 then return end
  local offset=d.distance-u.distance
  while offset<=length+1e-8 do
   local q=math.min(1,offset/length);cast("plague_vial",t,ox+(x-ox)*q,oz+(z-oz)*q,(x-ox)/length,(z-oz)/length)
   offset+=d.distance
  end
  u.distance=(u.distance+length)%d.distance
  if u.distance<1e-8 or d.distance-u.distance<1e-8 then u.distance=0 end
 end
 local function release(c:any)
  local t,d=c.owner,R.definitions[c.kind]
  if c.kind=="flame_cloak" then c.nextTick=R.clock+R.composition:period(t,d.period);c.radius=area(t,d.radius)
  elseif c.kind=="phoenix_fire" then
   local choices={};for _,m in ipairs(hooks.monsters())do if allowed(t,m) and (m.x-t.x)^2+(m.z-t.z)^2<=d.range^2 then choices[#choices+1]=m end end
   table.sort(choices,function(a:any,b:any)return a.id<b.id end)
   for _=1,math.min(d.targets,#choices)do
    local pick=math.min(#choices,1+math.floor(hooks.random()*#choices));local m=table.remove(choices,pick)
    entity(c.kind,t,t.x,t.z,m.x,m.z,m)
   end
  else
   entity(c.kind,t,c.x,c.z,math.clamp(c.x+c.dx*d.throw,-hooks.wallX,hooks.wallX),math.clamp(c.z+c.dz*d.throw,-hooks.wallZ,hooks.wallZ))
  end
 end
 function R:update(dt:number,live:any)
  if not hooks.active()then self:clear("round_end");return end
  self.clock+=dt
  self.triggers:update(live)
  self.resonance:update(dt,live)
  self.composition:update(dt,live)
  local present={}
  for _,t in ipairs(live)do if t.alive then
   self:attach(t);present[t.visualId]=true;local u=self.units[t.visualId]
   if (t.skills.phoenixFire or 0)>0 and self.clock>=u.nextPhoenix then cast("phoenix_fire",t);u.nextPhoenix=self.clock+self.composition:period(t,self.definitions.phoenix_fire.period) end
  end end
  -- A recalled source is also absent. Mark it dead so lingering DoTs cannot revive it.
  for unitId,u in pairs(self.units)do if not present[unitId]then u.owner.alive=false;self.units[unitId]=nil end end
  for i=#self.casts,1,-1 do
   local c=self.casts[i];local d=self.definitions[c.kind];local t=c.owner
   if not t.alive and c.phase~="end"then stage(c,"cast","end","source_gone")end
   if c.kind~="plague_vial"then c.x=t.x;c.z=t.z end
   local elapsed=self.clock-c.since
   if c.phase=="windup" and elapsed+1e-8>=d.windup then
    stage(c,"cast","release");release(c)
   elseif c.phase=="release" and elapsed+1e-8>=d.release then stage(c,"cast",d.channel==0 and "end" or "channel")
   elseif c.phase=="channel" then
    if d.channel==true then
     while self.clock+1e-8>=c.nextTick and hooks.active()do
      c.nextTick+=self.composition:period(t,d.period);event("cast",c.kind,"pulse",c)
      for _,m in ipairs(hooks.monsters())do if allowed(t,m) and (m.x-t.x)^2+(m.z-t.z)^2<=c.radius^2 then damage(m,areaDamage(t,d.damage)*c.power,t,c.kind)end end
     end
    elseif elapsed+1e-8>=d.channel then stage(c,"cast","end")end
   elseif c.phase=="end" and elapsed>=d.ending then table.remove(self.casts,i)end
  end
  for i=#self.entities,1,-1 do
   local e=self.entities[i];local d=self.definitions[e.kind];local elapsed=self.clock-e.since
   if e.phase=="spawn"then stage(e,"effect","flight")
   elseif e.phase=="flight" then
    if e.target and not e.target.alive then stage(e,"effect","death","target_gone")
    else
     if e.target then e.tx=e.target.x;e.tz=e.target.z end
     local p=math.min(1,elapsed/d.flight);e.x=e.ox+(e.tx-e.ox)*p;e.z=e.oz+(e.tz-e.oz)*p;e.y=math.sin(p*math.pi)*(e.kind=="plague_vial" and 1.4 or .55)+.4
     if p>=1 then
      if e.kind=="phoenix_fire"then addBuff("burn",e.target,e.owner,e.owner.damage*d.damage*e.power,d.duration,d.interval);stage(e,"effect","death","impact")
      else
       -- Per-source persistent field budget is a declared gameplay rule.
       local clouds={};for _,other in ipairs(self.entities)do if other~=e and other.kind==e.kind and other.owner==e.owner and other.phase=="active"then clouds[#clouds+1]=other end end
       table.sort(clouds,function(a:any,b:any)return a.id<b.id end)
       for n=1,math.max(0,#clouds-d.maxClouds+1)do stage(clouds[n],"effect","death","replaced")end
       e.y=.1;e.nextScan=self.clock;stage(e,"effect","active")
      end
     end
    end
   elseif e.phase=="active" then
    if elapsed>=d.duration then stage(e,"effect","death","expired")
    elseif self.clock+1e-8>=e.nextScan then
     e.nextScan=self.clock+.1
     for _,m in ipairs(hooks.monsters())do if allowed(e.owner,m) and (m.x-e.x)^2+(m.z-e.z)^2<=e.radius^2 then addBuff("poison",m,e.owner,areaDamage(e.owner,d.damage)*e.power,d.linger,d.interval)end end
    end
   elseif e.phase=="death" and elapsed>=.32 then table.remove(self.entities,i)end
  end
  -- Explicit order keeps simultaneous DoT breaks and payout attribution reproducible.
  local ordered={};for key,b in pairs(self.buffs)do ordered[#ordered+1]={key=key,b=b}end
  table.sort(ordered,function(a:any,b:any)return a.b.id<b.b.id end)
  for _,entry in ipairs(ordered)do
   local b=entry.b;local m=b.target;b.x=m.x;b.z=m.z
   if b.phase=="expire"then if self.clock-b.since>=.25 then self.buffs[entry.key]=nil end
   else
    if b.phase=="apply" and self.clock-b.since>=.15 then stage(b,"buff","active")end
    while m.alive and self.clock+1e-8>=b.nextTick and b.nextTick<=b.untilTime+1e-8 and hooks.active()do
     b.nextTick+=b.interval;damage(m,b.damage,b.owner,b.kind);event("buff",b.kind,"tick",b)
    end
    if not m.alive or self.clock>=b.untilTime then stage(b,"buff","expire",m.alive and "expired" or "target_gone")end
   end
  end
  self.elements:update()
  if not hooks.active()then self:clear("round_end")end
  local visible={}
  if hooks.active() and hooks.statuses then for _,status in ipairs(hooks.statuses())do
   visible[status.key]=true;local b=self.statusViews[status.key]
   if not b or b.phase=="expire" then b={id=id(),kind=status.kind,phase="apply",since=self.clock,sourceId=status.sourceId,targetId=status.targetId};self.statusViews[status.key]=b end
   b.x=status.x;b.z=status.z;b.remaining=status.remaining
   if self.clock-b.since>.15 then b.phase="active"end
  end end
  for key,b in pairs(self.statusViews)do if not visible[key]then
   if b.phase~="expire"then b.phase="expire";b.since=self.clock elseif self.clock-b.since>.25 then self.statusViews[key]=nil end
  end end
 end
 function R:hasPendingDamage()
  if self.composition:hasPendingDamage()then return true end
  if self.resonance:hasPendingDamage()then return true end
  if self.triggers:hasPendingDamage()then return true end
  if self.elements:hasPendingDamage()then return true end
  for _,e in ipairs(self.entities)do if e.phase~="death"then return true end end
  for _,b in pairs(self.buffs)do if b.phase~="expire"then return true end end
  return false
 end
 function R:clear(reason:string)
  self.composition:clear()
  self.resonance:clear()
  self.triggers:clear()
  self.elements:clear()
  for _,c in ipairs(self.casts)do if c.phase~="end"then stage(c,"cast","end",reason)end end
  for _,e in ipairs(self.entities)do if e.phase~="death"then stage(e,"effect","death",reason)end end
  for _,b in pairs(self.buffs)do if b.phase~="expire"then stage(b,"buff","expire",reason)end end
  self.units={};self.casts={};self.entities={};self.buffs={};self.statusViews={}
 end
 function R:reset()self:clear("reset");self.elements:reset();self.triggers:reset();self.resonance:reset();self.composition:reset();self.clock=0;self.serial=0;self.events={}end
 function R:view()
  local v:any={clock=self.clock,casts={},entities={},buffs={},events=self.events,elements=self.elements:view(),triggers=self.triggers:view(),resonance=self.resonance:view(),composition=self.composition:view()}
  local function copy(ref:any)
   local d=self.definitions[ref.kind];local duration=d and (ref.phase=="windup" and d.windup or ref.phase=="release" and d.release or ref.phase=="channel" and type(d.channel)=="number" and d.channel or ref.phase=="end" and d.ending or ref.phase=="flight" and d.flight or ref.phase=="active" and d.duration) or nil
   return {id=ref.id,kind=ref.kind,phase=ref.phase,since=ref.since,age=self.clock-ref.since,x=ref.x,z=ref.z,y=ref.y or .1,tx=ref.tx,tz=ref.tz,radius=ref.radius or d and d.radius or .7,sourceId=ref.owner.visualId,playerId=ref.owner.playerId,targetId=ref.target and ref.target.id or nil,progress=duration and math.min(1,(self.clock-ref.since)/duration) or nil,remaining=ref.untilTime and math.max(0,ref.untilTime-self.clock) or nil}
  end
  for _,c in ipairs(self.casts)do v.casts[#v.casts+1]=copy(c)end
  for _,e in ipairs(self.entities)do v.entities[#v.entities+1]=copy(e)end
  for _,b in pairs(self.buffs)do v.buffs[#v.buffs+1]=copy(b)end
  for _,b in pairs(self.statusViews)do v.buffs[#v.buffs+1]={id=b.id,kind=b.kind,phase=b.phase,age=self.clock-b.since,x=b.x,z=b.z,sourceId=b.sourceId,targetId=b.targetId,remaining=b.remaining,radius=.65}end
  table.sort(v.buffs,function(a:any,b:any)return a.id<b.id end)
  return v
 end
 return R
end
