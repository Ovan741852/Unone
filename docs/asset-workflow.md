# Asset workflow contract

This document explains asset operations and engine boundaries. Structural fields
come from Rust DTOs and generated `asset.schema.json`; runtime validation is authoritative. The CLI, MCP, native-local bundle reader, and documentation all
follow the same engine-core results. The old asset-reference and host-resolve
decisions have been removed; Git history retains their historical record.

## Distinguish three states first

The asset workflow has three distinct authorities:

1. **Authoring** is the game's `project.unone.json`, asset manifest,
   primary source, and manifest-declared companion files. The manifest entry's
   `id`, `source`, `kind`, `bundle`, `files`, and optional `encoding` are the authoring contract; the
   scene uses the same stable ID for placement and presentation.
2. **Packaged** is the bundle manifest, hash, and archive produced by
   `bundle pack` from authoring files. Do not edit an archive or cache
   instead of changing the source; packing also does not automatically activate
   a new generation.
3. **Active** is a generation explicitly installed locally by the native host.
   `asset read` reads only verified bytes that match the current bundle
   manifest and active hash; it does not fall back to the authoring source.

`asset read` first compares the complete AssetSpec with the verified
`asset-manifest`. If the author changes only kind, source, bundle, files, or encoding
without publishing, it reports `BUNDLE_GENERATION_MISMATCH` rather than mixing new metadata
with old bytes as a successful result. If the bundle manifest or active record
changes during a read, the read is rejected and no export is written. If only
the source bytes change while the AssetSpec remains unchanged, read may
legitimately return the already-published old bytes; use describe freshness to
determine whether they are current.

`asset describe` answers only whether the selected asset matches authoring
in `native_local`. A true freshness result does not mean that every bundle,
the whole game, Web IndexedDB, Android, or another host is synchronized, and it
does not mean that the native or Web renderer is complete.

## Authority levels and stable-id editing rules

The authorities are ordered from upstream to downstream:

1. **Authoring source** is the only editable content authority: the manifest
   selected by project config, its entries, primary and companion files, and
   the scene explicitly written by the author.
2. **Packaged bundle** is the verifiable output produced from authoring:
   re-create its bundle manifest, archive bytes, size/hash, and dependency
   metadata with pack; do not edit them by hand.
3. **Active generation** is the local observation after installation. It can be
   activated only by bundle install; cache, archive, or active metadata cannot
   be treated as authoring in reverse.

The stable ID connects scene references with host asset lookup. When replacing
source or companion bytes for the same ID, preserve the ID; scene references
usually do not need to change. After changing content, repack, run strict
inspection, install, check `matches_authoring` with `asset describe --id`, and finally read
the verified bytes. A successful read does not prove authoring freshness. If
only source bytes changed and the bundle has not been repacked, read may return
old active bytes; if packing changed the bundle hash but it has not been
installed, read rejects the manifest/active mismatch. If a source or companion
moves, change the manifest's `source`/`files` path while preserving the stable ID.
Scene size, pivot, collision shapes, and placement are separate scene edits; the
engine does not rewrite them when a source is replaced.

To add an asset, create the actual content first, then add the declaration with
`asset init`; init does not create, download, or guess art. The current tools do not
automatically rewrite references when an ID is deleted or truly renamed: a
static main scene with no reference does not prove that Luau, a host, or
external content does not use it dynamically, so unreferenced does not mean
safe to delete. One file may be shared by multiple manifest entries; changing
it affects every ID that declares the file, and queries report only the sharing
relationships observable from the manifest.

Pack output manifests, generated archives, and their `.part` temporary paths
must be separate from authoring inputs, and generated outputs must not collide
with one another. A collision reports `BUNDLE_OUTPUT_COLLISION` before any pack write; do not
point `--output` at an existing authoring manifest to “replace” it. This is
not a filesystem transaction for arbitrary external writers.

## Declaration format

`project.unone.json` points to an asset manifest:

```json
{
  "version": 1,
  "assets": [
    {
      "id": "asset://characters/hero",
      "source": "assets/characters/hero.svg",
      "kind": "texture2d",
      "bundle": "content",
      "files": []
    }
  ]
}
```

