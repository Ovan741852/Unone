-- LEGION FALL: all unit movement, targeting, combat and presentation poses live here.
-- Simulation: fixed 20 Hz game rules over the engine's fixed 60 Hz clock.
-- Cache immutable standard-library functions used by the crowd hot loops.
local sin,cos,sqrt,atan2,floor,abs,min,max=math.sin,math.cos,math.sqrt,math.atan2,math.floor,math.abs,math.min,math.max
local writef32,createBuffer,bufferLen=buffer.writef32,buffer.create,buffer.len
local ipairs,pairs=ipairs,pairs
local Game={}
local units,groups,shots,impacts={},{},{},{}
local count=10000
local step,elapsed,kills,attacks=0,0,{0,0},0
local phase,publishedElapsed=0,0
local teamShots={0,0}
local running=true
local stress=false
local capped=0
local cinematic=false
local grid={{},{}}
local live={5000,5000}
local shotCounts={arrow=0,bolt=0,boulder=0,magic=0}
local types={
 {name="infantry",label="步兵",hp=110,speed=6.2,range=2.1,damage=12,cooldown=.85,weight=45},
 {name="archer",label="弓兵",hp=60,speed=4.4,range=36,damage=13,cooldown=2.3,weight=23,shot="arrow",flight=32},
 {name="cavalry",label="騎兵",hp=240,speed=12,range=3.5,damage=24,cooldown=1.3,weight=13},
 {name="ballista",label="弩車",hp=180,speed=2.8,range=54,damage=36,cooldown=4.8,weight=2,shot="bolt",flight=48},
 {name="catapult",label="投石車",hp=160,speed=2.3,range=64,damage=38,cooldown=7,weight=1,shot="boulder",flight=22},
 {name="flyer",label="飛行衛隊",hp=75,speed=8.5,range=20,damage=10,cooldown=1.8,weight=7,shot="magic",flight=28},
 {name="mage",label="法師",hp=65,speed=4.5,range=29,damage=23,cooldown=3.4,weight=9,shot="magic",flight=24},
}
local names={"red","blue"}
local function v(x,y,z)return{x=x,y=y,z=z}end
local function pack(b,i,x,y,z,yaw,sx,sy,sz)
 local o=(i-1)*40
 writef32(b,o,x);writef32(b,o+4,y);writef32(b,o+8,z)
 writef32(b,o+12,0);writef32(b,o+16,sin(yaw*.5));writef32(b,o+20,0);writef32(b,o+24,cos(yaw*.5))
 writef32(b,o+28,sx);writef32(b,o+32,sy);writef32(b,o+36,sz)
