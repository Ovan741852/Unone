# Immutable bytes

Immutable binary data in Unone is an ordinary Luau `buffer` made read-only.
Read it with the standard `buffer.read*` functions. Freezing applies to every
alias of that buffer; a bounded span is also an actual frozen buffer, with its
own length and shared storage. There is no per-read wrapper method.

```luau
local rom = api.bytes.freeze(buffer.fromstring(bytes))   -- in place, O(1)
local word = buffer.readu32(rom, 0x40)                   -- ordinary buffer read
buffer.writeu8(rom, 0, 1)        -- error: attempt to modify a readonly buffer
```

## API

| Call | Result |
|---|---|
| `api.bytes.freeze(data)` | Makes `data` read-only for every reference to it, permanently; returns `data`. No copy. |
| `api.bytes.isFrozen(data)` | Reports whether an actual buffer is frozen. Snapshot and span results are frozen. |
| `api.bytes.snapshot(data, offset?, length?)` | A new frozen buffer with a copy of the range. A whole frozen buffer is returned as is. |
| `api.bytes.span(data, offset, length)` | A bounded, frozen view into an already frozen buffer. Allocates view metadata, without copying payload bytes. |
| `api.bytes.equals(left, right)` | Compares the current contents of two mutable or frozen buffers directly. |
| `api.bytes.equalsRange(left, leftOffset, right, rightOffset, length)` | Compares the specified valid ranges directly, using each buffer's own bounds. |

Every argument named above is a buffer, except the numeric offsets and lengths.
Strings, tables with a buffer-like brand and userdata are not accepted as buffer
substitutes. `freeze` and `isFrozen` take exactly one argument; `snapshot` takes
one to three, `span` three, `equals` two and `equalsRange` five. Extra arguments
fail explicitly.

## Ranges and snapshots

Offsets and lengths are zero-based byte units. A supplied range number must be
finite, integral, nonnegative and no greater than `2^53 - 1`; numeric strings,
fractions, NaN and infinities are rejected. The range must then fit the
buffer's logical length. An empty range at the exact end is valid. Reads retain
the standard Luau buffer representation, including little-endian integer reads;
byte offsets do not need to be aligned to the integer width.

For `snapshot`, omitted or `nil` offset means zero. Omitted or `nil` length
means the remaining bytes after that validated offset. A complete frozen buffer
or frozen view is returned unchanged. A mutable input, or a proper subrange of
any input, produces a separate frozen allocation and copies the selected bytes.

The standard buffer library also validates its range and size arguments
strictly, including create sizes, bit offsets/counts, read/write offsets and
string/copy/fill counts. This does not change write payload-value conversion.
Malformed ordinary-buffer numbers use `BUFFER_RANGE_INVALID`; valid integers
outside the buffer use the ordinary `buffer access out of bounds` error.
`api.bytes` distinguishes `BYTES_ARGUMENTS_INVALID`, `BYTES_RANGE_INVALID`,
`BYTES_BUFFER_REQUIRED` and, for a mutable span source, `BYTES_FROZEN_REQUIRED`.

## Choosing ownership

- The data will never change again (a loaded table, map, palette, original
  game image): `freeze` it. All existing references become read-only at once,
  so no writable alias survives.
- The owner keeps writing (a scratch buffer, a heap being simulated): give
  others `snapshot(data, offset, length)`. Later writes to the source do not
  reach the snapshot.
- The source is already frozen and a reader needs only a section: use
  `span(data, offset, length)`. Reads and further spans cannot escape that
  section's logical bounds.

## Spans

```luau
local all = api.bytes.freeze(buffer.fromstring("\0\1\2\3\4\5"))
local section = api.bytes.span(all, 2, 3)
assert(buffer.len(section) == 3)
assert(buffer.readu8(section, 0) == 2)
-- buffer.readu8(section, 3) fails even though all has more readable bytes.
local last = api.bytes.span(section, 2, 1)
assert(buffer.readu8(last, 0) == 4)
```

A span owns a strong GC reference to the ultimate backing buffer. Dropping the
root variable or an intermediate span does not invalidate a live child. Nested
spans share that root directly rather than retaining a chain of parent views.
The root allocation can retire after its final owning reference is gone.

Keeping even a one-byte span alive retains the entire backing allocation. Use
a copied `snapshot` when a small result must outlive a large source without
pinning it. Span creation allocates fixed metadata; zero payload copying does
not mean zero VM allocation.

## Comparisons and mutable inputs

Comparisons accept both mutable and frozen buffers. Each call compares the
current bytes, without a positive-result cache, hash, temporary string or
temporary span. A previous equality result does not authorize skipping a later
comparison after a mutable input changes.

```luau
local scratch = buffer.create(4)
local before = api.bytes.snapshot(scratch)
assert(api.bytes.equals(before, scratch))
buffer.writeu32(scratch, 0, 7)
assert(not api.bytes.equals(before, scratch))
assert(api.bytes.equalsRange(before, 4, scratch, 4, 0))
```

