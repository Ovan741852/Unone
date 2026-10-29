# Spatial diagnostics and recovery source review

Date: 2026-10-24 (Asia/Taipei). This is an informed source review of the frozen generic engine work in `D:/Projects/Unone`. The reviewer read implementation code and development evidence. It is separate from the fresh author's blind task and assigns no score.

## Scope and inputs

Reviewed `diagnostics.rs`, detailed validation in `spatial.rs`, `runtime/spatial.rs`, `runtime/spatial_metrics.rs`, `runtime/bindings/spatial.rs`, the observation value/array boundary, canonical Luau types, the Web spatial ABI, `web/shared/spatial-host.mjs` and `spatial-metrics.mjs`, both benchmark drivers, and the final spatial runtime verifier assertions. The review checked compatibility, retained bounds, canonical-state separation, recovery boundaries, metric attribution and Luau type safety. No product/source files or earlier audits were edited by this reviewer.

The coordinating agent froze product inputs before this final pass. Independently checked final SDK identities:

| Input | Identity |
|---|---|
| SDK | `artifacts/spatial-hardening-sdk-v2` |
| `bin/game.exe` SHA-256 | `d59c051d00ad47616978b6c4352a67092555baecfb090fb6b3442ca929c3e028` |
| Packaged `tools/benchmark-spatial.mjs` | 6,410 bytes |
| Packaged benchmark SHA-256 | `59e5ec169dcf6ac100c0c24b114be63133c0fd2a3c235557239a6177132ac9b2` |

## Findings resolved during review

### Preserve detailed terminal diagnostics after a failed tick

Previously, `SpatialJobs::finish()` recorded an executor/result/profile diagnostic and faulted the manager, then `EngineRuntime::tick()` called the generic spatial failure path again. That second call replaced the diagnostic with `SPATIAL_HOST_FAILED`, losing its specific code, path and facts.

The final [tick failure path](../../../crates/unone-engine/src/runtime.rs) returns the script-facing error without faulting the already-failed manager again. The detached `EngineRuntime::spatial_diagnostic()` observer now makes the retained diagnostic available after Lua execution stops. The Web ABI and `spatialHost.diagnostic()` expose that observer to a host. The regression covers invalid result version, invalid profile duration and executor failure, including detached reads and canonical digest preservation. The reviewed engine log reports all three boundary tests passing.

### Distinguish the two submission-capacity recovery boundaries

Previously, submitting four batches and cancelling all four in one update left zero retained tickets, but a fifth submission reported `retry="after_release"`. Releasing tickets cannot restore that update's submission budget.

The final [submission checks](../../../crates/unone-engine/src/runtime/spatial.rs) retain the thrown `SPATIAL_TICKET_LIMIT` message while reporting `next_tick` for the per-tick limit and `after_release` for outstanding tickets. Separate regressions demonstrate recovery on the next tick and recovery after cancelling a retained ticket in the same tick.

## Source conclusions

- Diagnostic details are produced at validation sites rather than extracted from human error strings. Public paths use one-based indices; legacy validation messages retain their original wording/index convention. The retained envelope caps its message/path/text fields and bounds each actual/expected fact to 1,024 serialized bytes. This bounds retained diagnostic facts, not every temporary allocation or VM failure.
- The latest diagnostic and profile are separate observer state. Canonical spatial snapshots retain indices, frozen inputs, delivery state and the handle sequence; they exclude timings, profile counters, backend identity and early completion state. Reading the new observers does not consume work or choose an executor. Explicitly publishing wall-clock diagnostics adds nondeterministic observation data by design.
- The generic weak-key array registry preserves empty engine-produced spatial arrays and explicit authored arrays without altering table metatables or retaining discarded tables. The observation number path preserves finite binary64 values and unsigned IDs; the save/input and array-key checks retain their established restrictions. This review does not assert preservation of arbitrary JSON-null array elements through Luau tables.
- Manager totals count accepted submissions and applied valid completions. Failed batches, cancellation, unavailable executor samples and equivalent USB1 input size are distinguished. Counters saturate at the documented safe-integer bound. The seven measured Lua mutation APIs record successful and rejected attempts; `info`, `profile` and `lastDiagnostic` are excluded from those binding counters.
- Binding input timing includes schema work and failed-input diagnostic construction. Output timing includes packed-buffer creation or result JSON-to-Lua conversion. The implementation's `bindings.scope` explicitly excludes manager/executor work, observation publication and observer serialization. The guide's phrase "structured diagnostic serialization" should be read as serialization when retrieving the diagnostic, not as a claim that constructing and bounding failed-input facts is free.
- Official host metrics measure UTF-8 packet bytes and reached JSON/copy/ABI/decode phases. Setup/configure phases overlap by design. The report is cloned, and reading it creates no bridge request. `diagnostic()` is an actual bridge request and therefore increments host transport metrics, while leaving engine work state unchanged. Native/Web executor host timings are not GPU kernel timestamps.
- The benchmark drivers use bounded synthetic inputs, exclude warmups from per-batch distributions, verify hit IDs and distinguish setup, direct-executor time, Lua conversion and CLI-process scope. Nearest-rank quantiles from one process do not establish rendered-frame performance, a GPU crossover or a universal speedup.

