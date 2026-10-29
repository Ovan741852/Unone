-- Game-owned generic geometry example. Canonical API types are inserted unchanged above.
type AuthoredRecord = {code: number, label: string}
type TimelineEvent = {tick: number, event: string, ticket: number, version: number}
local events: {TimelineEvent} = {}
local tick = 0
local smallIndex = 0
local largeIndex = 0
local initialTicket = 0
local emptyTicket = 0
local afterInvalidTicket = 0
local repairedTicket = 0
local smallTicket = 0
local largeTicket = 0
local initialBodies: {SpatialBody} = {
    {id=11, position={2,0,0}, radius=0.5, category=1},
    {id=22, position={8,0,0}, radius=1, category=2},
    {id=4294967295, position={12,0,0}, radius=0.25, category=1},
}
local repairedBodies: {SpatialBody} = {
    {id=11, position={4,0,0}, radius=0.5, category=1},
    {id=22, position={8,0,0}, radius=1, category=2},
    {id=4294967295, position={12,0,0}, radius=0.25, category=1},
}
local lifecycleQueries: {SpatialQuery} = {{kind="nearest", point={0,0,0}, max_distance=20, mask=1}}
local smallQueries: {SpatialQuery} = {
    {kind="nearest", point={0,0,0}, max_distance=20, mask=1},
    {kind="overlap_sphere", center={8,0,0}, radius=0.25, mask=2},
    {kind="sweep_sphere", from={0,0,0}, to={6,0,0}, radius=0.25, mask=1},
    {kind="nearest", point={100,0,0}, max_distance=1},
}
local largeQueries: {SpatialQuery} = {}
local function event(name: string, ticket: number, version: number): ()
    table.insert(events, {tick=tick, event=name, ticket=ticket, version=version})
end
local function sentinel(api: EngineApi, key: string): ()
    local p: Vec2 = api.entity.getPosition("unrelated_synthetic")
    api.observation.set(key, {id="unrelated_synthetic", x=p.x, y=p.y})
end
local Game = {}
function Game.start(api: EngineApi): ()
    smallIndex = api.spatial.create(initialBodies)
    local largeBodies: {SpatialBody} = {}
    for i=1,4096 do
        table.insert(largeBodies, {id=i, position={((i-1)%64)*3, math.floor((i-1)/64)*3, 10}, radius=0.5, category=1})
    end
    largeIndex = api.spatial.create(largeBodies)
    for i=1,256 do
        table.insert(largeQueries, {kind="nearest", point={((i-1)%64)*3, math.floor((i-1)/64)*3, 10}, max_distance=0.1, mask=1})
    end
    local numbers: {number} = {1.25,2147483648,4294967295}
    local markedNumbers: {number} = api.observation.array(numbers)
    local first: number = markedNumbers[1]
    markedNumbers[1] = first + 0.25
    local emptyNumbers: {number} = {}
    local records: {AuthoredRecord} = {{code=7,label="seven"},{code=8,label="eight"}}
    local emptyRecords: {AuthoredRecord} = {}
    api.observation.setArray("typed_numbers", markedNumbers)
    api.observation.setArray("typed_empty_numbers", emptyNumbers)
    api.observation.setArray("typed_records", api.observation.array(records))
    api.observation.setArray("typed_empty_records", emptyRecords)
    api.observation.set("authored_empty", api.observation.array())
    api.observation.setArray("authored_empty_setter")
    api.observation.set("authored_nested", {children=api.observation.array()})
    api.observation.set("plain_empty_object", {})
    api.observation.set("spatial_info_start", api.spatial.info())
    sentinel(api, "sentinel_before")
end
function Game.update(api: EngineApi, _dt: number): ()
    tick += 1
    if tick == 1 then
        initialTicket = api.spatial.submit(smallIndex, lifecycleQueries)
        event("submit_initial", initialTicket, 1)
        local earlyOk, earlyError = pcall(function(): () api.spatial.take(initialTicket) end)
        api.observation.set("same_tick_take", {ok=earlyOk,message=tostring(earlyError),tick=tick})
        emptyTicket = api.spatial.submit(smallIndex, {})
        event("submit_empty", emptyTicket, 1)
        -- Deliberately invalid input: duplicate IDs; the valid index must survive.
        local duplicateBodies: {SpatialBody} = {
            {id=11,position={200,0,0},radius=1},
            {id=11,position={300,0,0},radius=1},
        }
        local invalidOk, invalidError = pcall(function(): () api.spatial.update(smallIndex, duplicateBodies) end)
        api.observation.set("invalid_update", {ok=invalidOk,message=tostring(invalidError),tick=tick})
        afterInvalidTicket = api.spatial.submit(smallIndex, lifecycleQueries)
        event("submit_after_invalid", afterInvalidTicket, 1)
        local repairedVersion: number = api.spatial.update(smallIndex, repairedBodies)
        api.observation.set("repair_version", repairedVersion)
        repairedTicket = api.spatial.submit(smallIndex, lifecycleQueries)
        event("submit_repaired", repairedTicket, repairedVersion)
    elseif tick == 2 then
        local initial: SpatialBatchResult = api.spatial.take(initialTicket)
        local empty: SpatialBatchResult = api.spatial.take(emptyTicket)
        local afterInvalid: SpatialBatchResult = api.spatial.take(afterInvalidTicket)
        local repaired: SpatialBatchResult = api.spatial.take(repairedTicket)
        api.observation.set("initial_result", initial)
        api.observation.set("empty_batch_result", empty)
        api.observation.set("after_invalid_result", afterInvalid)
        api.observation.set("after_repair_result", repaired)
        event("delivered_initial", initialTicket, initial.version)
        event("delivered_empty", emptyTicket, empty.version)
        event("delivered_after_invalid", afterInvalidTicket, afterInvalid.version)
        event("delivered_repaired", repairedTicket, repaired.version)
        local consumedOk, consumedError = pcall(function(): () api.spatial.take(initialTicket) end)
        api.observation.set("consumed_take", {ok=consumedOk,message=tostring(consumedError),tick=tick})
        local lifecycleProfile: SpatialProfile = api.spatial.profile()
        api.observation.set("lifecycle_profile", lifecycleProfile)
    elseif tick == 3 then
        smallTicket = api.spatial.submit(smallIndex, smallQueries)
        event("submit_small_case", smallTicket, 2)
    elseif tick == 4 then
        local result: SpatialBatchResult = api.spatial.take(smallTicket)
        api.observation.set("small_result", result)
        event("delivered_small_case", smallTicket, result.version)
        local profile: SpatialProfile = api.spatial.profile()
        api.observation.set("small_profile", profile)
        api.spatial.destroy(smallIndex)
        local staleOk, staleError = pcall(function(): () api.spatial.submit(smallIndex, lifecycleQueries) end)
        api.observation.set("stale_index_submit", {ok=staleOk,message=tostring(staleError),tick=tick})
    elseif tick == 5 then
        largeTicket = api.spatial.submit(largeIndex, largeQueries)
        event("submit_large_case", largeTicket, 1)
    elseif tick == 6 then
        local result: SpatialBatchResult = api.spatial.take(largeTicket)
        api.observation.set("large_result", result)
        event("delivered_large_case", largeTicket, result.version)
        local profile: SpatialProfile = api.spatial.profile()
        api.observation.set("large_profile", profile)
        api.observation.set("spatial_info_final", api.spatial.info())
    end
    sentinel(api, "sentinel_after")
    api.observation.setArray("timeline", events)
    api.observation.set("executed_ticks", tick)
end
return Game
