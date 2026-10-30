--!strict
-- Shared by the native test (tests/immutable_bytes.rs) and the Wasm player
-- check (scripts/verify-immutable-bytes-wasm.mjs): both must observe the same.
local function expectFailure(call: () -> (), needle: string): string
    local ok, err = pcall(call)
    assert(not ok, "expected a failure containing " .. needle)
    local text = tostring(err)
    assert(string.find(text, needle, 1, true), text)
    return text
end

return {
    start = function(api)
        local data = buffer.create(16)
        buffer.writeu32(data, 0, 0xDEADBEEF)
        local alias = data
        assert(api.bytes.freeze(data) == data, "freeze returns the same buffer")
        api.bytes.freeze(data)
        assert(api.bytes.isFrozen(alias) and not api.bytes.isFrozen(buffer.create(1)))

        local scratch = buffer.create(16)
        local writes: {() -> ()} = {
            function() buffer.writeu8(alias, 0, 1) end,
            function() buffer.writei8(alias, 0, 1) end,
            function() buffer.writeu16(alias, 0, 1) end,
            function() buffer.writei16(alias, 0, 1) end,
            function() buffer.writeu32(alias, 0, 1) end,
            function() buffer.writei32(alias, 0, 1) end,
            function() buffer.writef32(alias, 0, 1) end,
            function() buffer.writef64(alias, 0, 1) end,
            function() buffer.writestring(alias, 0, "x") end,
            function() buffer.fill(alias, 0, 7) end,
            function() buffer.copy(alias, 0, scratch, 0, 4) end,
            function() buffer.writebits(alias, 0, 3, 5) end,
            -- Through a local the call is not a fastcall; in a loop it is hot.
            function() local write = buffer.writeu32; write(alias, 4, 1) end,
            function() for i = 0, 3 do buffer.writeu8(alias, i, i) end end,
        }
        for _, write in writes do
            expectFailure(write, "attempt to modify a readonly buffer")
        end
        -- Frozen data still reads and still works as a copy source.
        buffer.copy(scratch, 0, alias, 0, 4)
        api.observation.set("rejected_writes", #writes)
        api.observation.set("frozen_value", buffer.readu32(alias, 0))
        api.observation.set("copied_value", buffer.readu32(scratch, 0))

        local source = buffer.create(8)
        buffer.writeu32(source, 4, 42)
        local whole = api.bytes.snapshot(source)
        local tail = api.bytes.snapshot(source, 4, 4)
        buffer.writeu32(source, 4, 7)
        assert(api.bytes.isFrozen(whole) and api.bytes.isFrozen(tail) and not api.bytes.isFrozen(source))
        assert(not rawequal(whole, source) and buffer.len(tail) == 4)
        assert(rawequal(api.bytes.snapshot(whole), whole), "a whole frozen buffer is shared")
        assert(not rawequal(api.bytes.snapshot(whole, 0, 4), whole))
        assert(buffer.len(api.bytes.snapshot(source, 8, 0)) == 0)
        api.observation.set("snapshot_whole", buffer.readu32(whole, 4))
        api.observation.set("snapshot_tail", buffer.readu32(tail, 0))

        local range = 0
        for _, call in {
            function() api.bytes.snapshot(source, 5, 4) end,
            function() api.bytes.snapshot(source, -1) end,
            function() api.bytes.snapshot(source, 0, -1) end,
        } do
            expectFailure(call, "BYTES_RANGE_INVALID")
            range += 1
        end
        local wrongType = 0
        for _, call in {
            function() api.bytes.freeze("text" :: any) end,
            function() api.bytes.isFrozen(nil :: any) end,
            function() api.bytes.snapshot({} :: any) end,
        } do
            expectFailure(call, "BYTES_BUFFER_REQUIRED")
            wrongType += 1
        end
        expectFailure(function() api.bytes.freeze("text" :: any) end, "api.bytes.freeze expects a buffer, got string")
        api.observation.set("rejected_ranges", range)
        api.observation.set("rejected_types", wrongType)

        -- Engine APIs that read buffers accept frozen input unchanged.
        local packed = api.bytes.freeze(api.spatial.pack({{id = 1, position = {0, 0, 0}, radius = 1}}))
        api.observation.set("frozen_input_index", api.spatial.create(packed))
    end,
    update = function() end,
}