Comparison cost depends on the compared content and length. A copied snapshot
provides isolation from later writes; comparing a mutable input does not freeze
it or retain a writable alias.

## Mutation boundary

Guest writes to a frozen root or view fail: `buffer.write*`, `writestring`,
`writebits`, `fill` and copy targets all enforce the same readonly flag. The VM
checks ordinary calls and interpreter fastcalls; native codegen sends writes
through the checked path. Reads, `buffer.len`, `buffer.tostring` and copying
*from* frozen data remain valid. Engine APIs that consume buffers use the
value's adjusted data pointer and logical length.

Supported safe Rust host writes enforce the flag too. The patched mlua
`Buffer::write_bytes` returns an error before obtaining a mutable slice; its
cursor returns `PermissionDenied` without advancing. A host cursor created
before freezing cannot subsequently write through an old alias.

Trusted unsafe embedding code remains outside this guarantee. Raw C API
payload pointers, unsafe FFI and a host writing arbitrary exported WASM memory
can bypass guest rules and must enforce their own ownership preconditions.
The byte API does not grant guest code that unsafe authority.

## Historical pre-view benchmark

The following values are the previous author's recorded 2026-10-30 baseline,
before bounded views, the pointer-based buffer layout, safe-host write guards
and strict standard-buffer ranges. They are preserved as historical data,
**not current performance acceptance or a measurement of this implementation**.

The recorded protocol used 65,536 u32 reads per tick, subtracting an empty loop.
Native used interpreter medians of 40 ticks; Web used 40-tick batches and the
median of interleaved rounds after warm-up.

| Read | Native (interpreter) | Web, Node 24 | Web, Chromium 152 |
|---|---:|---:|---:|
| `buffer.readu32` on a frozen buffer | 5.4 | 8.2 | 18.9 |
| `buffer.readu32` on a writable buffer | 5.4 | 8.4 | 17.7 |
| `string.byte` x4 on a string | 18.0 | 32.6 | 45.5 |
| `string.unpack("<I4")` | 25.4 | 81.6 | 76.3 |
| Luau wrapper validating each read (Populous-Reborn prototype) | 220 | 381 | 398 |
| Rust userdata reader (an earlier draft, removed) | 116 | | |

Units are nanoseconds per read. The author described a release build
(opt-level 3, LTO). The browser figures came from
`web/bench/immutable-bytes.html` in the Claude desktop browser pane while
other builds were running. They do not establish an isolated timing comparison,
allocation counts, current Native/WASM parity, game FPS or GC cadence.

The current implementation changes buffer addressing and range validation;
native writes also use a checked fallback. Neither a header-only cost nor
unchanged JIT-write overhead is claimed. Fresh pinned artifacts and separate
measurements are required for current performance conclusions. The existing
`bytes_perf` and Web read-cost harnesses are microbenchmarks, not substitutes for
functional, lifetime or official-player validation.

## Implementation

The namespace is a Core capability, independent of optional project systems.
Use a matching engine/CLI/runtime distribution: a UI package version alone does
not identify whether a Core contains byte views. Ordinary Luau `buffer` types
describe the value; the VM flag, rather than a caller-supplied type or brand,
enforces immutability.

The VM owns readonly state, logical buffer lengths, adjusted data pointers and
view-to-root GC edges. The layout differs from upstream inline buffers; the
source maintenance notes are [the Luau fork](../vendor/luau0-src/UNONE.md) and
[safe mlua host writes](../vendor/mlua/UNONE.md).

The shared fixture at `crates/unone-engine/tests/fixtures/immutable-bytes.luau`
is used by native public-API tests and the functional emitted-WASM verifier,
`scripts/verify-immutable-bytes-functional-wasm.mjs`. The latter pins runtime,
source, fixture and loader hashes and can compare an actually executed native
checkpoint report. It does not replace a missing native execution with a Lua
implementation or an older artifact. Host tests separately cover safe Rust
mutation, bounded-view lifetime and metadata allocation.

An actual native-codegen proof needs a build without `preview-tools`. Default
engine features include development tools and disable JIT even when
`native-codegen` is selected. The host test's codegen-only case explicitly
compiles target functions and verifies their native entry through a private
host probe before freezing the writer's buffer and checking rejection. Merely
building the feature is not proof of native execution. Recorded results must
distinguish executed tests from a compiled executable blocked by the platform.

The [2026-10-30/31 review](reviews/2026-10-30-immutable-byte-spans.md) records
executed Native/JIT and release-WASM checks, strict historical-fixture parity,
bounded natural-GC lifetime evidence and operation diagnostics. It also records
the Windows-blocked final rebuild and unavailable matching SDK, rather than
treating an older CLI or SDK as the new distribution.
