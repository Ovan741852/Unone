# Native asset lookup during startup

The native renderer builds one `HashMap` of verified asset descriptors and checks
the existing GPU texture cache before resolving a mesh's texture descriptor.
The index is used for lookup only. Mesh and texture upload order still follows
the manifest, and all resources are loaded eagerly as before.

Asset IDs must be unique across all kinds. Duplicate IDs, including identical
descriptors or a mesh/texture collision, fail with
`ASSET_MANIFEST_DUPLICATE_ID`, matching the SDK manifest contract in
`unone-engine/src/asset.rs`. A missing texture or a reference to another asset
kind fails with `MESH_TEXTURE_MISSING`; no alternative material is selected.

This removes a linear scan that previously happened before every mesh's cache
lookup. With A assets, M meshes and T shared textures, indexing takes expected
O(A) time. Mesh cache checks remain O(M log T) because the existing GPU cache is
a `BTreeMap`; the registry is queried only on cache misses. Geometry, UVs,
vertical UV conversion, indices, material/sampler settings, shader code, LODs,
texture decoding and GPU allocation policy are unchanged.

An external CPU differential can be run without creating a GPU device:

```powershell
$env:UNONE_NATIVE_ASSET_LOOKUP_FIXTURE = 'C:\path\to\verified-export'
cargo test --manifest-path crates/unone-native-player/Cargo.toml --lib render::tests -- --nocapture
```

The export must contain `content/assets.json` and the referenced mesh files.
`external_asset_index_differential` compares the exact descriptor and source for
every mesh. It memoizes the old linear reference once per distinct texture ID
to avoid spending the test run repeating identical scans. It also reports the
number of comparisons the old per-mesh path would perform. Other focused tests
cover declaration order, missing IDs/references and duplicate-ID rejection.
An unset fixture environment variable does not exercise the external export.

In one measured 17,548-asset fixture, 15,546 meshes share 41 textures. The old
path performs 262,860,105 asset-ID comparisons; the new path builds one index
and performs 41 registry lookups after cache misses. All 2,002 texture uploads
and at least 31,092 mesh buffer allocations remain. This change does not provide
lazy loading or establish a bound on launch time.

`boot_ms` is recorded after renderer construction and before replay input is
advanced. It includes package reading/hashing, runtime creation and eager GPU
resource setup, but excludes the first UI rasterization. Per-frame `ui_raster`
timing therefore cannot identify the cause of an unusually long boot. Startup
phase instrumentation or controlled native before/after measurements are needed
to attribute variation to disk, compilation, GPU/driver allocation or scheduling.
