# Independent source review of the spatial Scout P2 fixes

Reviewed on 2026-10-23. This review inspected the current source for the four
previously reported P2 issues: complete info publication, direct typed result
publication, tiny-coordinate contact normals, and the packed SDK's authoring
guide. No product source, existing audit, game content or saved state was
modified. No build, analyzer, runtime or GPU test was executed by this reviewer;
the conclusions below are source-review conclusions, not new execution evidence.

## Decision

No new blocking finding was confirmed in the reviewed fixes. All four previous
P2 causes have corresponding corrections and targeted regressions in source.
Actual test results and source-to-binary provenance must be supplied by the
implementation verification separately.

| Previous issue | Source assessment |
|---|---|
| `info().limits.safe_integer` faults native observation publication | `state.rs` routes only `observation.set` through the new observation codec. Wide native integral values become JSON floating numbers, matching the existing WASM number path. Nested values use the same rule. The old codec remains in use for save/input and other existing callers; array keys retain the old portable bounds. |
| `SpatialBatchResult` cannot be passed to `ObservationValue` | Both canonical typing copies add an observation-value string indexer to batch, query-result and hit records. Explicit `version`, `results`, `hits`, numeric scalar and numeric-vector fields remain typed. This provides the structural dictionary compatibility needed by the recursive observation union without changing `ObservationApi.set` to `any`. |
| Valid `3e-23` coordinates produce a non-unit normal | CPU normalization scales by the largest absolute component before squaring, so the squared normalized vector is in `[1,3]`. Zero retains +Z. WGSL uses the same normalized-vector calculation; its static-contact helper additionally scales tiny source coordinates from their bit representations before subtraction, covering devices that flush subnormal arithmetic. |
| Packed SDK omits complete spatial guide | `authoring_files` now embeds `docs/spatial-batches.md` in the CLI's compiled authoring inventory, which `pack` copies into the SDK. The SDK README links that path and spatial API descriptors point to it. The release-only pack regression checks inventory, exact guide bytes, README link and descriptor references. |

## Checks on the implementation choices

- The observation conversion is deliberately confined to values. It does not
  loosen contiguous-array checks, key limits, finite-number checks, supported
  value kinds or depth limits. Existing save/input and UI/debug/shader conversion
  call sites still select the original codec. The unit regression compares the
  serialized native wide-integer representation with an explicit number-path
  representation and retains rejected key/callback/nonfinite cases.
- The typed publication regression exercises the complete info, result,
  query-result and hit values without casts. It also asks the official analyzer
  to reject a string `version`, a function-valued extra field and a string vector
  element. That test is explicitly ignored unless the analyzer is requested;
  merely running the normal test suite does not establish this typecheck claim.
- The tiny WGSL scale helper multiplies source values by `2^126`: normal values
  adjust their exponent, and subnormal mantissas become normal floating values
  through integer-to-float conversion. The guarded source magnitude is below
  `2^-63`, keeping that scaling and subtraction finite. CPU and native GPU
  regressions cover axis and oblique `3e-23`, smaller normal inputs, the minimum
  subnormal, a subnormal separation between normal inputs, large coordinates and
  exact coincidence. They validate the result envelope as well as direction.
- The geometry change alters normalization, not motion, damage, scene state or
  query-selection policy. No game behavior was introduced in the reviewed paths.
- SDK inventory validation remains backward compatible with older SDKs: the new
  guide is shipped and integrity tracked by newly packed SDKs without adding a
  new mandatory file check to loading old SDKs.

## Remaining limits

The review does not establish GPU execution on any adapter, browser execution,
performance, rendering or bit-identical CPU/GPU geometry. Existing f32 distance,
membership and tie arithmetic is not replaced by this normal fix, and the guide's
cross-device tolerance qualifications still apply. The native GPU differential
test is useful execution evidence only when its required adapter test actually
runs and passes. The known sparse-array JavaScript validator observation from the
earlier audit was outside these four P2 corrections and was not reassessed here.

The repository contains substantial pre-existing uncommitted work. This report
assesses the named correction paths rather than attributing the entire working
tree diff to this task. It leaves the earlier sealed blind evidence and prior
review conclusions historical and unchanged.
