# Script modules

A game's entry script can split its code into modules: the `.luau` files in
the entry script's directory and below it. The entry and any module load
another module with `require` and a path relative to their own file:

```luau
-- scripts/main.luau
local Terrain = require("./world/terrain")   -- scripts/world/terrain.luau
local Shared = require("./shared")           -- scripts/shared.luau

-- scripts/world/terrain.luau
local Shared = require("../shared")
local M = {}
function M.height(x: number): number return x * Shared.scale end
return M
```

## Rules

- A path starts with `./` or `../` and is relative to the requiring file. The
  `.luau` extension is implied, and `name/init.luau` answers for `name`. A path
  never leaves the entry script's directory (`SCRIPT_REQUIRE_PATH`).
- A module runs once per VM; every later `require` returns the same value. It
  must return exactly one non-nil value (`SCRIPT_MODULE_RETURN`).
- A cycle fails and names it (`SCRIPT_REQUIRE_CYCLE: a.luau -> b.luau -> a.luau`)
  instead of handing out a half-built table. Pass what two modules share into a
  third one.
- Errors point at the module's own file and line, for example
  `scripts/world/terrain.luau:12`.
- Modules share the VM's globals and its determinism guards; they are game code
  like the entry script, not a separate sandbox.

## Types

`game check --types` analyzes the entry script, and luau-analyze follows its
`require`s, so a module's exported types and return value are checked where
they are used. Declare shared types in a module with `export type` and refer to
them through the required value (`Terrain.Cell`).

## Hosts

A project on disk reads its modules when it loads, so hot reload sees changed
modules too. A host project payload carries them as `script_modules`, a map from
path relative to the entry script's directory to source text; `game export`
writes it. Production exports precompile the entry script only; modules ship as
source and compile when the game loads.
