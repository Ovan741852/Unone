-- Delayed skills own their clocks, geometry, attribution and finite chain budgets.
local function createResonanceRuntime(hooks:any)
 local L:any={jobs={},ghosts={},events={},counts={},serial=0}
 L.definitions={
  cinder_seal={modifier="cinderSeal",delay=1.2,radius=1.8,damage=.6,targets=4},
  chain_fuse={modifier="chainFuse",delay=1.8,radius=2.1,damage=.5,targets=4,links=6,step=.12},
  thunder_fan={modifier="thunderFan",delay=.18,range=4.8,angle=math.rad(100),damage=.45,targets=5},
  echo_blade={modifier="echoBlade",delay=.55,radius=.55,damage=.55,targets=4},
  starfall={modifier="starfall",after=2.8,delay=.65,radius=1.5,damage=.4,targets=3},
  soul_return={modifier="soulReturn",range=12,speed=20,radius=.5,damage=.4,targets=4},
 }
 local function now()return hooks.clock()end
 local function id()L.serial+=1;return L.serial end
 local function valid(t:any,m:any)return m.alive and(t.targetId==0 or t.targetId==m.id)end
 local function owner(t:any)return t.playerId or 1 end
 local function event(kind:string,j:any,extra:any?)
  local e={id=id(),kind=kind,x=j.x,z=j.z,radius=j.radius or .6,time=now(),sourceId=j.owner.visualId,playerId=owner(j.owner)}
  if extra then for k,v in pairs(extra)do e[k]=v end end
  L.events[#L.events+1]=e;if #L.events>160 then table.remove(L.events,1)end
 end
 local function radius(t:any,r:number)return r*(1+math.min(.6,t.skills.areaBonus or 0))end
 local function damage(t:any,m:any,d:number,kind:string)
  if hooks.active()and valid(t,m)then hooks.damage(m,t.damage*d*math.max(.5,1-(t.skills.areaPenalty or 0)),t,kind)end
 end
 local function schedule(kind:string,t:any,x:number,z:number,extra:any?)
  local d=L.definitions[kind];local j:any={id=id(),kind=kind,owner=t,x=x,z=z,born=now(),due=now()+d.delay,radius=radius(t,d.radius or .7)}
  if extra then for k,v in pairs(extra)do j[k]=v end end
  -- A finite per-player/per-kind pool; old marks fizzle rather than detonate early.
  local candidates={};for _,old in ipairs(L.jobs)do if old.kind==kind and owner(old.owner)==owner(t)then candidates[#candidates+1]=old end end
  if #candidates>=24 then
   local oldest=candidates[1];for _,old in ipairs(candidates)do if old.id<oldest.id then oldest=old end end
   for i,old in ipairs(L.jobs)do if old==oldest then table.remove(L.jobs,i);break end end
  end
  L.jobs[#L.jobs+1]=j;L.counts[kind]=(L.counts[kind]or 0)+1;return j
 end
 local function circle(j:any)
  local d=L.definitions[j.kind];local list={}
  for _,m in ipairs(hooks.monsters())do if valid(j.owner,m)then
   local dist=(m.x-j.x)^2+(m.z-j.z)^2;if dist<=j.radius^2 then list[#list+1]={m=m,d=dist}end
  end end
  table.sort(list,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
  for i=1,math.min(d.targets,#list)do damage(j.owner,list[i].m,d.damage,j.kind)end
 end
 local function segmentDistance(m:any,ax:number,az:number,bx:number,bz:number)
  local dx,dz=bx-ax,bz-az;local q=math.clamp(((m.x-ax)*dx+(m.z-az)*dz)/math.max(1e-12,dx*dx+dz*dz),0,1)
  return (m.x-ax-dx*q)^2+(m.z-az-dz*q)^2,q
 end
 function L:onDamage(t:any,m:any,info:any)
  if not hooks.active()or info.secondary or(info.amount or 0)<=0 then return end
  for _,kind in ipairs({"cinder_seal","chain_fuse"})do local d=self.definitions[kind]
   if(t.skills[d.modifier]or 0)>0 then
    local exists=false;for _,j in ipairs(self.jobs)do if j.kind==kind and j.target==m and owner(j.owner)==owner(t)then exists=true;break end end
    if not exists then schedule(kind,t,m.x,m.z,{target=m})end
   end
  end
  if(t.skills.thunderFan or 0)>0 and (t.mainHits or 0)%3==0 then
   schedule("thunder_fan",t,m.x-t.dx*.8,m.z-t.dz*.8,{dx=t.dx,dz=t.dz})
  end
  if(t.skills.echoBlade or 0)>0 and not t.echoBladeUsed then
   t.echoBladeUsed=true
   schedule("echo_blade",t,m.x,m.z,{ax=m.x-t.dx*1.2,az=m.z-t.dz*1.2,bx=m.x+t.dx*3.2,bz=m.z+t.dz*3.2})
  end
 end
 function L:moved(t:any,ax:number,az:number,bx:number,bz:number)
  if not hooks.active()or(t.skills.soulReturn or 0)<=0 or t.state=="airborne"then return end
  local length=math.sqrt((bx-ax)^2+(bz-az)^2);if length<1e-8 then return end
  t.returnPath=t.returnPath or {};local path=t.returnPath;local last=path[#path]
  if last and math.abs(last.bx-ax)+math.abs(last.bz-az)<1e-6 and ((last.bx-last.ax)*(bx-ax)+(last.bz-last.az)*(bz-az))/(last.length*length)>.99999 then last.bx=bx;last.bz=bz;last.length+=length
  else path[#path+1]={ax=ax,az=az,bx=bx,bz=bz,length=length}end
  local total=0;for _,s in ipairs(path)do total+=s.length end
  local excess=math.max(0,total-self.definitions.soul_return.range)
  while excess>1e-8 and #path>0 do
   local first=path[1]
   if first.length<=excess+1e-8 then excess-=first.length;table.remove(path,1)
   else local q=excess/first.length;first.ax+=(first.bx-first.ax)*q;first.az+=(first.bz-first.az)*q;first.length-=excess;excess=0 end
  end
 end
 function L:death(t:any,reason:string,x:number?,z:number?)
  if not hooks.active()or(reason~="contact"and reason~="expired")or t.returnedGhost or(t.skills.soulReturn or 0)<=0 then return end
  t.returnedGhost=true;local path=t.returnPath or {};local last=path[#path]
  if last then self:moved(t,last.bx,last.bz,x or t.x,z or t.z)end
  if #path==0 then return end
  local reverse={};local total=0
  for i=#path,1,-1 do local s=path[i];reverse[#reverse+1]={ax=s.bx,az=s.bz,bx=s.ax,bz=s.az,length=s.length};total+=s.length end
  local g={id=id(),owner=t,x=x or t.x,z=z or t.z,segments=reverse,index=1,offset=0,total=total,travel=0,hits={},hitCount=0,radius=.5}
  local owned={};for i,other in ipairs(self.ghosts)do if owner(other.owner)==owner(t)then owned[#owned+1]=i end end
  if #owned>=24 then table.remove(self.ghosts,owned[1])end
  self.ghosts[#self.ghosts+1]=g;self.counts.soul_return=(self.counts.soul_return or 0)+1;event("soul_spawn",g)
 end
 local function release(j:any)
  local d=L.definitions[j.kind]
  if j.kind=="thunder_fan"then
   local angle=math.atan2(j.dz,j.dx);local rays={};local chosen={}
   for _,m in ipairs(hooks.monsters())do if valid(j.owner,m)then
    local dx,dz=m.x-j.x,m.z-j.z;local distance=math.sqrt(dx*dx+dz*dz)
    local a=math.atan2(dz,dx)-angle;a=(a+math.pi)%(math.pi*2)-math.pi
    if distance<=d.range and math.abs(a)<=d.angle/2 then
     local bin=math.clamp(math.floor((a/d.angle+.5)*5)+1,1,5)
     if not chosen[bin]or distance<chosen[bin].d or distance==chosen[bin].d and m.id<chosen[bin].m.id then chosen[bin]={m=m,d=distance}end
    end
   end end
   for i=1,5 do
    local target=chosen[i]and chosen[i].m;local a=angle+(i-3)*d.angle/5
    rays[#rays+1]={x=j.x,z=j.z,tx=target and target.x or j.x+math.cos(a)*d.range,tz=target and target.z or j.z+math.sin(a)*d.range,hit=target~=nil}
    if target then damage(j.owner,target,d.damage,j.kind)end
   end
   event(j.kind,j,{rays=rays,angle=angle,range=d.range})
  elseif j.kind=="echo_blade"then
   local list={};for _,m in ipairs(hooks.monsters())do if valid(j.owner,m)then local dist,q=segmentDistance(m,j.ax,j.az,j.bx,j.bz);if dist<=j.radius^2 then list[#list+1]={m=m,q=q}end end end
   table.sort(list,function(a:any,b:any)return a.q<b.q or a.q==b.q and a.m.id<b.m.id end)
   for i=1,math.min(d.targets,#list)do damage(j.owner,list[i].m,d.damage,j.kind)end
   event(j.kind,j,{ax=j.ax,az=j.az,bx=j.bx,bz=j.bz})
  else
   if j.kind=="chain_fuse"then
    local wave=j.wave or {used=1};local candidates={}
    for _,other in ipairs(L.jobs)do if other.kind=="chain_fuse"and not other.wave and owner(other.owner)==owner(j.owner)and(other.x-j.x)^2+(other.z-j.z)^2<=j.radius^2 then candidates[#candidates+1]=other end end
    table.sort(candidates,function(a:any,b:any)return a.id<b.id end)
    for _,other in ipairs(candidates)do if wave.used>=d.links then break end
     wave.used+=1;other.wave=wave;other.due=now()+d.step;event("fuse_link",j,{tx=other.x,tz=other.z})
    end
   end
   event(j.kind,j);circle(j)
  end
 end
 function L:update(dt:number,live:any)
  if not hooks.active()then self:clear();return end
  for _,t in ipairs(live)do if t.alive and(t.skills.starfall or 0)>0 and not t.starfallUsed and(t.age or 0)>=self.definitions.starfall.after then
   t.starfallUsed=true;local choices={}
   for _,m in ipairs(hooks.monsters())do if valid(t,m)then choices[#choices+1]={m=m,d=(m.x-t.x)^2+(m.z-t.z)^2}end end
   table.sort(choices,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
   for i=1,math.min(3,#choices)do local m=choices[i].m;schedule("starfall",t,m.x,m.z,{due=now()+.65+(i-1)*.15})end
  end end
  for _,j in ipairs(self.jobs)do if j.target then j.x=j.target.x;j.z=j.target.z end end
  local ready={};for _,j in ipairs(self.jobs)do if now()+1e-8>=j.due then ready[#ready+1]=j end end
  table.sort(ready,function(a:any,b:any)return a.due<b.due or a.due==b.due and a.id<b.id end)
  for _,j in ipairs(ready)do
   if not hooks.active()then break end
   if now()+1e-8>=j.due then
    for i,v in ipairs(self.jobs)do if v==j then table.remove(self.jobs,i);break end end
    release(j)
   end
  end
  for i=#self.ghosts,1,-1 do local g=self.ghosts[i];local distance=self.definitions.soul_return.speed*dt
   while distance>1e-8 and g.index<=#g.segments and hooks.active()do
    local s=g.segments[g.index];local step=math.min(distance,s.length-g.offset);local ax,az=g.x,g.z
    g.offset+=step;distance-=step;g.travel+=step;local q=g.offset/s.length;g.x=s.ax+(s.bx-s.ax)*q;g.z=s.az+(s.bz-s.az)*q
    local list={};for _,m in ipairs(hooks.monsters())do if valid(g.owner,m)and not g.hits[m.id]then
     local d,u=segmentDistance(m,ax,az,g.x,g.z);if d<=(.4+m.scale*.5+g.radius)^2 then list[#list+1]={m=m,q=u}end
    end end
    table.sort(list,function(a:any,b:any)return a.q<b.q or a.q==b.q and a.m.id<b.m.id end)
    for _,entry in ipairs(list)do if g.hitCount>=4 then break end;g.hits[entry.m.id]=true;g.hitCount+=1;damage(g.owner,entry.m,.4,"soul_return")end
    if g.offset>=s.length-1e-8 then g.index+=1;g.offset=0 end
   end
   if g.index>#g.segments then event("soul_end",g);table.remove(self.ghosts,i)end
  end
  for i=#self.events,1,-1 do if now()-self.events[i].time>1 then table.remove(self.events,i)end end
  if not hooks.active()then self:clear()end
 end
 function L:hasPendingDamage()return #self.jobs>0 or #self.ghosts>0 end
 function L:view()
  local v={jobs={},ghosts={},events=self.events,counts=self.counts}
  for _,j in ipairs(self.jobs)do v.jobs[#v.jobs+1]={id=j.id,kind=j.kind,x=j.x,z=j.z,dx=j.dx,dz=j.dz,ax=j.ax,az=j.az,bx=j.bx,bz=j.bz,radius=j.radius,range=self.definitions[j.kind].range,angle=self.definitions[j.kind].angle,remaining=math.max(0,j.due-now()),progress=math.clamp((now()-j.born)/math.max(.001,j.due-j.born),0,1),targetId=j.target and j.target.id,sourceId=j.owner.visualId,linked=j.wave~=nil}end
  for _,g in ipairs(self.ghosts)do local s=g.segments[g.index];v.ghosts[#v.ghosts+1]={id=g.id,x=g.x,z=g.z,dx=s and(s.bx-s.ax)/s.length or 0,dz=s and(s.bz-s.az)/s.length or 0,progress=g.travel/g.total,k=g.owner.k}end
  return v
 end
 function L:clear()self.jobs={};self.ghosts={};self.events={}end
 function L:reset()self:clear();self.counts={};self.serial=0 end
 return L
end
