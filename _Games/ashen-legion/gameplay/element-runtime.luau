-- Gameplay-owned elemental surfaces and event dispatch. No rendering or lottery rules here.
local function createElementRuntime(hooks:any)
 local E:any={fields={},statuses={},queue={},events={},serial=0,nextScan=0,reactions=0,triggers={distance=0,damage=0,death=0}}
 E.rules={
  {id="ember_trail",modifier="emberTrail",trigger="distance",action="fire_path",distance=1,duration=3,radius=.48,cap=12},
  {id="slick_oil",modifier="slickOil",trigger="damage",action="coat_oil",primaryOnly=true,duration=3},
  {id="rain_strike",modifier="rainStrike",trigger="damage",action="splash_water",primaryOnly=true,duration=3,radius=1.2,cap=6},
  {id="storm_touch",modifier="stormTouch",trigger="damage",action="strike_lightning",primaryOnly=true,damage=.2},
  {id="oil_legacy",modifier="oilLegacy",trigger="death",action="spill_oil",duration=4,radius=2.2,cap=1},
 }
 E.reactionRules={oilFire={cooldown=1,burnDuration=2.4,burnInterval=.6,burnDamage=.24,burst=.25},waterLightning={cooldown=1.2,range=3,targets=4,damage=.25,duration=1.8,interval=.6,tick=.12},firePath={duration=2,interval=.6,damage=.12}}
 local function now()return hooks.clock()end
 local function id()E.serial+=1;return 1000000+E.serial end
 local function allowed(t:any,m:any)return m.alive and (t.targetId==0 or t.targetId==m.id)end
 local function has(t:any,key:string)return (t.skills[key] or 0)>0 end
 local function scaled(t:any,key:string)return 1+math.min(1,math.max(0,(t.skills[key] or 1)-1)*.25)end
 local function radius(t:any,r:number)return r*(1+math.min(.6,t.skills.areaBonus or 0))end
 local function areaDamage(t:any,d:number)return t.damage*d*math.max(.5,1-(t.skills.areaPenalty or 0))end
 local function signal(kind:string,t:any,x:number,z:number,tx:number?,tz:number?,extra:any?)
  E.events[#E.events+1]={id=id(),kind=kind,sourceId=t.visualId,playerId=t.playerId,x=x,z=z,tx=tx or x,tz=tz or z,time=now(),trigger=extra and extra.trigger,reason=extra and extra.reason}
  if #E.events>128 then table.remove(E.events,1)end
 end
 local function distance2(x:number,z:number,f:any)
  local dx,dz=f.tx-f.ox,f.tz-f.oz;local length=dx*dx+dz*dz
  local p=length>1e-10 and math.clamp(((x-f.ox)*dx+(z-f.oz)*dz)/length,0,1)or 0
  return (x-f.ox-dx*p)^2+(z-f.oz-dz*p)^2
 end
 local function status(m:any,kind:string)
  local s=E.statuses[tostring(m.id)..":"..kind]
  return s and s.untilTime>now()+1e-8 and m.alive and s or nil
 end
 local function removeStatus(m:any,kind:string)E.statuses[tostring(m.id)..":"..kind]=nil end
 local function coat(m:any,kind:string,t:any,duration:number)
  if not allowed(t,m)then return end
  local key=tostring(m.id)..":"..kind;local s=status(m,kind)
  if s then s.untilTime=now()+duration else
   s={id=id(),kind=kind,owner=t,target=m,since=now(),untilTime=now()+duration};E.statuses[key]=s
   signal(kind=="oil" and "oil_apply" or "wet_apply",t,m.x,m.z)
  end
 end
 local function endField(f:any,reason:string)
  if f.phase=="death"then return end
  f.phase="death";f.ended=now();signal("surface_end",f.owner,f.x,f.z,nil,nil,{reason=reason})
 end
 local function addField(kind:string,t:any,ox:number,oz:number,tx:number,tz:number,r:number,duration:number,cap:number,tag:string)
  if not hooks.active()then return end
  ox=math.clamp(ox,-hooks.wallX,hooks.wallX);tx=math.clamp(tx,-hooks.wallX,hooks.wallX)
  oz=math.clamp(oz,-hooks.wallZ,hooks.wallZ);tz=math.clamp(tz,-hooks.wallZ,hooks.wallZ)
  local owned={};for _,f in ipairs(E.fields)do if f.creator==t and f.tag==tag and f.phase=="active"then owned[#owned+1]=f end end
  if tag=="ember_trail"then
   local last=owned[#owned];local dx,dz=tx-ox,tz-oz
   -- Grow straight runs up to four units; never bridge a bounce corner.
   if last and last.kind==kind and (last.tx-ox)^2+(last.tz-oz)^2<1e-8 and (tx-last.ox)^2+(tz-last.oz)^2<=16 and math.abs((last.tx-last.ox)*dz-(last.tz-last.oz)*dx)<1e-6 and (last.tx-last.ox)*dx+(last.tz-last.oz)*dz>0 then
    last.tx=tx;last.tz=tz;last.x=(last.ox+tx)*.5;last.z=(last.oz+tz)*.5;last.untilTime=now()+duration;return last
   end
  end
  table.sort(owned,function(a:any,b:any)return a.id<b.id end)
  for i=1,math.max(0,#owned-cap+1)do endField(owned[i],"replaced")end
  local f:any={id=id(),kind=kind,tag=tag,owner=t,creator=t,ox=ox,oz=oz,tx=tx,tz=tz,x=(ox+tx)*.5,z=(oz+tz)*.5,radius=radius(t,r),phase="active",since=now(),untilTime=now()+duration}
  E.fields[#E.fields+1]=f;return f
 end
 function E:dispatch(trigger:string,t:any,context:any)
  if not hooks.active()then return end
  for _,rule in ipairs(self.rules)do if rule.trigger==trigger and has(t,rule.modifier) and (not context.ruleId or context.ruleId==rule.id)and (not rule.primaryOnly or not context.secondary)then
   self.triggers[trigger]+=1
   local m=context.target;local x,z=context.x or t.x,context.z or t.z
   signal("trigger",t,x,z,nil,nil,{trigger=trigger,reason=rule.id})
   if rule.action=="fire_path" then
    for i=2,#context.path do local a,b=context.path[i-1],context.path[i];addField("fire",t,a.x,a.z,b.x,b.z,rule.radius,rule.duration,rule.cap,rule.id)end
   elseif rule.action=="coat_oil"then coat(m,"oil",t,rule.duration)
   elseif rule.action=="splash_water"then
    coat(m,"wet",t,rule.duration);addField("water",t,x,z,x,z,rule.radius,rule.duration,rule.cap,rule.id)
   elseif rule.action=="strike_lightning"then
    if allowed(t,m)then hooks.damage(m,t.damage*rule.damage*scaled(t,rule.modifier),t,"lightning",false);signal("lightning",t,t.x,t.z,m.x,m.z)end
   elseif rule.action=="spill_oil"then addField("oil",t,x,z,x,z,rule.radius,rule.duration,rule.cap,rule.id);signal("oil_spill",t,x,z)end
  end end
 end
 function E:moved(t:any,ox:number,oz:number,x:number,z:number)
  if not hooks.active()or t.state=="airborne" then return end
  local length=math.sqrt((x-ox)^2+(z-oz)^2);if length<1e-8 then return end
  local dx,dz=(x-ox)/length,(z-oz)/length
  for _,rule in ipairs(self.rules)do if rule.trigger=="distance"and has(t,rule.modifier)then
  local used=0;local threshold=rule.distance
  assert(threshold>0,"distance trigger needs positive threshold")
  t.elementMovement=t.elementMovement or {};local progress=t.elementMovement[rule.id]or {distance=0,path={{x=ox,z=oz}}};t.elementMovement[rule.id]=progress
  while used<length-1e-8 do
   local step=math.min(length-used,threshold-progress.distance);used+=step;progress.distance+=step
   local p={x=ox+dx*used,z=oz+dz*used};local points=progress.path
   if #points>1 then local a,b=points[#points-1],points[#points]
    if math.abs((b.x-a.x)*(p.z-b.z)-(b.z-a.z)*(p.x-b.x))<1e-7 and (b.x-a.x)*(p.x-b.x)+(b.z-a.z)*(p.z-b.z)>=0 then points[#points]=p else points[#points+1]=p end
   else points[#points+1]=p end
   if progress.distance>=threshold-1e-8 then self:dispatch("distance",t,{path=points,x=p.x,z=p.z,ruleId=rule.id});progress.distance=0;progress.path={{x=p.x,z=p.z}}end
  end
  end
  end
 end
 function E:death(t:any,reason:string,x:number?,z:number?)
  if t.elementDeathDone or (reason~="contact" and reason~="expired")then return end
  t.elementDeathDone=true;self:dispatch("death",t,{reason=reason,x=x or t.x,z=z or t.z})
 end
 function E:onDamage(t:any,m:any,info:any)
  if info.reaction or not hooks.active()then return end
  self.queue[#self.queue+1]={t=t,m=m,info=info,x=m.x,z=m.z}
 end
 local function eligibleReaction(m:any,kind:string,cooldown:number)
  m.elementCooldowns=m.elementCooldowns or {}
  if now()<(m.elementCooldowns[kind] or -1)then return false end
  m.elementCooldowns[kind]=now()+cooldown;return true
 end
 local function ignite(m:any,t:any)
  local d=E.reactionRules.oilFire
  if not allowed(t,m)or not status(m,"oil")or not eligibleReaction(m,"ignite",d.cooldown)then return end
  removeStatus(m,"oil");E.reactions+=1;signal("ignite",t,m.x,m.z)
  hooks.burn(m,areaDamage(t,d.burnDamage),t,d.burnDuration,d.burnInterval)
  hooks.damage(m,areaDamage(t,d.burst),t,"ignite",true)
 end
 local function electrify(first:any,t:any)
  local d=E.reactionRules.waterLightning
  if not allowed(t,first)or not status(first,"wet")or not eligibleReaction(first,"conduct",d.cooldown)then return end
  local queue={first};local visited={[first.id]=true};local index=1;local total=0
  while index<=#queue and total<d.targets and hooks.active()do
   local m=queue[index];index+=1
   if allowed(t,m)then
    total+=1;removeStatus(m,"wet");m.elementCooldowns=m.elementCooldowns or {};m.elementCooldowns.conduct=now()+d.cooldown
    E.reactions+=1;hooks.shock(m,areaDamage(t,d.tick),t,d.duration,d.interval)
    local candidates={};for _,other in ipairs(hooks.monsters())do if not visited[other.id]and allowed(t,other)and status(other,"wet")and now()>=(other.elementCooldowns and other.elementCooldowns.conduct or -1)then
     local dist=(other.x-m.x)^2+(other.z-m.z)^2;if dist<=d.range^2 then candidates[#candidates+1]={m=other,d=dist}end
    end end
    table.sort(candidates,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
    for _,candidate in ipairs(candidates)do if #queue>=d.targets then break end;visited[candidate.m.id]=true;queue[#queue+1]=candidate.m;signal("conduct",t,m.x,m.z,candidate.m.x,candidate.m.z)end
    signal("charged",t,m.x,m.z);hooks.damage(m,areaDamage(t,d.damage),t,"conduct",true)
   end
  end
 end
 function E:touch(element:string,t:any,x:number,z:number,m:any?)
  if not hooks.active()then return end
  if m then if element=="fire"then ignite(m,t)elseif element=="lightning"then electrify(m,t)end end
  if not hooks.active()then return end
  -- A fire/lightning hit transforms the connected matching surface component.
  local from,to=element=="fire" and "oil" or "water",element=="fire" and "fire" or "charged_water"
  if element~="fire" and element~="lightning"then return end
  local candidates={};for _,f in ipairs(self.fields)do if f.phase=="active"and f.kind==from and f.untilTime>now()then candidates[#candidates+1]=f end end
  table.sort(candidates,function(a:any,b:any)return a.id<b.id end)
  local queue={};local visited={}
  for _,f in ipairs(candidates)do if distance2(x,z,f)<=f.radius^2 then queue[#queue+1]=f;visited[f.id]=true end end
  local cursor=1
  while cursor<=#queue do
   local f=queue[cursor];cursor+=1;f.kind=to;f.owner=t;f.since=now();f.untilTime=now()+3;f.chargedUntil=to=="charged_water" and now()+1.8 or nil
   signal(to=="fire"and "surface_ignite"or "surface_charge",t,f.x,f.z)
   for _,other in ipairs(candidates)do if not visited[other.id]and (other.x-f.x)^2+(other.z-f.z)^2<=(other.radius+f.radius)^2 then visited[other.id]=true;queue[#queue+1]=other end end
  end
 end
 function E:flush()
  local cursor=1
  while cursor<=#self.queue and hooks.active()do
   local e=self.queue[cursor];cursor+=1
   self:dispatch("damage",e.t,{target=e.m,x=e.x,z=e.z,secondary=e.info.secondary})
   local element=e.info.element
   if element=="fire"or element=="lightning"then self:touch(element,e.t,e.x,e.z,e.m)end
  end
  self.queue={}
 end
 function E:slowMultiplier(m:any)
  return status(m,"oil")and .75 or 1
 end
 function E:update()
  if not hooks.active()then self:clear();return end
  self:flush()
  for i=#self.fields,1,-1 do local f=self.fields[i]
   if f.phase=="death"then if now()-f.ended>.32 then table.remove(self.fields,i)end
   elseif now()>=f.untilTime then endField(f,"expired")
   elseif f.kind=="charged_water"and now()>=f.chargedUntil then f.kind="water";signal("surface_discharge",f.owner,f.x,f.z)end
  end
  for key,s in pairs(self.statuses)do if not s.target.alive or now()>=s.untilTime then self.statuses[key]=nil end end
  if now()+1e-8<self.nextScan then return end;self.nextScan=now()+.1
  -- Spatial buckets bound dense trail/contact work to local surface candidates.
  local grid={};local cell=4
  for _,f in ipairs(self.fields)do if f.phase=="active"then
   for gx=math.floor((math.min(f.ox,f.tx)-f.radius)/cell),math.floor((math.max(f.ox,f.tx)+f.radius)/cell)do
    for gz=math.floor((math.min(f.oz,f.tz)-f.radius)/cell),math.floor((math.max(f.oz,f.tz)+f.radius)/cell)do
     local key=tostring(gx)..":"..gz;grid[key]=grid[key]or {};grid[key][#grid[key]+1]=f
    end
   end
  end end
  -- Oil touching a burning road ignites even if no monster is standing there.
  for _,f in ipairs(self.fields)do if f.phase=="active"and f.kind=="oil"then
   local lit=false
   for gx=math.floor((f.x-f.radius)/cell),math.floor((f.x+f.radius)/cell)do
    for gz=math.floor((f.z-f.radius)/cell),math.floor((f.z+f.radius)/cell)do
     for _,other in ipairs(grid[tostring(gx)..":"..gz]or {})do
      if not lit and other.phase=="active"and other.kind=="fire"and distance2(f.x,f.z,other)<=(f.radius+other.radius)^2 then self:touch("fire",other.owner,f.x,f.z);lit=true end
     end
    end
   end
  end end
  for _,m in ipairs(hooks.monsters())do if m.alive then
   local fields=grid[tostring(math.floor(m.x/cell))..":"..math.floor(m.z/cell)]or {}
   -- Primers precede fire/electric surfaces, independent of field insertion order.
   for _,f in ipairs(fields)do if allowed(f.owner,m)and distance2(m.x,m.z,f)<=f.radius^2 then
    if f.kind=="oil"then coat(m,"oil",f.owner,3)elseif f.kind=="water"or f.kind=="charged_water"then coat(m,"wet",f.owner,3)end
   end end
   for _,f in ipairs(fields)do if allowed(f.owner,m)and distance2(m.x,m.z,f)<=f.radius^2 then
    if f.kind=="fire"then local d=self.reactionRules.firePath;ignite(m,f.owner);hooks.burn(m,areaDamage(f.owner,d.damage)*scaled(f.owner,"emberTrail"),f.owner,d.duration,d.interval)
    elseif f.kind=="charged_water"then electrify(m,f.owner)end
   end end
  end end
  self:flush()
 end
 function E:hasPendingDamage()for _,f in ipairs(self.fields)do if f.phase=="active"and(f.kind=="fire"or f.kind=="charged_water")then return true end end;return false end
 function E:clear()self.fields={};self.statuses={};self.queue={}end
 function E:reset()self:clear();self.events={};self.serial=0;self.nextScan=0;self.reactions=0;self.triggers={distance=0,damage=0,death=0}end
 function E:view()
  local v:any={fields={},statuses={},events=self.events,reactions=self.reactions,triggers=self.triggers}
  for _,f in ipairs(self.fields)do v.fields[#v.fields+1]={id=f.id,kind=f.kind,phase=f.phase,x=f.x,z=f.z,ox=f.ox,oz=f.oz,tx=f.tx,tz=f.tz,radius=f.radius,age=now()-(f.ended or f.since),remaining=math.max(0,f.untilTime-now()),sourceId=f.owner.visualId,playerId=f.owner.playerId}end
  for _,s in pairs(self.statuses)do v.statuses[#v.statuses+1]={id=s.id,kind=s.kind,phase=now()-s.since<.15 and "apply"or "active",x=s.target.x,z=s.target.z,age=now()-s.since,remaining=s.untilTime-now(),targetId=s.target.id,sourceId=s.owner.visualId,playerId=s.owner.playerId}end
  table.sort(v.statuses,function(a:any,b:any)return a.id<b.id end);return v
 end
 return E
end
