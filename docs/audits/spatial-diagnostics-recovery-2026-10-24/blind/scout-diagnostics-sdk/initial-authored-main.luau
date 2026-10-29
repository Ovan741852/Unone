--!strict
-- BEGIN UNONE API TYPES
-- END UNONE API TYPES

type LabelledValue = {label: string, value: number}
local index = 0
local baseline = 0
local afterRejected = 0
local repaired = 0
local empty = 0
local updateNumber = 0

local function geometryQueries(): {SpatialQuery}
    local nearest: SpatialNearestQuery = {
        kind="nearest", point={0,0,0}, max_distance=100,
    }
    local overlap: SpatialOverlapQuery = {
        kind="overlap_sphere", center={0,0,0}, radius=7,
    }
    local sweep: SpatialSweepQuery = {
        kind="sweep_sphere", from={0,0,0}, to={10,0,0}, radius=1, mask=1,
    }
    local noContact: SpatialOverlapQuery = {
        kind="overlap_sphere", center={100,100,100}, radius=1,
    }
    local queries: {SpatialQuery} = {}
    table.insert(queries, nearest)
    table.insert(queries, overlap)
    table.insert(queries, sweep)
    table.insert(queries, noContact)
    return queries
end

local function publishFailure(api: EngineApi, key: string): EngineDiagnostic
    local diagnostic: EngineDiagnostic? = api.spatial.lastDiagnostic()
    assert(diagnostic ~= nil, "Structured diagnostic expected")
    api.observation.set(key, diagnostic)
    return diagnostic
end

local game: Game = {
    start = function(api: EngineApi)
        local bodies: {SpatialBody} = {
            {id=41, position={6,0,0}, radius=1, category=1},
            {id=7, position={0,8,0}, radius=2, category=2},
            {id=90, position={-4,0,0}, radius=0.5, category=1},
        }
        index = api.spatial.create(bodies)
        local info: SpatialInfo = api.spatial.info()
        local limits: SpatialLimits = info.limits
        local capacity: number = limits.queries_per_batch
        api.observation.set("initial_info", info)
        api.observation.set("typed_capacity", capacity)
        local p = api.entity.getPosition("unrelated_marker")
        api.observation.set("entity_before", {x=p.x,y=p.y})
        local numbers: {number} = {4,8,16}
        local sameNumbers: {number} = api.observation.array(numbers)
        local first: number = sameNumbers[1]
        sameNumbers[2] = first * 3
        api.observation.setArray("typed_numbers", sameNumbers)
        local records: {LabelledValue} = {{label="marker",value=37},{label="queries",value=4}}
        api.observation.setArray("typed_records", records)
        local emptyNumbers: {number} = {}
        api.observation.setArray("typed_empty", emptyNumbers)
        api.observation.set("plain_object", {})
    end,
    update = function(api: EngineApi, _dt: number)
        updateNumber += 1
        if updateNumber == 1 then
            baseline = api.spatial.submit(index, geometryQueries())
            api.observation.set("submission_update", updateNumber)
            local earlyOk = pcall(function()
                api.spatial.take(baseline)
            end)
            api.observation.set("same_tick_take_ok", earlyOk)
            if not earlyOk then publishFailure(api, "early_diagnostic") end

            -- A valid first record moves far away; second record is deliberately invalid.
            -- The entire replacement must be rejected atomically.
            local invalidBody: SpatialBody = {
                id=7, position={0,8,0}, radius=-2, category=2,
            }
            local replacement: {SpatialBody} = {
                {id=41, position={60,0,0}, radius=1, category=1},
                invalidBody,
                {id=90, position={-4,0,0}, radius=0.5, category=1},
            }
            local updateOk = pcall(function()
                api.spatial.update(index, replacement)
            end)
            api.observation.set("invalid_update_ok", updateOk)
            if not updateOk then
                local d = publishFailure(api, "invalid_diagnostic")
                -- No parsing of d.message or thrown strings; recovery uses structured fields.
                local canRepair = d.operation == "spatial.update"
                    and d.path == "bodies[2].radius"
                    and d.actual == -2
                    and d.recovery.retry == "after_correction"
                    and d.recoverable and not d.terminal
                api.observation.set("structured_repair_authorized", canRepair)
                afterRejected = api.spatial.submit(index, geometryQueries())
                if canRepair then
                    invalidBody.radius = 2
                    local version: number = api.spatial.update(index, replacement)
                    api.observation.set("repaired_version", version)
                    local retained = api.spatial.lastDiagnostic()
                    if retained then api.observation.set("diagnostic_after_success", retained) end
                    repaired = api.spatial.submit(index, geometryQueries())
                    local emptyQueries: {SpatialQuery} = {}
                    empty = api.spatial.submit(index, emptyQueries)
                end
            end
            api.observation.set("submitted_info", api.spatial.info())
            api.spatial.destroy(index)
            local staleOk = pcall(function()
                local noQueries: {SpatialQuery} = {}
                api.spatial.submit(index, noQueries)
            end)
            api.observation.set("destroyed_index_submit_ok", staleOk)
            if not staleOk then publishFailure(api, "stale_index_diagnostic") end
            api.observation.set("after_submission_profile", api.spatial.profile())
        elseif updateNumber == 2 then
            local original: SpatialBatchResult = api.spatial.take(baseline)
            local preserved: SpatialBatchResult = api.spatial.take(afterRejected)
            local changed: SpatialBatchResult = api.spatial.take(repaired)
            local emptyResult: SpatialBatchResult = api.spatial.take(empty)
            api.observation.set("baseline_result", original)
            api.observation.set("after_rejection_result", preserved)
            api.observation.set("repaired_result", changed)
            api.observation.set("empty_result", emptyResult)
            api.observation.set("delivery_update", updateNumber)
            local consumedOk = pcall(function()
                api.spatial.take(baseline)
            end)
            api.observation.set("consumed_ticket_take_ok", consumedOk)
            if not consumedOk then publishFailure(api, "consumed_diagnostic") end
            api.observation.set("final_info", api.spatial.info())
            local profile: SpatialProfile = api.spatial.profile()
            api.observation.set("final_profile", profile)
            local p = api.entity.getPosition("unrelated_marker")
            api.observation.set("entity_after", {x=p.x,y=p.y})
            api.observation.set("complete", true)
        end
    end,
}
return game
