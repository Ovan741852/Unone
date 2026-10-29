# Spatial P2 fixes and SDK-only Scout trial — 2026-10-23

All four previously reported P2 defects have targeted fixes and successful regression evidence. A fresh AI completed the SDK-only CPU authoring task using public docs/types/CLI, without implementation source, casts, custom publication adapters or invented spatial APIs. The first actual Luau analyzer invocation and both initial native runs passed. This is a successful representative task, not an assertion that the entire tool experience had no failures.

The fixed ten-question Scout assessment is **76.25/100, `needs_work`**, with **no critical blockers**. All ten scoped questions have evidence (100% scoped rubric/public execution coverage). The evaluator also requires at least 80 points for `supported_within_scope`; passing the representative task and closing these four defects does not automatically satisfy that broader threshold. Ratings were retained rather than raised to obtain a passing gate. This SDK/release scope differs from the previous repository/debug audit, so the scores are not presented as a numeric before/after comparison.

## Four P2 closures

| Previous P2 | Correction | Actual verification |
|---|---|---|
| Complete info fails observation at `safe_integer` | Only the observation numeric-value path canonicalizes wide native integral numbers to JSON binary64. Save/input and array-key rules retain their existing bounds. | Direct complete info publication preserves numeric 9007199254740991 on native CLI and fresh WASM. Tests retain invalid function/nonfinite/key rejection and strict save behavior. |
| Typed batch result cannot compose with observation | Canonical batch, query-result and hit records now include an ObservationValue-compatible indexer while retaining explicit numeric and nested field types. ObservationApi is not weakened to any. | Official Luau 0.734 accepts direct info/batch/query/hit publication; negative version/function/coordinate assignments still fail. The fresh author uses the same unadapted path. |
| Valid `3e-23` input produces invalid normal and faults CPU manager | CPU normalizes after scaling; WGSL also preserves tiny directions across subnormal-flushing devices through guarded bit scaling before subtraction. | CPU regression and actual native GPU tests cover tiny/mixed/subnormal/zero/large inputs. Fresh WASM CPU/WebGPU main and Worker runs publish valid tiny-case normals. |
| Portable SDK lacks full contract | Canonical guide is embedded in compiled SDK authoring inventory; SDK README and spatial descriptors link it. Collision/Chinese discovery wording is added. | Release pack regression passes; a new SDK was actually packed with fresh CLI/WASM. Packaged guide/types match canonical bytes. Fresh AI discovers and uses them without repository access. |

All code belongs to generic geometry, observation serialization, authoring types or SDK delivery. No movement integration, targeting policy, damage, game content or game resources were added. Existing unrelated and concurrent changes were preserved; no commit/push or tool installation was performed.

## Fresh author evidence

The fresh author received SDK README/sdk.json/bin/game.exe entrypoints, a generic geometry task, an existing official analyzer location, and side-effect boundaries. It did not read the rubric, implementation source, prior audits or implementation tests. The original and final authored Luau are byte-identical. Only a PowerShell-generated UTF-8 BOM in project JSON was removed before successful checking.

- Operation 026: first actual strict analyzer invocation succeeds.
- Operation 027: one-frame native run submits two frozen snapshots; no geometry is delivered early.
- Operation 028: two-frame native run delivers expected geometry and versions.
- Operation 035: independently authored double-precision oracle/replay succeeds after preserved helper-tool repairs.
- Operation 038: final seal; 156 artifacts, all hashes and lengths independently verified.

The author checks category masks, exclusion, tie ordering, touching overlaps, zero and max-u32 IDs, and a moving target with analytic fraction 11/14. It rejects a duplicate replacement, preserves version 1, applies a packed version-2 repair, mutates caller tables after submission, destroys the index, consumes both frozen results next tick and rejects reuse. An unrelated complete scene entity stays unchanged. A later informed recorder replay confirms these results; it is not relabelled as a second blind trial.

