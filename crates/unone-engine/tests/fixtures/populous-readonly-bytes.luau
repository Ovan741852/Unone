-- Populous-Reborn's Luau-only readonly bytes (experimental/original-readonly-bytes-r1-agent),
-- trimmed to the u32 read. It validates the wrapper on every read. Benchmark setup code:
-- expects `text` and defines `R` and `value`.
local R = (function()
    local M = {}; local KIND = "original.readonly-bytes.r1"
    local kindOf, metaOf, isFrozen, field, scan = type, getmetatable, table.isfrozen, rawget, next
    local freeze, check, byte = table.freeze, assert, string.byte
    function M.is(value)
        if kindOf(value) ~= "table" or metaOf(value) ~= nil or not isFrozen(value) then return false end
        if field(value, "kind") ~= KIND or kindOf(field(value, "bytes")) ~= "string" then return false end
        local count = 0
        for key in scan, value do
            if key ~= "kind" and key ~= "bytes" then return false end
            count += 1
        end
        return count == 2
    end
    local function raw(value) check(M.is(value), "READONLY_BYTES_VALUE"); return field(value, "bytes") end
    local function span(bytes, offset, count)
        check(kindOf(offset) == "number" and offset == offset and offset % 1 == 0 and offset >= 0, "READONLY_BYTES_OFFSET")
        check(kindOf(count) == "number" and count == count and count % 1 == 0 and count >= 0, "READONLY_BYTES_COUNT")
        check(offset <= #bytes and count <= #bytes - offset, "READONLY_BYTES_BOUNDS")
    end
    function M.fromString(bytes) return freeze({kind = KIND, bytes = bytes}) end
    function M.u32(value, offset)
        local bytes = raw(value); span(bytes, offset, 4)
        local a, b, c, d = byte(bytes, offset + 1, offset + 4)
        return a + b * 256 + c * 65536 + d * 16777216
    end
    return freeze(M)
end)()
local value = R.fromString(text)
