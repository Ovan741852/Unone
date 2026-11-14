--!strict
-- Scatter instances over an area or a heightfield (plugins/org.unone.scatter):
-- evenly spaced random points (Poisson-disk), filtered by height, slope and
-- your own rule, with random yaw and scale, packed for api.instances3d.set.
-- Pure and deterministic: the same options and seed give the same points.
--
--   local scatter = require("./unone-scatter")
--   local trees = scatter.points({area = {x = 0, z = 0, width = 100, depth = 100},
--       spacing = 3, seed = 7, heightfield = terrain, maxSlope = 30})
--   api.instances3d.set("trees", "mesh://tree", scatter.pack(trees))

export type Heightfield = { width: number, depth: number, heights: { number }, cell_size: number, origin: { x: number, y: number, z: number } }
export type Area = { x: number, z: number, width: number, depth: number }
export type Point = { x: number, y: number, z: number, yaw: number, scale: number }
export type Options = {
	area: Area?, -- defaults to the heightfield's extent
	spacing: number, -- minimum distance between points
	seed: number?,
	heightfield: Heightfield?, -- places points on it and enables height/slope rules
	minHeight: number?,
	maxHeight: number?,
	maxSlope: number?, -- degrees from flat
	scale: { min: number, max: number }?,
	yaw: boolean?, -- random rotation around up (default true)
	limit: number?, -- at most this many points (default 100000)
	accept: ((x: number, y: number, z: number) -> boolean)?,
}

local Scatter = {}

-- xorshift32 in [0, 1): shifts and xors only, so it is exact on every host.
local function generator(seed: number): () -> number
	local state = bit32.bxor(math.floor(seed) % 4294967296, 0x9E3779B9)
	if state == 0 then
		state = 1
	end
	local function step(): number
		state = bit32.bxor(state, bit32.lshift(state, 13))
		state = bit32.bxor(state, bit32.rshift(state, 17))
		state = bit32.bxor(state, bit32.lshift(state, 5))
		return state / 4294967296
	end
	for _ = 1, 8 do
		step()
	end
	return step
end

--- World height of a heightfield at (x, z), on the same triangles the engine
--- draws, or nil outside it.
function Scatter.heightAt(field: Heightfield, x: number, z: number): number?
	local fx = (x - field.origin.x) / field.cell_size
	local fz = (z - field.origin.z) / field.cell_size
	if fx < 0 or fz < 0 or fx > field.width - 1 or fz > field.depth - 1 then
		return nil
	end
	local cx = math.min(math.floor(fx), field.width - 2)
	local cz = math.min(math.floor(fz), field.depth - 2)
	local u, v = fx - cx, fz - cz
	local function h(ix: number, iz: number): number
		return field.heights[iz * field.width + ix + 1]
	end
	local h00, h10, h01, h11 = h(cx, cz), h(cx + 1, cz), h(cx, cz + 1), h(cx + 1, cz + 1)
	local y = if u + v <= 1 then h00 + u * (h10 - h00) + v * (h01 - h00) else h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11)
	return field.origin.y + y
end

local function slopeAt(field: Heightfield, x: number, z: number): number
	local step = field.cell_size * 0.5
	local hx0 = Scatter.heightAt(field, x - step, z) or Scatter.heightAt(field, x, z) or 0
	local hx1 = Scatter.heightAt(field, x + step, z) or Scatter.heightAt(field, x, z) or 0
	local hz0 = Scatter.heightAt(field, x, z - step) or Scatter.heightAt(field, x, z) or 0
	local hz1 = Scatter.heightAt(field, x, z + step) or Scatter.heightAt(field, x, z) or 0
	local gx, gz = (hx1 - hx0) / (2 * step), (hz1 - hz0) / (2 * step)
	return math.deg(math.atan(math.sqrt(gx * gx + gz * gz)))
end

