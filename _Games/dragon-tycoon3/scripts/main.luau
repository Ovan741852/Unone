-- Offline capability probe: no account, currency, server or copied game code.
-- Original textured Creator meshes in static rest pose; skeletal animation pending.
local Game = {}
local frame, shots, hits, previous = 0, 0, 0, false
local positions = {}
local function hud(api)
    api.ui.setRoot({kind="screen",id="hud",node="arena",children={
        {kind="text",id="title",rect={x=10,y=88,width=80,height=8},text="獵龍戰紀 3 · Unone 引擎驗證"},
        {kind="text",id="score",rect={x=2,y=2,width=45,height=8},text="射擊 "..shots.."  /  命中 "..hits},
        {kind="button",id="fire",rect={x=76,y=2,width=22,height=9},text="測試命中特效",action="probe.hit"},
        {kind="text",id="help",rect={x=10,y=79,width=80,height=6},text="原始龍／翼龍／猛虎模型 · 點擊射擊"}
    }})
end
function Game.start(api)
    api.particle.play("hit",{x=0,y=0,z=0},42)
    hud(api)
end
function Game.update(api, dt)
    frame += 1
    for i=1,12 do
        local t=api.entity.getTransform3D("target"..i)
        t.position.x=((i-1)%4)*2-3+math.sin(frame/90+i)*0.4
        t.position.y=math.floor((i-1)/4)*1.5-1.5
        t.position.z=math.sin(frame/120+i)*0.4
        t.rotation.x=-1.15
        t.rotation.y=0.25
        t.rotation.z=-0.5
        positions[i]=t.position
        api.entity.setTransform3D("target"..i,t)
    end
    local down=api.input.isPointerDown()
    if (down and not previous) or api.input.isDown("probe.hit") then
        shots += 1
        local selected=nil
        if api.input.isDown("probe.hit") then selected=1 else
            -- Temporary game-owned ray/sphere query. Missing engine 3D picking API.
            local p=api.input.getPointerPosition() -- default 2D camera supplies aspect-normalized coordinates
            local ray={x=p.x/5*math.tan(math.rad(25)),y=p.y/5*math.tan(math.rad(25)),z=-1}
            local nearest=math.huge
            for i,pos in positions do
                local z=10-pos.z
                local distance=(ray.x*z-pos.x)^2+(ray.y*z-pos.y)^2
                if distance<0.55^2 and z<nearest then selected=i;nearest=z end
            end
        end
        if selected then
            hits += 1
            api.particle.play("hit",positions[selected],shots)
        end
        hud(api)
    end
    previous=down
    api.observation.set("shots",shots)
    api.observation.set("hits",hits)
    api.observation.set("targets",12)
end
return Game
