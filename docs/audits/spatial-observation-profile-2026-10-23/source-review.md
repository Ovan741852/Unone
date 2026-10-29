# Source review: observation arrays and spatial profiles

Date: 2026-10-23. This is a source review during implementation, not the fresh blind SDK acceptance run. No acceptance score is assigned.

## Scope and method

Read the repository `AGENTS.md` and the generic value/state/spatial bindings, spatial geometry/executor contract, runtime manager and integration, canonical Luau declarations, spatial guide, native GPU executor, Web GPU executor/host and their focused tests. No game, branch, commit, installation or product source was changed by this review. The only repository artifact authored by the reviewer is this document.

Independent execution:

- `node --test web/shared/spatial-gpu.test.mjs web/shared/spatial-host.test.mjs`: 11 passed, 0 failed, 0 skipped.
- An inline mocked-device probe demonstrated the Web accessor/snapshot validation defect below; the final Node run includes its successful regression check.
- A delegated read-only review used the pinned `.toolcache/luau-0.734/luau-analyze.exe` with isolated temporary scripts to test array type safety and alternatives.

Cargo was deliberately not started by this reviewer while the implementation owners were running Rust tests. Their results are separate evidence, not independently repeated here.

## Findings reported during implementation

### Array intersection loses element write safety and nested indexing — corrected

The reviewed alias `ObservationArray<T> = {T} & {[number]: ObservationValue}` is not a sound way to add publication compatibility in the pinned analyzer. This strict snippet was accepted with exit status 0:

```lua
local numbers: {number} = {1}
local marked = api.observation.array(numbers)
marked[1] = 'bad'
local x: number = marked[1]
```

The result promises a number after accepting a string write. The same alias admits `array({function() end})` followed by `observation.set`, although the runtime correctly rejects the contents. Explicit heterogeneous arrays can also lose assignability to their original element union. Using the intersection for nested spatial `results`/`hits` causes otherwise ordinary indexed reads to fail with a union/intersection table error.

Reported to the root owner before SDK freeze. The revised canonical declarations remove table intersections: `array()` and `array(nil)` return `{ObservationValue}`, `array(values: {T})` returns `{T}`, and `setArray<T>(key, values?)` validates/marks/publishes generic typed arrays. Existing `set` retains its recursive `ObservationValue` contract. Canonical spatial result fields again use ordinary typed arrays.

Focused isolated checks against the actual revised canonical file passed under pinned Luau 0.734: number arrays, named nested records, heterogeneous unions and nested arrays preserve their element types; direct complete result/profile publication and nested spatial indexing work; incorrect indexed assignment and `table.insert` fail. `setArray` accepts typed arrays, omitted values and explicit `nil`. Generic function elements intentionally require runtime validation.

A follow-up addition of a separate `nil` overload initially made `array()` ambiguous. Removing the redundant zero-argument signature resolves this because a `nil` parameter already permits an omitted argument. A fresh isolated check against the final actual canonical file confirms both `array()` and `array(nil)` publish directly (exit 0), while an incorrect numeric-array string write still fails (exit 1).

Isolated alternatives established that adding readonly or string indexers to the intersection does not repair write safety or heterogeneous indexing. The chosen plain-array result avoids those failures. Source review confirms `setArray` validates the observation key before marking, so an empty-key failure cannot change a caller's table identity.

### A Rust test was accidentally inside a raw Luau string — corrected

The initial `reading_spatial_profiles_preserves_world_digests_and_exposes_measured_work` test was inserted before the raw string terminator in `full_info_and_results_publish_without_adapters_including_unsigned_ids`. Rust therefore did not register the new test, and the enclosing runtime test would pass Rust syntax to Luau.

Reported immediately. A subsequent source read confirms the test is now outside the string. The root owner reported a fresh full library/core/array/runtime test run with the digest test registered; that run is owner evidence rather than a reviewer Cargo execution.

### Direct Web executor callers could change values between validation and snapshot — corrected

The initial `execute(batch)` validated the caller's live object and then called `structuredClone(batch)` without validating the owned clone. An accessor could return `radius = 0` during validation and `radius = -1` during cloning. The isolated mocked-device execution completed successfully and uploaded `-1`:

```json
{"radiusReads":2,"uploadedRadius":-1,"result":{"version":1,"results":[{"hits":[]}]}}
```

The official Rust bridge emits plain parsed JSON, so this was a direct JavaScript executor intake defect rather than a demonstrated failure in the official engine path. The final implementation validates the owned snapshot before allocating GPU resources and includes both validation passes in the nested validation measurement. The regression accessor test now rejects the changed negative radius and confirms no GPU buffers were allocated. A fresh independent Node run passed all 11 executor/host tests.

## Runtime and timing assessment

The implementation keeps array identity in a private weak-key registry rather than table metatables or public fields. Marking validates all current contents, serialization validates later mutations, and ordinary empty authored tables retain object shape. Engine JSON arrays, including empty nested arrays, receive the same generic marker; save conversion consults it without widening the signed integer boundary used by saves. The observation numeric widening is explicit and limited to finite binary64 values, which permits full unsigned spatial IDs and the safe-integer limit to publish consistently across native/Web classifications.

Profiles are separate from `info()`, geometry results and the canonical spatial snapshot. The manager retains one latest applied completion plus bounded cumulative totals. Accepted submission, completion, cancellation and pending-batch failure counts have documented meanings. Profile reads do not consume tickets. Backend selection and committed reload reset diagnostics, while failed reload candidates do not mutate the live profile.

Source review also confirms that the Web smoke ABI completion request accepts an optional profile with a serde default, and a separate profile request routes to `runtime.spatial_profile()`. Fresh actual WASM execution is separate owner verification, not claimed by this source review.

CPU timings measure the executor call. Native GPU and Web GPU expose host phases and actual transfer buffer byte counts. Web preparation includes validation and the input snapshot; queue wait is host scheduling latency; total includes preparation, queue latency and cleanup. GPU kernel duration remains unavailable with an explicit reason. Nested/overlapping phases are documented and are not presented as additive GPU kernel measurements. Per-batch setup excludes device/pipeline initialization; manager timings explicitly exclude Luau/bridge conversion and caller application work.

No remaining blocking runtime/serialization, ordinary strict-authoring or cost-attribution defect was identified in the revised source pass. Fresh blind SDK consumption remains separate outstanding acceptance work; these checks do not substitute for it.
