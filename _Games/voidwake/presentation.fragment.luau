-- Engine-owned presentation for VOIDWAKE. This fragment is inlined into the
-- single Luau entry before publish(); it reads S and never changes gameplay or
-- consumes its random stream. Bitmap art is imagegen PNGs; native particle
-- shapes, Bloom and material resources are provided by the official player.
local visualFrame = 0
local visualSerial = 0
local visualFired = 0
local visualVisibility: {[string]: boolean} = {}
local visualHandles: {any} = {}
local visualBatchHandles: {[string]: string} = {}
local visualExhaust: {any} = {}
local visualSeenEffects: {[number]: boolean} = {}
local visualEffectStarted: {[number]: number} = {}
local visualWaves: {any} = {}
local visualEchoes: {any} = {}
local visualWaveSlot = 0
local visualEchoSlot = 0
local visualShieldAt = -100
local visualLastEcho = -100
local visualDropped = 0
local visualCounts: {[string]: number} = {}

local function visualSlot(prefix:string, index:number):string
 return prefix .. (index < 10 and "0" or "") .. tostring(index)
end

local function visualShow(api:any, entity:string, visible:boolean)
 if visualVisibility[entity] ~= visible then
  api.entity.setSpriteVisible(entity, visible)
  visualVisibility[entity] = visible
 end
end

local function visualPlace(api:any, entity:string, x:number, y:number, angle:number, scale:number)
 api.entity.setTransform2D(entity, {
  position={x=x,y=-y}, rotation=-angle, scale={x=scale,y=scale},
 })
 visualShow(api, entity, true)
end

local function visualSeed(salt:number):number
 return math.floor(((S.seed or 1) + salt * 7919 + visualSerial * 104729) % 2147483647)
end

local function visualCanReserve(api:any, count:number):boolean
 local budget = api.particle.stats()
 local available=budget.active_handles < 58 and budget.reserved_particles + count <= 3900
 if not available then visualDropped+=1 end
 return available
end

local function visualPlay(api:any, effect:string, x:number, y:number, salt:number, births:number, life:number):string?
 if not visualCanReserve(api, births) then return nil end
 visualSerial += 1
 local handle = api.particle.play(effect, {x=x,y=-y,z=0.08}, visualSeed(salt))
 table.insert(visualHandles, {handle=handle,expires=visualFrame+life})
 visualCounts[effect]=(visualCounts[effect] or 0)+1
 return handle
end

