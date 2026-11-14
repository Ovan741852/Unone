--!strict
-- glTF 2.0 binary (.glb) importer for the Unone import pipeline
-- (docs/import-pipeline.md). Register it in project.unone.json as
--   "unone.gltf.mesh": {"module": "import/unone-gltf.luau", "node": "mesh"}
-- and declare a mesh3d asset whose import reads the .glb.
--
-- The default scene's meshes are flattened into one static mesh with their
-- node transforms applied; the first textured material's base colour image is
-- the texture. UVs flip to the static-mesh convention (v = 0 at the bottom).
-- Draco, meshopt and KTX2 compression, sparse accessors, external buffers and
-- images, and skinning/animation are not read: export without them.

type Json = any

local function fail(message: string): never
	error("GLTF_IMPORT_FAILED: " .. message, 0)
end

-- A small JSON reader: the import VM has no JSON decoder.
local function parseJson(text: string): Json
	local at = 1
	local function skip()
		at = string.find(text, "[^ \t\r\n]", at) or (#text + 1)
	end
	local escapes = { b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
	local function parseString(): string
		at += 1
		local parts = {}
		while true do
			local stop = string.find(text, '["\\]', at)
			if not stop then
				fail("unterminated JSON string")
			end
			table.insert(parts, string.sub(text, at, stop - 1))
			if string.sub(text, stop, stop) == '"' then
				at = stop + 1
				return table.concat(parts)
			end
			local escape = string.sub(text, stop + 1, stop + 1)
			if escape == "u" then
				local code = tonumber(string.sub(text, stop + 2, stop + 5), 16) or fail("bad \\u escape")
				table.insert(parts, utf8.char(code))
				at = stop + 6
			else
				table.insert(parts, escapes[escape] or escape)
				at = stop + 2
			end
		end
	end
	local parseValue: () -> Json
	function parseValue(): Json
		skip()
		local c = string.sub(text, at, at)
		if c == "{" then
			at += 1
			local object = {}
			skip()
			if string.sub(text, at, at) == "}" then
				at += 1
				return object
			end
			while true do
				skip()
				if string.sub(text, at, at) ~= '"' then
					fail("expected a JSON key")
				end
				local key = parseString()
				skip()
				if string.sub(text, at, at) ~= ":" then
					fail("expected ':' in JSON")
				end
				at += 1
				object[key] = parseValue()
				skip()
				local d = string.sub(text, at, at)
				at += 1
				if d == "}" then
					return object
				elseif d ~= "," then
					fail("expected ',' or '}' in JSON")
				end
			end
		elseif c == "[" then
			at += 1
			local array = {}
			skip()
			if string.sub(text, at, at) == "]" then
				at += 1
				return array
			end
			while true do
				table.insert(array, parseValue())
				skip()
				local d = string.sub(text, at, at)
				at += 1
				if d == "]" then
					return array
				elseif d ~= "," then
					fail("expected ',' or ']' in JSON")
				end
			end
		elseif c == '"' then
			return parseString()
		elseif string.sub(text, at, at + 3) == "true" then
			at += 4
			return true
		elseif string.sub(text, at, at + 4) == "false" then
			at += 5
			return false
		elseif string.sub(text, at, at + 3) == "null" then
			at += 4
			return nil
		end
		local first, last = string.find(text, "^-?%d+%.?%d*[eE]?[-+]?%d*", at)
		if not first then
			fail("bad JSON value at byte " .. at)
		end
		at = (last :: number) + 1
		return tonumber(string.sub(text, first, last))
	end
	return parseValue()
end

local COMPONENTS = { SCALAR = 1, VEC2 = 2, VEC3 = 3, VEC4 = 4 }
local SIZES = { [5120] = 1, [5121] = 1, [5122] = 2, [5123] = 2, [5125] = 4, [5126] = 4 }
local READERS = {
	[5120] = buffer.readi8,
	[5121] = buffer.readu8,
	[5122] = buffer.readi16,
	[5123] = buffer.readu16,
	[5125] = buffer.readu32,
	[5126] = buffer.readf32,
}
local NORMALIZE = { [5120] = 1 / 127, [5121] = 1 / 255, [5122] = 1 / 32767, [5123] = 1 / 65535 }
local UNSUPPORTED = {
	KHR_draco_mesh_compression = "Draco compression",
	EXT_meshopt_compression = "meshopt compression",
	KHR_texture_basisu = "KTX2/Basis textures",
	KHR_mesh_quantization = "quantized vertices",
}
-- A 1x1 white PNG for models without a base colour texture.
local WHITE_PNG = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8ffffff7f0009fb03fd2a86e38a0000000049454e44ae426082"

local function fromHex(hex: string): buffer
	local bytes = buffer.create(#hex // 2)
	for i = 0, #hex // 2 - 1 do
		buffer.writeu8(bytes, i, tonumber(string.sub(hex, i * 2 + 1, i * 2 + 2), 16) :: number)
	end
	return bytes
end

local function compose(t: { number }, r: { number }, s: { number }): { number }
	local x, y, z, w = r[1], r[2], r[3], r[4]
	local xx, yy, zz = x * x, y * y, z * z
	local xy, xz, yz, wx, wy, wz = x * y, x * z, y * z, w * x, w * y, w * z
	return {
		(1 - 2 * (yy + zz)) * s[1], 2 * (xy + wz) * s[1], 2 * (xz - wy) * s[1], 0,
		2 * (xy - wz) * s[2], (1 - 2 * (xx + zz)) * s[2], 2 * (yz + wx) * s[2], 0,
		2 * (xz + wy) * s[3], 2 * (yz - wx) * s[3], (1 - 2 * (xx + yy)) * s[3], 0,
		t[1], t[2], t[3], 1,
	}
end

local function multiply(a: { number }, b: { number }): { number }
	local m = table.create(16, 0)
	for column = 0, 3 do
		for row = 0, 3 do
			local sum = 0
			for k = 0, 3 do
				sum += a[k * 4 + row + 1] * b[column * 4 + k + 1]
			end
			m[column * 4 + row + 1] = sum
		end
	end
	return m
end

local IDENTITY = { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }

return {
	mesh = {
		inputs = { model = "bytes" },
		outputs = { mesh = "json", texture = "bytes" },
		-- params.texture: the texture2d asset id the mesh names (required).
		-- params.scale: uniform scale applied to every position (default 1).
		run = function(inputs: { model: buffer }, params: { texture: string?, scale: number? })
			local glb = inputs.model
			if typeof(params) ~= "table" or type(params.texture) ~= "string" or params.texture == "" then
				fail("params.texture must name the texture2d asset this mesh uses")
			end
			local scale = params.scale or 1
			if buffer.len(glb) < 20 or buffer.readu32(glb, 0) ~= 0x46546C67 then
				fail("not a binary glTF (.glb); export the model as GLB")
			end
			if buffer.readu32(glb, 4) ~= 2 then
				fail("only glTF 2.0 is supported")
			end
			local jsonLength = buffer.readu32(glb, 12)
			if buffer.readu32(glb, 16) ~= 0x4E4F534A then
				fail("the first GLB chunk must be JSON")
			end
			local gltf = parseJson(buffer.readstring(glb, 20, jsonLength))
			local binOffset = 20 + jsonLength
			local binStart = binOffset + 8
			if binOffset + 8 > buffer.len(glb) or buffer.readu32(glb, binOffset + 4) ~= 0x004E4942 then
				fail("the GLB has no binary chunk")
			end
			for _, name in gltf.extensionsRequired or {} do
				fail(`{UNSUPPORTED[name] or name} ({name}) is not supported; export without it`)
			end

			local function accessor(index: number): ({ number }, number)
				local a = (gltf.accessors or {})[index + 1] or fail(`accessor {index} does not exist`)
				if a.sparse then
					fail("sparse accessors are not supported")
				end
				local view = gltf.bufferViews[a.bufferView + 1] or fail(`buffer view {a.bufferView} does not exist`)
				if (view.buffer or 0) ~= 0 then
					fail("only the GLB's own binary buffer is supported")
				end
				local width = COMPONENTS[a.type] or fail(`accessor type {a.type}`)
				local size = SIZES[a.componentType] or fail(`component type {a.componentType}`)
				local read = READERS[a.componentType]
				local stride = view.byteStride or width * size
				local base = binStart + (view.byteOffset or 0) + (a.byteOffset or 0)
				local factor = if a.normalized then NORMALIZE[a.componentType] or 1 else 1
				local values = table.create(a.count * width)
				for item = 0, a.count - 1 do
					for c = 0, width - 1 do
						values[item * width + c + 1] = read(glb, base + item * stride + c * size) * factor
					end
				end
				return values, width
			end

			local positions: { number }, uvs: { number }, indices: { number } = {}, {}, {}
			local texture: buffer? = nil
			local function visit(nodeIndex: number, parent: { number })
				local node = gltf.nodes[nodeIndex + 1] or fail(`node {nodeIndex} does not exist`)
				local localMatrix = node.matrix
					or compose(node.translation or { 0, 0, 0 }, node.rotation or { 0, 0, 0, 1 }, node.scale or { 1, 1, 1 })
				local m = multiply(parent, localMatrix)
				if node.mesh then
					local det = m[1] * (m[6] * m[11] - m[10] * m[7]) - m[5] * (m[2] * m[11] - m[10] * m[3]) + m[9] * (m[2] * m[7] - m[6] * m[3])
					for _, primitive in gltf.meshes[node.mesh + 1].primitives do
						if (primitive.mode or 4) ~= 4 then
							fail("only triangle primitives are supported")
						end
						local attributes = primitive.attributes
						local points = accessor(attributes.POSITION or fail("a primitive has no POSITION"))
						local count = #points // 3
						local coords = if attributes.TEXCOORD_0 then accessor(attributes.TEXCOORD_0) else nil
						local base = #positions // 3
						for v = 0, count - 1 do
							local x, y, z = points[v * 3 + 1], points[v * 3 + 2], points[v * 3 + 3]
							table.insert(positions, (m[1] * x + m[5] * y + m[9] * z + m[13]) * scale)
							table.insert(positions, (m[2] * x + m[6] * y + m[10] * z + m[14]) * scale)
							table.insert(positions, (m[3] * x + m[7] * y + m[11] * z + m[15]) * scale)
							-- glTF UVs start at the top; static meshes at the bottom.
							table.insert(uvs, if coords then coords[v * 2 + 1] else 0)
							table.insert(uvs, if coords then 1 - coords[v * 2 + 2] else 0)
						end
						local list = if primitive.indices then accessor(primitive.indices) else nil
						local total = if list then #list else count
						for t = 0, total // 3 - 1 do
							local a = if list then list[t * 3 + 1] else t * 3
							local b = if list then list[t * 3 + 2] else t * 3 + 1
							local c = if list then list[t * 3 + 3] else t * 3 + 2
							-- A mirroring transform reverses winding; keep faces outward.
							if det < 0 then
								b, c = c, b
							end
							table.insert(indices, base + a)
							table.insert(indices, base + b)
							table.insert(indices, base + c)
						end
						if not texture and primitive.material then
							local material = gltf.materials[primitive.material + 1]
							local info = material and material.pbrMetallicRoughness and material.pbrMetallicRoughness.baseColorTexture
							if info then
								local image = gltf.images[gltf.textures[info.index + 1].source + 1]
								if image.uri then
									fail("external images are not supported; pack textures into the GLB")
								end
								if image.mimeType ~= "image/png" and image.mimeType ~= "image/jpeg" then
									fail(`texture type {image.mimeType} is not supported (PNG or JPEG)`)
								end
								local view = gltf.bufferViews[image.bufferView + 1]
								local bytes = buffer.create(view.byteLength)
								buffer.copy(bytes, 0, glb, binStart + (view.byteOffset or 0), view.byteLength)
								texture = bytes
							end
						end
					end
				end
				for _, child in node.children or {} do
					visit(child, m)
				end
			end
			local scene = (gltf.scenes or {})[(gltf.scene or 0) + 1] or fail("the GLB has no scene")
			for _, root in scene.nodes or {} do
				visit(root, IDENTITY)
			end
			if #indices < 3 then
				fail("the default scene has no triangles")
			end
			return {
				mesh = { version = 1, positions = positions, uvs = uvs, indices = indices, texture = params.texture },
				texture = texture or fromHex(WHITE_PNG),
			}
		end,
	},
}