Two natural first-use guesses are retained: an unrelated broad entity search misses, and Windows PowerShell writes BOM JSON. Later Python availability, process execution policy and PowerShell vector-expression failures are also retained. There were no authored Luau type failures, initial native run failures, timeouts or source fallback. Bootstrap 000 records its setup description rather than the entire original shell body; this limitation remains explicit.

## Verification

- Engine library: 318 passed, 3 existing ignored. Spatial core: 15 passed. Spatial runtime: 9 passed; its external-analyzer test was then explicitly run and passed separately.
- SDK release pack regression: 1 passed. Existing SDK loading remains backward compatible.
- Native GPU: shader validation, two actual differential tests and Luau integration passed on NVIDIA GeForce RTX 5080 / Vulkan.
- JS host/GPU/runtime tests: 13 passed.
- Fresh release CLI and WASM builds passed, including the build script's official parity gate. A new SDK includes both artifacts.
- Recorder public regression: unadapted strict publication, u32/tiny inputs, invalid repair, state/lifetime/scene boundaries, nonempty equal same-seed digests and collision/Chinese discovery passed.
- Fresh WASM in Edge 155: CPU and actual WebGPU passed in both main and Worker hosts. Runtime binary hashes are verified before/after execution. Full info is published during start before host backend configuration; update and host reports separately establish selected WebGPU execution.

See [validation record](validation.json) for commands and scope. The implementation test record and source review are labelled separately from raw Scout execution captures. The original missing-Emscripten-path attempt and two informed fixture/assertion failures remain preserved; only new fixture variants were repaired. Final captures were actually rerun with the same expanded 33-input subject set, not refreshed by changing hashes.

## Remaining limits

The fresh author found that generic observation JSON represents an empty Lua hits table as `{}`, while Luau `#hits == 0` works. Full nonempty records and numeric limits publish correctly. External JSON consumers should not infer stable `[]` identity for empty Lua tables. This is retained as a follow-up contract/representation issue and keeps observation at 3 rather than 4; it does not reopen the original typed-publication or numeric-publication failures.

Generic release CPU timings/counts/memory are observable. These correctness fixtures do not isolate spatial transfer/execution/application cost or establish GPU acceleration thresholds, so performance remains 2. There is no renderer, speedup, device-loss, persistent-save or cross-platform claim. Tiny normal repair does not replace existing f32 distance/selection arithmetic or promise exact CPU/GPU tiny geometry. The prior lower-priority sparse-vector validator finding for malformed direct JavaScript callers remains outside canonical Luau authoring scope and is not claimed fixed.

Selected source hashes are fingerprints, not immutable source copies. The sealed author's evidence has detached integrity verification, not authorship certification. One fresh author does not establish statistical AI usability or coverage of every engine feature/device. No critical blocker was confirmed for the exercised SDK task, and the broader Scout gate remains below its fixed threshold.

## Artifacts

- [New SDK entrypoint](../../../artifacts/spatial-p2-sdk/README.md) and [pack manifest](../../../artifacts/spatial-p2-sdk/sdk.json).
- [Structured assessment](audit.json), [actual Scout evaluation](evaluation.json), [independent semantic review](semantic-review.md).
- [Fresh author's first-use report](blind/scout-sdk-blind-v2/FIRST-USE.md), [counters](blind/scout-sdk-blind-v2/COUNTERS.json), [final typed example](blind/scout-sdk-blind-v2/final-project/scripts/main.luau), [seal verification](blind-verification.json).
- Actual recorder runs: [public regression](capture-public-final.json), [fresh WASM CPU/WebGPU](capture-web-final.json), [informed author-fixture replay](capture-blind-replay.json).
- [Independent source review](source-review.md), [preserved proposal](audit.proposed.json) and [proposal evaluation](evaluation.proposed.json).

The previous audit directory remains unchanged, including its original failing examples and seal. This retest preserves all failures and reports the actual fixed-rubric result.
