# Binary Job transport — 2026-09-08

Job buffers now cross the Web WASM boundary as UJB1 raw payloads and cross
Workers as transferable ArrayBuffers. Lua APIs, isolated execution and the
earliest-next-tick delivery contract are unchanged. This is engine transport;
game algorithms stay in Lua. Metadata remains JSON; the legacy JSON ABI remains
for compatibility. See [wire contract](../job-binary.md).

## Measurements

Actual release WASM, copy kernel, three alternating pairs of ten calls after
warmup. Median of the three round means, complete JS → WASM → JS call:

| Input | JSON request bytes | Binary request bytes | JSON ms | Binary ms |
|---|---:|---:|---:|---:|
| Empty | 110 | 111 | 0.176 | 0.191 |
| 4 KiB | 14,733 | 4,207 | 0.614 | 0.194 |
| 256 KiB | 936,045 | 262,255 | 13.817 | 0.231 |

The largest request shrinks 72%. Tiny jobs need not improve. These timings
include isolated VM creation and compilation, exclude Worker scheduling and
rendering, and do not establish a game FPS increase. WASM/Lua boundary copies
remain; this is not end-to-end zero copy. Source text is still sent per job.

## Verification and AI observability

- Engine suite: 223 passed, 3 ignored; Web ABI suite: 10 passed.
- Final shared JS suite: 19 passed. Covers heap growth, malformed framing,
  buffer ownership/detachment, empty and maximum buffers, pool dispatch.
- Release development export: Jobs Lab, three browser execution configurations,
  all 30 tick digests equal; final digest equals CLI. Two real compute Workers.
- Release production export: scheduler lab, same 30-tick checks, one real
  compute Worker. Production manifest excludes preview tools.
- Acceptance requires positive binary payload counters on host and Worker.
- AI `jobs` reports metadata/payload bytes, boundary copies, encode/ABI/decode
  times and per-worker transport totals alongside queue/kernel/error traces.
  These host-local counters are excluded from canonical state; ABI time contains
  kernel time and must not be added to it.

[Raw measurements and artifact identities](2026-09-08-job-binary-evidence.json).
Builds identify the parent commit plus a dirty source flag because they precede
this commit. Feature-selected production build emits unused-code warnings;
this work does not claim a warning-free build or mobile performance validation.
