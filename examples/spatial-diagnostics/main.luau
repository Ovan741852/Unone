--!strict
-- BEGIN UNONE API TYPES
-- SDK packing inserts the current canonical contract here. For a source copy:
-- game --project <copied-example> api typings --update-script main.luau
-- END UNONE API TYPES

-- Generic geometry, diagnostics and observation only; no scene mutation.
local index = 0
local pending: number? = nil
local emptyPending: number? = nil
local phase = 0

return {
    start = function(api: EngineApi)
        local bodies: {SpatialBody} = {
            {id=10, position={2,0,0}, radius=0.5, category=1},
            {id=20, position={8,0,0}, radius=1, category=2},
        }
        index = api.spatial.create(bodies)
        local info: SpatialInfo = api.spatial.info()
        local capacity: number = info.limits.queries_per_batch
        assert(info.delivery == "next_tick" and capacity >= 4)
        api.observation.set("info", info)
    end,
    update = function(api: EngineApi, _dt: number)
        phase += 1
        if phase == 1 then
            local overlap: SpatialOverlapQuery = {
                kind="overlap_sphere", center={2,0,0}, radius=-1,
            }
            local invalid: {SpatialQuery} = {overlap}
            local ok = pcall(function()
                api.spatial.submit(index, invalid)
            end)
            assert(not ok)
            local diagnostic: EngineDiagnostic? = api.spatial.lastDiagnostic()
            assert(diagnostic ~= nil)
            assert(diagnostic.operation == "spatial.submit")
            assert(diagnostic.path == "queries[1].radius")
            assert(diagnostic.recovery.retry == "after_correction")
            api.observation.set("rejected_input", diagnostic)

            -- Explicit variants preserve literal kind when inserted into a union array.
            overlap.radius = 0.25
            local nearest: SpatialNearestQuery = {
                kind="nearest", point={0,0,0}, max_distance=100, mask=3,
            }
            local sweep: SpatialSweepQuery = {
                kind="sweep_sphere", from={0,0,0}, to={12,0,0}, radius=0.25,
            }
            local noContact: SpatialNearestQuery = {
                kind="nearest", point={1000,0,0}, max_distance=1,
            }
            local queries: {SpatialQuery} = {}
            table.insert(queries, nearest)
            table.insert(queries, overlap)
            table.insert(queries, sweep)
            table.insert(queries, noContact)
            pending = api.spatial.submit(index, queries)
            emptyPending = api.spatial.submit(index, {})
            -- Success does not clear the last failure; read it directly after pcall.
            local retained = api.spatial.lastDiagnostic()
            assert(retained ~= nil and retained.path == "queries[1].radius")
        elseif phase == 2 then
            local ticket = pending
            local emptyTicket = emptyPending
            assert(ticket ~= nil and emptyTicket ~= nil)
            local result: SpatialBatchResult = api.spatial.take(ticket)
            local empty: SpatialBatchResult = api.spatial.take(emptyTicket)
            assert(result.version == 1 and #result.results == 4)
            for i = 1, 3 do
                local hit: SpatialHit = result.results[i].hits[1]
                assert(hit.id == 10)
            end
            assert(#result.results[4].hits == 0 and #empty.results == 0)
            -- Complete typed records publish directly, including nested empty [] arrays.
            api.observation.set("result", result)
            api.observation.set("empty_batch", empty)
            local numbers: {number} = {1,2,3}
            api.observation.setArray("numbers", numbers)
            api.observation.set("empty_array", api.observation.array())
            api.observation.set("plain_object", {})
            local profile: SpatialProfile = api.spatial.profile()
            api.observation.set("profile", profile)
            api.spatial.destroy(index)
            pending = nil
            emptyPending = nil
            api.observation.set("complete", true)
        end
    end,
}
