-- A small acceptance fixture, not application gameplay or a benchmark.
local phase = 0
return {
    start = function(api)
        api.observation.set("target_switch_fixture", true)
    end,
    update = function(api, dt)
        phase += dt
        api.entity.setPosition("moving", { x = math.sin(phase) * 3, y = 0 })
    end,
}
