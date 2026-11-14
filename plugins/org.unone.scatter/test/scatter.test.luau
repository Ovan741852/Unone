--!strict
-- Run with: luau plugins/org.unone.scatter/test/scatter.test.luau
local Scatter = require("../scatter/unone-scatter")

local function check(condition: boolean, message: string)
	if not condition then
		error("FAILED: " .. message, 2)
	end
end

-- Even spacing and determinism over a flat area.
local options = { area = { x = -50, z = -50, width = 100, depth = 100 }, spacing = 4, seed = 42 }
local a, b = Scatter.points(options), Scatter.points(options)
check(#a > 300 and #a < 1000, "about 100*100/(4*4) points, got " .. #a)
check(#a == #b and a[17].x == b[17].x and a[#a].yaw == b[#b].yaw, "the same seed gives the same points")
check(Scatter.points({ area = options.area, spacing = 4, seed = 43 })[1].x ~= a[1].x, "another seed moves them")
local closest = math.huge
for i = 1, math.min(#a, 200) do
	for j = i + 1, #a do
		closest = math.min(closest, math.sqrt((a[i].x - a[j].x) ^ 2 + (a[i].z - a[j].z) ^ 2))
	end
end
check(closest >= 4 - 1e-9, "no two points closer than the spacing, got " .. closest)
for _, p in a do
	check(p.x >= -50 and p.x < 50 and p.z >= -50 and p.z < 50 and p.y == 0, "points stay in the area")
end

-- A ramp heightfield: 11x11 samples, height = x, so a 45-degree slope; plus a flat top.
local heights = {}
for z = 0, 10 do
	for x = 0, 10 do
		table.insert(heights, if x <= 5 then x else 5)
	end
end
local field = { width = 11, depth = 11, heights = heights, cell_size = 1, origin = { x = 0, y = 2, z = 0 } }
check(Scatter.heightAt(field, 2.5, 3.7) == 2 + 2.5, "heights follow the drawn triangles")
check(Scatter.heightAt(field, -1, 0) == nil, "outside the field is nil")
local all = Scatter.points({ heightfield = field, spacing = 0.7, seed = 1 })
local flat = Scatter.points({ heightfield = field, spacing = 0.7, seed = 1, maxSlope = 20 })
local high = Scatter.points({ heightfield = field, spacing = 0.7, seed = 1, minHeight = 6 })
check(#flat < #all and #flat > 0, "maxSlope drops the ramp")
for _, p in flat do
	check(p.x >= 4.9, "only the flat top keeps points, got x = " .. p.x)
end
for _, p in high do
	check(p.y >= 6, "minHeight filters by world height")
	check(math.abs(p.y - (Scatter.heightAt(field, p.x, p.z) :: number)) < 1e-9, "points sit on the ground")
end
local even = Scatter.points({ heightfield = field, spacing = 0.7, seed = 1, accept = function(x)
	return math.floor(x) % 2 == 0
end })
check(#even > 0 and #even < #all, "accept filters with a game rule")

-- Packing: 40-byte records, yaw as a quaternion around +y.
local packed = Scatter.pack({ { x = 1, y = 2, z = 3, yaw = math.pi, scale = 2 } })
check(buffer.len(packed) == 40, "one 40-byte record")
check(buffer.readf32(packed, 0) == 1 and buffer.readf32(packed, 28) == 2, "position and scale")
check(math.abs(buffer.readf32(packed, 16) - 1) < 1e-6 and math.abs(buffer.readf32(packed, 24)) < 1e-6, "yaw pi is the quaternion (0, 1, 0, 0)")
print("scatter tests passed: " .. #a .. " points over 100x100 at spacing 4")
