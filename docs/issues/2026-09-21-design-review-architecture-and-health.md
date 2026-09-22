# Design review: architecture and code health (2026-09-21)

## Scope and method

- Committed revision: `39d8ee1` (`Add verified Web and Windows project preparation handoff`).
- The working tree also carried roughly 1,380 uncommitted modified files at review
  time. Two findings below (A7, B1) concern that uncommitted work, and are marked.
- Requested focus: architecture/design quality and maintainability. Not a
  correctness or safety audit, although three safety-adjacent gaps are recorded.
- Method: static reading only. **No build, no test, no clippy run.** The review
  environment had no reachable crate registry, so no dependency could be fetched
  and nothing was compiled. Every claim below is a source-level observation or a
  mechanical count, never an executed result.
- Public sources only. `_Games/` contains nine games; the private validation games
  under `Unone_Games` were not visible, so every usage count below describes the
  public subset and would change if a private game exercises the same API.

## What holds up

These are recorded so a later reader does not "fix" them.

1. **The engine/game ownership rule in `AGENTS.md` is actually enforced in the
   committed engine.** Across `crates/unone-engine/src`, `crates/unone-cli/src`
   and `crates/unone-native-player/src`, exactly one occurrence of a game-specific
   noun exists, and it is a documentation example
   (`crates/unone-engine/src/api.rs:217`, `mesh://soldier`). For a project of this
   size that is unusual and worth protecting.
2. **`Diagnostic` / `EngineResult` is a real machine-readable contract**, not a
   wrapped error string: `code`, `facts`, `likely_causes`, `suggested_actions`,
   `source` (`crates/unone-engine/src/diagnostics.rs:25-35`).
3. **`EngineRuntime::tick` avoids `RefCell` re-entrancy by construction.** The
   codebase has 121 `borrow_mut()` calls and zero `try_borrow`, yet every borrow in
   `tick` is scoped to end before `update_fn.call()` re-enters Luau
   (`crates/unone-engine/src/runtime.rs:869-1010`). This is deliberate and should
   stay deliberate; a future edit that holds a borrow across the script call will
   panic at runtime, not fail to compile.
4. **`InstanceBatch3D` is the right shape for the hot path.** `Arc<[u8]>` for the
   packed poses plus `Arc<OnceLock<String>>` for the lazy base64 makes snapshot
   clones near-free and encodes once (`crates/unone-engine/src/instances3d.rs:6-23`).
5. **Determinism is taken seriously**: seeded RNG, observation digests, quantized
   snapshot fields, and a capture/restore rollback for a failed hot reload
   (`runtime.rs` `capture_reload_state` / `restore_failed_reload`).
6. **Test presence is good**: 388 `#[test]` functions, and every module under
   `web/shared/` has a colocated `.test.mjs`.

## A. Architecture findings

### A1 — The "ECS world" is a string-keyed map that the real workloads bypass

- `World.entities` is `BTreeMap<String, EntityState>`, and `EntityState` is an
  11-field struct with four `Option` members
  (`crates/unone-engine/src/world.rs:837-847, 869-876`).
- `World::snapshot` deep-clones that whole map every call
  (`crates/unone-engine/src/world.rs:999-1044`), and `EngineRuntime::tick` calls
  `observe()` unconditionally on every frame (`runtime.rs:981`, `runtime.rs:1145`).
- Measured usage in the public games: `api.entity.*` appears **17 times** across
  nine games and 11,920 lines of Luau. The 70,000-unit battle creates no entities
  at all; it drives `api.instances3d.set` with packed byte buffers
  (`_Games/legion-fall/main.luau:115-133`).

The consequence is that the 2,536-line entity model plus a per-frame deep copy
carries none of the headline workload, while a ~200-line packed-buffer side path
carries all of it. The fast path is a bypass, not the model.

**Decision needed.** Either (a) demote the entity map to an authoring/debug
representation and say so in the contract, or (b) make it a real archetype/SoA
store. The present middle state pays the cost of both and the benefit of neither.
A cheaper interim step that does not require picking (a) or (b): make `observe()`
lazy, so a headless or native run that never reads the snapshot does not build one
every frame.

### A2 — `systems` is a flag bag, not a schedule

- `SystemSettings` is `BTreeMap<String, bool>` and `is_enabled` is a string lookup
  (`crates/unone-engine/src/systems.rs:186-188`).