The core currently supports `texture2d`, `mesh3d`, `spine`, and `effekseer` as
`kind` values. `files` contains required project-relative companion sources,
such as Spine atlases and texture pages; the engine does not guess formats,
decode them, or create art for the author.

## Tool entry points

The CLI and MCP are thin clients of the Developer Protocol; the engine core
provides the actual inspection and selection rules:

```powershell
game --project <game-root> --json asset inspect
game --project <game-root> --json asset inspect --strict
game --project <game-root> --json asset describe --id <asset-id>
game --project <game-root> --json asset read --id <asset-id>
game --project <game-root> --json asset read --id <asset-id> --file <declared-companion>
game --project <game-root> --json bundle pack
game --project <game-root> --json bundle install <bundle-id>
game --project <game-root> --json bundle install --all
```

The corresponding MCP tools are `unone_asset_inspect`, `unone_asset_describe`,
`unone_asset_read`, `unone_asset_init`, `unone_bundle_pack`,
`unone_bundle_inspect`, and `unone_bundle_install`. Use `tools/list` as the
authority for available tools and parameters; do not infer capability from a
fixed tool count. `unone_asset_describe` is read-only, while `unone_asset_read` has
`readOnlyHint=false` because passing output may write a file.

### `asset describe`

`game asset describe --id <id>` performs a focused query for one declared ID. It
does not repeat the full `asset inspect` gate or silently read every asset's bytes. It puts
the authoring manifest location and declared files, main-scene static
references, the native-local active observation, selected-asset publication
freshness, and ordered next actions into one `EngineResult`. `ok` means only that
the query completed; do not turn false or unknown freshness into true.

The serialized shape of `AssetDescribeReport` currently includes `project_root`, `asset`,
`authoring`, `references`, `reference_scope`, `active`, `publication`, and
`required_next_actions`. The manifest fields under `authoring` are `manifest_path` and
`manifest_json_pointer`. Each file entry identifies the primary/companion role,
existence, readable size/hash, `shared_with_asset_ids`, and a structured diagnostic
when needed. Reference fields retain the main-scene path, `json_pointer`, ID,
entity, component, and actual array index for `sprite`, `mesh3d`, and `animation`. This is
not arbitrary string search or a complete impact analysis for the selected asset.
`reference_scope` explicitly marks `main_scene_only` and states that IDs dynamically
created or selected by Luau are not inspected; do not treat unreferenced as
safe to delete.

The scope of `active` is `native_local`. It reports the generation, active
manifest entry, verified status and size/hash for each primary/companion, structured
diagnostics, and whether the observation token stayed consistent. The scope of
`publication` is `selected_asset_native_local`. Preserve `asset_spec_matches`,
`primary_bytes_match`, `companion_bytes_match`, `bytes_match`, and
`matches_authoring` exactly as `true`/`false`/`null`; a successful read or a
non-empty bundle hash is not evidence of freshness.

Read failures for active primary/companion files appear in the file's
diagnostic and also in the deduplicated `active.diagnostics` and top-level
`EngineResult.diagnostics`. A client does not need to inspect every file to learn
about a cache miss or archive error; the file field preserves precise location.

`active.asset_manifest_json_pointer` locates the entry in the verified retained
bundle's `asset-manifest`, not the author's current manifest file. The author may
move the manifest without repacking, so active does not provide file paths
inferred from the authoring path.

The following is the minimum shape for a successful query (optional diagnostics
omitted); use the core result as the source of actual values:

When `AssetSpec.files` is empty, core serde settings may omit it; authoring and
active file status is still represented by each side's `files` array.

