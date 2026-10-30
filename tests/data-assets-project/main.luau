--!strict
-- Host parity fixture: every data asset loader, including one the game adds.
return {
    start = function(api)
        api.assets.registerLoader("csv", function(data: buffer, _id: string)
            local rows = {}
            for line in string.gmatch(buffer.tostring(data), "[^\n]+") do
                local row = {}
                for cell in string.gmatch(line, "[^,]+") do table.insert(row, tonumber(cell)) end
                table.insert(rows, row)
            end
            return rows
        end)
        local level = api.assets.load("data://level")
        local rom = api.assets.load("data://rom")
        local grid = api.assets.load("data://grid")
        api.observation.set("level", level.name)
        api.observation.set("area", level.size.w * level.size.h)
        api.observation.set("rom_u32", buffer.readu32(rom, 0))
        api.observation.set("rom_len", buffer.len(rom))
        api.observation.set("notes", api.assets.load("data://notes"))
        api.observation.set("grid", grid[2][3])
        api.observation.set("frozen", api.bytes.isFrozen(rom) and table.isfrozen(level) and table.isfrozen(grid[1]))
    end,
    update = function() end,
}