- The frame pipeline is a hand-written chain of
  `#[cfg(feature = "...")] if self.systems.is_enabled("...")` pairs inside `tick`
  (`runtime.rs:869-1018`). `runtime.rs` alone contains 78 `cfg(feature)` attributes.
- `runtime/bindings/mod.rs:20-90` repeats a `#[cfg]` / `#[cfg(not)]` pair plus
  `disable_if_off` / `unavailable` for every namespace.
- Adding one system requires edits in five places: the crate's `[features]`,
  `lib.rs`, `systems.rs` `descriptors()`, `bindings/mod.rs`, and `tick`.
- System ids are strings, so a typo in engine code silently disables a system
  instead of failing to compile.

**Proposed correction.** Introduce `enum SystemId` with a `const` id string per
variant, resolve `SystemSettings` once at load into a fixed-size bitset, and make
`tick` iterate an explicit schedule array of `(SystemId, fn(&mut World))` rather
than an if-chain. The compile-time `cfg` then only decides whether a schedule
entry is present, and `is_enabled` becomes a bit test instead of a `BTreeMap`
lookup per system per frame.

### A3 — Two overlapping switch dimensions

Compile-time Cargo features and runtime `systems` describe overlapping facts, so
`SystemDescriptor` has to carry `build_feature`, `compiled`, `default_enabled`,
`optional` and `status` at once (`systems.rs:34-53`) to express "could this binary
do it" versus "is it turned on". If the player binary's capability set were decided
by features only, and the runtime switch were offered only for genuinely optional
gameplay systems, roughly half of those fields disappear along with the states an
AI consumer has to reason about.

### A4 — Dev tooling and runtime share one crate

`lib.rs` carries 23 `#[cfg(feature = "dev-tools")]` attributes, and `bundle`,
`verify`, `asset`, `asset_workflow`, `developer`, `api`, `layout`, `diff`,
`schema` and `project_authoring` — roughly 12,000 lines of authoring tooling —
live inside `unone-engine` next to the runtime. The crate root then re-exports
over 100 types in one flat list.

**Proposed correction.** Split into `unone-core` (runtime) and `unone-authoring`
(dev-tools). Almost every `cfg` in `lib.rs` disappears, the flat re-export list
splits in two, and "a player binary contains no dev tooling" becomes a fact about
crate dependencies rather than the compile-time assertion `DEV_TOOLS_ENABLED`.

### A5 — The documented gate does not cover the graphics crate, and there is no CI

- `Cargo.toml` excludes `crates/unone-player` and `crates/unone-native-player`.
  The exclusion itself is justified: `crates/unone-native-player/Cargo.toml`
  declares its own `[workspace]` and `[profile.release]` so it can ship a `cdylib`
  for Android. But the crate is 4,261 lines and holds the wgpu renderer and its
  `unsafe` code, and nothing else covers it either.
- `README.md` presents `cargo test --workspace` and
  `cargo clippy --workspace --all-targets -- -D warnings` as the gate. Neither
  command reaches an excluded crate.
- The repository contains no CI configuration (no `.github/workflows`, no GitLab,
  Circle or Azure file). Every gate is a manual run of one of ~40 scripts under
  `scripts/`, and all but one are PowerShell, so the documented "clone and verify"
  path is Windows-only in practice.

This is the largest gap between what the roadmap promises and what is mechanized.

### A6 — Capability breadth is running ahead of validation

Public-subset usage across all nine games and 11,920 lines of Luau:

| Engine capability | Implementation size | Game call sites |
|---|---:|---:|
| Audio (`audio.rs`, `AudioBus`, `AudioMix`, rodio/cpal, ADRs) | 857 lines + host code | **0** |
| 2D physics (`broadphase.rs`, world integration, ADR 0006) | ~600 lines | **0** |
| Spine / Effekseer presentation | adapters in three hosts | **0** |
| UI (`ui.rs` 1,191 + `layout.rs` 494 + native `ui.rs` 837) | 2,522 lines | 8 |
| Entities (`world.rs`) | 2,536 lines | 17 |
| Packed instances (`instances3d.rs`) | 78 lines | 13 |

Seven of the nine games are labs of 283 lines or fewer. The real validation surface
is `ashen-legion` (7,671 lines) and `wuxia-sandbox` (3,304 lines), and neither
touches audio or 2D physics. `docs/roadmap.md` states "Prioritize usable
capabilities over additional verification machinery"; the built ratio is the
inverse of that sentence, and the seven-game gate in ADR 0002 is the mechanism
that was supposed to prevent it.

