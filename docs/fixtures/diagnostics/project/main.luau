-- Scenario rules and restoration belong to the project, not Rust.
local ticks = 0
local held = {}
local Game = {}
function Game.start(api) end
function Game.update(api)
    ticks += 1
    if api.input.isDown("release") then
        table.clear(held)
    else
        table.insert(held, table.create(4096, ticks))
    end
    api.observation.set("ticks", ticks)
end
Game.replay = {
    id = "example.counter",
    version = "1",
    restore = function(capture, api)
        if capture.captureOrigin.kind ~= "start" then return false end
        ticks = capture.scenario.initialCount
        table.clear(held)
        return true
    end,
    compatible = function(versions, api)
        -- Accept only this project's own adapter and schema; games must define
        -- their actual migration policy rather than returning true blindly.
        return versions.source.game.id == versions.target.game.id
            and versions.sourceAdapter.id == "example.counter"
            and versions.sourceAdapter.version == "1"
            and versions.scenarioSchema.version == 1
    end,
    inspect = function(context, api)
        -- Must be read-only. Never consume RNG or change the gameplay state.
        return {invariants = {counter = ticks, retained = #held}, diagnostics = {}}
    end,
}
return Game
