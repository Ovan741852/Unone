-- Memory round-trip fixture: four screens that each own an image group, switched by keys,
-- so measure-web-export's scenario mode can drive real screen changes and watch owners.
--   city --T--> tech --B--> bag --Escape--> city;  city --F--> battle --Escape--> city
-- City keeps its group loaded; every other screen loads its group on entry and unloads it on
-- exit. Battle also spawns world sprites and despawns them on exit. Each entry marks
-- "<screen>.interactive" once its group is ready, the milestone the scenario waits for.
local Game = {}

local MENUS = {
    city = {"texture://city-map", "texture://city-hud"},
    tech = {"texture://tech-tree", "texture://tech-panel"},
    bag = {"texture://bag-grid", "texture://bag-items"},
}
local UNITS = 40

local screen = "city"
local marked = false
local units: {string} = {}

local function enter(api: any, nextScreen: string)
    local groups = api.assets.imageGroups
    if screen ~= "city" then groups.unload(screen) end
    for _, id in units do api.entity.despawn(id) end
    table.clear(units)
    screen = nextScreen
    marked = false
    if screen ~= "city" then groups.load(screen) end
    if screen == "battle" then
        table.insert(units, api.entity.spawn("field", {transform = {x = 0, y = 0}, sprite = {asset = "texture://battle-field", size = {x = 16, y = 9}, layer = 0}}))
        for i = 1, UNITS do
            local asset = if i % 2 == 0 then "texture://battle-unit-a" else "texture://battle-unit-b"
            local x, y = (i % 10) - 4.5, math.floor((i - 1) / 10) - 1.5
            table.insert(units, api.entity.spawn(`unit{i}`, {transform = {x = x, y = y}, sprite = {asset = asset, size = {x = 0.8, y = 0.8}, layer = 1}}))
        end
    end
end

local function view(api: any)
    local children = {}
    for i, asset in MENUS[screen] or {} do
        local tall = i == 1
        table.insert(children, {kind = "image", id = `{screen}_{i}`, asset = asset, fit = "stretch",
            rect = if tall then {x = 5, y = 5, width = 55, height = 90} else {x = 62, y = 30, width = 33, height = 40}})
    end
    table.insert(children, {kind = "text", id = "title", text = screen, rect = {x = 2, y = 92, width = 30, height = 6}})
    api.ui.setRoot({kind = "screen", id = "round_trip", node = screen, children = children})
end

function Game.start(api: any)
    api.assets.imageGroups.load("city")
end

function Game.update(api: any, _dt: number)
    local input = api.input
    if screen == "city" then
        if input.wasPressed("T") then enter(api, "tech") elseif input.wasPressed("F") then enter(api, "battle") end
    elseif screen == "tech" then
        if input.wasPressed("B") then enter(api, "bag") elseif input.wasPressed("Escape") then enter(api, "city") end
    elseif input.wasPressed("Escape") then
        enter(api, "city")
    end
    view(api)
    if not marked then
        local state = api.assets.imageGroups.status(screen).state
        -- Without a host that holds groups (game test, run) the images load when drawn.
        if state == "ready" or state == "unsupported" then
            marked = true
            api.profile.mark(`{screen}.interactive`)
        end
    end
    api.observation.set("screen", screen)
    api.observation.set("units", #units)
end

return Game
