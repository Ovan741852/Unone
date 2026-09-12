--!strict
local Game = {}
local ticks = 0
function Game.start(api: any)
    ticks = 0
    if api.debug.enabled then
        api.debug.registerTab({id="qa", label="QA"})
        api.debug.register({kind="button", id="qa.ping", tab="qa", label="Ping"}, function()
            api.observation.set("clicked", true)
        end)
    end
    api.observation.set("ticks", ticks)
end
function Game.update(api: any, dt: number)
    ticks += 1
    api.observation.set("ticks", ticks)
end
return Game
