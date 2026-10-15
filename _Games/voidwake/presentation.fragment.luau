-- Engine-owned presentation for VOIDWAKE. This fragment is inlined into the
-- single Luau entry before publish(); it reads S and never changes gameplay or
-- consumes its random stream. All art remains the original imagegen PNGs.
local visualFrame = 0
local visualSerial = 0
local visualFired = 0
local visualVisibility: {[string]: boolean} = {}
local visualHandles: {any} = {}
local visualBatchHandles: {[string]: string} = {}
local visualExhaust: {any} = {}
local visualSeenEffects: {[number]: boolean} = {}

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
 return budget.active_handles < 58 and budget.reserved_particles + count <= 3900
end

local function visualPlay(api:any, effect:string, x:number, y:number, salt:number, births:number, life:number):string?
 if not visualCanReserve(api, births) then return nil end
 visualSerial += 1
 local handle = api.particle.play(effect, {x=x,y=-y,z=0.08}, visualSeed(salt))
 table.insert(visualHandles, {handle=handle,expires=visualFrame+life})
 return handle
end

-- Bullets and pickups share a few native instanced particle batches. Updating
-- their exact positions replaces the preceding batch rather than allocating
-- one effect handle per projectile or introducing another renderer.
local function visualBatch(api:any, key:string, effect:string, positions:{any}, maxCount:number)
 local previousHandle = visualBatchHandles[key]
 if previousHandle then api.particle.stop(previousHandle); visualBatchHandles[key] = nil end
 local count = math.min(#positions, maxCount)
 if count == 0 or not visualCanReserve(api, count*2) then return end
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

local function resetPresentation(api:any)
 for _,record in ipairs(visualHandles) do api.particle.stop(record.handle) end
 for _,handle in pairs(visualBatchHandles) do api.particle.stop(handle) end
 visualFrame=0; visualSerial=0; visualFired=0
 visualVisibility={}; visualHandles={}; visualBatchHandles={}
 visualExhaust={}; visualSeenEffects={}
 for index=1,28 do visualShow(api,visualSlot("hostile_",index),false) end
 for index=1,19 do visualShow(api,visualSlot("rock_",index),false) end
 for index=1,16 do visualShow(api,visualSlot("detonation_",index),false) end
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
 local compact = api.ui.getViewport().aspect < 1.4
 local shipX = p.x + (showcase and (compact and 125 or 330) or 0)
 local shipY = p.y + (showcase and (-50+math.sin(visualFrame/75)*5) or 0)
 local shipAngle = showcase and 0.12 or p.angle
 local shipScale = showcase and (compact and 4.2 or 6.4) or 1

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

 local friendly,hostile,xp,repair={},{},{},{}
 for _,projectile in ipairs(S.bullets) do
  table.insert(projectile.friendly and friendly or hostile,{x=projectile.x,y=projectile.y})
 end
 for _,pickup in ipairs(S.pickups) do
  table.insert(pickup.kind=="repair" and repair or xp,{x=pickup.x,y=pickup.y})
 end
 visualBatch(api,"friendly","rail_bolts",friendly,280)
 visualBatch(api,"hostile","hostile_bolts",hostile,280)
 visualBatch(api,"xp","salvage_xp",xp,192)
 visualBatch(api,"repair","salvage_repair",repair,96)

 -- Eight declarative exhaust directions let the engine orient the plume.
 -- Moving only the emission origin leaves already-born ions in world space.
 local emitting = p.hp>0 and (S.phase=="playing" or S.phase=="menu")
 local direction = math.floor((shipAngle/(math.pi*2)*8)+0.5)%8
 for nozzle=1,2 do
  local record=visualExhaust[nozzle]
  local side=(nozzle==1 and -8 or 8)*shipScale
  local tail=27*shipScale
  local x=shipX-math.sin(shipAngle)*tail+math.cos(shipAngle)*side
  local y=shipY+math.cos(shipAngle)*tail+math.sin(shipAngle)*side
  if record and (not emitting or record.direction~=direction or visualFrame>=record.refresh) then
   api.particle.finish(record.handle)
   visualExhaust[nozzle]=nil
   record=nil
  end
  if emitting and not record then
   local handle=visualPlay(api,"ion_exhaust_"..tostring(direction),x,y,nozzle,15,50)
   if handle then
    record={handle=handle,direction=direction,refresh=visualFrame+24}
    visualExhaust[nozzle]=record
   end
  end
  if record then api.particle.move(record.handle,{x=x,y=-y,z=0.045}) end
 end

 if S.fired>visualFired then
  visualPlay(api,"muzzle_flash",p.x+math.sin(p.angle)*33,p.y-math.cos(p.angle)*33,S.fired,1,8)
 end
 visualFired=S.fired

 -- The PNG supplies detailed blast debris; authored native emitters add the
 -- pressure wave, fast sparks and delayed embers. FX IDs prevent repeats on
 -- pause, upgrade screens, or several publications of the same game state.
 local seen:{[number]:boolean}={}
 local detonationIndex=0
 for _,event in ipairs(S.effects) do
  seen[event.id]=true
  if not visualSeenEffects[event.id] then
   if event.kind=="explosion" then
    visualPlay(api,event.radius>140 and "capital_detonation" or "hull_detonation",event.x,event.y,event.id,48,65)
   elseif event.kind=="hit" then
    visualPlay(api,"impact_sparks",event.x,event.y,event.id,9,20)
   elseif event.kind=="burst" then
    visualPlay(api,"emp_discharge",event.x,event.y,event.id,26,55)
   elseif event.kind=="pulse" then
    visualPlay(api,event.radius>150 and "emp_discharge" or "phase_dash",event.x,event.y,event.id,event.radius>150 and 26 or 13,55)
   end
  end
  if event.kind=="explosion" then
   detonationIndex+=1
   if detonationIndex<=16 then
    local entity=visualSlot("detonation_",detonationIndex)
    local age=1-event.life/event.maxLife
    local scale=event.radius*2/128*(0.6+age*0.65)
    visualPlace(api,entity,event.x,event.y,(event.id%13)*0.41,scale)
    api.shader.setUniform(entity,"opacity",math.max(0,(1-age)^1.7))
    api.shader.setUniform(entity,"heat",math.max(0,1-age*2))
   end
  end
 end
 for index=detonationIndex+1,16 do visualShow(api,visualSlot("detonation_",index),false) end
 visualSeenEffects=seen
end
