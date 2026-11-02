# Refresh an official Web export using source ingestion

`scripts/refresh-official-web.mjs` prepares a fresh official Web publication from
a project, a pinned engine host snapshot, an existing verified export and a
pinned production WASM runtime. It does not invoke a native executable or change
application-control policy. Prefer the normal CLI `project prepare` pipeline
when its full import, analysis and precompilation gates are available.

This tool has an explicit `source-ingestion-refresh` mode. Entry and module
sources compile when the runtime loads them. It does not produce a complete SDK
and does not perform the current CLI's production bytecode precompilation,
importers, asset conversions, analyzer or gameplay tests. The output manifest
records these limits, the separate Core and host identities, every published
file hash, and the actual WASM validation result.

Use Node 24 or newer (the JSON precision and signed-zero checks require its
JSON capabilities). Inspect the inputs before preparing a fresh output directory:

```powershell
node scripts/refresh-official-web.mjs --inspect-host --host-root <engine-snapshot>
node scripts/refresh-official-web.mjs --inspect-runtime --runtime <runtime-directory>
node scripts/refresh-official-web.mjs --project <game-project> `
  --input-export <verified-official-export> `
  --host-root <engine-snapshot> --host-sha256 <inspection-sha256> `
  --host-commit <full-host-commit> `
  --runtime <runtime-directory> --runtime-sha256 <manifest-sha256> `
  --output <fresh-directory>
```

The host fingerprint covers the authoritative Rust `WEB_FILES` inventory and its
relevant source contracts. A commit argument is a caller-supplied label; the
exact relevant file hashes independently pin what was read. The selected
runtime must be production, clean-source, opt2, contain the actual sprite
resource ABI, and omit developer exports. Metadata and actual JS/WASM bytes are
checked together. This is not permission to substitute a renamed native binary.

The base export must have a closed, hash-valid inventory and matching alias and
release contents. Fresh project config, scene, source modules, jobs, declared
data assets, fonts and supported raw image/audio assets are read from confined
paths. Existing derived assets can be reused only when their authored
specification and every source hash match. Unsupported new imports or decoder
formats fail explicitly. Project-owned HTML customizations are not copied into
the fresh official shell; their owner must reapply and reseal them deliberately.

Before publication, a bounded Node worker executes the pinned WASM to parse the
HostProject, stage data assets, compile the entry and modules required during
`Game.start`, and run that start function. Unused modules are not precompiled.
This verifies neither gameplay ticks nor GPU rendering. Inputs are checked
again after validation. The output gets a canonical content-addressed generation
and `export.json` is written last. Existing outputs are never overwritten;
failed partial publication evidence is preserved.

Validate the exported official player in the requested browser backend. Keep
Node VM, browser/GPU, FPS, memory ownership and Native evidence separate. A
successful preparation alone does not establish any of those results.
