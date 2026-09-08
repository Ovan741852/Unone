-- prepare/apply closures run in the gameplay VM; copy.luau is isolated.
local updates = 0
return {
    start = function(api)
        api.jobs.schedule("copy", {every_ticks = 3, times = 3}, function(api, occurrence)
            local input = buffer.create(4)
            buffer.writeu32(input, 0, updates)
            return input
        end, function(api, output, occurrence)
            api.observation.set("last_value", buffer.readu32(output, 0))
            api.observation.set("completed", occurrence)
        end)
    end,
    update = function(api, dt)
        updates += 1
    end,
}
