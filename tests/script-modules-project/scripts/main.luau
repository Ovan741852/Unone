--!strict
-- Host parity fixture for script modules: a development host loads these files
-- as source, a production export as bytecode; both must observe the same game.
local Terrain = require("./world/terrain")
local Shared = require("./shared")

local frame = 0
local late: {value: number}? = nil

local Game = {}

function Game.start(api)
	api.observation.set("height", Terrain.height(3))
	api.observation.set("loads", Shared.loads)
end

function Game.update(api, dt)
	frame += 1
	Shared.tick(dt)
	-- A module first required mid-game loads from the same staged chunks.
	if frame == 30 then
		late = require("./late")
	end
	api.observation.set("sum", Shared.sum)
	api.observation.set("late", if late then late.value else 0)
end

return Game
