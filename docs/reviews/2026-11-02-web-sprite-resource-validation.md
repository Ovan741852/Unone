# Web sprite resource and immutable span validation

The official Web host now shares one decoded-image/texture owner across material
preparations for the same catalog asset and sampler. Material programs and
instance uniforms retain independent ownership. Bloom preparation visits the
existing screen and HDR targets and restores the previous target. The earlier
missing Bloom hook made valid resource preparation fail; it is fixed.

The host changes are `f7c1999` and `97e6383`. The tested production WASM is the
existing clean `bfcd9160ae3cb7c4dff6d8515ee7400ee3adff00` build, SHA-256
`dd30ee204e6faa5809625166dd4a02727218a35bd8273df7952d8a60da0f98f3`.
It contains immutable byte spans and SpriteApi. It predates the latest module
bytecode export changes. The separate host fingerprint is
`b3d771176624a6a60adc9ce39d9ef115ae4c155fb6aaa97533285aceacbb141c`.

Actual validation:

- Production WASM SpriteApi: 10 transaction/readiness/ownership checks passed.
- The expanded immutable bytes/span fixture passed. Natural collection retained
  the root while its child span was live and collected the released objects by
  tick 5, after 10 MiB cumulative requested pressure. This is an ownership
  witness, not a GC-frequency measurement.
- Web suite: 729 passed, zero failed, one skipped because adjacent normal-World
  mesh packet captures were absent. Focused sprite/Bloom/broker tests passed;
  six meaningful old-pool negative controls reproduce duplicate ownership.
- Official WebGL player, 1280×720, IAB: main and worker each completed 100 cycles,
  12 slots, two pages and two distinct shader materials: 4,800 actual submitted
  revisions per backend, zero fixture failures and zero scheduler dropped steps.
  Both displayed PASS. The saved visible screenshot also shows independent
  material colors on the same page.
- Each long run built/retired 400 material entries and 200 textures. Final
  managed handles, entries, image leases, live textures and reserved bytes were
  all zero. Observed WASM linear capacity stayed 16 MiB. The broker intentionally
  retained two tiny decoded images (256 bytes estimated) in its separate bounded
  scene/unused caches; UI/Bloom allocations remain separate.
- The source-refresh publisher passed 22 tests including real WASM `require`,
  staged JSON/text assets, invalid-input rejection and closed publication checks.
  Invalid data or entry compilation leaves the requested output absent.

The stable local delivery is `artifacts/web-sprite-official-20261102`, containing
219 indexed files and release
`6cfd2b165bbaf7799ba1f4bf675ef0c813ead77a9e925e2834e8cc890c68d507`.
Its release files are byte-identical to the 100-cycle browser-tested publication;
the final manifest adds the current preparation-tool provenance. The separate
host/runtime snapshots and [preparation instructions](../web-source-refresh.md)
are a scoped Web delivery, not a complete SDK. Source ingestion does not run
importers, the analyzer or the native CLI's production precompiler. Validation
covers the entry and modules actually required by `Game.start`.

The latest `a5ceca3` WASM rebuild failed with Windows App Control error 4551 for
`generic-array` and `heapless` build scripts. The newer native CLI and Native
rebuild remain blocked as previously recorded. No blocked executable was
renamed, copied or retried, and no OS security policy was changed. Existing
successful Native immutable-byte tests are historical evidence, not a successful
rebuild of this newer sprite adapter. Native custom sprite GLSL is unsupported
and fails explicitly.

The JYRogue battle p95 regression remains unresolved. A separately profiled actual
WASM run identified whole `entities` (317 members) and `observations` (782 members)
as changed on every measured tick. Per-field restore marks and byte/change
counters now identify UTF-8, parse and freeze costs without changing private
immutable grants. Most sampled tails were still larger inside the tick ABI;
some were larger in field restore. These wall boundaries do not establish GC as
the cause. See [the diagnostic record](../evidence/2026-11-02-sprite-resources/world-fields-diagnostic-summary.json).

No claim is made here that all seven gameplay scenes sustain 60 FPS, that every
frame in the long run met a display deadline, that all memory is leak-free, or
that GC frequency is acceptable. Context restoration has source/unit coverage;
this browser run did not deliberately lose the GPU context. The other chat is
continuing actual JYRogue integration and scene acceptance with this official
pair. All local test tabs and the server started for this validation were closed.
