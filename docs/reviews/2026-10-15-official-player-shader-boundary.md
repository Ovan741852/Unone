# Official player, declarative effects and shader boundary

Date: 2026-10-15
Baseline: `29a77f42943fab33eb55a0ca7050df33878628e7` on `main`.

## Problem and resulting behavior

A game could use the Core simulation but replace the entire presentation host,
pass headless checks, and then incorrectly attribute custom rendering work to
missing engine capabilities. Native declarative particles already existed, but
visual-intent searches and stale scope documentation obscured that path.

New projects now declare the official player, demonstrate native particles, and
provide API/system discovery and official export actions. Custom renderers require
an explicit presentation mode and packaged module/file declarations. Export and
boot identify that choice; arbitrary trusted host code is not sandboxed by this
contract. Headless verification is not proof that a GPU path was exercised.

Scene-authored fragment materials and `shader.setMaterial`, `shader.setUniform`
and `shader.clearMaterial` keep game decisions in Luau and GPU resources in the
official renderer. The initial implementation supports WebGL sprite materials;
native export/player and active WebGPU bindings fail explicitly instead of
silently omitting them. See [ADR 0037](../decisions/0037-official-player-and-shader-boundary.md).

## Validation

- `cargo test --release --workspace --locked --quiet`: passed; the suite retains
  three existing ignored tests. Exact API names, CLI/MCP discovery, starter
  authoring, schemas and shader state/error paths are covered.
- `cargo test --manifest-path crates/unone-native-player/Cargo.toml --release --locked native_runtime_rejects_shader_resources --quiet`:
  passed, including a normal scene and rejection of a shader resource.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: passed.
  Small equivalent guard rewrites also resolve existing asset-scan and bundle
  Clippy warnings; their behavior is unchanged.
- Node renderer-selection, shader-material and particle unit tests: passed.
- `scripts/verify-shader-materials-browser.mjs`: 36 actual GPU checks passed with
  the production minified Three bundle. Scalar/vector uniforms change pixels;
  simulation time remains fixed during a wall-clock pause; clearing restores the
  original pixel; malformed GLSL reports its compiler error; teardown has no GL
  errors. This is a renderer-level fixture, separate from the exported player.
- Official-player acceptance: 18 checks passed using fresh CLI init, strict
  verify, actual exported WASM/native observation parity and an actual browser
  boot. The official player reported an active shader material, native particles
  and Bloom, with no JS/request failures. An unmarked custom module was rejected
  before creating an output directory. Test images were copied from the existing
  imagegen-generated game assets into ignored QA fixtures.

Compact results and the exact check lists are in
[acceptance.json](../evidence/2026-10-15-official-player/acceptance.json).
Generated runtimes, screenshots and full local traces remain under ignored
`artifacts/`; they are not release artifacts or cross-device acceptance claims.

## Independent review

Independent agents performed read-only reviews of Core shader validation and
state ownership, renderer lifecycle/packaging, API discovery and documentation.
Corrections include testing scene validation at actual runtime load, independent
per-sprite textures, compatibility with the production Three export, preserving
explicit API-name intent, shader deletion after compiler failure, and deterministic
time. Relevant regressions and actual-GPU acceptance are included above.

The repository-prescribed Claude CLI review was attempted twice with version
`2.1.280`; **neither attempt completed and neither is counted as a successful
review**:

1. A read-only fixed-diff review with `Read,Grep,Glob`, plan permissions and
   `--max-turns 8` exited 1 with `error_max_turns`. The fixed diff SHA-256 and exact
   command are in [attempt 1](../evidence/2026-10-15-official-player/claude-attempt1.json);
   the [raw response](../evidence/2026-10-15-official-player/claude-attempt1-raw.json)
   contains no final finding report.
2. A static fixed-diff review with tools disabled and `--max-turns 1` was stopped
   after a 240-second timeout (exit 124). It produced no stdout. Its diff SHA-256
   and exact argument list are in
   [attempt 2](../evidence/2026-10-15-official-player/claude-attempt2.json).

Later equivalent Clippy guard rewrites are outside those incomplete review
snapshots. No claim of completed Claude review or additional platform parity is
made.
