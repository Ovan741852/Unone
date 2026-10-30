--!strict
-- Render pipeline fixture: declared passes retuned during play.
local frame = 0
return {
    start = function(api)
        api.observation.set("phase", "declared")
    end,
    update = function(api)
        frame += 1
        if frame == 120 then
            -- Warm tint on, bloom off.
            api.render.setPass("tint", {params = {amount = 0.6}})
            api.render.setPass("glow", {enabled = false})
            api.observation.set("phase", "tinted")
        elseif frame == 240 then
            -- Tone mapping exposure down, tint off, bloom back stronger.
            api.render.setPass("tone", {params = {exposure = 0.4}})
            api.render.setPass("tint", {enabled = false})
            api.render.setPass("glow", {enabled = true, params = {strength = 2.0}})
            api.observation.set("phase", "dim")
        end
        local tone = api.render.getPass("tone")
        api.observation.set("exposure", tone.params.exposure)
    end,
}
