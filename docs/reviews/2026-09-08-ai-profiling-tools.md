# AI optimization tooling review

Verdict: the API-first direction is sound, but the present tools support inspection better than a reproducible optimization loop. This is a source review informed by the Legion Fall capture; the proposed APIs below are not implemented.

## Existing strengths

`web/developer/api.js` exposes structured discovery, strict request validation, registered Luau callbacks, pause/step/input, observations, profile, memory and screenshots. Native has corresponding operations and explicitly lists unsupported browser facilities. Timing stays outside deterministic observation digests (`crates/unone-engine/src/performance.rs`). The exported-host parity runner and specialized physics benchmark demonstrate reusable measurement primitives without inventing an automatic bottleneck verdict.

## Gaps, in priority order

1. **Metric scope can mislead optimization.** In `web/player/main.js::tickOnce`, `bridge_ms` spans input transfer, the entire WASM tick and JSON readback. It is not isolated bridge overhead. Script timing includes Luau-to-engine API work, including packed instance validation and encoding. Provide explicit, non-overlapping CPU phase boundaries; report GPU separately as asynchronous timing, never sum it into CPU totals.
2. **Reading a profile creates avoidable work.** Web `profile` and `memory` call `core()`, whose snapshot request builds the whole observation and digest in `runtime/preview.rs`. Native `profile` also uses the preview snapshot. Add bounded performance-only reads that do not traverse or serialize the full game world. The lightweight `observations` endpoint added for this demo solves HUD polling, not this profile problem.
3. **No controlled measurement window.** Collector totals are cumulative, percentiles use the last 1,024 engine frames, renderer samples use another window, and battle reset clears neither. A report needs session/window IDs, first/last frame, warmup exclusion, sample counts and actual build/host configuration. Start/stop a measurement window without resetting gameplay. Mark incomplete windows and disjoint CPU/GPU samples explicitly.
4. **Insufficient attribution inside script.** There are no custom Luau profiling sections in the current bindings. A development-only scoped API could label targeting, combat and pose publication, with call counts and inclusive/exclusive duration. Use bounded label/sample storage and close scopes on callback errors. Timing should not become gameplay input or enter replay state; production should use a cheap no-op where appropriate.
5. **Insufficient cost/scale context.** Core counts show one entity for this 10,000-instance game. Renderer instance count helps, but reports also need instance bytes, dirty/uploaded bytes, snapshot size and GC/allocation activity where supported. WASM capacity and Lua used bytes do not reveal allocation churn. Unsupported measures must remain explicit, not zero.
6. **No general repeatable comparison harness.** Existing physics scripts are scenario-specific. Generalize the orchestration: fixed exported artifact, seed, input replay, warmup, measurement interval and repeated runs; emit raw samples and distributions with frame/digest references. Real-time browser runs must report missed deadlines, presentation cadence and simulation/wall-time ratio. Paused stepping tests correctness or CPU throughput, not interactive FPS.

## Ownership and acceptance

Engine work: cheap timing reads, scopes, bounded windows, phase definitions and artifact metadata. Game work: scenario setup, unit counts, battle rules and benchmark controls in Luau. AI work: state a hypothesis, choose an experiment, change code, compare repeated measurements, check behavior and retain or revert. Do not hard-code an engine tool that decides the bottleneck or silently optimizes gameplay.

Acceptance should prove that profile collection does not change replay digests, ends cleanly on errors, stays bounded, distinguishes unsupported host metrics, and reports its own overhead against a no-collection baseline. A before/after speedup must include unchanged workload and correctness checks; deliberately changed gameplay fidelity must be declared separately.
