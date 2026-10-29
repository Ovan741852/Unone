-- Synthetic geometry only; all scene state is unrelated.
local tick = 0
local index = 0
local frozenTicket = 0
local replacementTicket = 0
local bodies: {SpatialBody} = {
    {id=41,position={3,0,0},radius=0.5,category=1},
    {id=17,position={-3,0,0},radius=0.5,category=1},
    {id=0,position={0.25,0,0},radius=0.125,category=2},
    {id=4294967295,position={0,3,0},radius=0.5,category=1},
    {id=73,position={8,0,0},previous_position={12,0,0},radius=0.5,category=4},
}
local queries: {SpatialQuery} = {
    {kind="nearest",point={0,0,0},max_distance=3,mask=1,exclude_id=17},
    {kind="overlap_sphere",center={0,0,0},radius=2.5,mask=1},
    {kind="sweep_sphere",from={0,0,0},to={10,0,0},radius=0.5,mask=4},
    {kind="nearest",point={0,0,0},max_distance=1,mask=2},
}
local function near(actual: number, expected: number)
    assert(math.abs(actual-expected) < 0.00002, "geometry mismatch")
end
local function checkHit(hit: SpatialHit, id: number, distance: number, fraction: number, point: {number}, normal: {number})
    assert(hit.id == id, "hit ID mismatch")
    near(hit.distance,distance)
    near(hit.fraction,fraction)
    for axis=1,3 do
        near(hit.point[axis],point[axis])
        near(hit.normal[axis],normal[axis])
    end
end
local function unchanged(api: EngineApi)
    local p = api.entity.getPosition("unrelated")
    assert(p.x == -23 and p.y == 47, "unrelated scene entity changed")
    api.observation.set("unrelated_current",{x=p.x,y=p.y})
end
local Game = {}
function Game.start(api: EngineApi)
    index = api.spatial.create(bodies)
    api.observation.set("spatial_info_start",api.spatial.info())
    local p = api.entity.getPosition("unrelated")
    api.observation.set("unrelated_before",{x=p.x,y=p.y})
    unchanged(api)
end
function Game.update(api: EngineApi, _dt: number)
    tick += 1
    if tick == 1 then
        local invalid: {SpatialBody} = {
            {id=9,position={1,0,0},radius=1},
            {id=9,position={2,0,0},radius=1},
        }
        local invalidOk, invalidError = pcall(function()
            api.spatial.update(index,invalid)
        end)
        assert(not invalidOk,"deliberate duplicate IDs unexpectedly accepted")
        api.observation.set("invalid_replacement",{rejected=not invalidOk,error=tostring(invalidError)})
        frozenTicket = api.spatial.submit(index,queries)
        api.observation.set("first_submission",{tick=tick,ticket=frozenTicket,expected_version=1})
        local earlyOk, earlyError = pcall(function()
            api.spatial.take(frozenTicket)
        end)
        assert(not earlyOk,"same-tick take unexpectedly accepted")
        api.observation.set("next_tick_boundary",{rejected_same_tick=not earlyOk,error=tostring(earlyError)})
        -- Mutate caller tables after submit. The pending result must retain both.
        bodies[1].position[1] = 300
        local firstQuery = queries[1]
        if firstQuery.kind == "nearest" then
            firstQuery.point[1] = 500
        end
        local repaired: {SpatialBody} = {
            {id=9,position={100,100,100},radius=0.5,category=7},
        }
        local packed = api.spatial.pack(repaired)
        local version = api.spatial.update(index,packed)
        assert(version == 2,"failed replacement advanced version")
        api.observation.set("repair",{version=version,packed_bytes=buffer.len(packed)})
        replacementTicket = api.spatial.submit(index,queries)
        api.spatial.destroy(index)
        api.observation.set("spatial_info_after_destroy",api.spatial.info())
        unchanged(api)
    elseif tick == 2 then
        local frozen: SpatialBatchResult = api.spatial.take(frozenTicket)
        local replacement: SpatialBatchResult = api.spatial.take(replacementTicket)
        api.observation.set("frozen_batch",frozen)
        api.observation.set("replacement_batch",replacement)
        api.observation.set("masked_nearest",frozen.results[1])
        api.observation.set("ordered_overlap",frozen.results[2])
        api.observation.set("moving_target_sweep",frozen.results[3])
        api.observation.set("zero_id_nearest",frozen.results[4])
        assert(frozen.version == 1 and replacement.version == 2,"snapshot version mismatch")
        assert(#frozen.results == 4 and #replacement.results == 4,"query order mismatch")
        assert(#frozen.results[1].hits == 1)
        checkHit(frozen.results[1].hits[1],41,3,0,{2.5,0,0},{-1,0,0})
        local overlaps = frozen.results[2].hits
        assert(#overlaps == 3,"overlap membership mismatch")
        checkHit(overlaps[1],17,3,0,{-2.5,0,0},{1,0,0})
        checkHit(overlaps[2],41,3,0,{2.5,0,0},{-1,0,0})
        checkHit(overlaps[3],4294967295,3,0,{0,2.5,0},{0,-1,0})
        assert(#frozen.results[3].hits == 1)
        checkHit(frozen.results[3].hits[1],73,55/7,11/14,{117/14,0,0},{-1,0,0})
        assert(#frozen.results[4].hits == 1)
        checkHit(frozen.results[4].hits[1],0,0.25,0,{0.125,0,0},{-1,0,0})
        for _, queryResult in replacement.results do
            assert(#queryResult.hits == 0,"replacement unexpectedly contacted")
        end
        local consumedOk, consumedError = pcall(function()
            api.spatial.take(frozenTicket)
        end)
        assert(not consumedOk,"consumed ticket unexpectedly reusable")
        api.observation.set("consumption_boundary",{rejected=not consumedOk,error=tostring(consumedError)})
        api.observation.set("spatial_info_complete",api.spatial.info())
        api.observation.set("verification",{passed=true,delivery_tick=tick,frozen_version=frozen.version,repaired_version=replacement.version})
        unchanged(api)
    end
end
return Game
