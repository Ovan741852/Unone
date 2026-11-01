local M = {scale = 10, loads = 0, sum = 0}
M.loads += 1

function M.tick(dt: number)
	M.sum = (M.sum * 1.0001 + dt * 7) % 1000
end

return M
