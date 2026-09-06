# Web reload failure consistency

Date: 2026-09-06. Status: design proposal; reproduction and independent review
required before implementation. Web first; Android is deferred.

## Observed code paths, not yet a completed reproduction

`web/runner/main.js::reloadActiveBundle` currently installs/activates storage
before calling the Rust script reload. A rejected script can therefore leave
the stored active generation ahead of the running session. It also reads the
next project and asset manifest but never applies the next scene/system config.

`EngineRuntime::reload_source` replaces script_source before validation;
load_script evaluates in the existing Lua VM and calls onReload with the active
API before accepting the update function. Retaining the old update function is
not rollback: a failing callback may already change world/save/UI/random state
or Lua globals. This is a lifecycle/ownership problem, not a game-rule problem.

## Required invariants

- Failure leaves the previous running script, Rust-owned state, RNG sequence,
  save/UI, asset identity and runtime generation usable and unchanged.
- Storage activation and the displayed runtime identity must not silently claim
  the same content when they differ. Report applied identity separately from
  downloaded/staged content; do not infer equality from generation counters.
- Script hot reload preserves world state. Changes to scene/system configuration
  require an explicit restart workflow, not silent non-application. Return a
  structured restart-required reason before activation for unsupported changes.
- Never clear cache, delete active records, fall back to an older generation or
  edit a game to conceal a failed update.

## Candidate minimal implementation for review

Use purpose-specific staging, not a general transaction framework. Prepare a
replacement script in an isolated Lua VM with cloned Rust-owned API state and
RNG. Run validation/onReload there; only a successful candidate can replace the
active runtime. Do not preserve arbitrary old Lua globals across reload.

For Web, verify/stage candidate bundle bytes without updating the active pointer;
validate supported config/scene identity and prepare the candidate runtime.
Pause ticks while a candidate is being committed. Publish storage activation
with an expected-generation check, then perform an infallible in-memory swap
before yielding to another browser task. On storage failure, discard candidate
and keep the old runtime. Account for competing reload clicks/tabs explicitly.
Crash/restart behavior must load the stored committed generation rather than
pretend to resume an in-memory world that no longer exists.

These are proposals to assess against existing APIs. Do not add new public
commands or promise full scene hot replacement as an incidental implementation.

## Concrete tests and review questions

1. Failed onReload after entity/save/UI/random writes leaves old state and next
   RNG output identical to a control runtime; include top-level Lua failure.
2. Valid reload retains intended world state and swaps update behavior once.
3. Invalid candidate source/config/scene cannot advance the active content claim.
4. Storage abort and stale-generation activation keep the old session usable.
5. Repeated and concurrent clicks cannot mix script/assets from two candidates.
6. A new browser session loads the committed generation consistently.

Record first failing raw evidence before the repair, then passing evidence.
Independent review must assess the actual state boundary, not only happy-path
tests. No new ADR unless the review identifies a material unresolved boundary
choice that cannot be expressed in the existing reload contract.