-- Bullets and pickups share a few native instanced particle batches. Updating
-- their exact positions replaces the preceding batch rather than allocating
-- one effect handle per projectile or introducing another renderer.
local function visualBatch(api:any, key:string, effect:string, positions:{any}, maxCount:number, birthsPerOrigin:number)
 local previousHandle = visualBatchHandles[key]
 if previousHandle then api.particle.stop(previousHandle); visualBatchHandles[key] = nil end
 local count = math.min(#positions, maxCount)
 if count == 0 or not visualCanReserve(api, count*birthsPerOrigin) then return end
 local packed = buffer.create(count*12)
 for index=1,count do
  local point = positions[index]
  local offset = (index-1)*12
  buffer.writef32(packed,offset,point.x)
  buffer.writef32(packed,offset+4,-point.y)
  buffer.writef32(packed,offset+8,0.09)
 end
 visualSerial += 1
 visualBatchHandles[key] = api.particle.play_batch(effect, packed, visualSeed(visualFrame))
end

-- A fixed pool bounds image/material work independently of enemy density.
-- These are original imagegen textures shaded through the engine API.
local function visualWave(event:any, tint:{number}, energy:number, lifetime:number)
 visualWaveSlot=visualWaveSlot%6+1
 visualWaves[visualWaveSlot]={x=event.x,y=event.y,radius=event.radius,
  tint=tint,energy=energy,started=visualFrame,lifetime=lifetime,
  angle=(event.id%13)*.41,blast=event.kind=="explosion"}
end

local function resetPresentation(api:any)
 for _,record in ipairs(visualHandles) do api.particle.stop(record.handle) end
 for _,handle in pairs(visualBatchHandles) do api.particle.stop(handle) end
 visualFrame=0; visualSerial=0; visualFired=0
 visualVisibility={}; visualHandles={}; visualBatchHandles={}
 visualExhaust={}; visualSeenEffects={}
 visualEffectStarted={}
 visualWaves={};visualEchoes={};visualWaveSlot=0;visualEchoSlot=0
 visualShieldAt=-100;visualLastEcho=-100;visualDropped=0;visualCounts={}
 for index=1,28 do visualShow(api,visualSlot("hostile_",index),false) end
 for index=1,19 do visualShow(api,visualSlot("rock_",index),false) end
 for index=1,16 do visualShow(api,visualSlot("detonation_",index),false) end
 for index=1,6 do visualShow(api,visualSlot("plasma_wave_",index),false) end
 for index=1,4 do visualShow(api,visualSlot("phase_echo_",index),false) end
 visualShow(api,"player_shield_ripple",false)
 visualShow(api,"boss",false)
 visualShow(api,"player",true)
 api.shader.setMaterial("player","player_hull")
 api.shader.setMaterial("nebula","nebula_grade")
end

local function updatePresentation(api:any)
 visualFrame += 1
 local p = S.player
 local retained = {}
 for _,record in ipairs(visualHandles) do
  if record.expires >= visualFrame then table.insert(retained,record) end
 end
 visualHandles=retained

 -- The menu uses the same imagegen hull and engine material at showcase
 -- scale. Only its visual transform changes; the ship's gameplay state is
 -- still the untouched origin used when a sortie starts.
 local showcase = S.phase=="menu"
 local layoutValues=resolveVoidwakeUi(api).values
 local shipX = p.x + (showcase and layoutValues.showcaseX or 0)
 local shipY = p.y + (showcase and (layoutValues.showcaseY+math.sin(visualFrame/75)*5) or 0)
 local shipAngle = showcase and 0.12 or p.angle
 local shipScale = showcase and layoutValues.showcaseScale or 1

 -- The large imagegen nebula moves more slowly than the ship. Its material
 -- gently grades the original photographic detail through the Shader API.
 api.entity.setTransform2D("nebula",{
  position={x=p.x*0.93-300,y=-p.y*0.93},rotation=0,scale={x=1,y=1},
 })
 local sectorTint = S.sector==4 and {1.0,0.48,0.26}
  or S.sector==3 and {0.68,0.66,1.0}
  or S.sector==2 and {0.5,0.95,1.0} or {1.0,0.9,0.75}
 api.shader.setUniform("nebula_grade","sectorTint",sectorTint)
 api.shader.setUniform("nebula_grade","exposure",showcase and 0.76 or 0.96)

 if p.hp > 0 then visualPlace(api,"player",shipX,shipY,shipAngle,shipScale)
 else visualShow(api,"player",false) end
 api.shader.setUniform("player_hull","strength",showcase and .28 or p.shield/math.max(1,p.maxShield)+(p.dashTime>0 and 1.2 or 0))
 api.shader.setUniform("player_hull","impact",math.min(1,p.hit*4))

 for index=1,19 do
  local rock=S.asteroids[index]
  local entity=visualSlot("rock_",index)
  if rock and (not showcase or ((rock.x-shipX)^2+(rock.y-shipY)^2)>280^2) then visualPlace(api,entity,rock.x,rock.y,rock.angle,rock.radius*2/100)
  else visualShow(api,entity,false) end
 end

 local hostileIndex=0
 local hasBoss=false
 for _,enemy in ipairs(S.enemies) do
  if enemy.kind=="boss" then
   hasBoss=true
   visualPlace(api,"boss",enemy.x,enemy.y,enemy.angle,1)
   api.shader.setUniform("boss_hull","impact",math.min(1,enemy.hit*5))
   api.shader.setUniform("boss_hull","strength",0.3+enemy.telegraph*1.7)
  else
   hostileIndex+=1
   if hostileIndex<=28 then
    local entity=visualSlot("hostile_",hostileIndex)
    local material=visualSlot("enemy_hull_",hostileIndex)
    visualPlace(api,entity,enemy.x,enemy.y,enemy.angle,enemy.kind=="heavy" and 1.38 or enemy.kind=="shooter" and 0.94 or 1)
    api.shader.setUniform(material,"impact",math.min(1,enemy.hit*6))
    api.shader.setUniform(material,"strength",enemy.kind=="shooter" and 0.35 or 0.12)
   end
  end
 end
 for index=hostileIndex+1,28 do visualShow(api,visualSlot("hostile_",index),false) end
 visualShow(api,"boss",hasBoss)

 local friendly,hostile,xp,repair,friendlyTrail,hostileTrail={},{},{},{},{},{}
 for _,projectile in ipairs(S.bullets) do
  table.insert(projectile.friendly and friendly or hostile,{x=projectile.x,y=projectile.y})
  local trail=projectile.friendly and friendlyTrail or hostileTrail
  -- These positions come from the real swept ballistic segment. No separate
  -- projectile simulation or renderer is introduced for the tracer.
  local previousX=projectile.previousX or projectile.x
  local previousY=projectile.previousY or projectile.y
  table.insert(trail,{x=previousX,y=previousY})
  table.insert(trail,{x=(previousX+projectile.x)*.5,y=(previousY+projectile.y)*.5})
 end
 for _,pickup in ipairs(S.pickups) do
  table.insert(pickup.kind=="repair" and repair or xp,{x=pickup.x,y=pickup.y})
 end
 visualBatch(api,"friendly","rail_bolts",friendly,280,2)
 visualBatch(api,"hostile","hostile_bolts",hostile,280,2)
 visualBatch(api,"xp","salvage_xp",xp,192,2)
 visualBatch(api,"repair","salvage_repair",repair,96,2)
 visualBatch(api,"friendly_trail","rail_tracers",friendlyTrail,160,1)
 visualBatch(api,"hostile_trail","hostile_tracers",hostileTrail,80,1)

 -- Sixteen declarative exhaust directions let the engine orient the plume.
 -- Moving only the emission origin leaves already-born ions in world space.
 local emitting = p.hp>0 and (S.phase=="playing" or S.phase=="menu")
 local direction = math.floor((shipAngle/(math.pi*2)*16)+0.5)%16
 local boosting=p.dashTime>0 and S.phase=="playing"
 local plumeMode=showcase and "showcase_exhaust_" or boosting and "afterburner_" or "ion_exhaust_"
 for nozzle=1,2 do
  local record=visualExhaust[nozzle]
  local side=(nozzle==1 and -8 or 8)*shipScale
  local tail=27*shipScale
  local x=shipX-math.sin(shipAngle)*tail+math.cos(shipAngle)*side
  local y=shipY+math.cos(shipAngle)*tail+math.sin(shipAngle)*side
  if record and (not emitting or record.direction~=direction or record.mode~=plumeMode or visualFrame>=record.refresh) then
   api.particle.finish(record.handle)
   visualExhaust[nozzle]=nil
   record=nil
  end
  if emitting and not record then
   local handle=visualPlay(api,plumeMode..tostring(direction),x,y,nozzle,boosting and 52 or 26,48)
   if handle then
    record={handle=handle,direction=direction,mode=plumeMode,refresh=visualFrame+20}
    visualExhaust[nozzle]=record
   end
  end
  if record then api.particle.move(record.handle,{x=x,y=-y,z=0.045}) end
 end

 if S.fired>visualFired then
  visualPlay(api,"muzzle_flash",p.x+math.sin(p.angle)*33,p.y-math.cos(p.angle)*33,S.fired,7,12)
 end
 visualFired=S.fired

 -- The dash leaves four short hull echoes. They are plain scene sprites with
 -- imagegen ship art and a shared Shader API interface, behind the live ship.
 if boosting and visualFrame-visualLastEcho>=3 then
  visualEchoSlot=visualEchoSlot%4+1
  visualEchoes[visualEchoSlot]={x=p.x,y=p.y,angle=p.angle,started=visualFrame}
  visualLastEcho=visualFrame
 end

 -- The PNG supplies detailed blast debris; authored native emitters add the
 -- pressure wave, fast sparks and delayed embers. FX IDs prevent repeats on
 -- pause, upgrade screens, or several publications of the same game state.
 local seen:{[number]:boolean}={}
 local effectStarts:{[number]:number}={}
 local detonationIndex=0
 for _,event in ipairs(S.effects) do
  seen[event.id]=true
  effectStarts[event.id]=visualEffectStarted[event.id] or visualFrame
  if not visualSeenEffects[event.id] then
   if event.kind=="explosion" then
    visualPlay(api,event.radius>140 and "capital_detonation" or "hull_detonation",event.x,event.y,event.id,40,72)
    visualWave(event,{1,.55,.22},.68,21)
   elseif event.kind=="hit" then
    visualPlay(api,"impact_sparks",event.x,event.y,event.id,9,20)
    if event.radius>=50 then
     visualShieldAt=visualFrame
     visualPlay(api,"shield_impact",event.x,event.y,event.id,13,20)
    end
   elseif event.kind=="burst" then
    visualPlay(api,"emp_discharge",event.x,event.y,event.id,24,55)
    visualWave(event,{.3,.78,1},.8,28)
   elseif event.kind=="pulse" then
    visualPlay(api,event.radius>150 and "emp_discharge" or "phase_dash",event.x,event.y,event.id,event.radius>150 and 24 or 13,55)
    visualWave(event,{.32,.76,1},event.radius>150 and .6 or .24,event.radius>150 and 28 or 16)
   end
  end
  -- The bitmap supplies a brief dense gas accent, not a long static blast.
  -- Its material advects/swivels UV detail while independent native debris,
  -- cooling embers and smoke continue their own velocities and lifetimes.
  local blastAge=(visualFrame-effectStarts[event.id])/12
  if event.kind=="explosion" and blastAge<1 then
   detonationIndex+=1
   if detonationIndex<=16 then
    local entity=visualSlot("detonation_",detonationIndex)
    local age=blastAge
    local scale=event.radius*2/128*(0.52+(1-(1-age)^2)*.8)
    visualPlace(api,entity,event.x,event.y,(event.id%13)*0.41,scale)
    api.shader.setUniform(entity,"opacity",math.max(0,(1-age)^1.45))
    api.shader.setUniform(entity,"heat",math.max(0,1-age*1.6))
    api.shader.setUniform(entity,"age",age)
   end
  end
 end
 for index=detonationIndex+1,16 do visualShow(api,visualSlot("detonation_",index),false) end
 visualSeenEffects=seen
 visualEffectStarted=effectStarts

 local activeWaves,activeEchoes=0,0
 for index=1,6 do
  local wave=visualWaves[index]
  local entity=visualSlot("plasma_wave_",index)
  local age=wave and (visualFrame-wave.started)/wave.lifetime or 1
  if wave and age<1 then
   activeWaves+=1
   local expand=1-(1-age)^3
   local radius=wave.radius*(wave.blast and (.35+expand*1.2) or (.12+expand*.88))
   visualPlace(api,entity,wave.x,wave.y,wave.angle,radius*2/128)
   api.shader.setUniform(entity,"opacity",math.min(1,age*14+.25)*(1-age)^1.6)
   api.shader.setUniform(entity,"energy",wave.energy*(1-age))
   api.shader.setUniform(entity,"age",age)
   api.shader.setUniform(entity,"tint",wave.tint)
  else visualShow(api,entity,false) end
 end
 for index=1,4 do
  local echo=visualEchoes[index]
  local entity=visualSlot("phase_echo_",index)
  local age=echo and (visualFrame-echo.started)/14 or 1
  if echo and age<1 then
   activeEchoes+=1
   visualPlace(api,entity,echo.x,echo.y,echo.angle,1+age*.09)
   api.shader.setUniform(entity,"opacity",(1-age)^2*.24)
  else visualShow(api,entity,false) end
 end
 local shieldPulse=math.max(0,1-(visualFrame-visualShieldAt)/22)^2
 if shieldPulse>0 and p.hp>0 then
  visualPlace(api,"player_shield_ripple",p.x,p.y,0,1+(1-math.sqrt(shieldPulse))*.18)
  api.shader.setUniform("player_shield_ripple","pulse",shieldPulse)
  api.shader.setUniform("player_shield_ripple","tint",p.shield>0 and {.3,.75,1} or {1,.52,.22})
  api.shader.setUniform("player_shield_ripple","impactDirection",{math.sin(p.angle),math.cos(p.angle)})
 else visualShow(api,"player_shield_ripple",false) end

 local budget=api.particle.stats()
 api.observation.set("presentation",{
  renderer="official",particle_backend="native_declarative",shader_materials=59,
  plume_mode=plumeMode,afterburner=boosting,
  active_waves=activeWaves,active_echoes=activeEchoes,shield_pulse=shieldPulse,
  trail_points=math.min(#friendlyTrail,160)+math.min(#hostileTrail,80),
  active_handles=budget.active_handles,reserved_particles=budget.reserved_particles,
  live_particles=budget.live_particles,dropped_effects=visualDropped,
  explosions_played=(visualCounts.hull_detonation or 0)+(visualCounts.capital_detonation or 0),
  muzzle_flashes=visualCounts.muzzle_flash or 0,
  shield_impacts=visualCounts.shield_impact or 0,
  ability_discharges=visualCounts.emp_discharge or 0,
 })
end
