--!strict
-- VOIDWAKE: all simulation, combat, collision, progression and random selection
-- execute inside Unone's fixed-step Luau runtime. Official engine presentation
-- consumes real scene sprites, declarative particles, shaders, UI and audio.
-- Coordinates: +x right, +y down; angle 0 points north.
type Vec2 = {x:number,y:number}
type EngineApi = {
 input: {isDown:(string)->boolean,getPointerPosition:()->Vec2,isPointerDown:()->boolean},
 random: {nextFloat:()->number,nextInt:(number,number)->number},
 observation: {set:(string,any)->()},
 entity: {setPosition:(string,Vec2)->()},
 camera: {setPosition:(Vec2)->()},
 particle:any,shader:any,ui:any,audio:any,
}
local Game = {}
local S:any = {}
local nextId = 0
local previous:{[string]:boolean} = {}
local BOUNDS = {x=1400,y=1000}
local SECTOR_DURATION = 40
local UPGRADES = {
 {id="reactor",name="超臨界反應爐",description="主炮傷害 +25%。將每一束餘燼變成穿甲光。",rarity="RARE"},
 {id="autoloader",name="磁軌自動裝填",description="射擊間隔 -18%。連續火力，直到深空沉默。",rarity="RARE"},
 {id="twin",name="雙聯脈衝炮",description="每次射擊額外增加一發平行彈，最多五發。",rarity="EPIC"},
 {id="shield",name="相位護盾矩陣",description="護盾上限 +30，立即回滿。回充速度 +20%。",rarity="RARE"},
 {id="hull",name="複合裝甲龍骨",description="艦體上限 +35，立即修復 50 點。",rarity="COMMON"},
 {id="thruster",name="離子向量推進",description="航速 +15%，閃避冷卻 -15%。",rarity="COMMON"},
 {id="magnet",name="深空回收磁場",description="拾取吸附距離 +85，修復艦體 25 點。",rarity="COMMON"},
 {id="pulse",name="電磁過載核心",description="脈衝傷害 +60%，範圍 +20%，冷卻 -15%。",rarity="EPIC"},
 {id="pierce",name="鎢芯穿甲彈",description="每發主炮多穿透一個目標，傷害 +10%。",rarity="EPIC"},
}

local function id():number nextId += 1; return nextId end
local function dist2(ax:number,ay:number,bx:number,by:number):number return (ax-bx)^2+(ay-by)^2 end
local function clamp(v:number,a:number,b:number):number return math.max(a,math.min(b,v)) end
local function angleTo(ax:number,ay:number,bx:number,by:number):number return math.atan2(bx-ax,ay-by) end
local function edge(api:EngineApi,name:string):boolean
 local down=api.input.isDown(name)
 local fired=down and not previous[name]
 previous[name]=down
 return fired
end
local function fx(kind:string,x:number,y:number,r:number,life:number)
 table.insert(S.effects,{id=id(),kind=kind,x=x,y=y,radius=r,life=life,maxLife=life,angle=0})
end
-- @AUDIO@
-- @PRESENTATION@
-- @UI@
local function fresh(api:EngineApi,phase:string)
 nextId=0
 S={phase=phase,time=0,sectorTime=0,sectorDuration=SECTOR_DURATION,sector=1,wave=0,kills=0,
  xp=0,xpNext=14,level=1,credits=0,seed=0,choices={},upgrades={},upgradesInstalled=0,
  autoFire=true,burstCooldown=0,dashCooldown=0,bossSpawned=false,sectorDraft=false,
  levelDraft=false,fireCooldown=0,spawnCooldown=2.2,waveCooldown=8,lastDamage=-10,
  fired=0,damageTaken=0,burstCount=0,dashCount=0,previousPhase="playing",
  player={x=0,y=0,vx=0,vy=0,angle=0,radius=18,hp=100,maxHp=100,shield=60,maxShield=60,
   boost=100,boostMax=100,invuln=0,dashTime=0,dashX=0,dashY=-1,hit=0},
  stats={damage=18,fireInterval=.19,projectiles=1,speed=220,pierce=0,magnet=100,
   shieldRegen=9,dashCooldown=2.4,burstDamage=85,burstRadius=330,burstInterval=12},
  enemies={},bullets={},pickups={},effects={},asteroids={},bounds=BOUNDS}
 -- The runtime seed itself is host-owned. This reproducible signature identifies
 -- the content generated from it without introducing a second random generator.
 S.seed=api.random.nextInt(1,2147483646)
 for i=1,19 do
  local x=(api.random.nextFloat()*2-1)*1270
  local y=(api.random.nextFloat()*2-1)*870
  if x*x+y*y<220*220 then x+=440 end
  table.insert(S.asteroids,{id=id(),x=x,y=y,radius=25+api.random.nextFloat()*35,
   angle=api.random.nextFloat()*math.pi*2,spin=(api.random.nextFloat()-.5)*.08})
 end
 abandonPrompt=false
 resetPresentation(api)
 resetAudio(api)
