# Unone's Luau patch: read-only buffers

This is the `luau0-src` 0.18.3+luau709 crate (the Luau sources mlua builds),
with one change: a buffer can be made read-only. Every Cargo workspace that
builds the engine uses it through `[patch.crates-io]`: the root workspace,
`crates/unone-player` (Web), `crates/unone-native-player` and
`crates/unone-spatial-gpu`.

Why it is in the VM: immutable binary data must read as fast as an ordinary
buffer and must not leave a writable alias anywhere. A wrapper object in Luau
or Rust costs every read a call; native `buffer.readu32` measured 5.3 ns per
read against 115 ns for a Rust userdata reader and 234 ns for a Luau wrapper
(native release interpreter; see docs/immutable-bytes.md for Web numbers).

## The change

`UNONE-readonly-buffers.patch` is the complete diff against upstream:

- `Buffer` gains `uint8_t readonly` in the header padding after
  `CommonHeader`; size, `len` and `data` offsets are unchanged.
  `luaB_newbuffer` clears it.
- `lua_setreadonly` / `lua_getreadonly` accept buffers as well as tables.
- In `lbuflib.cpp` every write (`write*`, `writestring`, `writebits`, `fill`,
  and `copy` into a target) checks the flag and raises
  `attempt to modify a readonly buffer`.
- The `luauF_writeinteger` / `luauF_writefp` fastcalls decline a readonly
  buffer, so the call falls back to the checked library function.
- Native codegen never inlines a buffer write (reads stay inlined). Writes run
  through the checked fastcall, so a frozen buffer cannot be written from
  machine code either.
- `lbuflib.cpp` / `lualib.h` add `unone_buffer_freeze`,
  `unone_buffer_isfrozen` and `unone_buffer_snapshot`. The engine registers
  them as `api.bytes.*` C functions, so their errors are raised from VM
  frames only.
- `src/lib.rs` defines `UNONE_READONLY_BUFFERS` (a revision number) for the
  C++ build.

## Upgrading Luau

1. Copy the new `luau0-src` crate here.
2. Apply `UNONE-readonly-buffers.patch` with `patch -p1` from this directory.
3. Search the new `lbuflib.cpp`, `lbuiltins.cpp` and
   `CodeGen/src/IrTranslateBuiltins.cpp` for any new buffer write path, and
   guard it the same way.
4. Run `cargo test -p unone-engine --test immutable_bytes`,
   `node scripts/verify-immutable-bytes-wasm.mjs` on a fresh Web player build,
   and the native-codegen variant.