```json
{
  "project_root": "<absolute-project-root>",
  "asset": {
    "id": "asset://characters/hero",
    "source": "assets/characters/hero.svg",
    "kind": "texture2d",
    "bundle": "content"
  },
  "authoring": {
    "manifest_path": "assets/manifest.json",
    "manifest_json_pointer": "/assets/0",
    "files": [
      {
        "path": "assets/characters/hero.svg",
        "role": "primary",
        "exists": true,
        "size_bytes": 123,
        "sha256": "<sha256>",
        "shared_with_asset_ids": []
      }
    ],
    "editing_rules": ["<engine-provided editing rules>"]
  },
  "references": [
    {
      "path": "scenes/main.scene.json",
      "json_pointer": "/entities/0/sprite/asset",
      "id": "asset://characters/hero",
      "entity": "player",
      "component": "sprite"
    }
  ],
  "reference_scope": {
    "scope": "main_scene_only",
    "roots_inspected": ["scenes/main.scene.json"],
    "components_inspected": ["sprite", "mesh3d", "animation"],
    "dynamic_luau_assets_included": false,
    "limitations": ["<engine-provided limitations>"]
  },
  "active": {
    "scope": "native_local",
    "generation": 3,
    "asset_manifest_json_pointer": "/assets/0",
    "asset": {
      "id": "asset://characters/hero",
      "source": "assets/characters/hero.svg",
      "kind": "texture2d",
      "bundle": "content"
    },
    "files": [
      {
        "path": "assets/characters/hero.svg",
        "role": "primary",
        "verified": true,
        "size_bytes": 123,
        "sha256": "<sha256>"
      }
    ],
    "diagnostics": [],
    "observation_token_before": "<token>",
    "observation_token_after": "<token>",
    "observation_consistent": true
  },
  "publication": {
    "scope": "selected_asset_native_local",
    "matches_authoring": true,
    "asset_spec_matches": true,
    "primary_bytes_match": true,
    "companion_bytes_match": true,
    "bytes_match": true,
    "reasons": []
  },
  "required_next_actions": [
    {
      "action": "asset_read_primary",
      "kind": "command",
      "reason": "<engine-provided reason>",
      "executable": "game",
      "argv": ["--project", "<absolute-project-root>", "asset", "read", "--id", "asset://characters/hero", "--json"],
      "ready": true,
      "status": "ready",
      "prerequisites": []
    }
  ]
}
```

When source, companion, active-record, cache, or archive bytes are missing, the
result must retain the available location and structured diagnostic rather than
collapsing the error into missing or false. If the latest formal active
generation cannot be read, report `BUNDLE_ACTIVE_GENERATION_UNREADABLE` and do not silently
fall back to an older generation. If the manifest or generation changes during a
query, do not report true freshness; run describe again.

Follow-up commands are represented by the `action`, `kind`, `reason`, `executable`,
`argv`, `ready`, `status`, and `prerequisites` fields of
`AssetWorkflowAction`. `executable: "game"` is a logical CLI name; blind AI is not
expected to guess PATH or an installed alias. When using an immutable package,
resolve it to that package's `bin/game.exe`. Preserve each core-generated `argv` item
as-is and execute it through a subprocess argument list rather than
concatenating a shell string; special characters, spaces, and asset IDs/paths
therefore are not reparsed. The primary read argv has no `--file`; a companion
read argv includes its complete declared `--file`. Non-mechanical art-editing steps
are marked as AI/author work rather than disguised as commands. Describe itself
does not run pack, inspect, install, or read.

## New asset bootstrap order

New assets do not start with “install content only”. Create the authoring
content first, then declare, pack, validate, activate, and query it:

1. AI or the author creates the actual primary bytes and all companion bytes in
   the project root.
2. Declare the manifest entry with
   `game asset init --id <id> --source <project-relative-source>`.
   `asset init` writes only the manifest/project config; it does not create or
   guess image, model, Spine, or Effekseer files. Inspect the returned
   `changed_files` first. `describe_argv` is provided only when a new asset is
   successfully added; when there is no `new_asset`, the optional field is omitted
   rather than fabricating `<asset-id>`. If a partial write fails, failure effects
   list the changes that actually occurred.
3. Run `game bundle pack` to produce or update the bundle manifest, hash, and
   archive from authoring files.
4. Use `game verify` as the aggregate author gate; its assets step already runs
   strict `asset inspect --strict`. When diagnosing asset authoring in isolation
   before the aggregate gate, use the focused `game asset inspect --strict` command.
5. Use `game bundle install --all` to validate and activate the complete generation
   once. Use `game bundle install <id>` only when one bundle is required. After
   all selected roots are validated, write only one active generation.
6. Then use `game asset describe --id <id>` to confirm authoring, active state, and
   `matches_authoring`, and finally use `game asset read --id <id>` to obtain
   verified bytes.

