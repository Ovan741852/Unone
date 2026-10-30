--!strict
-- Passes both official hosts execute, retuned at fixed frames so Web and
-- native captures can be compared phase by phase.
local frame = 0
return {
    start = function() end,
    update = function(api)
        frame += 1
        if frame == 120 then
            api.render.setPass("glow", {enabled = false})
        elseif frame == 240 then
            api.render.setPass("tone", {params = {exposure = 0.4}})
            api.render.setPass("glow", {enabled = true, params = {strength = 2.0}})
        elseif frame == 360 then
            api.render.setPass("tone", {enabled = false})
            api.render.setPass("glow", {enabled = false})
        end
        api.observation.set("frame", frame)
    end,
}