## Retained Luau type limitation

The canonical record indexers permit direct publication through the existing recursive `ObservationValue` contract while retaining named numeric field types. Pinned official Luau 0.734 nevertheless accepts a dynamically indexed write that can invalidate a named field:

```lua
-- SpatialHit has id:number and [string]:ObservationValue.
local function corrupt(hit: SpatialHit, key: string)
    hit[key] = "bad" -- key can be "id"; strict analysis accepts this.
    local id: number = hit.id
    print(id + 1)
end
```

This affects detached caller tables, not engine state. The final guides tell callers to treat returned info/result/profile/diagnostic records as read-only snapshots. Ordinary named-field reads/writes and numeric array operations remain typed; this is not a claim that every alias mutation is rejected.

Isolated experiments used the actual canonical declarations and `.toolcache/luau-0.734/luau-analyze.exe`. A separate serializer-input type with recursive read-only string/numeric indexers preserved direct publication, the complete SDK example, legacy `ObservationValue` assignability and legacy mutable save maps. It rejected direct dynamic writes. It still accepted this nested alias escape:

```lua
local value = info[key] -- key can be "limits".
if typeof(value) == "table" then
    value[nestedKey] = "bad" -- nestedKey can be "queries_per_batch".
end
local capacity: number = info.limits.queries_per_batch
```

The readonly alternative was therefore not adopted as a complete safety fix. No `any`, casts, unsafe array intersections or project publication adapters were introduced by this review. The experiments were confined to a fresh OS-temp directory and were not used as blind-author evidence.

## Verification evidence inspected or executed

The reviewer independently reran:

```text
node --test web/shared/spatial-metrics.test.mjs web/shared/spatial-host.test.mjs web/shared/spatial-faults.test.mjs web/shared/spatial-gpu.test.mjs web/shared/runtime-core.test.mjs
```

Result: 29 passed, zero failed/skipped. A separate synthetic-ABI probe exercised `spatialHost.diagnostic()`, exact non-ASCII UTF-8 response-byte accounting, detached diagnostic values and repeated report-read purity; it passed. These mocked host checks do not establish a real device-loss event.

The reviewer inspected these coordinating-agent captures; the reviewer did not rerun root Cargo while builds held its locks:

| Capture under `.cache/` | Observed result |
|---|---|
| `spatial-hardening-engine-first.log` | 330 library tests passed, 3 existing ignored; observation arrays 2, spatial core 15, diagnostic boundaries 3, diagnostics 3, faults 5, binding metrics 1 and runtime 10 passed |
| `spatial-hardening-types.log` | The explicitly invoked official strict-types regression passed; it is ignored in the ordinary runtime suite and was run separately |
| `spatial-hardening-bridge-v2.log` | 11 Web bridge tests passed |
| `spatial-hardening-sdk-tests.log` | The named release SDK packaging regression passed once |
| `spatial-hardening-web-build-v3.log` | Successful production Web runtime build; source was dirty and the capture records that fact |
| `spatial-hardening-runtime-first.json` | `ok:true`; actual browser CPU/WebGPU runs in main and Worker hosts, including final binding/setup/bridge assertions |
| `spatial-hardening-example-types.json`, `spatial-hardening-example-run.json` | Final SDK example passed official strict analysis and completed three frames |
| `spatial-hardening-cpu-v2.json` | Final SDK CPU benchmark passed at 4,096 bodies x 128 queries, 3 warmups and 9 measured samples; CLI identity matches the SDK above |
| `spatial-hardening-native-benchmark-first.json` | Actual CPU and NVIDIA GeForce RTX 5080 Vulkan executor runs passed in the earlier debug benchmark capture |

Earlier failed development logs remain evidence of those attempts, not passing gates. In particular, `spatial-hardening-cpu-first.stderr` retains the strict-analyzer rejection of an unannotated inserted sample record. The final benchmark uses a local `Sample` annotation and the subsequent CPU capture passed. Earlier bridge/build invocation errors are superseded by the specifically named successful captures above; they have not been erased or relabeled.

The native benchmark source added `build_profile`, platform and architecture metadata after its first capture. That capture does not validate the final metadata-bearing source; an actual formal rerun remains pending at this review's cutoff. Formal sealed captures and the separate fresh-author assessment are owned by the coordinating agent. This source review establishes neither rendered-player appearance, real hardware device-loss recovery, other-device behavior nor a performance rating.