end
-- A published ViewModel is a stable interchange format. Native and WASM may
-- differ at the last bit of an intermediate float; leave simulation untouched
-- and publish sub-microunit precision consistently across those targets.
local function viewValue(value:any):any
 if type(value)=="number" then
  if value==math.floor(value) then return value end
  return math.floor(value*1000000+.5)/1000000
 elseif type(value)=="table" then
  local result:any={}
  for key,child in pairs(value) do result[key]=viewValue(child) end
  return result
 end
 return value
end
local function publish(api:EngineApi)
 api.entity.setPosition("player",{x=S.player.x,y=-S.player.y})
 api.camera.setPosition({x=S.player.x,y=-S.player.y})
 updatePresentation(api)
 updateAudio(api)
 updateUi(api)
 api.observation.set("game",viewValue(S))
 -- Small semantic observations make headless replay assertions independent
 -- from the renderer and from a complete, brittle state-object comparison.
 api.observation.set("phase",S.phase)
 api.observation.set("fired",S.fired)
 api.observation.set("sector",S.sector)
 api.observation.set("level",S.level)
 api.observation.set("kills",S.kills)
 api.observation.set("time",viewValue(S.time))
 api.observation.set("player_x",viewValue(S.player.x))
 api.observation.set("player_y",viewValue(S.player.y))
 api.observation.set("autoFire",S.autoFire)
 api.observation.set("burstCount",S.burstCount)
 api.observation.set("dashCount",S.dashCount)
 api.observation.set("upgradesInstalled",S.upgradesInstalled)
 api.observation.set("choiceCount",#S.choices)
 api.observation.set("movedRight",S.player.x>100)
 api.observation.set("finiteState",S.player.hp>=0 and S.player.hp<=S.player.maxHp and S.player.shield>=0 and S.player.shield<=S.player.maxShield)
end
local function bullet(owner:string,x:number,y:number,angle:number,speed:number,damage:number,radius:number,pierce:number)
 if #S.bullets>=280 then return end
 table.insert(S.bullets,{id=id(),owner=owner,friendly=owner=="player",x=x,y=y,
  previousX=x,previousY=y,angle=angle,vx=math.sin(angle)*speed,vy=-math.cos(angle)*speed,
  damage=damage,radius=radius,life=owner=="player" and 1.5 or 4,pierce=pierce,hits={}})
end
local function spawnEnemy(api:EngineApi,kind:string?)
 if #S.enemies>=28 then return end
 local k=kind or (api.random.nextFloat()<.24 and "shooter" or "chaser")
 if not kind and S.sector>=2 and api.random.nextFloat()<.19 then k="heavy" end
 local a=api.random.nextFloat()*math.pi*2
 local p=S.player
 local d=480+api.random.nextFloat()*180
 local x=clamp(p.x+math.cos(a)*d,-1350,1350)
 local y=clamp(p.y+math.sin(a)*d,-950,950)
 local hp=(k=="boss" and 2200 or k=="heavy" and 115 or k=="shooter" and 46 or 32)+(S.sector-1)*(k=="boss" and 0 or 12)
 table.insert(S.enemies,{id=id(),kind=k,boss=k=="boss",x=x,y=y,angle=angleTo(x,y,p.x,p.y),
  radius=k=="boss" and 82 or k=="heavy" and 32 or 22,hp=hp,maxHp=hp,
  speed=k=="boss" and 45 or k=="heavy" and 64 or k=="shooter" and 92 or 108+S.sector*8,
  cooldown=k=="boss" and 2 or .9+api.random.nextFloat()*2,telegraph=0,pattern=0,hit=0,age=0})
end
local function draft(api:EngineApi,sectorClear:boolean)
 S.phase="upgrade"
 S.sectorDraft=sectorClear
 S.choices={}
 local used:{[number]:boolean}={}
 for _=1,3 do
  local n=api.random.nextInt(1,#UPGRADES)
  while used[n] do n=n%#UPGRADES+1 end
  used[n]=true
  local u=UPGRADES[n]
  table.insert(S.choices,{id=u.id,name=u.name,description=u.description,desc=u.description,rarity=u.rarity})
 end
end
local function install(index:number)
 local chosen=S.choices[index]
 if not chosen then return end
 local k=chosen.id
 local p,st=S.player,S.stats
 if k=="reactor" then st.damage*=1.25
 elseif k=="autoloader" then st.fireInterval=math.max(.055,st.fireInterval*.82)
 elseif k=="twin" then st.projectiles=math.min(5,st.projectiles+1);if st.projectiles==5 then st.damage*=1.1 end
 elseif k=="shield" then p.maxShield+=30;p.shield=p.maxShield;st.shieldRegen*=1.2
 elseif k=="hull" then p.maxHp+=35;p.hp=math.min(p.maxHp,p.hp+50)
 elseif k=="thruster" then st.speed*=1.15;st.dashCooldown*=.85
 elseif k=="magnet" then st.magnet+=85;p.hp=math.min(p.maxHp,p.hp+25)
 elseif k=="pulse" then st.burstDamage*=1.6;st.burstRadius*=1.2;st.burstInterval*=.85
 elseif k=="pierce" then st.pierce+=1;st.damage*=1.1 end
 S.upgrades[k]=(S.upgrades[k] or 0)+1
 S.upgradesInstalled+=1
 S.choices={}
 if S.sectorDraft then
  S.sector+=1;S.sectorTime=0;S.enemies={};S.bullets={};S.wave=0;S.spawnCooldown=2
  p.shield=p.maxShield;p.hp=math.min(p.maxHp,p.hp+15);S.burstCooldown=0
  fx("pulse",p.x,p.y,430,1)
 end
 S.sectorDraft=false
 S.phase="playing"
end
local function damagePlayer(amount:number)
 local p=S.player
 if p.invuln>0 or S.phase~="playing" then return end
 local blocked=math.min(p.shield,amount)
 p.shield-=blocked
 p.hp=math.max(0,p.hp-(amount-blocked))
 p.invuln=.55;p.hit=.3;S.lastDamage=S.time;S.damageTaken+=amount
 fx("hit",p.x,p.y,55,.3)
 if p.hp<=0 then S.phase="gameover";fx("explosion",p.x,p.y,130,1.5) end
end
local function destroyEnemy(api:EngineApi,index:number)
 local e=S.enemies[index]
 fx("explosion",e.x,e.y,e.kind=="boss" and 200 or e.radius*1.7,e.kind=="boss" and 1.5 or .65)
 S.kills+=1
 S.credits+=e.kind=="boss" and 200 or e.kind=="heavy" and 12 or 5
 if e.kind=="boss" then S.phase="victory";S.bullets={};table.remove(S.enemies,index);return end
 table.insert(S.pickups,{id=id(),kind="xp",x=e.x,y=e.y,value=e.kind=="heavy" and 7 or 3,radius=10,life=25})
 if api.random.nextFloat()<.13 then table.insert(S.pickups,{id=id(),kind="repair",x=e.x+16,y=e.y,value=18,radius=12,life=25}) end
 table.remove(S.enemies,index)
end
local function nearestEnemy():any
 local result=nil
 -- Automatic targeting waits until a hostile reaches the combat viewport.
 -- Manual aim still uses the projectile's full ballistic range.
 local best=500^2
 for _,e in ipairs(S.enemies) do
  local d=dist2(S.player.x,S.player.y,e.x,e.y)
  if d<best then best=d;result=e end
 end
 return result
end
-- Swept circle impact: fast projectiles cannot tunnel between fixed ticks.
local function segmentDistance2(ax:number,ay:number,bx:number,by:number,px:number,py:number):number
 local dx,dy=bx-ax,by-ay
 local den=dx*dx+dy*dy
 local t=den>0 and clamp(((px-ax)*dx+(py-ay)*dy)/den,0,1) or 0
 return dist2(ax+dx*t,ay+dy*t,px,py)
end
local function updatePlayer(api:EngineApi,dt:number,dashPressed:boolean,burstPressed:boolean)
 local p,st=S.player,S.stats
 local function down(a:string,b:string):boolean return api.input.isDown(a) or api.input.isDown(b) end
 local dx=(down("KeyD","ArrowRight") and 1 or 0)-(down("KeyA","ArrowLeft") and 1 or 0)
 local dy=(down("KeyS","ArrowDown") and 1 or 0)-(down("KeyW","ArrowUp") and 1 or 0)
 local length=math.sqrt(dx*dx+dy*dy)
 if length>0 then dx/=length;dy/=length end
 S.dashCooldown=math.max(0,S.dashCooldown-dt)
 S.burstCooldown=math.max(0,S.burstCooldown-dt)
 p.invuln=math.max(0,p.invuln-dt);p.hit=math.max(0,p.hit-dt)
 p.boost=math.min(p.boostMax,p.boost+dt*29)
 if dashPressed and S.dashCooldown<=0 and p.boost>=35 then
  p.dashX=length>0 and dx or math.sin(p.angle)
  p.dashY=length>0 and dy or -math.cos(p.angle)
  p.dashTime=.19;p.invuln=.3;p.boost-=35;S.dashCooldown=st.dashCooldown;S.dashCount+=1
  fx("pulse",p.x,p.y,60,.32)
 end
 if p.dashTime>0 then p.dashTime=math.max(0,p.dashTime-dt);p.vx=p.dashX*st.speed*3.6;p.vy=p.dashY*st.speed*3.6
 else p.vx=dx*st.speed;p.vy=dy*st.speed end
 p.x=clamp(p.x+p.vx*dt,-BOUNDS.x+p.radius,BOUNDS.x-p.radius)
 p.y=clamp(p.y+p.vy*dt,-BOUNDS.y+p.radius,BOUNDS.y-p.radius)
 -- Rocks are solid obstacles. Contact separates the ship without arbitrary
 -- collision damage; hostile contact and projectiles remain damaging.
 for _,rock in ipairs(S.asteroids) do
  local rx,ry=p.x-rock.x,p.y-rock.y
  local d=math.sqrt(rx*rx+ry*ry)
  local r=p.radius+rock.radius
  if d<r and d>.001 then p.x=rock.x+rx/d*r;p.y=rock.y+ry/d*r end
 end
 if S.time-S.lastDamage>3 then p.shield=math.min(p.maxShield,p.shield+st.shieldRegen*dt) end
 local pointer=api.input.getPointerPosition()
 pointer={x=pointer.x,y=-pointer.y}
 local target=nearestEnemy()
 if S.autoFire and not api.input.isPointerDown() and target then
  -- A small lead makes moving targets readable while keeping ballistic shots.
  p.angle=angleTo(p.x,p.y,target.x,target.y)
 elseif dist2(p.x,p.y,pointer.x,pointer.y)>16 then p.angle=angleTo(p.x,p.y,pointer.x,pointer.y) end
 S.fireCooldown=math.max(0,S.fireCooldown-dt)
 if (api.input.isPointerDown() or api.input.isDown("Fire") or (S.autoFire and target)) and S.fireCooldown<=0 then
  S.fireCooldown=st.fireInterval
  for n=1,st.projectiles do
   local offset=(n-(st.projectiles+1)/2)*12
   bullet("player",p.x+math.sin(p.angle)*31+math.cos(p.angle)*offset,p.y-math.cos(p.angle)*31+math.sin(p.angle)*offset,p.angle,750,st.damage,5,st.pierce)
  end
  S.fired+=1
 end
 if burstPressed and S.burstCooldown<=0 then
  S.burstCooldown=st.burstInterval;S.burstCount+=1
  fx("burst",p.x,p.y,st.burstRadius,.85)
  for _,e in ipairs(S.enemies) do if dist2(p.x,p.y,e.x,e.y)<(st.burstRadius+e.radius)^2 then e.hp-=st.burstDamage;e.hit=.2 end end
  for i=#S.bullets,1,-1 do local b=S.bullets[i];if not b.friendly and dist2(p.x,p.y,b.x,b.y)<st.burstRadius^2 then table.remove(S.bullets,i) end end
 end
end
local function updateEnemies(api:EngineApi,dt:number)
 local p=S.player
 for _,e in ipairs(S.enemies) do
  if e.hp<=0 then continue end
  local dx,dy=p.x-e.x,p.y-e.y
  local distance=math.max(1,math.sqrt(dx*dx+dy*dy))
  e.angle=angleTo(e.x,e.y,p.x,p.y);e.age+=dt;e.hit=math.max(0,e.hit-dt)
  local desired=e.kind=="boss" and 390 or e.kind=="shooter" and 320 or 0
  if distance>desired then e.x+=dx/distance*e.speed*dt;e.y+=dy/distance*e.speed*dt
  elseif desired>0 and distance<desired-70 then e.x-=dx/distance*e.speed*dt*.6;e.y-=dy/distance*e.speed*dt*.6 end
  if e.kind=="shooter" then
   e.cooldown-=dt
   if e.cooldown<=0 then e.cooldown=math.max(1.25,2.8-S.sector*.25);bullet("enemy",e.x,e.y,e.angle,230,12,7,0) end
  elseif e.kind=="boss" then
   e.cooldown-=dt
   e.telegraph=e.cooldown<.8 and math.max(.01,.8-e.cooldown) or 0
   if e.cooldown<=0 then
    e.pattern+=1;e.cooldown=e.hp<e.maxHp*.5 and 1.9 or 2.7;e.telegraph=0
    if e.pattern%3==0 then
     for n=0,15 do bullet("enemy",e.x,e.y,n*math.pi/8+e.age*.2,180,16,9,0) end
    else for n=-3,3 do bullet("enemy",e.x,e.y,e.angle+n*.14,255,18,9,0) end end
    if e.pattern%4==0 then spawnEnemy(api,"chaser") end
   end
  end
  if distance<e.radius+p.radius then damagePlayer(e.kind=="boss" and 30 or e.kind=="heavy" and 24 or 16)
   e.x-=dx/distance*50;e.y-=dy/distance*50 end
 end
end
local function updateBullets(api:EngineApi,dt:number)
 for i=#S.bullets,1,-1 do
  local b=S.bullets[i]
  b.previousX=b.x;b.previousY=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt
  local remove=b.life<=0
  if b.friendly then
   for _,e in ipairs(S.enemies) do
    if not b.hits[tostring(e.id)] and segmentDistance2(b.previousX,b.previousY,b.x,b.y,e.x,e.y)<(e.radius+b.radius)^2 then
     e.hp-=b.damage;e.hit=.16;b.hits[tostring(e.id)]=true;fx("hit",b.x,b.y,24,.15)
     if b.pierce<=0 then remove=true;break else b.pierce-=1 end
    end
   end
  else local p=S.player
   if segmentDistance2(b.previousX,b.previousY,b.x,b.y,p.x,p.y)<(p.radius+b.radius)^2 then damagePlayer(b.damage);remove=true end
  end
  -- Friendly and hostile projectiles share the same geometric asteroid cover.
  if not remove then for _,rock in ipairs(S.asteroids) do
   if segmentDistance2(b.previousX,b.previousY,b.x,b.y,rock.x,rock.y)<(rock.radius+b.radius)^2 then remove=true;fx("hit",b.x,b.y,18,.12);break end
  end end
  if remove then table.remove(S.bullets,i) end
 end
 for i=#S.enemies,1,-1 do if S.enemies[i].hp<=0 then destroyEnemy(api,i) end end
end
local function updatePickups(dt:number)
 local p=S.player
 for i=#S.pickups,1,-1 do
  local v=S.pickups[i]
  local dx,dy=p.x-v.x,p.y-v.y
  local d=math.sqrt(dx*dx+dy*dy)
  v.life-=dt
  if d<S.stats.magnet and d>1 then local travel=math.min(d,dt*(190+550*(1-d/S.stats.magnet)));v.x+=dx/d*travel;v.y+=dy/d*travel end
  if d<27 then
   if v.kind=="repair" then p.hp=math.min(p.maxHp,p.hp+v.value);fx("pulse",p.x,p.y,60,.4)
   else S.xp+=v.value;S.credits+=1 end
   table.remove(S.pickups,i)
  elseif v.life<=0 then table.remove(S.pickups,i) end
 end
end

function Game.start(api:EngineApi)
 fresh(api,"menu")
 publish(api)
end
function Game.update(api:EngineApi,dt:number)
 -- Read every edge on every frame, even on a menu. Holding a button across
 -- a phase change must never buy another upgrade or toggle pause repeatedly.
 local pressed:{[string]:boolean}={}
 for _,name in ipairs({"Start","Restart","Menu","Pause","Resume","AutoFire","Burst","KeyQ","Dash","Space","ShiftLeft","ShiftRight","Select1","Select2","Select3","Enter","Escape","KeyF","Digit1","Digit2","Digit3","Sound","Abandon","CancelAbandon"}) do pressed[name]=edge(api,name) end
 local start=pressed.Start or pressed.Enter
 local restart=pressed.Restart or (pressed.Enter and (S.phase=="gameover" or S.phase=="victory"))
 local menu=pressed.Menu
 local pause=pressed.Pause or pressed.Escape
 local resume=pressed.Resume
 local auto=pressed.AutoFire or pressed.KeyF
 local burst=pressed.Burst or pressed.KeyQ
 local dash,space,shift,rightShift=pressed.Dash,pressed.Space,pressed.ShiftLeft,pressed.ShiftRight
 local select1,select2,select3=pressed.Select1 or pressed.Digit1,pressed.Select2 or pressed.Digit2,pressed.Select3 or pressed.Digit3
 if pressed.Sound then soundEnabled=not soundEnabled;api.audio.setMasterVolume(soundEnabled and .45 or 0) end
 if pressed.Abandon and S.phase=="paused" then abandonPrompt=true end
 if pressed.CancelAbandon then abandonPrompt=false end
 if menu then fresh(api,"menu");publish(api);return end
 if restart or (start and S.phase=="menu") then
  fresh(api,"playing");spawnEnemy(api,"chaser");spawnEnemy(api,"shooter");spawnEnemy(api,"chaser")
  publish(api);return
 end
 if pause and S.phase=="playing" then S.phase="paused";abandonPrompt=false
 elseif (resume or pause) and S.phase=="paused" then S.phase="playing";abandonPrompt=false end
 if auto and S.phase=="playing" then S.autoFire=not S.autoFire end
 if S.phase=="upgrade" then
  if select1 then install(1) elseif select2 then install(2) elseif select3 then install(3) end
  publish(api);return
 end
 if S.phase~="playing" then publish(api);return end
 dt=math.min(dt,.05)
 S.time+=dt;S.sectorTime+=dt
 updatePlayer(api,dt,dash or space or shift or rightShift,burst)
 updateEnemies(api,dt)
 updateBullets(api,dt)
 if S.phase=="playing" then updatePickups(dt) end
 for i=1,#S.asteroids do local a:any=S.asteroids[i];a.angle+=a.spin*dt end
 for i=#S.effects,1,-1 do local e=S.effects[i];e.life-=dt;if e.life<=0 then table.remove(S.effects,i) end end
 if S.phase=="playing" then
  S.spawnCooldown-=dt;S.waveCooldown-=dt
  if S.waveCooldown<=0 then S.wave+=1;S.waveCooldown=8;for _=1,math.min(4,S.sector+1) do spawnEnemy(api) end end
  if S.spawnCooldown<=0 then S.spawnCooldown=math.max(1.3,3-S.sector*.3);spawnEnemy(api) end
  if S.sector==4 and S.sectorTime>=8 and not S.bossSpawned then S.bossSpawned=true;spawnEnemy(api,"boss") end
  if S.sector<4 and S.sectorTime>=SECTOR_DURATION then draft(api,true)
  elseif S.xp>=S.xpNext then S.xp-=S.xpNext;S.xpNext+=10;S.level+=1;draft(api,false) end
 end
 publish(api)
end
return Game
