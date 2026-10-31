# Asset import pipeline

Some assets are made from files a game cannot ship or edit by hand: an original
game installation, a level editor's output, a vendor's binary format. An asset
can declare how its file is **imported** from such sources. Before a host reads
or packs the project's assets (`game run`, `test`, `verify`, `preview`,
`project sync`, export), the engine brings every imported asset's file up to
date. There is no separate import command.

The engine defines the importer contract and does the work around it: reading
sources, checking the wiring, caching, encoding products into engine formats,
and recording provenance. **Importers are project Luau modules**, so a game adds
a source format without any engine change.

## Importers

An importer module returns a table of nodes. Each node declares typed input and
output ports and a `run(inputs, params)` function that returns its outputs:

```luau
-- import/pop3.luau
return {
    model_atlas = {
        inputs = {blocks = "bytes", palette = "bytes"},
        outputs = {atlas = "image"},
        run = function(inputs, params)
            -- decode inputs.blocks with inputs.palette ...
            return {atlas = {width = 256, height = 1024, rgba = rgba}}
        end,
    },
}
```

| Port type | Luau value | Becomes |
|---|---|---|
| `bytes` | a buffer | the file as it is |
| `image` | `{width, height, rgba}`: straight RGBA8, first row at the top | an RGBA PNG (`texture2d` assets) |
| `json` | tables, strings, numbers, booleans | JSON text |

Nodes run in the same isolated VM as [jobs](jobs.md): no world, no files, no
clock, no randomness and no output channel. Their outputs depend only on their
inputs, params and module source, which is what makes caching and provenance
sound. Register importers in `project.unone.json`, which is where a game injects
them:

```json
"import": {
  "importers": {"pop3.model_atlas": {"module": "import/pop3.luau", "node": "model_atlas"}},
  "roots": {
    "original": {
      "description": "Populous: The Beginning installation (read-only)",
      "candidates": ["${ProgramFiles(x86)}/Steam/steamapps/common/Populous 3"]
    }
  }
}
```

## Imported assets

A file that needs no conversion is copied as it is with `from`; no importer is
involved:

```json
{"id": "data://populous/levels/levl2001.dat", "kind": "data", "source": "assets/imported/levels/levl2001.dat",
 "encoding": {"format": "binary", "mime": "application/octet-stream", "decoder": "bytes"},
 "import": {"from": "original:levels/levl2001.dat"}}
```

The game reads it with `api.assets.load(id)` (a frozen buffer for the `bytes`
decoder). Never paste such bytes into a script as a string literal: `game verify`
rejects large literals because data belongs in assets.

An asset made by an importer names it with `importer` and `product`; `source`
is where its file is written:

```json
{"id": "texture://populous/models/c", "kind": "texture2d", "source": "assets/imported/models-c.png",
 "bundle": "terrain", "encoding": {"format": "png", "mime": "image/png", "decoder": "image"},
 "import": {"importer": "pop3.model_atlas", "product": "atlas", "params": {"transparent": [0, 255]},
            "inputs": {"blocks": "original:data/BL320-C.DAT", "palette": "original:data/pal0-c.dat"}}}
```

An input is `<root>:<path>` (a file under a declared root, as bytes) or
`asset:<id>` (another asset: its import product with that product's type, or
its file as bytes). Every importer input must be connected with a matching
type; an `image` product needs a `texture2d` asset. Imports that read each
other's products run in dependency order; a cycle fails.

## Roots

A root is a read-only directory outside the project. The engine looks for it in
this order: the machine-local `.unone/import-roots.json`
(`{"original": "D:/Games/Populous 3"}`, never committed), the environment
variable `UNONE_IMPORT_ROOT_<NAME>`, then the first existing candidate
(`${VAR}` expands environment variables). Output files never go into a root.

When a root is missing on a machine, assets whose files already exist are kept
as they are and reported as unverified; an asset without its file fails with
`IMPORT_ROOT_UNAVAILABLE`.

## Cache and provenance

Each importer run is cached in `.unone/import-cache/` under the hash of its
module source, node, params and input values; assets sharing one run reuse it,
and an unchanged project costs only hashing its sources. A file is rewritten
only when its bytes change. `.unone/import-provenance.json` records, for every
imported asset, its file hash, importer, module hash, params, and each input's
root path or source asset with hashes, so a product can be traced to the exact
source files that made it.

## Scope

The pipeline runs on development hosts (CLI, preview, MCP); shipped players read
the imported files like any other asset. Running the same importers at runtime
(for example over files a player selects) and further product types (audio,
meshes) are planned extensions of this contract.
