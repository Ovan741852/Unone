# UJB1 Job data transport

Engine-owned transport; gameplay code and next-tick visibility are unchanged.
The Lua buffer remains opaque. No assumption is made about floats, structs or
endianness inside the game's payload.

## Framing and ABI

`unone_web_jobs_binary(pointer, length, mode)` returns 0 on success, -1 on error.
`mode=0` serves a loaded job manager; `mode=1` executes one isolated job without a
loaded game. Other modes fail. Read the response using the existing observation
pointer/length ABI. Successful responses are binary; errors remain the ordinary
JSON diagnostic envelope. Pointers are valid only until the next mutating ABI call.
Hosts must refresh HEAPU8 after allocations/calls that may grow WASM memory.

| Byte offset | Field |
|---|---|
| 0..3 | ASCII `UJB1` (version 1) |
| 4..7 | Metadata byte length, little-endian u32 |
| 8..11 | Opaque payload byte length, little-endian u32 |
| 12.. | UTF-8 JSON metadata, followed immediately by raw payload |

Maximum packet 2 MiB; metadata 512 KiB; each job input/output 256 KiB. Total length
must exactly match framing: unknown versions, truncated or trailing bytes fail.
Metadata is strictly typed and rejects unknown fields.

Manager `drain` request: `{"kind":"drain"}`, empty payload. Response:
`{"kind":"tasks","tasks":[]}` for an empty drain; each task has required
`id`, `path`, `source`, `offset`, and `byte_length` fields.
Offsets address the payload region, not the packet/WASM heap. Tasks are contiguous,
unique and ordered; up to four new submissions per tick. Hosts copy each input to
an owned ArrayBuffer before another ABI call, then transfer it to a compute worker.
A failed drain encoding does not consume staged work.

Execute request metadata has `kind: "execute"` and required string fields
`id`, `path`, `source`, followed by raw input. Response metadata has
`kind: "complete"`, the same `id`, `error` (null or string) and numeric `run_ms`,
followed by raw output. A successful empty buffer has null error and zero payload length; failure
has an error string and no payload. Stack text is bounded to 4096 UTF-8 bytes.
Completion metadata can also contain `profile`, the strictly validated executor
phase/cache diagnostics described in jobs.md. Older replies may omit it.
This metadata never enters canonical state.
The manager accepts that same complete packet, verifies the live handle/epoch and
one-shot delivery, and replies `{"kind":"accepted"}` with no payload. Completion
alone does not expose results to Lua; the next tick barrier still does that.

## Ownership and diagnostics

Worker postMessage transfers input/output ArrayBuffers. Neither side may reuse
its buffer after transfer. The WASM linear memory is never transferred. There are
still bounded copies at Lua/engine and JS/WASM boundaries; no SharedArrayBuffer,
atomics, cross-origin isolation requirement or zero-copy claim is introduced.
Packet metadata still includes source text; cached worker programs are a separate
future optimization.

AI reads `jobs`: wire format, metadata/payload byte totals, copied payload bytes,
encode/ABI/decode time, plus per-job queue/roundtrip/run traces. Counts have explicit
host/worker lifetime scopes. Runtime `run_ms` is inside `abi_ms`, not additive.

`node scripts/benchmark-job-binary.mjs RUNTIME report.json` compares the old JSON
ABI against UJB1 using real release WASM, equal copy jobs and alternating repeated
runs. It validates every output byte. This measures the isolated call boundary,
including VM creation/compilation; it is not a game or Worker scheduling FPS test.
