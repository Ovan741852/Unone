# Bounded immutable byte views

## Decision

Binary ownership is a reusable Core primitive. It does not include a game's
file formats, parsing rules, cache policy or resource choices. Immutable bytes
remain native Luau buffers so standard binary reads need no wrapper call.

`api.bytes.freeze` permanently revokes writes through every alias of a buffer.
`snapshot` copies mutable or partial input into frozen storage; a complete
already-frozen input can be reused. `span` requires frozen input and creates an
actual bounded buffer view, not an advisory offset/length tuple. Nested views
retain the ultimate root directly, and collection of intermediate handles
cannot invalidate a live reader. A small view can therefore pin a large root;
callers use `snapshot` when detaching that data is preferable.

The VM owns the readonly flag, logical length, backing pointer and strong root
edge. GC marking, allocation accounting, object destruction, interpreter
fastcalls and native-codegen reads use this representation. Guest code cannot
forge ownership with a table field, unfreeze storage or recover a writable
backing alias. Safe Rust `mlua::Buffer` writes and cursor writes check readonly
before creating mutable access. Deliberately unsafe trusted C/FFI writes and
arbitrary host access to WASM linear memory are outside this guest/safe-host
contract.

Numeric range arguments are checked for type, finite integral value and bounds
before casts or subtraction, including standard buffer operations. Existing
payload-value conversions are separate from range validation. Views preserve
binary strings, unaligned little-endian reads and the standard buffer API.

`equals` and `equalsRange` compare current bytes directly, including mutable
buffers. They retain no input, cache no positive result and construct no payload
copy, string or intermediate view. Equality is not a promise of future
immutability or a portable serialized value. Buffers remain excluded from
portable observations and saves.

## Alternatives and costs

A host userdata wrapper would impose a host boundary on ordinary reads. A
buffer/offset/length tuple would leave every parser responsible for enforcing
its own bounds. Readonly type aliases or frozen wrapper tables would not revoke
existing writable buffer aliases. Copying every immutable subrange would make
safe ownership unnecessarily proportional to payload size.

The selected representation adds a backing-pointer load to buffer reads and
small GC-accounted metadata per view. Freezing and whole-frozen snapshots are
constant-time; partial snapshots copy bytes. Equality remains proportional to
the compared data. Native write inlining is disabled in this fork, so compiled
writes use the checked VM path; no header-only write-overhead claim is made.
Benchmarks and lifetime tests must report their actual target, feature flags and
source/artifact pins. A test collector is not evidence of natural player GC
frequency, leak freedom or 60 FPS.

See [the API and ownership contract](../immutable-bytes.md) for usage and limits.
