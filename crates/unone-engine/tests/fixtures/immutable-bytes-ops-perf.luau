--!strict
-- Shared Native/WASM microbenchmark. Select one BytesSize<size> and BytesOp<n>
-- held action; BytesBaseline selects the matching loop instead of the operation.
-- Timing includes normal tick work. This does not count allocations or prove FPS.
local sizes = {4096, 65536, 1048576}
local datasets = {}

local function run(api, data, operation: number, repetitions: number, baseline: boolean): number
    local sum = 0
    local last: buffer? = nil
    if baseline then
        for _ = 1, repetitions do sum += 1 end
    elseif operation == 1 then -- span
        for _ = 1, repetitions do
            last = api.bytes.span(data.frozenA, data.offset, data.length)
            sum += 1
        end
        assert(buffer.len(last :: buffer) == data.length and api.bytes.isFrozen(last))
    elseif operation >= 2 and operation <= 4 then -- equal distinct roots
        local left = if operation == 3 then data.frozenA else data.mutableA
        local right = if operation == 2 then data.mutableB else data.frozenB
        for _ = 1, repetitions do
            if api.bytes.equals(left, right) then sum += 1 end
        end
    elseif operation >= 5 and operation <= 7 then -- equal subranges
        local left = if operation == 6 then data.frozenA else data.mutableA
        local right = if operation == 5 then data.mutableB else data.frozenB
        for _ = 1, repetitions do
            if api.bytes.equalsRange(left, data.offset, right, data.offset, data.length) then sum += 1 end
        end
    elseif operation == 8 then -- mutable whole snapshot copies payload
        for _ = 1, repetitions do last = api.bytes.snapshot(data.mutableA); sum += 1 end
        assert(buffer.len(last :: buffer) == data.size and not rawequal(last, data.mutableA))
        assert(api.bytes.isFrozen(last) and buffer.readu8(last :: buffer, 0) == 90)
    elseif operation == 9 then -- frozen proper subrange still copies
        for _ = 1, repetitions do
            last = api.bytes.snapshot(data.frozenA, data.offset, data.length)
            sum += 1
        end
        assert(buffer.len(last :: buffer) == data.length and not rawequal(last, data.frozenA))
        assert(api.bytes.isFrozen(last) and buffer.readu8(last :: buffer, 0) == 90)
    elseif operation == 10 then -- frozen whole snapshot reuses identity
        for _ = 1, repetitions do last = api.bytes.snapshot(data.frozenA); sum += 1 end
        assert(rawequal(last, data.frozenA))
    elseif operation == 11 then -- repeated content includes Luau string interning
        local text = ""
        for _ = 1, repetitions do
            text = buffer.readstring(data.frozenA, data.offset, data.length)
            sum += 1
        end
        assert(#text == data.length and string.byte(text, 1) == 90)
    else
        error("unknown byte operation")
    end
    assert(sum == repetitions)
    return sum
end

return {
    start = function(api)
        for _, size in sizes do
            local a, b = buffer.create(size), buffer.create(size)
            buffer.fill(a, 0, 90)
            buffer.copy(b, 0, a, 0, size)
            datasets[#datasets + 1] = {
                size = size, offset = size / 4, length = size / 2,
                mutableA = a, mutableB = b,
                frozenA = api.bytes.snapshot(a), frozenB = api.bytes.snapshot(b),
            }
        end
        api.observation.set("bytes_ops_ready", true)
    end,
    update = function(api)
        local selectedSize, selectedOperation = 1, 1
        -- All selectors are read on every tick, including matching baselines.
        for index, size in sizes do
            if api.input.isDown("BytesSize" .. tostring(size)) then selectedSize = index end
        end
        for index = 1, 11 do
            if api.input.isDown("BytesOp" .. tostring(index)) then selectedOperation = index end
        end
        local data = datasets[selectedSize]
        local repetitions = if selectedOperation == 1 or selectedOperation == 10
            then 512 else math.max(1, math.floor(1048576 / data.size))
        local baseline = api.input.isDown("BytesBaseline")
        local sum = run(api, data, selectedOperation, repetitions, baseline)
        api.observation.set("bytes_ops_size", data.size)
        api.observation.set("bytes_ops_case", selectedOperation)
        api.observation.set("bytes_ops_repetitions", repetitions)
        api.observation.set("bytes_ops_baseline", baseline)
        api.observation.set("bytes_ops_checksum", sum)
    end,
}
