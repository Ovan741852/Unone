# Runtime contracts and current boundaries

Unone is an AI-native **3D engine with 2D workflows**, currently a prototype.
Existing Transform3D, Camera3D, Mesh3D and host presentation paths are part of
that direction. More complete 2D regression coverage is not a 2D-only product
commitment. It is not yet a mature engine for every game genre.

## Contract authority

Rust deserialization DTOs define accepted project, scene, test, asset, bundle, input,
host-project and developer request shapes. Generate their checked-in schemas:

```powershell
foreach ($name in @('project','scene','test','asset','bundle','input','host-project','developer')) {
    game schema $name --output "docs/$name.schema.json"
}
```

A Rust test checks the generated files against the DTOs. Do not hand-edit JSON
schemas. Runtime semantic validation additionally checks ranges, references,
mutually exclusive assertions, file contents and capability requirements. A
structurally valid JSON document is not proof that those checks will pass.
Typed object fields reject unknown keys, including nested vectors/UI/input and
asset encoding. Open dictionaries are intentionally open: action names, system
IDs (validated against the registry), observations and game-owned save data.

`unone_session` advertises the generated request schema and uses the same core
parser as JSONL. Legacy MCP command argument schemas are still constructed in
the adapter; their advertised property names now also gate accepted arguments.
Unknown keys return `MCP_ARGUMENT_UNKNOWN` before command execution. This is a
remaining migration boundary, not a claim that every legacy command is generated.
Engine API documentation/type generation is a separate registry; adding an API
still requires its implementation and contract tests.

## Host semantics and deterministic scope

Web and Mobile share `HostProject` and `HostInputState` from engine core. The host
envelope is `{config, script, scene, restored_save?, viewport_aspect?}`; `config`
is the complete `ProjectConfig`, with the same generated schema and unknown-field
rejection. Old envelopes with top-level `project`, `systems` or `audio` must be
rebuilt. Hosts forward the whole config rather than maintaining a field allowlist.
Runner, live, presentation and player share `web/shared/load-project.js` for the
actual WASM load. Android packagers preserve the original config JSON as well.
Save restoration happens before `Game.start`; later save replacement
is a separate action and cannot retroactively rerun startup. Web runner restores
persisted save before load. Android packaging includes systems/audio; storage
policy remains the caller's responsibility.

`node scripts/verify-host-parity.mjs` executes the built CLI and actual WASM on
the checked-in replay project, comparing observation digests at every fixture
time point. It includes an audio-omission negative control. Package verification
runs this against its packaged binaries; binary string searches are removed.
This proves the exercised replay contracts, not every possible future declaration
or rendering equivalence. Extend the fixture as observable contracts grow.
Player release acceptance additionally uses the actual export's payload, loader
and runtime (`verify-player-parity.mjs`), including an on-disk payload corruption
negative control. See [Luau replay boundary](luau-determinism.md) for the supported
numeric/ordering discipline, enforced ambient-source guards and exclusions.

Normalized `InputFrame` is the replay boundary. Every field is checked before
runtime mutation. Explicit frames are consumed once; omitted pointers release
the button while retaining coordinates. Scalar pointer setters hold until release;
scalar actions are one-frame submissions. Mixing frames with scalar input never
resurrects an older press. Browser focus loss clears queued presses. Camera2D
screen/world conversion uses camera position, zoom and view height, including
Android's Canvas adapter. UI screen coordinates are 0..100, y-up; world position
is a 2D compatibility coordinate. 3D picking must use a defined camera/ray contract,
which is not added here.

All ticks now publish completed-frame audio lifecycle state: the tick return and
immediate `observe()` agree. This fixes a prior fade-boundary difference between
Web and Mobile and intentionally changes old audio replay digests at those
boundaries. Re-record affected baselines after review; do not mix engine builds.

Compare semantic snapshots/digests with identical engine build, content, seed,
normalized input sequence, system/audio settings, initial save and viewport.
Resizing is an external configuration change, not currently a recorded developer
command. The shared 3D fixture exercises core/Web bridge/Mobile FFI on the test
host, including save, input and audio. It does not prove cross-architecture floating
point identity, device event scheduling, GPU frames, audio output or external
Spine/Effekseer rendering. Device and WASM acceptance remain explicit work.

Error responses share `ok`, `value`, `diagnostics`, `effects`; legacy `diagnostic`,
`error` and `message` aliases remain during migration. Success envelopes retain
host-specific lifecycle/surface data; compare `world` and `observation_digest`.
`platform capabilities` reports core/binary information and `renderer_probe:
not_probed`; it cannot certify a separately running renderer from target OS alone.

## State ownership and AI operation

[DeveloperSession](developer-session.md) provides Snapshot, Journal, polling Watch,
input stepping, replay and Enact. Enact is an atomic temporary Rust state patch
between ticks, with revision checks and dry-run diffs. It runs no Lua callbacks,
changes no authoring files, and may be overwritten by gameplay on the next tick.
Luau plus input retain gameplay authority. There is no implicit permanent override.

The AI can gather traces, counts, phase timings and Lua memory measurements,
form a hypothesis, change source, then compare the same workload and replay.
The engine supplies raw evidence; it does not select bottlenecks or automatically
optimize. The current session is headless and does not control an already-open
preview. GPU/render profiling and live-host attachment need host instrumentation.

## Asset and engine scope

See [asset workflow](asset-workflow.md) for optional explicit encoding metadata,
required companion roles and actual decoder boundaries. Resource freshness is
separate from decodability. Mesh3D declarations do not imply a universal importer.

Still unfinished: general module/package composition, entity lifecycle, prefabs,
navigation, networking, broad mesh/material importing and mature 3D physics.
Audio already has core semantics and Web playback; Native/Android playback remains
unfinished. Spine remains external. Effekseer and a future AI-native particle
backend are intended alternatives; the new particle format is not implemented.