### A7 — Game-specific policy has entered the CLI preview (uncommitted work)

`crates/unone-cli/src/main.rs:1764-1782` selects preview colors by matching game
entity id strings: `"floor"`, the `npc_` prefix, and substrings `"training"`,
`"monster"`, `"temple"`. These are `wuxia-sandbox` naming conventions, and this is
exactly the behavior `AGENTS.md` forbids the engine side from encoding.

This code is in the working tree, not in `39d8ee1`, so it can be corrected before
it lands. A game-agnostic replacement is a deterministic hash of the entity id into
a fixed palette; anything semantic belongs in the scene's declared material.

## B. Maintainability findings

1. **`fn run()` in `crates/unone-cli/src/main.rs:429` is 702 lines.** One match
   over every command, with `match EngineRuntime::load*` error boilerplate repeated
   at least seven times, and the existing helper `read_input_frames` re-implemented
   inline twice (around lines 733 and 792). `report_host_assets` at line 1192 is
   668 lines. Correction: one handler function per `Command` variant, moved into
   the sibling modules that already exist.
2. **`EngineRuntime` has eight constructors**: `load`, `load_with_seed`,
   `load_with_seed_and_save`, `load_source`, `load_source_with_seed`,
   `load_source_with_systems`, `load_source_with_options`, `load_source_project`
   (`runtime.rs:361-479`; eight `pub fn load*` in one impl). Telescoping constructors; collapse to one options struct
   plus `load` / `load_source`.
3. **`fn descriptor()` in `crates/unone-engine/src/api.rs:1532` takes 12 positional
   parameters, six of them `&str`.** Swapping `when_to_use` and `when_not_to_use` at
   a call site compiles cleanly, and there are ~1,300 lines of such call sites.
   Correction: a struct literal with named fields, or move the catalog into a data
   file that a test validates against the Luau typings.
4. **162 distinct diagnostic codes appear as 289 bare string literals** in
   `Diagnostic::error(...)` / `Diagnostic::warning(...)`, with no central registry.
   For an engine whose contract surface is machine-readable diagnostics, the code
   space should be enumerable and testable against the docs.
5. **No lint configuration.** No `[workspace.lints]`, no `clippy.toml`, no
   `rustfmt.toml`, no crate-level `#![deny(...)]`. Clippy runs only when a human
   types the README command, and then not on the excluded crates.
6. **FFI safety is under-documented.** `crates/unone-mobile-ffi/src/lib.rs` has 123
   `unsafe` occurrences and two `SAFETY` comments; `bytes_from_ptr` (line 158) and
   `str_from_ptr` (line 173) are `unsafe fn` with no `# Safety` section stating the
   caller's obligations.
7. **Oversized modules.** `bundle.rs` is 3,194 lines covering manifest validation,
   the archive format, atomic writes, fetching, verification, generation activation
   and packing, with a single 730-line `impl BundleManager` (lines 1225-1956).
   `runtime.rs` is 3,125 and `world.rs` 2,536. `bundle/` should become a directory.
8. **Formatting is not uniform.** The test module in
   `crates/unone-engine/src/instances3d.rs:34-70` is written in a compressed
   single-line style unlike the rest of the tree, which suggests `cargo fmt` is not
   applied consistently.
9. **ADR hygiene.** Numbers 0003, 0024 and 0026 are unused; titles alternate
   between `# ADR 00xx:` and `# Decision 00xx：`; language alternates between
   English and Chinese; `Date`/`Status` headers are present on some records and
   absent on others.

## C. Changes applied by this review

Documentation and message text only. Nothing structural was changed, because
nothing could be compiled.

1. **ADR number collision resolved.** Two records shared the number 0034.
   `0034-independent-2d-colliders.md` is referenced from `docs/roadmap.md`,
   `docs/execution-plan.md`, two devlogs and a work package, so it keeps the
   number. The unreferenced `0034-unified-camera-component.md` was renamed to
   `0036-unified-camera-component.md` (0035 was taken) and its title changed from
   `# Unified Camera component` to `# ADR 0036: Unified Camera component`.
