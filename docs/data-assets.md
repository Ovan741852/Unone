# Data assets

Game data that lives in files (levels, balance tables, dialogue, original
game binaries) is a **data asset**: an asset manifest entry of kind `"data"`
that game Luau reads with `api.assets.load(id)`. Code names data by its stable
id only; which file it comes from and how it is decoded live in the manifest,
so either can change without touching a script.

```json
{"id": "data://levels/1", "kind": "data", "source": "data/level1.json", "bundle": "content",
 "encoding": {"format": "json", "mime": "application/json", "decoder": "json"}}
```

```luau
local level = api.assets.load("data://levels/1")  -- deep-frozen tables
```

## The pipeline

1. **Source.** The host supplies each declared asset's bytes before
   Game.start: `game run`/`game test` read the project files, an export copies
   them to `content/` and lists them in `content/project.json` as
   `data_assets` (`{id, source, loader}`), the official Web player fetches
   them beside that JSON, and the native player reads them from its verified
   package. A declared asset without bytes, or bytes without a declaration,
   fails the load (`ASSET_DATA_MISSING`, `ASSET_DATA_UNDECLARED`).
2. **Loader.** `encoding.decoder` names the loader; without an encoding it is
   `bytes`. The engine provides:

   | Loader | Value |
   |---|---|
   | `bytes` | a frozen buffer ([immutable bytes](immutable-bytes.md)) |
   | `text` | a string; the bytes must be UTF-8 |
   | `json` | deep-frozen tables, built straight from the JSON text; numbers are doubles (integers beyond 2^53 fail), `null` is nil |

   Any other name is a loader the game registers at runtime.
3. **Value.** The first `load` decodes; later calls return the same value. The
   value is immutable: buffers are frozen and tables deep-frozen, so every
   module can share it. A shipped player releases the source bytes once an
   asset is decoded; development builds keep them for hot reload.

## Runtime loaders

```luau
api.assets.registerLoader("csv", function(data: buffer, id: string)
    local rows = {}
    for line in string.gmatch(buffer.tostring(data), "[^\n]+") do
        local row = {}
        for cell in string.gmatch(line, "[^,]+") do table.insert(row, tonumber(cell)) end
        table.insert(rows, row)
    end
    return rows
end)
local grid = api.assets.load("data://grid")   -- manifest: "decoder": "csv"
```

A loader receives the asset's bytes as a frozen buffer and runs synchronously
in the game VM, so it behaves the same on every host and in replays. Its
result is deep-frozen and cached. Register loaders before the first `load` of
an asset that names them; registering a name again replaces the loader and
drops values it decoded (in a shipped player only before their first decode).
`bytes`, `text` and `json` are reserved. A runtime package can ship loaders as
ordinary Luau that registers them.

## Hosts

| Host | Where the bytes come from |
|---|---|
| `game run`, `game test`, `game verify` | the project's files, through its asset manifest |
| Web player export | `content/<source>`, fetched in parallel with startup and copied once into the core (`unone_web_stage_data`); the worker backend transfers the buffers |
| Native player | the verified package's `content/<source>` |

Checked by `crates/unone-engine/tests/data_assets.rs`,
`web/shared/data-assets-staging.test.mjs`, and the host parity fixture
`tests/data-assets-project`: `node scripts/verify-host-parity.mjs --fixture
tests/data-assets-project --export <web export>` requires the native CLI and
the exported Wasm player to produce the same observation digest.
