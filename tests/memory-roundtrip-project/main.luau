-- Memory and frame-time fixture: screens that each own an image group, switched by keys, so
-- measure-web-export's scenario mode can drive real screen changes and real interaction.
--   city --T--> tech --B--> bag --Escape--> city;  city --F--> battle --Escape--> city
--   city --E--> empty;  city --M--> map (drag to pan);  city --L--> list (wheel to scroll)
-- City keeps its group loaded; every other screen loads its group on entry and unloads it on
-- exit. Battle spawns world sprites that move every tick and despawns them on exit; map pans the
-- camera over a world sprite while the pointer is dragged; list is a scroll view of image rows;
-- empty draws only its title, the minimal-player control (a screen always has nodes: ui.setRoot
-- rejects an empty children table on purpose). Each entry marks "<screen>.interactive" once
-- its group is ready, the milestone the scenarios wait for.
local Game = {}

local GROUP = {city = "city", tech = "tech", bag = "bag", battle = "battle", list = "tech", map = "city"}
local MENUS = {
    city = {"texture://city-map", "texture://city-hud"},
    tech = {"texture://tech-tree", "texture://tech-panel"},
    bag = {"texture://bag-grid", "texture://bag-items"},
}
local UNITS = 40
local ROWS = 40

local screen = "city"
local marked = false
local entities: {string} = {}
local lastPointer: {x: number, y: number}? = nil
local camera = {x = 0, y = 0}
local frame = 0

local function despawnAll(api: any)
    for _, id in entities do api.entity.despawn(id) end
    table.clear(entities)
end

local function enter(api: any, nextScreen: string)
    local groups = api.assets.imageGroups
    local before, after = GROUP[screen], GROUP[nextScreen]
    if before and before ~= "city" and before ~= after then groups.unload(before) end
    despawnAll(api)
    if screen == "map" then camera = {x = 0, y = 0}; api.camera.setPosition(camera) end
    screen = nextScreen
    marked = false
    lastPointer = nil
    if after and after ~= "city" then groups.load(after) end
    if screen == "battle" then
        table.insert(entities, api.entity.spawn("field", {transform = {x = 0, y = 0}, sprite = {asset = "texture://battle-field", size = {x = 16, y = 9}, layer = 0}}))
        for i = 1, UNITS do
            local asset = if i % 2 == 0 then "texture://battle-unit-a" else "texture://battle-unit-b"
            table.insert(entities, api.entity.spawn(`unit{i}`, {transform = {x = 0, y = 0}, sprite = {asset = asset, size = {x = 0.8, y = 0.8}, layer = 1}}))
        end
    elseif screen == "map" then
        table.insert(entities, api.entity.spawn("map", {transform = {x = 0, y = 0}, sprite = {asset = "texture://city-map", size = {x = 24, y = 24}, layer = 0}}))
    end
end

local function moveUnits(api: any)
    for i = 2, #entities do
        local n = i - 1
        local x = (n % 10) - 4.5 + math.sin(frame * 0.05 + n) * 0.4
        local y = math.floor((n - 1) / 10) - 1.5 + math.cos(frame * 0.04 + n) * 0.3
        api.entity.setPosition(entities[i], {x = x, y = y})
    end
end

local function panMap(api: any)
    if api.input.isPointerDown() then
        local p = api.input.getScreenPointerPosition()
        if lastPointer then
            camera = {x = camera.x - (p.x - lastPointer.x) * 0.16, y = camera.y - (p.y - lastPointer.y) * 0.09}
            api.camera.setPosition(camera)
        end
        lastPointer = {x = p.x, y = p.y}
    else
        lastPointer = nil
    end
end

local function view(api: any)
    local children = {}
    for i, asset in MENUS[screen] or {} do
        local tall = i == 1
        table.insert(children, {kind = "image", id = `{screen}_{i}`, asset = asset, fit = "stretch",
            rect = if tall then {x = 5, y = 5, width = 55, height = 90} else {x = 62, y = 30, width = 33, height = 40}})
    end
    if screen == "list" then
        local rows = {}
        for i = 1, ROWS do
            local asset = if i % 2 == 0 then "texture://tech-tree" else "texture://tech-panel"
            table.insert(rows, {kind = "image", id = `row_{i}_art`, asset = asset, fit = "stretch", rect = {x = 0, y = (i - 1) * 20, width = 18, height = 18}})
            table.insert(rows, {kind = "text", id = `row_{i}_name`, text = `Research {i}`, rect = {x = 20, y = (i - 1) * 20 + 4, width = 38, height = 10}})
        end
        table.insert(children, api.ui.scrollView({id = "research", viewport = {left = 5, top = 10, width = 60, height = 80}, content = rows}))
    end
    table.insert(children, {kind = "text", id = "title", text = screen, rect = {x = 2, y = 92, width = 30, height = 6}})
    api.ui.setRoot({kind = "screen", id = "round_trip", node = screen, children = children})
end

function Game.start(api: any)
    api.assets.imageGroups.load("city")
end

function Game.update(api: any, _dt: number)
    frame += 1
    local input = api.input
    if screen == "city" then
        if input.wasPressed("T") then enter(api, "tech")
        elseif input.wasPressed("F") then enter(api, "battle")
        elseif input.wasPressed("E") then enter(api, "empty")
        elseif input.wasPressed("M") then enter(api, "map")
        elseif input.wasPressed("L") then enter(api, "list") end
    elseif screen == "tech" then
        if input.wasPressed("B") then enter(api, "bag") elseif input.wasPressed("Escape") then enter(api, "city") end
    elseif input.wasPressed("Escape") then
        enter(api, "city")
    end
    if screen == "battle" then moveUnits(api) elseif screen == "map" then panMap(api) end
    view(api)
    if not marked then
        local group = GROUP[screen]
        -- Without a host that holds groups (game test, run) the images load when drawn.
        local state = if group then api.assets.imageGroups.status(group).state else "ready"
        if state == "ready" or state == "unsupported" then
            marked = true
            api.profile.mark(`{screen}.interactive`)
        end
    end
    api.observation.set("screen", screen)
    api.observation.set("entities", #entities)
    api.observation.set("camera_x", camera.x)
end

return Game
