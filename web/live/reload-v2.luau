--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type InputApi = { getPointerPosition: () -> Vec2, isPointerDown: () -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi }
local Game = {}
function Game.start(_api: EngineApi) end
function Game.update(api: EngineApi, dt: number)
    local position = api.entity.getPosition("web_probe")
    if api.input.isPointerDown() then
        position = api.input.getPointerPosition()
    else
        position.x += dt * 2
    end
    api.entity.setPosition("web_probe", position)
end
return Game