end
local function cell(x,z)return floor(x/7)*1000+floor(z/7)end
local function rebuildGrid()
 grid={{},{}}
 for i,u in ipairs(units)do if u.hp>0 then local key=cell(u.x,u.z);local bucket=grid[u.team][key];if not bucket then bucket={};grid[u.team][key]=bucket end;bucket[#bucket+1]=i end end
end
local function damage(target,amount,team)
 if target and target.hp>0 then target.pending+=amount;target.flash=.15 end
end
local function resolveDamage()
 -- Simultaneous damage: neither army gets a first-iteration kill advantage.
 for _,u in ipairs(units)do
  if u.pending>0 and u.hp>0 and not stress then
   u.hp-=u.pending
   if u.hp<=0 then live[u.team]-=1;kills[3-u.team]+=1;u.dead=elapsed end
  end
  u.pending=0
 end
end
local function acquire(u,index)
 local ux,uz=u.x,u.z;local groundOnly=u.kind==1 or u.kind==3
 local enemies=grid[3-u.team];local records=units
 local best,bestD=nil,1e9;local gx,gz=floor(ux/7),floor(uz/7);local scanned=0
 for dx=-1,1 do for dz=-1,1 do
  local bucket=enemies[(gx+dx)*1000+gz+dz]
  if bucket then for _,j in ipairs(bucket)do
   local e=records[j]
   if e.hp>0 and (not groundOnly or e.kind~=6) then
    local d=(e.x-ux)^2+(e.z-uz)^2
    if d<bestD then best=j;bestD=d end
   end
   scanned+=1;if scanned>=32 then break end
  end end
  if scanned>=32 then break end
 end;if scanned>=32 then break end end
 if best then return best end
 -- A bounded deterministic sample supplies a pursuit target when no enemy is nearby.
 local half=count/2;local offset=u.team==1 and half or 0
 for n=1,12 do
  local j=offset+((index*17+step*7+n*397)%half)+1;local e=records[j]
  if e.hp>0 and (not groundOnly or e.kind~=6)then local d=(e.x-ux)^2+(e.z-uz)^2;if d<bestD then best=j;bestD=d end end
 end
 return best
end
local function hitArea(p,radius,limit)
 local gx,gz=floor(p.tx/7),floor(p.tz/7);local hit=0
 for dx=-1,1 do for dz=-1,1 do local bucket=grid[3-p.team][(gx+dx)*1000+gz+dz]
  if bucket then for _,j in ipairs(bucket)do local e=units[j]
   if e.hp>0 and (p.source~=5 or e.kind~=6) and (e.x-p.tx)^2+(e.z-p.tz)^2<radius*radius then damage(e,p.damage,p.team);hit+=1;if hit>=limit then return end end
  end end
 end end
end
local function publish(api)
 for key,g in pairs(groups)do
  local visible=0
  for _,index in ipairs(g.ids)do local u=units[index];if u.hp>0 or elapsed-u.dead<1.4 then visible+=1 end end
  if bufferLen(g.buffer)~=visible*40 then g.buffer=createBuffer(visible*40) end
  local b=g.buffer;local n=0
  for _,index in ipairs(g.ids)do local u=units[index]
   if u.hp>0 or elapsed-u.dead<1.4 then
    n+=1;local scale=1;local y=u.kind==6 and 6 or 0
    if u.hp<=0 then scale=max(0,1-(elapsed-u.dead)/1.4);y-=.3
    else
     if u.moving or u.kind==6 then local wave=sin(elapsed*(u.kind==3 and 13 or 9)+index*.71);y+=u.kind==6 and wave*.65 or abs(wave)*.14 end
     if u.attack>0 then y+=.1;u.attack=max(0,u.attack-.05) end
    end
    pack(b,n,u.x,y,u.z,u.yaw,scale,scale*(1+(u.attack>0 and .1 or 0)),scale)
   end
  end
  api.instances3d.set(key,"mesh://"..key,b)
 end
 for _,kind in ipairs({"arrow","bolt","boulder","magic"})do
  local b=createBuffer(shotCounts[kind]*40);local i=0
  for _,p in ipairs(shots)do if p.kind==kind then
   i+=1;local a=min(1,p.age/p.duration);local y=p.y+(p.ty-p.y)*a+4*p.arc*a*(1-a)
   pack(b,i,p.x+(p.tx-p.x)*a,y,p.z+(p.tz-p.z)*a,p.yaw,p.kind=="bolt" and 1 or .8,p.kind=="boulder" and 1.3 or .8,p.kind=="arrow" and 1.4 or 1)
  end end
  api.instances3d.set("projectile-"..kind,"mesh://"..kind,b)
 end
 local b=createBuffer(#impacts*40)
 for i,p in ipairs(impacts)do local s=p.radius*(1-p.age/.5);pack(b,i,p.x,.06,p.z,0,s,1,s)end
 api.instances3d.set("impacts","mesh://impact",b)
 api.observation.set("unit_count_conserved",live[1]+live[2]+kills[1]+kills[2]==count)
 api.observation.set("combat_has_losses",kills[1]+kills[2]>0)
 api.observation.set("battle",{total=count,red=live[1],blue=live[2],red_kills=kills[1],blue_kills=kills[2],seconds=floor(elapsed*10)/10,attacks=attacks,projectiles=#shots,simulation_hz=20,running=running,stress=stress,capped_attacks=capped,step=step})
end
local function reset(api,n)
 for key in pairs(groups)do api.instances3d.remove(key)end
 phase=0;publishedElapsed=0;teamShots={0,0}
 capped=0;count=n;units={};groups={};shots={};impacts={};step=0;elapsed=0;kills={0,0};attacks=0;live={n/2,n/2};running=true
 shotCounts={arrow=0,bolt=0,boulder=0,magic=0}
 local half=count/2
 for team=1,2 do
  local dir=team==1 and 1 or -1;local ordinal=0
  for kind,t in ipairs(types)do
   local amount=floor(half*t.weight/100);local key=names[team].."-"..t.name
   local g={ids={},buffer=createBuffer(amount*40)};groups[key]=g
   for j=1,amount do
    ordinal+=1
    local col=(j-1)%72;local row=floor((j-1)/72)
    local depth=12+row*2.0;local z=(col-35.5)*2.05
    if kind==2 then depth=78+row*1.9
    elseif kind==3 then depth=18+floor((j-1)/16)*1.9;z=(j%2==0 and 1 or -1)*(78+(j%8)*2.0)
    elseif kind==4 or kind==5 then depth=(kind==4 and 82 or 109)+floor((j-1)/24)*5.5;z=((j-1)%24-11.5)*6
    elseif kind==6 then depth=22+row*3
    elseif kind==7 then depth=104+row*2.2 end
    local x=-dir*depth
    local u={team=team,kind=kind,hp=t.hp*3,pending=0,x=x,z=z,yaw=dir*math.pi/2,cool=(j%31)/31*t.cooldown,attack=0,moving=true,target=nil,flash=0}
    units[#units+1]=u;g.ids[#g.ids+1]=#units
   end
  end
 end
 assert(#units==count);rebuildGrid();publish(api)
end
local function camera(api,mode)
 cinematic=mode=="cinematic"
 if mode=="wide"then api.camera3d.setPosition(v(95,180,185));api.camera3d.setTarget(v(0,0,0))
 elseif mode=="front"then api.camera3d.setPosition(v(25,13,38));api.camera3d.setTarget(v(0,1,0))
 elseif mode=="siege" then api.camera3d.setPosition(v(-106,12,30));api.camera3d.setTarget(v(-70,1,0))
 else api.camera3d.setPosition(v(0,265,4));api.camera3d.setTarget(v(0,0,0))end
end
function Game.start(api)
 reset(api,10000);camera(api,"wide")
 if api.debug.enabled then
  api.debug.registerTab({id="battle",label="萬軍戰場"})
  for _,n in ipairs({1000,5000,10000})do api.debug.register({kind="button",id="battle.reset"..n,tab="battle",label="重新開戰 · "..n.." 人"},function()reset(api,n)end)end
  for _,mode in ipairs({"wide","front","top","siege","cinematic"})do api.debug.register({kind="button",id="battle.camera."..mode,tab="battle",label="視角 · "..mode},function()camera(api,mode)end)end
  api.debug.register({kind="checkbox",id="battle.stress",tab="battle",label="壓測：維持存活（不計傷亡）",checked=false},function(value)stress=value end)
  api.debug.register({kind="checkbox",id="battle.running",tab="battle",label="戰鬥進行",checked=true},function(value)running=value end)
 end
end
local function advanceUnits(first,last)
 local delta=.05
 for order=first,last do local i=floor((order-1)/2)+1+((order+step)%2)*(count/2);local u=units[i];if u.hp>0 then
  local t=types[u.kind]
  if i%6==step%6 or not u.target or units[u.target].hp<=0 then u.target=acquire(u,i)end
  local e=u.target and units[u.target]
  u.cool-=delta;u.moving=false
  if e and e.hp>0 then
   local dx,dz=e.x-u.x,e.z-u.z;local distance=sqrt(dx*dx+dz*dz);u.yaw=atan2(dx,dz)
   if distance>t.range*.88 then
    local speed=t.speed;local advance=min(speed*delta,max(0,distance-t.range*.8))
    -- Stable lateral lanes prevent a single point pile-up without all-pairs rigid bodies.
    local lane=((i%7)-3)*.08
    if distance>0 then u.x+=dx/distance*advance-dz/distance*lane*delta;u.z+=dz/distance*advance+dx/distance*lane*delta end
    u.moving=true
   end
   if distance<t.range and u.cool<=0 then
    u.cool=t.cooldown+(i%13)*.015;u.attack=.25
    if not t.shot then attacks+=1;damage(e,t.damage+(u.kind==3 and u.moving and 18 or 0),u.team)
    elseif teamShots[u.team]<1200 then
     attacks+=1;teamShots[u.team]+=1
     local kind=t.shot
     local p={kind=kind,team=u.team,damage=t.damage,target=u.target,x=u.x,z=u.z,y=u.kind==6 and 6 or 1.2,tx=e.x,tz=e.z,ty=e.kind==6 and 6 or .7,duration=max(.15,distance/t.flight),age=0,arc=u.kind==5 and distance*.3 or u.kind==2 and distance*.11 or 0,yaw=u.yaw,source=u.kind}
     shots[#shots+1]=p
    else capped+=1 end
   end
  end
 end end
end
local function finishBattle(api)
 local delta=.05
 shotCounts={arrow=0,bolt=0,boulder=0,magic=0}
 for i=#shots,1,-1 do local p=shots[i];p.age+=delta
  if p.age>=p.duration then
   if p.source==5 or p.source==7 or p.source==4 then
    local radius=p.source==5 and 4 or p.source==7 and 2.5 or 1.7
    hitArea(p,radius,p.source==4 and 3 or 6)
    if #impacts<250 then impacts[#impacts+1]={x=p.tx,z=p.tz,radius=radius,age=0}end
   else local e=units[p.target];if e and (e.x-p.tx)^2+(e.z-p.tz)^2<12 then damage(e,p.damage,p.team)end end
   shots[i]=shots[#shots];shots[#shots]=nil
  else shotCounts[p.kind]+=1 end
 end
 resolveDamage()
 for i=#impacts,1,-1 do local p=impacts[i];p.age+=delta;if p.age>=.5 then impacts[i]=impacts[#impacts];impacts[#impacts]=nil end end
 publish(api)
 publishedElapsed=elapsed
end
function Game.update(api,dt)
 if cinematic then api.camera3d.setPosition(v(cos(publishedElapsed*.07)*52,24,sin(publishedElapsed*.07)*52));api.camera3d.setTarget(v(0,1,0)) end
 if not running then return end
 -- Fixed work partitions, never a wall-clock budget. Internal work stays private
 -- until the third tick publishes the same complete 20 Hz battle result.
 phase+=1
 local firstCut=floor(count*.37);local secondCut=floor(count*.90)
 if phase==1 then
  step+=1;elapsed+=.05;rebuildGrid()
  teamShots={0,0};for _,p in ipairs(shots)do teamShots[p.team]+=1 end
  advanceUnits(1,firstCut)
 elseif phase==2 then advanceUnits(firstCut+1,secondCut)
 else
  advanceUnits(secondCut+1,count);finishBattle(api);phase=0
 end
end
return Game