--- Evenly spaced random points (Bridson's Poisson-disk sampling), filtered.
function Scatter.points(options: Options): { Point }
	local field = options.heightfield
	local area = options.area
		or (field and { x = field.origin.x, z = field.origin.z, width = (field.width - 1) * field.cell_size, depth = (field.depth - 1) * field.cell_size })
	if not area then
		error("SCATTER_OPTIONS_INVALID: give an area or a heightfield", 2)
	end
	local spacing = options.spacing
	if type(spacing) ~= "number" or spacing <= 0 or area.width <= 0 or area.depth <= 0 then
		error("SCATTER_OPTIONS_INVALID: spacing and the area's width and depth must be positive", 2)
	end
	local limit = options.limit or 100000
	local random = generator(options.seed or 1)
	local cell = spacing / math.sqrt(2)
	local columns, rows = math.max(1, math.ceil(area.width / cell)), math.max(1, math.ceil(area.depth / cell))
	if columns * rows > 4000000 then
		error("SCATTER_OPTIONS_INVALID: spacing is too small for the area (over 4 million grid cells)", 2)
	end
	local grid: { [number]: { number } } = {}
	local samples: { { number } } = {}
	local active: { number } = {}
	local function fits(x: number, z: number): boolean
		if x < 0 or z < 0 or x >= area.width or z >= area.depth then
			return false
		end
		local gx, gz = math.floor(x / cell), math.floor(z / cell)
		for j = math.max(0, gz - 2), math.min(rows - 1, gz + 2) do
			for i = math.max(0, gx - 2), math.min(columns - 1, gx + 2) do
				local other = grid[j * columns + i]
				if other and (other[1] - x) ^ 2 + (other[2] - z) ^ 2 < spacing * spacing then
					return false
				end
			end
		end
		return true
	end
	local function add(x: number, z: number)
		local sample = { x, z }
		table.insert(samples, sample)
		table.insert(active, #samples)
		grid[math.floor(z / cell) * columns + math.floor(x / cell)] = sample
	end
	add(random() * area.width, random() * area.depth)
	while #active > 0 and #samples < limit * 4 do
		local slot = math.floor(random() * #active) + 1
		local origin = samples[active[slot]]
		local placed = false
		for _ = 1, 30 do
			local angle, distance = random() * 2 * math.pi, spacing * (1 + random())
			local x, z = origin[1] + math.cos(angle) * distance, origin[2] + math.sin(angle) * distance
			if fits(x, z) then
				add(x, z)
				placed = true
				break
			end
		end
		if not placed then
			active[slot] = active[#active]
			table.remove(active)
		end
	end
	local scale = options.scale or { min = 1, max = 1 }
	local spin = options.yaw ~= false
	local points: { Point } = {}
	for _, sample in samples do
		local x, z = area.x + sample[1], area.z + sample[2]
		local y = if field then Scatter.heightAt(field, x, z) else 0
		-- Draw yaw and scale for every sample so filters never shift later points.
		local yaw = if spin then random() * 2 * math.pi else 0
		local size = scale.min + random() * (scale.max - scale.min)
		local keep = y ~= nil
			and (options.minHeight == nil or (y :: number) >= options.minHeight)
			and (options.maxHeight == nil or (y :: number) <= options.maxHeight)
			and (options.maxSlope == nil or field == nil or slopeAt(field :: Heightfield, x, z) <= options.maxSlope)
			and (options.accept == nil or options.accept(x, y :: number, z))
		if keep then
			table.insert(points, { x = x, y = y :: number, z = z, yaw = yaw, scale = size })
			if #points >= limit then
				break
			end
		end
	end
	return points
end

--- 40-byte instance records (position, quaternion, scale) for api.instances3d.set.
function Scatter.pack(points: { Point }): buffer
	local records = buffer.create(#points * 40)
	for index, point in points do
		local at = (index - 1) * 40
		local half = point.yaw * 0.5
		local values = { point.x, point.y, point.z, 0, math.sin(half), 0, math.cos(half), point.scale, point.scale, point.scale }
		for k, value in values do
			buffer.writef32(records, at + (k - 1) * 4, value)
		end
	end
	return records
end

return Scatter
