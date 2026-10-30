# Immutable bytes

Immutable binary data in Unone is an ordinary Luau `buffer` made read-only.
There is no wrapper type: read it with `buffer.read*` exactly as before, at the
same speed, and hand it to anyone without risk that they change it.

```luau
local rom = api.bytes.freeze(buffer.fromstring(bytes))   -- in place, O(1)
local word = buffer.readu32(rom, 0x40)                   -- native speed
buffer.writeu8(rom, 0, 1)        -- error: attempt to modify a readonly buffer
```

## API

| Call | Result |
|---|---|
| `api.bytes.freeze(data)` | Makes `data` read-only for every reference to it, permanently; returns `data`. No copy. |
| `api.bytes.isFrozen(data)` | `true` after `freeze` or for a `snapshot` result. |
| `api.bytes.snapshot(data, offset?, length?)` | A new frozen buffer with a copy of the range. A whole frozen buffer is returned as is. |

Every write path fails on a frozen buffer: `buffer.write*`, `writestring`,
`writebits`, `fill` and `copy` into it, whether the call is a fastcall,
goes through a local alias or runs as native code. Reads, `buffer.len`,
`buffer.tostring` and `copy` *from* it work as usual. Engine APIs that read
buffers (`spatial`, `instances3d`, `particle.play_batch`, `projected`, `jobs`)
accept frozen buffers.

## Choosing freeze or snapshot

- The data will never change again (a loaded table, map, palette, original
  game image): `freeze` it. All existing references become read-only at once,
  so no writable alias survives.
- The owner keeps writing (a scratch buffer, a heap being simulated): give
  others `snapshot(data, offset, length)`. Later writes to the source do not
  reach the snapshot.

## Spans

A span is the triple `(buffer, offset, length)`, passed as plain values: no
object, no allocation, no copy. Over a frozen buffer it is safe to pass
anywhere. When a callee needs bounds that it cannot exceed, give it a
`snapshot` of the range instead.

## Cost

Per u32 read, 65,536 reads per tick, minus an empty loop. Native runs
`cargo test --release -p unone-engine --test bytes_perf -- --ignored
--nocapture` (interpreter, median of 40 ticks). Web runs the release Wasm
player through `node scripts/verify-immutable-bytes-wasm.mjs` or
`web/bench/immutable-bytes.html` served from the repository root (40-tick
batches, median of interleaved rounds after a warm-up pass).

| Read | Native (interpreter) | Web, Node 24 | Web, Chromium 152 |
|---|---:|---:|---:|
| `buffer.readu32` on a frozen buffer | 5.4 | 8.2 | 18.9 |
| `buffer.readu32` on a writable buffer | 5.4 | 8.4 | 17.7 |
| `string.byte` x4 on a string | 18.0 | 32.6 | 45.5 |
| `string.unpack("<I4")` | 25.4 | 81.6 | 76.3 |
| Luau wrapper validating each read (Populous-Reborn prototype) | 220 | 381 | 398 |
| Rust userdata reader (an earlier draft, removed) | 116 | | |

Nanoseconds per read, measured 2026-10-30 on this repository's release
player (opt-level 3, LTO). Browser numbers come from
`web/bench/immutable-bytes.html` in the Claude desktop browser pane while
other builds were running, so compare rows within a column, not across
columns.

A frozen buffer reads exactly like any buffer because it is one; the only
added cost is one header-byte check on each write call.

## Implementation

The flag lives in the Luau VM's buffer header (padding byte, so no layout
change); `vendor/luau0-src/UNONE.md` in the source repository describes the
patch and how to carry it across Luau upgrades. Correctness is checked by one
shared fixture, `crates/unone-engine/tests/fixtures/immutable-bytes.luau`, run
natively (`tests/immutable_bytes.rs`, also with `--features native-codegen`)
and in the Web player (`scripts/verify-immutable-bytes-wasm.mjs`).
