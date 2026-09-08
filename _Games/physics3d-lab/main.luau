local Game = {}
local frame = 0
local sensorEnters = 0
local moving = true
local function v(x,y,z) return {x=x,y=y,z=z} end
local function fire(api)
    api.physics3d.teleport("ball",{position=v(-7,2,0)})
    api.physics3d.setVelocity("ball",v(48,0,0))
    api.physics3d.setAngularVelocity("ball",v(0,0,0))
end
local function reset(api)
    for i=0,35 do
        local id=string.format("box%02d",i)
        api.physics3d.teleport(id,{position=v((i%6-2.5)*1.12,0.6+math.floor(i/6)*1.08,0)})
        api.physics3d.setVelocity(id,v(0,0,0))
        api.physics3d.setAngularVelocity(id,v(0,0,0))
    end
    fire(api)
end
function Game.start(api)
    assert(api.physics3d.getBody("ball").membership == -1)
    api.physics3d.addJoint("pendulum",{body_a="anchor",body_b="pendulum",anchor_a=v(0,-2,0),anchor_b=v(0,0,0),joint={kind="spherical"}})
    api.physics3d.applyImpulse("pendulum",v(2,0,0))
    fire(api)
    if api.debug.enabled then
        api.debug.registerTab({id="physics",label="3D 物理"})
        api.debug.register({kind="button",id="physics.fire",tab="physics",label="發射 CCD 球體"},function() fire(api) end)
        api.debug.register({kind="button",id="physics.reset",tab="physics",label="重建堆疊並射擊"},function() reset(api) end)
        api.debug.register({kind="checkbox",id="physics.moving",tab="physics",label="移動 kinematic 平台",checked=true},function(value) moving=value end)
        api.debug.register({kind="label",id="physics.stats",tab="physics",text="Fixed 60 Hz · Rapier"})
    end
end
function Game.update(api,dt)
    frame+=1
    if moving then
        local phase=frame%240
        local y=0.3+(phase<120 and phase or 240-phase)/60
        api.physics3d.moveKinematic("platform",{position=v(0,y,5)})
    end
    for _,contact in ipairs(api.physics3d.contacts()) do
        if contact.sensor and contact.phase=="enter" then sensorEnters+=1 end
    end
    -- Queries and gameplay decisions stay in Luau; the solver supplies geometry.
    local ray=api.physics3d.raycast({from=v(0,15,0),to=v(0,-2,0)})
    api.observation.set("ray_hit",ray and ray.id or "none")
    api.observation.set("sensor_enters",sensorEnters)
    if api.debug.enabled then
        api.debug.set("physics.stats","frame "..frame.." · trigger enter "..sensorEnters.." · ray "..(ray and ray.id or "none"))
    end
end
return Game
