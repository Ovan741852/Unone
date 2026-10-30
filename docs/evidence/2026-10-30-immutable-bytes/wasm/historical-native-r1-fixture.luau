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

local retainedView: buffer? = nil
local tickCount = 0

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

        local B = api.bytes
        local checks, rejected = 0, 0
        local function check(value: boolean)
            assert(value, "extended immutable bytes contract")
            checks += 1
        end
        local function reject(call: () -> (), code: string)
            expectFailure(call, code)
            rejected += 1
            checks += 1
        end
        local characters: {string} = {}
        for byte = 0, 255 do characters[#characters + 1] = string.char(byte) end
        local binary = table.concat(characters)
        local root = B.freeze(buffer.fromstring("P" .. binary .. "Q"))
        local view = B.span(root, 1, 256)
        check(B.isFrozen(view) and buffer.len(view) == 256)
        local checksum = 0
        for byte = 0, 255 do
            check(buffer.readu8(view, byte) == byte)
            checksum += buffer.readu8(view, byte)
        end
        check(checksum == 32640 and buffer.tostring(view) == binary)
        check(buffer.readstring(view, 0, 2) == "\0\1")
        check(rawequal(B.snapshot(view), view))
        local empty = B.span(view, 256, 0)
        check(buffer.len(empty) == 0 and B.isFrozen(empty))
        check(B.equals(empty, B.freeze(buffer.create(0))))
        check(B.equalsRange(view, 256, empty, 0, 0))
        check(B.equals(view, B.freeze(buffer.fromstring(binary))))
        check(B.equals(view, buffer.fromstring(binary)))
        check(B.equalsRange(root, 1, view, 0, 256))
        check(not B.equals(view, buffer.fromstring("different")))
        local mutableEqual = buffer.fromstring(binary)
        check(B.equals(mutableEqual, view))
        buffer.writeu8(mutableEqual, 0, 99)
        check(not B.equals(mutableEqual, view) and buffer.readu8(view, 0) == 0)

        -- View bounds are independent of the surrounding root's readable bytes.
        reject(function() buffer.readu8(view, 256) end, "buffer access out of bounds")
        reject(function() buffer.readu32(view, 253) end, "buffer access out of bounds")
        reject(function() B.span(view, 255, 2) end, "BYTES_RANGE_INVALID")
        reject(function() B.snapshot(view, 255, 2) end, "BYTES_RANGE_INVALID")
        reject(function() B.equalsRange(view, 255, root, 0, 2) end, "BYTES_RANGE_INVALID")
        reject(function() B.equalsRange(root, 0, view, 255, 2) end, "BYTES_RANGE_INVALID")
        reject(function() B.span(buffer.create(8), 0, 4) end, "BYTES_FROZEN_REQUIRED")
        for _, number in {-1, -2147483648} do
            reject(function() B.snapshot(view, number) end, "BYTES_RANGE_INVALID")
            reject(function() B.span(view, 0, number) end, "BYTES_RANGE_INVALID")
        end
        for _, number in {0.5, 0 / 0, math.huge, -math.huge, 9007199254740992} do
            reject(function() B.snapshot(view, number) end, "BYTES_ARGUMENTS_INVALID")
            reject(function() B.snapshot(view, 0, number) end, "BYTES_ARGUMENTS_INVALID")
            reject(function() B.span(view, number, 0) end, "BYTES_ARGUMENTS_INVALID")
            reject(function() B.equalsRange(view, 0, view, 0, number) end, "BYTES_ARGUMENTS_INVALID")
        end
        reject(function() B.snapshot(view, "0" :: any) end, "BYTES_ARGUMENTS_INVALID")
        reject(function() B.span(view, 0, "1" :: any) end, "BYTES_ARGUMENTS_INVALID")
        reject(function() B.freeze(view, true) end, "BYTES_ARGUMENTS_INVALID")
        reject(function() B.isFrozen(view, true) end, "BYTES_ARGUMENTS_INVALID")
        reject(function() B.snapshot(view, 0, 1, true) end, "BYTES_ARGUMENTS_INVALID")
        reject(function() B.span(view, 0, 1, true) end, "BYTES_ARGUMENTS_INVALID")
        reject(function() B.equals(view, view, true) end, "BYTES_ARGUMENTS_INVALID")
        reject(function() B.equalsRange(view, 0, view, 0, 1, true) end, "BYTES_ARGUMENTS_INVALID")
        reject(function() B.equals(view, "\0" :: any) end, "BYTES_BUFFER_REQUIRED")
        reject(function() B.freeze(setmetatable({kind = "buffer"}, {__type = "buffer"}) :: any) end, "BYTES_BUFFER_REQUIRED")
        check(buffer.readu8(view, 0) == 0 and buffer.len(view) == 256)

        local endianRoot = B.freeze(buffer.fromstring("X\120\86\52\18\255\255\255\255\0\0\0\128"))
        local unaligned = B.span(endianRoot, 1, 12)
        check(buffer.readu16(unaligned, 0) == 0x5678)
        check(buffer.readu32(unaligned, 0) == 0x12345678)
        check(buffer.readu32(unaligned, 4) == 4294967295)
        check(buffer.readi32(unaligned, 4) == -1)
        check(buffer.readi32(unaligned, 8) == -2147483648)
        -- Standard buffer fastcalls and native reads must reject malformed
        -- ranges too; only byte payload values retain normal Luau conversion.
        local ordinary = buffer.create(16)
        for _, number in {0.5, 0 / 0, math.huge, -math.huge, 9007199254740992} do
            reject(function() buffer.readu32(ordinary, number) end, "buffer range")
            reject(function() buffer.readu32(unaligned, number) end, "buffer range")
            reject(function() buffer.writeu32(ordinary, number, 7) end, "buffer range")
            reject(function() buffer.fill(ordinary, 0, 0, number) end, "buffer range")
        end
        reject(function() buffer.readu32(unaligned, "0" :: any) end, "buffer range")
        reject(function() buffer.readstring(ordinary, 0, 0.5) end, "buffer range")
        reject(function() buffer.writebits(ordinary, 0.5, 1, 1) end, "buffer range")
        reject(function() buffer.readbits(unaligned, 0 / 0, 1) end, "buffer range")
        reject(function() buffer.create(0.5) end, "buffer range")
        reject(function() buffer.readu32(unaligned, 4294967296) end, "buffer access out of bounds")
        reject(function() buffer.writeu32(unaligned, 0, 0) end, "attempt to modify a readonly buffer")
        reject(function() buffer.copy(unaligned, 0, mutableEqual, 0, 1) end, "attempt to modify a readonly buffer")
        local output = buffer.create(256)
        buffer.copy(output, 0, view, 0, 256)
        buffer.writeu8(output, 0, 88)
        check(buffer.readu8(view, 0) == 0 and buffer.readu8(output, 0) == 88)
        local detached = B.snapshot(mutableEqual, 0, 4)
        buffer.fill(mutableEqual, 0, 77)
        check(buffer.readu8(detached, 0) == 99 and B.isFrozen(detached))

        -- These are actual buffer values, never trusted table brands. Replacing
        -- guest globals cannot change C-level type/range/readonly authority.
        local assertSaved, pcallSaved = assert, pcall
        local env = getfenv(0)
        local oldBuffer, oldType, oldMath, oldAssert = env.buffer, env.type, env.math, env.assert
        local oldPairs, oldString = env.pairs, env.string
        local ok, message = pcallSaved(function()
            env.buffer = {tostring = function() return "forged" end}
            env.type = function() return "buffer" end
            env.math = {huge = 0}
            env.assert = function() end
            env.pairs = function() return function() end end
            env.string = {byte = function() return 99 end}
            assertSaved(B.isFrozen(view))
            assertSaved(B.equalsRange(view, 0, root, 1, 256))
            assertSaved(not pcallSaved(B.freeze, {kind = "buffer"}))
            assertSaved(not pcallSaved(B.snapshot, view, "0"))
        end)
        env.buffer, env.type, env.math, env.assert = oldBuffer, oldType, oldMath, oldAssert
        env.pairs, env.string = oldPairs, oldString
        assertSaved(ok, message)
        checks += 4

        -- Nonportable buffers must fail before replacing a prior observation/save.
        api.observation.set("immutable_bytes_boundary", "unchanged")
        local okObservation = pcall(api.observation.set, "immutable_bytes_boundary", {nested = view})
        check(not okObservation)
        api.save.set({immutable_bytes = "portable-only", revision = 1})
        local okSave = pcall(api.save.set, {nested = view})
        check(not okSave)
        local saved = api.save.get()
        check(saved.immutable_bytes == "portable-only" and saved.revision == 1)

        -- Keep only a nested child across fixed ticks. Native host tests also
        -- prove backing reachability/retirement with a separate unit-only GC.
        retainedView = B.span(B.span(view, 10, 100), 7, 5)
        root, view, endianRoot, unaligned = nil, nil, nil, nil
        api.observation.set("immutable_bytes_pass", true)
        api.observation.set("immutable_bytes_checks", checks)
        api.observation.set("immutable_bytes_rejections", rejected)
        api.observation.set("immutable_bytes_signature", "bytes-v2:256:32640:4294967295")
        api.observation.set("immutable_bytes_ticks", 0)
        api.observation.set("immutable_bytes_lifetime_value", 17)
    end,
    update = function(api)
        local child = retainedView :: buffer
        assert(api.bytes.isFrozen(child) and buffer.len(child) == 5)
        assert(buffer.readu8(child, 0) == 17 and buffer.readu8(child, 4) == 21)
        tickCount += 1
        api.observation.set("immutable_bytes_ticks", tickCount)
        api.observation.set("immutable_bytes_lifetime_value", buffer.readu8(child, 0))
    end,
}
