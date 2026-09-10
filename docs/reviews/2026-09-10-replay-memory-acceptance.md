# Replay / memory tooling acceptance — 2026-09-10

## Scope and ownership

Implemented SDK/headless start replay, not the entire diagnostics roadmap.
Orchestration/schema/version checks/process lifetime belong to CLI/MCP; Core
provides a narrow Luau adapter invocation hook and VM measurements. Game scenario
meaning, restore and invariants stay in Luau. No Viewer dependency or gameplay
rules were added. Checkpoint/automatic capture/flag registry/trace storage remain
explicitly unsupported.

## Verification

- `cargo test --workspace --quiet` passed: CLI, engine, integration, mobile and
  Web bridge crates; three pre-existing ignored engine tests remain ignored.
- Added scenario tests cover real Luau execution, missing inputs, version mismatch,
  compatible retest, independent override/regressions, malformed evidence,
  checkpoint rejection, missing project file, changing asset payload, bundle-listed
  source separation, and infinite `start`/restore deadlines.
- Separate Windows integration test killed the CLI parent while its worker was in
  an infinite Lua loop. The worker exited within the 3-second assertion window via
  its Job, rather than waiting for the 60-second watchdog.
- Core tests cover retained Lua allocations/release, warmup exclusion, 128-sample
  retention, unavailable metrics, zero-growth idle GC control, and exclusion of
  adapter execution from gameplay function samples (including error cleanup).
- `node --test web/developer/api.test.mjs`: 6 passed. This checks JS request routing,
  not a live browser heap or GPU measurement.
- `cargo check -p unone-engine --no-default-features --quiet`: passed, with existing
  feature-disabled unused/dead-code warnings.

## YesSir practical acceptance

An isolated copy of ASHEN LEGION appended a `Game.replay` adapter without changing
the formal game's source. Inputs used the normal Start/Choice/LeaveShop/fire/Home
flow: four short 60-tick cycles, not four full levels or a long-running benchmark.

Final frozen executable SHA-256:
`934e73cce0b75a9ab6a1cff1908fba50180cc79cae31edb3f358faf42ee97865`.

Nine asserted cases passed:

| Case | Replay / regression | Outer gate |
|---|---|---|
| Exact, cycle memory, idle memory | reproduced / passed | ok, exit 0 |
| Missing input | incomplete / not_evaluated | not ok, exit 1 |
| Absent diagnostic matcher | not_reproduced / passed | ok, exit 0 |
| Failed regression | reproduced / failed | not ok, exit 1 |
| Exact source version mismatch | incompatible / not_evaluated | not ok, exit 1 |
| Compatible override | reproduced / passed | ok, exit 0 |
| Original false, override true | independent results, reproduced / passed | ok, exit 0 |

Source-only comment changes preserve asset hash after fixing bundle inventories
that listed `main.luau` as a resource. Bundle metadata remains in the overall game
revision; it is not silently discarded. YesSir restored its asset-equality check
in the compatibility adapter and the final case passed.

YesSir reported this is easier than its self-written WASM harness: version and
input checks, isolated execution, matchers, regression gates and GC reports now
share one interface. `replay describe` embeds the guide/schema/adapter example.
Request creation, adapter authoring and same-phase sampling are still manual.

Cycle post-warmup retained Lua heap increased **224 bytes across three samples**;
the idle control was flat. This is a small load-dependent retention signal, not
proof of a leak or an allocation/retaining-path attribution. Live Web/native
memory APIs and a long-duration gameplay benchmark were not part of YesSir's run.

Local reproducibility artifacts (kept with the game, not copied into Core):
`D:/Projects/YesSir/_Tools/replay-acceptance-20260910/` contains requests, results,
process exit evidence, `verify-yessir.mjs`, `summary.json`, and `final-evidence.json`.
Summary SHA-256:
`006ac5e66aef9dadf2f9c9b44f2851038c68895b019a19caca3638836ccbc29d`.
Harness SHA-256:
`b7e5d2704f8629fac43156a6ced9d14f8dad29cf3f553d8ae820d98018fcb1ca`.

## Claude review

The plan review recommended the explicitly scoped start-replay slice. Code review
identified outer-gate ambiguity, parent/worker lifetime, error classification,
archival/request mode documentation, stable nullable response fields, path-link
checks, and UTF-8 label-limit documentation. These were addressed. Follow-up code
review reported **no remaining blocker/high-severity correctness defects**.
A separately scoped final Claude evidence review read the YesSir harness, summary
and final fingerprints and confirmed the nine cases, source-only asset stability,
negative exit gates and headless-only scope, with no remaining blocker/high.
Usability improvement is YesSir's reported hands-on experience; schema presence
alone is not a general UX benchmark or proof of all-platform readiness.