The `--output` argument for asset read is an export path explicitly authorized by
the user. It is not a source resolver, and it does not cause describe's read
argv to include output.

## bundle install selection contract

The CLI's `id` is an optional positional argument and `all` is a boolean
flag; core accepts only the following two selections:

| Arguments | Result |
|---|---|
| `bundle install <id>` | Install that ID and its dependency closure |
| `bundle install --all` | Install all manifest roots and their dependency closure |
| `bundle install` | `BUNDLE_SELECTION_INVALID`; do not create a generation |
| `bundle install <id> --all` | `BUNDLE_SELECTION_INVALID`; do not create a generation |
| `bundle install ""` | `BUNDLE_SELECTION_INVALID`; an empty ID is not a selection |

Each activation set is determined only by the current selection; it does not
automatically accumulate other bundles from the previous generation. For
example, install A and then an independent B, and the second generation contains
only B. Use `--all` when all bundles must be active; do not treat repeated
single-bundle installs as an accumulating operation.

The MCP `unone_bundle_install` schema uses `oneOf` to require exactly one
selection: the ID branch permits omitted `all` or `false`, while the all branch
requires `all:true` and forbids ID. The handler still performs strict
string/boolean parsing for `id`/`all`, then passes the values to the same
`install_selected(id.as_deref(), all)`. Therefore
`{"id":"content","all":false}` is exactly equivalent to ID-only; `{}`,
`{"all":false}`, and `{"id":"content","all":true}` produce the same core semantic
selection error. An error must not switch the active generation.

All manifest roots share one installed set and dependency traversal. Any fetch,
hash, dependency, or cycle failure preserves the existing active metadata. Empty
or duplicate bundle IDs, invalid hash/size values, and missing or cyclic
dependencies are also rejected before activation.

The manifest's `bundles` field must be explicitly an array: a missing field is
`BUNDLE_MANIFEST_INVALID`, while `[]` is `BUNDLE_MANIFEST_EMPTY`. Native and Web
installation/active reads validate the complete dependency graph; they do not
ignore another missing or cyclic dependency just because this operation reads
only one bundle.
When Web already has an active pointer but its record is missing or invalid,
report `BUNDLE_ACTIVE_GENERATION_UNREADABLE`; this is not an automatically overwritable
“first installation”.

## `asset inspect` and boundaries

`asset inspect` is an authoring advisory for the complete manifest/scene. Use
`game verify` as the aggregate author gate; its assets step already runs strict
inspection. Use standalone `asset inspect --strict` for focused asset diagnosis or
publication verification, not as a duplicate gate when `verify` is the selected entry
point. It checks static references from main-scene `sprite`, `mesh3d`, and `animation`
components, but not IDs dynamically created or selected by Luau.
`unreferenced_asset_ids` does not mean safe to delete: dynamic strings, a host, or
external content may still use them.

The engine is responsible only for declaration validation, archive integrity,
native-local verified reads, and generation activation. It does not own
image/model decoding, GPU resource lifetime, downloading, retries, cache quota,
CDN, runtime asset leases, or a game catalog. Web IndexedDB, native `.unone`, and
other host storage are different active scopes; native CLI activation does not
mean Web activation. Passing `asset read` does not prove native texture rendering or a
formal Web/mobile host gate.

The Web slice is Web-first: mobile validation is a separate deferred track and
is not required for Web validation. Web CDN, OPFS/production quota, and
content-change hot-update evidence must still be collected separately when
claiming the Web final gate.

Safe-path rules also apply to the manifest, scene, primary files, companions,
bundle manifest, and native-local bundle fetch: perform portable lexical checks
first, then check canonical containment for existing targets and ancestors.
Absolute paths outside the project, `..`, backslashes, escaping symlinks,
duplicate asset IDs, and unknown kinds/versions all fail closed.

## Error recovery and invariants

Recover at the layer where the error occurred; do not hide the problem by
clearing the cache or falling back to the source:

- authoring is missing a manifest, source, or companion: create or fix the
  authoring files and declaration, then run pack. A query can provide
  locations, but it does not generate bytes for the author.
- pack or `asset inspect --strict` fails: fix the manifest, path,
  kind/version, static reference, or actual files first, then repack; do not
  install content that did not pass.
