local Shared = require("../shared")

local M = {}

function M.height(x: number): number
	return x * Shared.scale
end

return M
