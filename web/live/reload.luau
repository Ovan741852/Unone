--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type InputApi = { getPointerPosition: () -> Vec2, isPointerDown: () -> boolean }
type ObservationValue = nil | boolean | number | string | {[string]: ObservationValue} | {ObservationValue}
type UiApi = { setRoot: (root: ObservationValue) -> () }
type EngineApi = { entity: EntityApi, input: InputApi, ui: UiApi }
local Game = {}
local function publishUi(api: EngineApi)
    api.ui.setRoot({
        kind = "screen",
        id = "web-live",
        node = "probe",
        children = {
            { kind = "text", id = "title", rect = { x = 5, y = 84, width = 90, height = 10 }, text = "Unone live UI" },
            { kind = "button", id = "probe-button", rect = { x = 5, y = 5, width = 35, height = 10 }, text = "Probe", action = "Probe" },
        },
    })
end
function Game.start(api: EngineApi)
    publishUi(api)
end
function Game.update(api: EngineApi, dt: number)
    local position = api.entity.getPosition("web_probe")
    if api.input.isPointerDown() then
        position = api.input.getPointerPosition()
    else
        position.x += dt
    end
    api.entity.setPosition("web_probe", position)
    publishUi(api)
end
return Game