- If the latest formal active record is damaged or cannot be parsed,
  `install`, `describe`, and `read` must fail closed and report
  `BUNDLE_ACTIVE_GENERATION_UNREADABLE`. This is a manual prerequisite for the
  host/operator: inspect and repair the record from diagnostics, or restore it
  from a trusted backup; report a blocker when no trusted backup exists. Do not
  clear the cache, delete the entire `.unone` directory, roll back to an older
  generation, or fabricate an active generation to pretend recovery. Fixing
  the source, packing, or strict inspection cannot repair a damaged record.
- If cache or archive bytes are damaged, or active does not yet contain the
  latest authoring/bundle manifest, use the structured diagnostic to fix the
  authoring source and follow
  `pack → strict → install --all → describe → read`. This path does not bypass
  the manual prerequisite for a damaged active record and does not splice
  results from different generations.
- If `bundle install` fails during fetch, hash, size, dependency, cycle, or
  activation, preserve the existing active generation and metadata. Verified
  cache may remain, but that does not mean it is active. This protects the
  current activation only; it is not a rollback for the entire publication
  process. If the authoring bundle manifest was updated, the old active
  generation may no longer satisfy the new manifest and may not be readable;
  republish through the preceding path.
- `asset read --output` is an export write explicitly authorized by the
  user and is separate from authoring-source project containment; describe's
  suggested read command does not include output.

Each query's freshness covers only the selected asset's native-local
observation. If the generation or manifest changes during observation, do not
report it as fresh; run describe/read again for a consistent observation. Web
IndexedDB, native `.unone`, mobile, and other hosts each install and validate
independently, and CLI results cannot substitute for cross-host evidence. Mobile
validation remains a separate deferred track and is not a prerequisite for the
Web slice.

## Encoding and decoder boundaries

A legacy entry without `encoding` is unspecified, not universally decodable.
`asset describe` reports `decoder_support: not_probed` even when bytes are fresh.
An explicit declaration looks like this:

```json
{
  "id": "asset://actor", "kind": "spine", "source": "assets/actor.json",
  "bundle": "content", "files": ["assets/actor.atlas", "assets/actor.png"],
  "encoding": {
    "format": "spine-json", "mime": "application/json", "decoder": "spine",
    "companions": [
      {"path": "assets/actor.atlas", "role": "atlas", "mime": "text/plain"},
      {"path": "assets/actor.png", "role": "texture", "mime": "image/png"}
    ]
  }
}
```

Every `files` entry is required and must have exactly one role/MIME descriptor
when encoding is supplied. Undeclared, duplicate and missing descriptors fail
validation. `format_version` optionally states a required version; current adapters
cannot negotiate it and reject versioned declarations instead of silently ignoring
it. Encoding is part of AssetSpec equality and active-generation freshness checks.
The basic asset-init command still initializes legacy entries; richer declarations
are authored in the schema-backed manifest.

| Host path | Actual boundary |
| --- | --- |
| Native texture loader | Explicit `image` / `svg` / `image/svg+xml`; resvg decode. Legacy sources use SVG extension detection. |
| Web runner image loader | `image`: svg/png/jpeg/webp, matching MIME. Actual image decode may still fail. |
| Web audio loader | `audio`: wav/mp3/ogg with audio/wav, audio/mpeg, audio/ogg. `decodeAudioData` decides actual device support. |
| Web presentation Spine | `spine` / `spine-json` / application/json, JSON skeleton and atlas. Uses the external runtime, not binary skeleton loading; currently one selected rig asset. |
| Web presentation Effekseer | `effekseer` / `efkefc` / application/octet-stream for explicit declarations, external runtime loading; currently one selected effect asset. |
| Android Canvas | Limited semantic 2D presentation, no universal asset decoder or 3D renderer. |

Web runner/presentation expose `unoneHost.decoderCapabilities()` from the same
accepted-route table used by their loaders. These are accepted routes, not proof
of successful decoding. Unsupported explicit routes return
`HOST_ASSET_ENCODING_UNSUPPORTED`; load/decode failures remain visible. Legacy
extension/runtime behavior remains compatible, with no inferred capability claim.
Unknown or unimplemented formats can be packaged as assets but cannot be claimed
renderable until the selected host implements and verifies their decoder.