2. **Duplicate ADR marked.** `0018-seven-game-acceptance-gate.md` records the same
   decision, on the same date, as the English `0002-seven-game-acceptance-gate.md`.
   Its status now reads `superseded by ADR 0002` with a note that 0002 is the
   canonical English record. Neither file was deleted.
3. **Engine-authored CLI text is now English**, per `docs/roadmap.md` ("Engine-
   authored public text is English") and `docs/review-process.md`. 120 lines of
   Traditional Chinese diagnostic summaries, explanations and suggested actions
   were translated in `crates/unone-cli/src/{main,mcp,plugins,assets}.rs`, and the
   full-width colon in `format!("{}：{}")` was replaced with an ASCII colon
   (17 occurrences). Diagnostic codes were not changed.

   Deliberately left in Chinese, because the roadmap exempts them: the
   Chinese search-example terms in `main.rs:327` and `mcp.rs:472`, which demonstrate
   that `api search` and `systems search` accept non-ASCII queries; and the Unicode
   regression fixtures in `project_authoring.rs:1315`,
   `runtime/jobs/binary.rs:189` and `unone-native-player/src/ui.rs:716`.
   `_Games/ashen-legion/tests/formal-layout/auto-report.json` contains recorded
   historical output carrying the old Chinese summaries and was left untouched as
   evidence.

   Verification performed, in the absence of a compiler: each replacement was
   checked to preserve its `{}` / `{name}` placeholder set exactly, to introduce no
   quote or backslash characters, and to match its source string exactly once per
   expected site; the resulting files were confirmed to have balanced double quotes
   and no remaining CJK outside the exemptions above. A search confirmed that no
   test, script or schema asserts any of the translated strings.

**This change has not been compiled or tested.** Run `cargo check -p unone-cli`
before relying on it.

4. **A CI workflow was added** at `.github/workflows/ci.yml`, because A5 is the one
   finding that is a missing mechanism rather than a judgement call, and
   `docs/roadmap.md` prefers a tool over a document. It runs check, clippy and
   tests on the workspace, and carries three `continue-on-error` jobs for the parts
   this review could not prove: rustfmt (finding B8 says the tree is not uniformly
   formatted, so this will fail until it is), the two excluded player crates via
   `--manifest-path`, and the 24 colocated `web/**/*.test.mjs` modules under
   `node --test`.

   **It has never been executed.** The two things most likely to need adjustment
   are the system packages wgpu/winit/rodio need on the runner, and whether
   `cargo test --workspace` reaches the luau-analyze types gate on Linux — the
   install script's own header notes that only the Windows binary has ever been
   run on the machine that pinned the hashes. Delete the file if CI is not wanted;
   nothing else depends on it.

## C2. Lint configuration, deliberately not applied

Finding B5 has an obvious fix, but applying it blind would break the project's own
gate: `cargo clippy --workspace --all-targets -- -D warnings` promotes every
warning to an error, so adding lints without being able to run clippy first would
turn a passing command into a failing one. The snippet below belongs in the root
`Cargo.toml`, with `lints.workspace = true` added to each member crate, and should
be introduced one lint at a time with a clippy run between each.

```toml
[workspace.lints.rust]
unsafe_op_in_unsafe_fn = "deny"
missing_debug_implementations = "warn"
unreachable_pub = "warn"

[workspace.lints.clippy]
undocumented_unsafe_blocks = "warn"   # expect many hits; see finding B6
missing_safety_doc = "warn"           # `bytes_from_ptr`, `str_from_ptr`
too_many_arguments = "warn"           # finding B3, `api.rs` `descriptor()`
```

`unsafe_op_in_unsafe_fn` should be the first one tried: edition 2024 already warns
on it and the FFI code appears to comply already, so it is the cheapest lint to
promote to `deny` and the one that most directly guards finding B6.

## D. Open decisions for the author

1. A1: demote the entity map, or invest in a real ECS. Until this is settled,
   every further entity-side feature increases the cost of whichever answer wins.
2. A3: does a shipped player decide its capabilities by Cargo feature alone?
   The answer determines whether `SystemDescriptor` can lose half its fields.
3. A5: is CI acceptable for this project, and on which runner? Without it,
   A2/A4/B1/B2/B3/B7 are all refactors with no safety net, which is a reason not
   to start them rather than a reason to hurry.
4. A6: which of audio, 2D physics and Spine/Effekseer are still on the critical
   path to the seven-game gate, and which should be marked dormant rather than
   maintained as if validated?
