--!strict
-- Bounded natural-collection witness for the actual WASM VM. No collector API,
-- clock, game data or renderer is used. Cumulative pressure is not live memory.
local watch: {[string]: buffer?} = setmetatable({}, {__mode = "v"})
local child: buffer? = nil
local released = false
local tickCount = 0
local childLength = 32768
local rootOffset = 1031 + 4113
local pressureBytes = 0

local function pattern(index: number): number
    return (index * 37 + 11) % 256
end

local function checkChild()
    assert(child ~= nil, "NATURAL_GC_CHILD_MISSING")
    assert(watch.root ~= nil, "NATURAL_GC_ROOT_COLLECTED_WHILE_CHILD_LIVE")
    local view = child :: buffer
    assert(buffer.len(view) == childLength)
    for index = 0, childLength - 1 do
        assert(buffer.readu8(view, index) == pattern(rootOffset + index), "NATURAL_GC_CHILD_BYTES_CHANGED")
    end
    local writable, errorText = pcall(buffer.writeu8, view, 0, 123)
    assert(not writable and string.find(tostring(errorText), "readonly", 1, true))
    local inBounds = pcall(buffer.readu8, view, childLength)
    assert(not inBounds, "NATURAL_GC_VIEW_ESCAPED_LOGICAL_BOUNDS")
end

return {
    start = function(api)
        do
            local root = buffer.create(131072)
            for index = 0, buffer.len(root) - 1 do buffer.writeu8(root, index, pattern(index)) end
            api.bytes.freeze(root)
            local intermediate = api.bytes.span(root, 1031, 65536)
            child = api.bytes.span(intermediate, 4113, childLength)
            watch.root = root
            watch.intermediate = intermediate
            watch.child = child
            assert(rawequal(watch.root, root) and rawequal(watch.intermediate, intermediate) and rawequal(watch.child, child))
        end
        checkChild()
        api.observation.set("bytes_gc_ready", true)
        api.observation.set("bytes_gc_ticks", 0)
        api.observation.set("bytes_gc_root_alive", true)
        api.observation.set("bytes_gc_intermediate_collected", false)
        api.observation.set("bytes_gc_child_collected", false)
        api.observation.set("bytes_gc_child_valid", true)
        api.observation.set("bytes_gc_released", false)
        api.observation.set("bytes_gc_pressure_bytes", 0)
        api.observation.set("bytes_gc_pressure_checksum", 0)
    end,
    update = function(api)
        tickCount += 1
        assert(tickCount <= 100, "NATURAL_GC_FIXED_TICK_BUDGET_EXCEEDED")
        if api.input.wasPressed("ReleaseLastChild") then
            assert(not released and watch.intermediate == nil, "NATURAL_GC_RELEASE_WITHOUT_INTERMEDIATE_WITNESS")
            child = nil
            released = true
        end
        local checksum = 0
        for index = 1, 32 do
            local ephemeral = buffer.create(65536)
            local value = (tickCount + index) % 256
            buffer.writeu8(ephemeral, 0, value)
            checksum += buffer.readu8(ephemeral, 0)
        end
        pressureBytes += 32 * 65536
        if not released then checkChild() end
        api.observation.set("bytes_gc_ticks", tickCount)
        api.observation.set("bytes_gc_root_alive", watch.root ~= nil)
        api.observation.set("bytes_gc_intermediate_collected", watch.intermediate == nil)
        api.observation.set("bytes_gc_child_collected", watch.child == nil)
        api.observation.set("bytes_gc_child_valid", not released)
        api.observation.set("bytes_gc_released", released)
        api.observation.set("bytes_gc_pressure_bytes", pressureBytes)
        api.observation.set("bytes_gc_pressure_checksum", checksum)
    end,
}
