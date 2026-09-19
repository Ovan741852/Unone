-- Game-owned combinations: trigger recipes, payloads and source modifiers.
local function createCompositionRuntime(hooks:any)
 local C:any={clock=0,serial=0,units={},pairs={},marks={},nodes={},wells={},queue={},events={},counts={},tracks={},monsterStarts={}}
 C.recipes={
  contact_mine={trigger="period",modifier="contactMine",period=2,arm=.35,ttl=5,triggerRadius=.9,radius=2,damage=.5,targets=5,cap=3,playerCap=64},
  step_orb={trigger="distance",modifier="stepOrb",distance=6,delay=1.4,radius=1.8,damage=.45,targets=4,cap=16,playerCap=256},
  resonant_debt={trigger="received_hits",modifier="resonantDebt",hits=5,ttl=4,radius=1.8,damage=.7,targets=4},
  gravity_law={trigger="period",modifier="gravityLaw",period=2.4,windup=.25,duration=.4,radius=4.2,targets=8,distance=2},
  comrade_oath={trigger="ally_contact",modifier="comradeOath",radius=.65,duration=2.5,bonus=.25,cooldown=1.2},
 }
 local function now()return hooks.clock()end
 local function id()C.serial+=1;return C.serial end
 local function player(t:any)return t.playerId or 1 end
 local function allowed(t:any,m:any)return m.alive and(t.targetId==0 or t.targetId==m.id)end
 local function has(t:any,key:string)return(t.skills[key]or 0)>0 end
 local function radius(t:any,r:number)return r*(1+math.min(.6,t.skills.areaBonus or 0))end
 function C:period(t:any,seconds:number)
  return seconds*(1-math.min(.5,math.max(0,t.skills.quickChant or 0)*.25))*(has(t,"overloadScript")and 1.5 or 1)
 end
 function C:spellPower(t:any)return has(t,"overloadScript")and 2 or 1 end
 local function event(kind:string,t:any,x:number,z:number,extra:any?)
  local e={id=id(),kind=kind,time=now(),x=x,z=z,sourceId=t.visualId,playerId=player(t)}
  if extra then for k,v in pairs(extra)do e[k]=v end end
  C.events[#C.events+1]=e;if #C.events>128 then table.remove(C.events,1)end
 end
 local function count(kind:string)C.counts[kind]=(C.counts[kind]or 0)+1 end
 local function unit(t:any)
  if not C.units[t.visualId]then C.units[t.visualId]={owner=t,distance=0,nextMine=now()+C:period(t,C.recipes.contact_mine.period),nextGravity=now()+C:period(t,C.recipes.gravity_law.period)}end
  return C.units[t.visualId]
 end
 function C:attach(t:any)unit(t)end
 local function node(kind:string,t:any,x:number,z:number)
  local r=C.recipes[kind];local n={id=id(),kind=kind,owner=t,x=x,z=z,born=now(),due=now()+(r.delay or r.ttl),armed=now()+(r.arm or 0),radius=radius(t,r.radius),element=has(t,"stormPayload")and "lightning"or(kind=="contact_mine"and "fire"or "arcane")}
  local sourceCount,playerCount=0,0
  for _,v in ipairs(C.nodes)do if v.kind==kind then if v.owner==t then sourceCount+=1 end;if player(v.owner)==player(t)then playerCount+=1 end end end
  -- Keep committed timers. Replacing old nodes can starve every detonation at high speed.
  if sourceCount>=r.cap or playerCount>=r.playerCap then return nil end
  C.nodes[#C.nodes+1]=n;count(kind);return n
 end
 function C:beginFrame(live:any,monsters:any)
  self.tracks={};self.monsterStarts={}
  -- Trajectories are normalized over the same simulation tick, split at walls.
  local enabled=false;for _,t in ipairs(live)do if t.alive and has(t,"comradeOath")then enabled=true;break end end
  self.trackContacts=enabled
  if enabled then for _,t in ipairs(live)do if t.alive then self.tracks[t.visualId]={owner=t,x=t.x,z=t.z,segments={},distance=0,planned=0}end end end
  for _,m in ipairs(monsters)do if m.alive then self.monsterStarts[m.id]={x=m.x,z=m.z}end end
 end
 function C:planMove(t:any,distance:number)
  local tr=self.tracks[t.visualId];if tr then tr.planned=distance end
 end
 function C:moved(t:any,ax:number,az:number,bx:number,bz:number)
  if not hooks.active()or t.state=="airborne"then return end
  local length=math.sqrt((bx-ax)^2+(bz-az)^2);if length<1e-8 then return end
  local tr=self.tracks[t.visualId]
  if tr then local from=tr.distance;tr.distance+=length;tr.segments[#tr.segments+1]={ax=ax,az=az,bx=bx,bz=bz,from=from,to=tr.distance}end
  if has(t,"stepOrb")then
   local u=unit(t);local r=self.recipes.step_orb;local step=r.distance-u.distance
   while step<=length+1e-8 do local q=math.min(1,step/length);node("step_orb",t,ax+(bx-ax)*q,az+(bz-az)*q);step+=r.distance end
   u.distance=(u.distance+length)%r.distance;if u.distance<1e-8 or r.distance-u.distance<1e-8 then u.distance=0 end
  end
 end
 local function closest(ax:number,az:number,bx:number,bz:number,x:number,z:number)
  local dx,dz=bx-ax,bz-az;local q=math.clamp(((x-ax)*dx+(z-az)*dz)/math.max(1e-12,dx*dx+dz*dz),0,1)
  return (ax+dx*q-x)^2+(az+dz*q-z)^2,q
 end
 local function position(tr:any,q:number)
  local d=q*math.max(tr.planned,tr.distance)
  for _,s in ipairs(tr.segments)do if d<=s.to+1e-8 then local p=math.clamp((d-s.from)/math.max(1e-8,s.to-s.from),0,1);return s.ax+(s.bx-s.ax)*p,s.az+(s.bz-s.az)*p end end
  return tr.owner.x,tr.owner.z
 end
 local function crossed(a:any,b:any,r:number)
  local times={0,1}
  for _,tr in ipairs({a,b})do for _,s in ipairs(tr.segments)do times[#times+1]=s.to/math.max(1e-8,tr.planned,tr.distance)end end
  table.sort(times)
  for i=2,#times do local q0,q1=times[i-1],times[i]
   local ax,az=position(a,q0);local bx,bz=position(b,q0);local atx,atz=position(a,q1);local btx,btz=position(b,q1)
   local distance,q=closest(ax-bx,az-bz,atx-btx,atz-btz,0,0)
   if distance<=r*r then return true,(ax+(atx-ax)*q+bx+(btx-bx)*q)*.5,(az+(atz-az)*q+bz+(btz-bz)*q)*.5 end
  end
  return false,0,0
 end
 function C:contacts(live:any)
  local r=self.recipes.comrade_oath;local eligible={};local seen={}
  for _,t in ipairs(live)do if t.alive and t.state~="airborne"and(t.age or 0)>=.35 and(t.travel or 0)>=1.5 then
   eligible[#eligible+1]=t;self.tracks[t.visualId]=self.tracks[t.visualId]or{owner=t,x=t.x,z=t.z,segments={},distance=0,planned=0}
  end end
  table.sort(eligible,function(a:any,b:any)return a.visualId<b.visualId end)
  for i=1,#eligible do for j=i+1,#eligible do local a,b=eligible[i],eligible[j]
   if player(a)==player(b)and(has(a,"comradeOath")or has(b,"comradeOath"))then
    local key=a.visualId..":"..b.visualId;local old=self.pairs[key]or{touching=false,next=0};seen[key]=true
    local contact,x,z=crossed(self.tracks[a.visualId],self.tracks[b.visualId],r.radius)
    if contact and not old.touching and now()+1e-8>=old.next then
     local source=has(a,"comradeOath")and a or b;old.next=now()+self:period(source,r.cooldown)
     a.oathUntil=now()+r.duration;b.oathUntil=now()+r.duration;count("comrade_oath");event("comrade_oath",source,x,z,{tx=b.x,tz=b.z,radius=r.radius})
    end
    old.touching=(a.x-b.x)^2+(a.z-b.z)^2<=r.radius^2;self.pairs[key]=old
   end
  end end
  for key in pairs(self.pairs)do if not seen[key]then self.pairs[key]=nil end end
 end
 function C:damageBonus(t:any)return(t.oathUntil or 0)>now()and self.recipes.comrade_oath.bonus or 0 end
 function C:onDamage(t:any,m:any,info:any)
  if not hooks.active()or(info.amount or 0)<=0 or not allowed(t,m)then return end
  -- A debt explosion cannot advance another debt; all other friendly hits and DoTs can.
  if info.kind=="resonant_debt"then return end
  local key=player(t)..":"..m.id;local mark=self.marks[key]
  if mark and mark.due<=now()then self.marks[key]=nil;mark=nil end
  if mark then
   mark.hits+=1
   if mark.hits>=self.recipes.resonant_debt.hits then
    self.marks[key]=nil;self.queue[#self.queue+1]={kind="resonant_debt",owner=mark.owner,x=m.x,z=m.z,radius=radius(mark.owner,self.recipes.resonant_debt.radius),element=has(mark.owner,"stormPayload")and "lightning"or "arcane"};count("resonant_debt")
   end
  elseif not info.secondary and has(t,"resonantDebt")then
   self.marks[key]={id=id(),kind="resonant_debt",owner=t,target=m,hits=0,due=now()+self.recipes.resonant_debt.ttl}
  end
 end
 local function explode(n:any)
  count(n.kind.."_detonate")
  local r=C.recipes[n.kind];local list={}
  for _,m in ipairs(hooks.monsters())do if allowed(n.owner,m)then local d=(m.x-n.x)^2+(m.z-n.z)^2;if d<=n.radius^2 or m==n.triggerTarget then list[#list+1]={m=m,d=m==n.triggerTarget and -1 or d}end end end
  table.sort(list,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
  event(n.kind,n.owner,n.x,n.z,{radius=n.radius,element=n.element,power=C:spellPower(n.owner),phase="explode"})
  for i=1,math.min(r.targets,#list)do if not hooks.active()then break end;count(n.kind.."_hits");hooks.damage(list[i].m,n.owner.damage*r.damage*math.max(.5,1-(n.owner.skills.areaPenalty or 0)),n.owner,n.kind)end
 end
 function C:flush()
  -- Drain one generation only. Mine/orb hits may finish marks on the next flush.
  local jobs=self.queue;self.queue={};for _,n in ipairs(jobs)do if not hooks.active()then break end;explode(n)end
  if not hooks.active()then self:clear()end
 end
 function C:update(dt:number,live:any)
  if not hooks.active()then self:clear();return end
  local present={}
  for _,t in ipairs(live)do if t.alive then
   present[t.visualId]=true;local u=unit(t)
   if has(t,"contactMine")and t.state~="airborne"and now()+1e-8>=u.nextMine then node("contact_mine",t,t.x,t.z);u.nextMine=now()+self:period(t,self.recipes.contact_mine.period)end
   if has(t,"gravityLaw")and now()+1e-8>=u.nextGravity then
    local r=self.recipes.gravity_law;local existing=false;for _,w in ipairs(self.wells)do if w.owner==t then existing=true end end
    if not existing then self.wells[#self.wells+1]={id=id(),owner=t,born=now(),due=now()+r.windup,untilTime=now()+r.windup+r.duration,pulled={}};count("gravity_law")end
    u.nextGravity=now()+self:period(t,r.period)
   end
  end end
  local pullBudget={};local r=self.recipes.gravity_law
  for i=#self.wells,1,-1 do local w=self.wells[i];local t=w.owner
   if not t.alive or not present[t.visualId]or now()>w.untilTime+1e-8 then table.remove(self.wells,i)
   elseif now()+1e-8>=w.due then
    if not w.targets then
     local choices={};for _,m in ipairs(hooks.monsters())do if allowed(t,m)and m.rank<=2 then local d=(m.x-t.x)^2+(m.z-t.z)^2;if d<=r.radius^2 then choices[#choices+1]={m=m,d=d}end end end
     table.sort(choices,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end);w.targets={}
     for n=1,math.min(r.targets,#choices)do w.targets[#w.targets+1]=choices[n].m end
    end
    local elapsed=math.max(0,math.min(now(),w.untilTime)-math.max(now()-dt,w.due))
    for _,m in ipairs(w.targets)do if allowed(t,m)then
     local dx,dz=t.x-m.x,t.z-m.z;local length=math.sqrt(dx*dx+dz*dz)
     local step=math.min(math.max(0,length-.9),math.max(0,r.distance-(w.pulled[m.id]or 0)),r.distance/r.duration*elapsed,math.max(0,5*dt-(pullBudget[m.id]or 0)))
     if step>0 then
      local wall=math.max(0,hooks.wallX-(.4+m.scale*.5)-.65)
      m.x=math.clamp(m.x+dx/length*step,-wall,wall);m.z=math.clamp(m.z+dz/length*step,-wall,wall)
      w.pulled[m.id]=(w.pulled[m.id]or 0)+step;pullBudget[m.id]=(pullBudget[m.id]or 0)+step
     end
    end end
   end
  end
  for i=#self.nodes,1,-1 do local n=self.nodes[i];local trigger=false;local expired=now()+1e-8>=n.due
   if n.kind=="step_orb"then trigger=expired
   elseif not expired and now()+1e-8>=n.armed then
    for _,m in ipairs(hooks.monsters())do if allowed(n.owner,m)then
     local start=self.monsterStarts[m.id]or m
     -- An arming mine only senses the path after it became armed, never old travel.
     local fraction=dt>0 and math.clamp((n.armed-(now()-dt))/dt,0,1)or 1
     local ax,az=start.x+(m.x-start.x)*fraction,start.z+(m.z-start.z)*fraction
     if closest(ax,az,m.x,m.z,n.x,n.z)<=self.recipes.contact_mine.triggerRadius^2 then trigger=true;n.triggerTarget=m;break end
    end end
   end
   if trigger or expired then table.remove(self.nodes,i);if trigger then self.queue[#self.queue+1]=n end end
  end
  for key,mark in pairs(self.marks)do if not mark.target.alive or now()>=mark.due then self.marks[key]=nil end end
  if self.trackContacts then self:contacts(live)else self.pairs={}end
  for id in pairs(self.units)do if not present[id]then self.units[id]=nil end end
  for i=#self.events,1,-1 do if now()-self.events[i].time>1 then table.remove(self.events,i)end end
  self:flush();self.tracks={};self.monsterStarts={}
 end
 function C:hasPendingDamage()return #self.nodes>0 or #self.queue>0 end
 function C:view()
  local v={nodes={},marks={},wells={},buffs={},events=self.events,counts=self.counts}
  for _,n in ipairs(self.nodes)do v.nodes[#v.nodes+1]={id=n.id,kind=n.kind,x=n.x,z=n.z,radius=n.radius,triggerRadius=self.recipes[n.kind].triggerRadius,element=n.element,armed=now()>=n.armed,remaining=math.max(0,n.due-now()),progress=math.clamp((now()-n.born)/(n.due-n.born),0,1)}end
  for _,m in pairs(self.marks)do v.marks[#v.marks+1]={id=m.id,x=m.target.x,z=m.target.z,hits=m.hits,required=5,remaining=math.max(0,m.due-now()),playerId=player(m.owner)}end
  for _,w in ipairs(self.wells)do local r=self.recipes.gravity_law;v.wells[#v.wells+1]={id=w.id,x=w.owner.x,z=w.owner.z,radius=r.radius,progress=math.clamp((now()-w.born)/(w.untilTime-w.born),0,1),active=now()>=w.due}end
  for _,u in pairs(self.units)do local t=u.owner;if t.alive and(t.oathUntil or 0)>now()then v.buffs[#v.buffs+1]={kind="comrade_oath",sourceId=t.visualId,x=t.x,z=t.z,remaining=t.oathUntil-now()}end end
  table.sort(v.marks,function(a:any,b:any)return a.hits>b.hits or a.hits==b.hits and a.id<b.id end);table.sort(v.buffs,function(a:any,b:any)return a.sourceId<b.sourceId end)
  return v
 end
 function C:clear()self.units={};self.pairs={};self.marks={};self.nodes={};self.wells={};self.queue={};self.events={};self.tracks={};self.monsterStarts={}end
 function C:reset()self:clear();self.serial=0;self.counts={}end
 return C
end
