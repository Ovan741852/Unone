# Generic spatial compute backend

`SpatialGpuExecutor` implements `unone_engine::spatial::SpatialExecutor` using
actual wgpu compute dispatch and mapped result readback. It creates no window,
surface, renderer, game state, or gameplay policy.

```rust,no_run
use unone_engine::spatial::SpatialExecutor;
use unone_spatial_gpu::SpatialGpuExecutor;

let mut executor = SpatialGpuExecutor::new()?;
let result = executor.execute(&batch)?;
```

Hosts can instead call `from_device(device.clone(), queue.clone())` to share
their existing wgpu device. The browser implementation is
`web/shared/spatial-gpu.mjs`; it uses the same canonical
`web/shared/spatial.wgsl` shader. Browser hosts may inject a device or let the
executor create one. `close()` destroys only an executor-owned browser device;
temporary buffers are destroyed after every result or error.

Version 1 supports at most 65,536 sphere bodies, 1,024 queries per batch, and
64 overlap hits per query. An overlap overflow fails the entire batch. Nearest
and sweep return at most one hit. Validation, ordering, masks, exclusion, and
relative-motion sweep semantics follow the CPU reference. Unavailable adapters
and GPU errors are reported explicitly; this crate never silently runs CPU
work while identifying it as GPU execution.

The algorithm is a bounded linear scan, O(bodies × queries), with one GPU
invocation per query. It uploads batch snapshots and reads query results back.
There is no spatial grid, resident simulation state, renderer zero-copy path,
or speedup guarantee in this version. CPU and GPU use f32 geometry, with ID
ordering and numeric tie rules; cross-device bit-identical arithmetic is not
promised. Applications needing exact replay can select the CPU backend.

Verification (using an existing Rust toolchain and Playwright/browser):

```text
cargo test --manifest-path crates/unone-spatial-gpu/Cargo.toml
node --test web/shared/spatial-gpu.test.mjs
node scripts/verify-spatial-webgpu.mjs
```

The native differential test requires a real compute adapter and fails if
none is available. The browser verifier builds CPU reference fixtures from
independent geometry, executes actual WebGPU dispatch, and checks result IDs,
ordering, contact data, capacities, overflow, validation, device ownership,
and device-loss errors. It writes `.cache/spatial-webgpu-report.json`.
