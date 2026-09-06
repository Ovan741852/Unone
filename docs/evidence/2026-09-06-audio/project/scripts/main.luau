--!strict
-- Audio evidence: everything here is a call the engine has to publish, so a
-- reader can check the sound against the observation without listening.
local Game = {}

local frame = 0
local music: string? = nil
local switched = false

function Game.start(api)
    music = api.audio.loop("audio://lobby", { category = "bgm", volume = 0.6 })
    api.audio.play("audio://click", { category = "sfx" })
end

function Game.update(api, _dt)
    frame += 1
    -- One click a second, so a listener can hear the one-shot path stay alive.
    if frame % 60 == 0 then
        api.audio.play("audio://click", { category = "sfx" })
    end
    -- The rule only the engine can enforce: the exclusive switch stops the
    -- previous track and its fade ends on a frame nothing had to report.
    if frame == 180 and not switched then
        switched = true
        music = api.audio.loop("audio://game", { category = "bgm", volume = 0.6 })
    end
    if api.input.isDown("Stop") and music ~= nil then
        api.audio.stopAll()
        music = nil
    end
    api.observation.set("view_model", {
        frame = frame,
        switched = switched,
    })
end

return Game
