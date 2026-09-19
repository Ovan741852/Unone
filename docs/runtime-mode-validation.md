# Luau execution modes and paired validation

2026-09-15. Reusable engine/host diagnostics, not gameplay policy. Games retain
rules in Luau. These tools neither rewrite gameplay nor choose optimization targets.

Scoped release verification was completed on 2026-09-17 for the paired
`execution_probe` on Windows x86_64; see
[`docs/evidence/2026-09-17-native-codegen-release.md`](evidence/2026-09-17-native-codegen-release.md).
This is not a blanket release claim for a game, renderer, mobile package, or
browser host.

## Wasm JIT: distinguish the two compiler layers

WebAssembly can be JIT-compiled by a host. V8 uses Liftoff and TurboFan to turn
Wasm functions into CPU instructions. That compiles the Luau VM's Wasm code, not
each game Luau function into a new Wasm function. The latter requires another
compiler backend and integration with Luau values, GC, calls and deoptimization.

As checked on 2026-09-15, upstream Luau documents optional x64/arm64 codegen.
mlua explicitly excludes JIT from its wasm32-unknown-emscripten support. This
repository pins mlua 0.11.6 / luau0-src 0.18.3+luau709; its CodeGen isSupported
accepts CODEGEN_TARGET_X64 or CODEGEN_TARGET_A64 and rejects other targets.
Therefore no current supported Luau-Wasm JIT switch was found to enable here.
This is **not** a claim that guest JITs targeting Wasm are theoretically impossible.
The WebAssembly JavaScript API can compile generated modules; a Luau backend
would be new compiler work, not an existing mlua setting.

Primary references:

- [Luau performance](https://luau.org/performance/)
- [mlua supported targets](https://github.com/mlua-rs/mlua#readme)
- [Upstream CodeGen support checks](https://github.com/luau-lang/luau/blob/master/CodeGen/src/CodeGen.cpp)
- [V8 Wasm compilation pipeline](https://v8.dev/docs/wasm-compilation-pipeline)
- [WebAssembly compilation API](https://webassembly.org/getting-started/js-api/)

## Discover the real mode

Core `execution_mode()` is host-visible metadata. `platform capabilities`,
developer session metadata and preview profile responses expose it. It is not
part of canonical world snapshots, replay equality or gameplay APIs.

It reports the Luau VM identity, Rust host binding, target, Rust debug/release
profile, diagnostic/shipping intent, diagnostic features, codegen
compiled/support/requested state, fallback, and Luau bytecode
optimization/type-info levels. It also states the fixed-tick replay contract.
`native-codegen-eligible` means this CPU/ABI is supported and mlua is requested to
compile loaded code. It is NOT a per-function compilation success counter.
Unsupported or unprobed facts remain explicit, not assumed true.

- Diagnostic `preview-tools` disables Luau codegen even if compiled in. Default
  bytecode optimization is level 1 and type info level 0.
- Non-diagnostic `native-codegen` requests codegen and bytecode optimization 2 /
  type info 1, matching the existing production engine policy.
- Wasm host compilation is `host-managed-not-probed`. A Rust/Wasm build cannot
  report which browser JIT tier is currently executing it merely from cfg flags.

## Paired headless validation

```powershell
node scripts/verify-runtime-modes.mjs --project D:/path/content/project.json --scenario D:/path/scenario.json --target-dir C:/path/mode-build-cache --output C:/path/new-evidence --repeats 3
```

`project.json` uses the shared `HostProject` payload: config, script, scene,
job_sources, restored_save and viewport_aspect. No second game implementation or
source scanning is used. This is suitable for an exported content/project.json;
it does not resolve arbitrary authoring asset paths. Scenario schema:

```json
{"seed":42,"warmup":2,"inputs":[{"actions":{"Right":true}},{},{}]}
```

Warmup uses released/default inputs; measured inputs are one exact InputFrame per
tick. There must be at least one measured tick and at most 60,000 total ticks.
The tool snapshots the input bytes into a new evidence directory, pins payload,
scenario, engine-source, Cargo lockfile and executable hashes, builds two separate
release binaries, then alternates fresh-process ordering for 2..10 repetitions:

1. `--no-default-features --features all-systems,native-codegen,preview-tools`:
   interpreter with diagnostic sampling/VM probes enabled during measured ticks.
2. `--no-default-features --features all-systems,native-codegen`: no preview ABI,
   no sampler, supported native codegen eligibility required. No silent fallback.

Initial state and every attempted warmup/measured tick have canonical digest
checkpoints. First divergence, a failed tick, changed inputs/source, unsupported
mode, probe timeout or inconsistent repeat blocks the success verdict. Timeouts
do not manufacture a zero cost. Failures and build logs are retained. The tool
never overwrites previous evidence directories or automatically retries a mode.

The timed span is `tick_with_input` including the returned snapshot, not just Lua.
Digest hashing is outside it. Diagnostic reports include actual function samples
and VM measurements. Only successful production runs contribute to the median of
mean tick times. No diagnostic/production ratio is advertised as speedup: the
builds deliberately differ. To evaluate an optimization, compare old/new
**production** repetitions with fixed workload and inspect acceptance separately.

Canonical digests exclude packed instance pose bytes by existing Core contract;
equal digests do not prove those poses, rendered pixels, GPU time or game quality.
No renderer, mobile WebView or browser JIT tier is measured by this native probe.
The default per-probe timeout is 120 seconds; --timeout-ms accepts 1..300 seconds.

## HTML overlay direction

Use HTML overlay as the primary human UI for Viewer and browser/WebView players.
Core continues to publish semantic UI state and accept typed input; HTML is a
presentation adapter, not an authority for game rules or an engine dependency.
Keep stable node IDs, hit testing/input routing and observation access independent
of DOM so AI can diagnose either presentation through domain tools.

Pure native wgpu does not acquire HTML support automatically: it needs a WebView
host/adapter with explicit input focus, resize, safe-area, IME, lifecycle and scoped
bridge handling. Keep its existing native UI renderer as a supported fallback;
do not remove it or claim WebView/phone validation from a desktop browser test.
The previous blanket “Native UI gap” description is stale: the native-player
source now includes a CPU-raster/wgpu UI overlay with static SVG images. This
document sets the preferred HTML direction, not a new implemented WebView host.
