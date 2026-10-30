# Unone's Luau patch: read-only buffers and bounded views

This is `luau0-src` 0.18.3+luau709 with VM-owned immutable buffers. The root,
Web player, native player and spatial GPU Cargo workspaces select this source
through `[patch.crates-io]`. `UNONE_READONLY_BUFFERS=2` identifies this layout.
`UNONE-readonly-buffers.patch` contains the complete diff against upstream.
The build explicitly emits `cargo:rerun-if-changed` for its absolute `luau/`
source subtree. Cargo recursively watches that directory, including headers;
`cc::Build::cargo_metadata(false)` otherwise leaves changed C++ sources invisible
and can silently reuse an archive built before a VM fix.

## Ownership and layout

`Buffer` retains the common GC header, readonly byte and logical `len` at the
original offsets. `data` is now a pointer at offset 8 on both 32-bit and 64-bit
targets. It points either to the root's inline allocation or into a frozen
root's allocation. `owner` is null for a root and points directly to the
ultimate root for a view. Nested views never retain intermediate views.

Owned inline payload starts at offset 24 on 64-bit targets and 16 on 32-bit
targets; `lmem.cpp` asserts those ABI offsets. Each root allocates and charges
its own payload once. A view allocates only `sizebuffer(0)` bytes of metadata,
regardless of its logical length. Freeing and GC diagnostics use the actual
allocation size, not a view's logical byte count. The collector marks a view's
owner strongly; validation, heap dumps and graph enumeration include that edge.
Keeping even a one-byte view alive therefore retains its whole root allocation.

`lua_newbufferview` roots the new object through the normal GC/stack-barrier
sequence. A source remains on the VM stack across allocation and buffers do not
move. All public span range checks use the source's logical length, preventing
reads outside a nested view even when more bytes exist in its root.

## Lua API and reads

The engine registers six direct VM C callbacks as `api.bytes.*`:

- `freeze(buffer)` permanently freezes every alias in place, without copying.
- `isFrozen(buffer)` reports the VM flag.
- `snapshot(buffer, offset?, length?)` copies and freezes a range. A whole
  already-frozen buffer is returned unchanged. Missing or nil bounds use defaults.
- `span(frozenBuffer, offset, length)` creates a frozen, bounded, zero-copy
  buffer view. Mutable sources fail with `BYTES_FROZEN_REQUIRED`.
- `equals(a, b)` and `equalsRange(a, aOffset, b, bOffset, length)` compare bytes
  directly on every call. Both writable and frozen buffers are accepted; the
  synchronous comparisons retain nothing and create no strings, spans or hashes.

All six functions check arity and buffer types. Supplied offsets and lengths
must be actual finite safe integer numbers. Numeric strings and fractions are
rejected before casts. Negative or out-of-range integers fail range validation;
default lengths are computed only after checking the offset. Empty end ranges
are valid. Diagnostics use `BYTES_ARGUMENTS_INVALID`, `BYTES_BUFFER_REQUIRED`,
`BYTES_RANGE_INVALID` and `BYTES_FROZEN_REQUIRED`.

The ordinary `buffer.read*`, `len`, `readstring`, `tostring` and copy-source paths
operate on logical data/length for both roots and views. Interpreter fastcalls
load the same pointer; x64 and A64 native codegen load `Buffer.data` rather than
forming an inline-payload address. This adds a pointer load compared with the
upstream inline layout. Old layout performance figures do not validate this
layout's performance.

The standard buffer library also uses strict finite, nonnegative integer
offsets/counts, including create sizes, bit ranges and string/copy/fill counts.
Write payload values retain upstream semantics. Copy/fill default lengths are
computed only after validating offsets. Interpreter fastcalls validate before
casting; inlined native reads round-trip integer conversion and branch to the
checked fallback on a mismatch (including NaN). The upstream constant folder
already range-checks before narrowing a numeric constant, so malformed literal
offsets cannot invoke an unchecked C++ cast during compilation.

## Mutation boundaries

Every Lua write in `lbuflib.cpp` checks readonly: integer/float/string/bit writes,
fill and the target of copy. Write fastcalls decline frozen buffers and fall
back to those checked functions. Native codegen buffer-write inlining remains
disabled; writable JIT writes also pay the fallback cost. The C readonly setter
cannot unfreeze a frozen buffer. Supported safe Rust buffer mutators must check
the flag separately in the patched mlua dependency; checking Lua callbacks alone
does not protect host `Buffer::write_bytes` or cursor writes.

The trusted raw C API still exposes payload pointers for embedding, just as it
does for other VM values. Embedders must not write frozen payloads through raw
pointers. The guarantee covers supported Lua operations and checked safe host
operations, not arbitrary unsafe native code.

## Upgrading and validation

1. Copy a new upstream `luau0-src` crate and apply the complete patch.
2. Audit every buffer writer and data-address path in VM and codegen, including
   new fastcalls and any changes to GC marking, accounting or debug enumeration.
3. Check the independent x64/32-bit ABI assertions and bounded-view lifetime.
4. Run shared fixture, safe Rust mutation, GC/accounting and snapshot numeric
   regressions natively and in an actual newly emitted production Web runtime.
5. For native codegen, use a build without `preview-tools`; the default engine
   features include it and disable JIT even if `native-codegen` is selected.
   The private host-only `unone_bytes_nativecompiled` probe checks the actual
   Proto execution data, target and native entry opcode. It returns no pointers
   and has no Lua binding or WASM ABI export. Eligibility alone is not proof of
   a compiled writer/reader.

Source review and tests compiled but blocked by OS policy are not executed
proof. Preserve original immutable runtime artifacts and their source identities.
