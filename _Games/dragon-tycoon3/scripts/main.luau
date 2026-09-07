-- Gameplay owns firing, integration, lifetime, damage and effect selection.
-- Rust supplies only a continuous 3D sphere query, with no projectile policy.
local Game = {}
local frame, shots, hits, previous = 0, 0, 0, false
local positions, bullets, effects = {}, {}, {}
local SPEED, GRAVITY, BULLET_RADIUS, TARGET_RADIUS = 10, -0.8, 0.12, 0.52
local function add(a,b) return {x=a.x+b.x,y=a.y+b.y,z=a.z+b.z} end
local function scale(a,s) return {x=a.x*s,y=a.y*s,z=a.z*s} end
local function sub(a,b) return {x=a.x-b.x,y=a.y-b.y,z=a.z-b.z} end
local function length(v) return math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z) end
local function wave(n) return math.abs((n%480)/240-1)*2-1 end
local function hud(api)
    api.ui.setRoot({kind="screen",id="hud",node="arena",children={
        {kind="text",id="title",rect={x=5,y=87,width=90,height=8},text="獵龍戰紀 3 · Unone"},
        {kind="text",id="score",rect={x=2,y=2,width=45,height=8},text="射擊 "..shots.."  /  命中 "..hits},
        {kind="button",id="fire",rect={x=76,y=2,width=22,height=9},text="發射測試子彈",action="probe.hit"},
        {kind="button",id="effect",rect={x=52,y=2,width=22,height=9},text="原作命中特效",action="probe.effect"},
        {kind="text",id="help",rect={x=5,y=79,width=90,height=6},text="點擊瞄準 · 子彈飛行碰撞後才命中"}
    }})
end
local function hitEffect(api,p)
    -- Existing Effekseer transport is XY; project this camera's contact to z=0.
    local projection=10/(10-p.z)
    local handle=api.effect.spawn("effect://reference/hit",{x=p.x*projection,y=p.y*projection,scale=0.006})
    table.insert(effects,{handle=handle,expires=frame+90})
end
function Game.start(api)
    for i=1,12 do positions[i]=api.entity.getTransform3D("target"..i).position end
    hud(api)
end
function Game.update(api,dt)
    frame+=1
    local targets={}
    for i=1,12 do
        local t=api.entity.getTransform3D("target"..i)
        table.insert(targets,{id="target"..i,radius=TARGET_RADIUS,previous_position=positions[i]})
        t.position={x=((i-1)%4)*2-3+wave(frame+i*39)*0.25,y=math.floor((i-1)/4)*1.5-1.5,z=wave(frame+i*31)*0.2}
        t.rotation={x=-1.15,y=0.25,z=-0.5}
        positions[i]=t.position
        api.entity.setTransform3D("target"..i,t)
    end
    local down=api.input.isPointerDown()
    if ((down and not previous) or api.input.isDown("probe.hit")) and #bullets<8 then
        shots+=1
        local aim
        if api.input.isDown("probe.hit") then aim=positions[1] else
            local p=api.input.getPointerPosition()
            aim={x=p.x*0.93261531631,y=p.y*0.93261531631,z=0}
        end
        local origin={x=0,y=-2.65,z=0.6}
        local delta=sub(aim,origin)
        local distance=length(delta)
        if distance>0.01 then
            local velocity=scale(delta,SPEED/distance)
            velocity.y-=0.5*GRAVITY*distance/SPEED
            table.insert(bullets,{position=origin,velocity=velocity,expires=frame+180,seed=shots})
        end
        hud(api)
    end
    if api.input.isDown("probe.effect") then hitEffect(api,{x=0,y=0,z=0}) end
    -- Semi-implicit integration and collision response belong to this game.
    for i=#bullets,1,-1 do
        local bullet=bullets[i]
        bullet.velocity.y+=GRAVITY*dt
        local nextPosition=add(bullet.position,scale(bullet.velocity,dt))
        local hit=api.physics3d.sweepSphere({from=bullet.position,to=nextPosition,radius=BULLET_RADIUS,targets=targets})
        if hit then
            hits+=1
            hitEffect(api,hit.point)
            table.remove(bullets,i)
            hud(api)
        elseif frame>=bullet.expires then table.remove(bullets,i)
        else
            bullet.position=nextPosition
            api.particle.play("bullet",bullet.position,bullet.seed)
        end
    end
    for i=#effects,1,-1 do
        if frame>=effects[i].expires then api.effect.stop(effects[i].handle);table.remove(effects,i) end
    end
    previous=down
    api.observation.set("shots",shots)
    api.observation.set("hits",hits)
    api.observation.set("targets",12)
    api.observation.set("flying_bullets",#bullets)
end
return Game
