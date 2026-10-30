# Luau replay boundary

Unone's guarantee is conditional deterministic **simulation replay**, not arbitrary
Luau execution and not bit-identical rendered frames. Compare the same engine,
Luau/compiler build, project config, script, initial scene, seed, restored save,
startup viewport and normalized input sequence at the same fixed frame. Matching
digests certify the observed world at those frames, not hidden Lua locals or every
possible branch. Release/export acceptance runs the actual exported host payload,
loader and WASM against the native CLI (`node scripts/verify-player-parity.mjs`).

## Supported gameplay discipline

| Source | Contract |
| --- | --- |
| Time | `Game.update` gets fixed `1/60` dt. Count simulation frames or accumulate that dt. Wall-clock/device scheduling is not simulation time. Record external decisions as input. |
| Randomness | Use `api.random.nextFloat/nextInt`, with identical seed and call order. This is the engine's integer SplitMix64 stream; stock Luau RNG has separate state. Shipped players choose a new seed per session (see [player export](player-export.md)); replay and verification use a recorded or fixed seed. |
| Numbers | Luau numbers are binary64. Keep intermediates finite, operations in the same order, and avoid overflow/underflow-sensitive calculations. Basic arithmetic and nonnegative `math.sqrt` are the intended portable path on the tested native/WASM builds. Do not infer support for untested architectures, compiler flags, JIT/native-code modes or changed rounding environments. |
| Integer exchange | Current JSON/FFI conversion restricts integer-valued input/save values and Luau Integer variants to signed 32-bit range for native/WASM portability. This is narrower than binary64's exact-integer range. Out-of-range values must not be smuggled through a different JSON representation. |
| Ordering | Use dense arrays with numeric loops/`ipairs`. For maps, collect string keys, sort them, then operate in that order. `pairs`, `next`, generalized table iteration, sparse-table length and equal-key sort order are not ordering guarantees. Canonical output key sorting cannot undo earlier order-dependent mutations or RNG calls. |
| State | Lua owns gameplay state. Save is explicit game-owned JSON; it is not a checkpoint of the Lua heap, stack or RNG stream. Reconstruct in `Game.start`. Hot reload is a development operation, outside a fresh deterministic replay unless separately tested. |

## Enforced guards and explicit exclusions

`math.random`, `math.randomseed`, `os.clock`, `os.time` and `os.date` raise
`LUA_NONDETERMINISTIC_SOURCE` with the replacement to use. Guards install before
top-level script evaluation in check, normal load and reload VMs. `os.time` with
an explicit date table is also unavailable; this boundary deliberately exposes
no calendar API to gameplay. Catching an error with `pcall` does not provide the
ambient value. This is a replay guard, not a hostile-code security sandbox.

Other standard-library functions remain available, but availability is not a
cross-platform determinism promise. `sin/cos/tan`, logarithms/exponentials,
`math.pow` and the `^` operator, noise, vector operations and unspecified libm
functions are outside the portable subset. Platform math implementations and
compiler constant folding can differ. The engine does not inspect all bytecode
or prove that these results never reach gameplay. Avoid them in authoritative
state or use authored/precomputed data with fixed interpolation instead.

The VM now initializes with Luau's sandbox environment after installing replay guards. Standard libraries and builtin metatables are read-only; replacing functions such as `math.sqrt` or `buffer.writef32` is rejected. Game globals remain writable in the VM-local environment. `collectgarbage` supports the informational `count` operation, not explicit collection control. This enables builtin fast paths while preventing library mutation; projects that monkey-patched standard libraries must instead use game-local helper functions. It does not turn arbitrary Luau into a deterministic language or a hostile-code security boundary.

Likewise, object/function address strings, GC/weak-table behavior, memory/timing
observations, locale-dependent formatting and incidental hash iteration cannot
drive gameplay. Finite JSON observations are validated and object keys are
canonicalized, but serialization does not make arbitrary code deterministic.

Rendering, Bloom/GPU particles, Effekseer/Spine animation, audio device output,
network arrival times and host frame drops are outside the simulation digest.
Record normalized input to replay; equal wall-clock durations on two hosts need
not yield the same number of ticks.

## Evidence and limits

The opt-in [3D rigid-body backend](physics3d.md) uses pinned Rapier with
`enhanced-determinism`, no parallel/SIMD solver features, fixed dt and stable
command ordering. Its internal math uses the backend's deterministic math path;
this does not extend the portable subset of Lua's own transcendental functions.
The export gate also compares a rigid-body/CCD/kinematic/joint fixture through
frame 360 and detects a gravity mutation in the actual emitted payload. Physics
observations include body-definition digests; they are not full solver saves.

The exported fixture exercises startup save/audio, normalized input, 3D transforms,
2D contacts, native particles, seeded RNG, arithmetic/sqrt, sorted arrays and the
ambient-source guards. The test compares five frame observations and corrupts the
actual exported audio declaration as a negative control. It is an acceptance
sample, not a proof of every Luau expression, all engine APIs or ARM execution.

Implementation basis: pinned `mlua 0.11.6`, `luau0-src 0.18.3+luau709`, Luau
`VM/src/lmathlib.cpp` (stock RNG seeds from pointer/time/clock and math delegates
to platform routines), and `VM/src/loslib.cpp` (ambient clocks/calendar). Re-audit
this boundary when updating the VM/toolchain. Engine RNG lives in `runtime.rs`; JSON conversion lives in
`runtime/bindings/value.rs`, and guards in `runtime/determinism.rs`.
