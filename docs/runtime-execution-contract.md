# Runtime execution contract

This document is the source of truth for comparing Unone's Luau execution
modes. It exists so an AI does not confuse the Rust host, the Luau VM, a
diagnostic build, and a shipping measurement.

## Ownership

| Boundary | Owner | Meaning |
|---|---|---|
| Gameplay rules | Luau | Game state transitions, formulas, cooldowns and reactions stay in the script. |
| Engine primitives | Rust | Reusable world, physics, input, observation and host bindings. |
| VM implementation | Upstream Luau, vendored by `mlua-sys` | `mlua` is the Rust host/binding layer; it is not a Rust rewrite of Luau. |
| Presentation host | Native Rust or Web JavaScript/HTML | Rendering, storage, input conversion and platform services are host concerns. |

## Execution manifest

Every capability report exposes `ExecutionMode` as a versioned manifest. The
important fields are:

- `runtime`: currently `luau`.
- `vm_implementation`: currently `luau-upstream-vendored`.
- `host_binding`: currently `rust-mlua`.
- `build_intent`: `diagnostic`, `development`, or `shipping-candidate`.
- `luau_execution`: `interpreter` or `native-codegen-eligible`.
- `native_codegen_fallback`: the behavior when codegen is unavailable; currently
  `interpreter`.
- `wasm_host_compilation`: host status only. It must not be read as a Luau JIT
  claim. WASM currently uses the interpreter.
- `determinism_contract`: fixed-tick, seeded replay with an explicit policy for
  cross-target floating-point differences.

`native-codegen-eligible` means that the build requested and the target reports
support. It is not proof that every function was compiled natively. Diagnostic
preview builds intentionally report interpreter execution even when the feature
is compiled into the binary.

## Replay comparison policy

Before comparing two modes, fix all of the following:

1. tick count and fixed timestep;
2. seed and input sequence;
3. project source, scene and asset manifest hashes;
4. engine and VM build identity;
5. enabled systems and feature flags;
6. renderer/presentation work excluded from the gameplay digest.

Compare canonical state digests and event sequences separately from timing. A
native and interpreter run must not be called equivalent merely because their
frame time is close. If a target has a documented floating-point difference,
the comparison must state its tolerance; otherwise require exact digests.

## Metric semantics

The diagnostic profiler reports measured values and explicit availability:

- `measured`: the metric was collected for this scope;
- `unsupported`: the runtime cannot collect it;
- `not-applicable`: the metric belongs to another host (for example JS GC on a
  native build);
- `not-collected`: the metric is intentionally not instrumented yet;
- `null`: no value is claimed.

Luau `allocation_growth` is the positive growth observed by Luau's
`onallocate` callback. It excludes frees, allocator overhead, Rust/JS
allocations and retaining paths. Incremental GC timing includes probe overhead
and excludes forced full collections. No unavailable metric may be represented
as zero.

The current report explicitly marks API crossing counts, Luau/Rust conversion
objects/bytes and Rust allocator traffic as `not-collected`. These are planned
measurements, not hidden claims.

## Safe optimization order

1. Establish a fixed replay baseline in native interpreter, native release with
   codegen when supported, and WASM interpreter.
2. Measure script, physics, observation, serialization, VM allocation and GC
   phases. Keep startup/compile time separate from steady state.
3. Add an API crossing or conversion counter only when a real hot path needs
   it; report instrumentation overhead.
4. Only after a measured hotspot, prototype one typed batch/handle path. The
   existing table API remains the semantic reference and fallback, with parity
   tests before shipping.
5. Production Web exports precompile the entry script (see
   `compile_production_script`); the declared format names the Luau bytecode
   version, optimization and type-information levels and the engine version, and
   a player loads only its own format. A persistent cache beyond export would also
   need source/dependency hashes, target ABI and sandbox/features in its key, and
   must fall back to compilation on failure.

Do not add ECS, SoA, Web Workers, asset streaming or a bytecode cache merely to
fill an architectural slot. They require workload evidence and a replay parity
test first.
