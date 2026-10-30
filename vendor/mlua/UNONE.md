# Safe host writes respect frozen Luau buffers

This directory starts from the exact cached crates.io `mlua` **0.11.6** source.
The upstream Git revision in `.cargo_vcs_info.json` is
`e7fa8d75bb3947648605562694d03c1ce4c82b20`; the registry package checksum from
the original lockfiles is
`ccd36acfa49ce6ee56d1307a061dd302c564eee757e6e4cd67eb4f7204846fab`.
The upstream MIT license remains in `LICENSE`. No upstream read path changes.

Unone's VM patch in `../luau0-src` makes a Luau buffer read-only for every
guest reference. Upstream mlua also exposes safe host mutation methods;
those methods must check the same VM flag rather than bypass guest ownership.

Changes from upstream are limited to `src/buffer.rs` and its existing tests:

- `Buffer::write_bytes` returns `mlua::Result<()>`, rejects read-only buffers
  before acquiring a mutable slice, and validates range addition without
  overflow before copying. Failed writes leave the payload unchanged.
- `BufferCursor::write` returns `PermissionDenied` for frozen buffers, without
  changing its position or payload. Reading, seeking and flushing remain valid.
- The shared private mutable-slice acquisition itself checks `lua_getreadonly`
  while holding the same Lua lock and returns an error; callers cannot create a
  mutable reference to frozen data before checking.
- Existing writable-buffer tests handle the new result; out-of-range writes
  now assert an error and unchanged payload instead of expecting a panic.

The root, player, native-player and spatial-gpu Cargo workspaces all patch this
same source. `UNONE-safe-buffer-writes.patch` records the exact delta for future
upstream upgrades.

This is a guarantee for guest Luau and safe engine/mlua host operations, not an
attempt to sandbox trusted unsafe native code. Raw `lua_tobuffer` pointers,
unsafe FFI, and a host writing arbitrary exported WASM linear memory retain
their explicit unsafe authority; such operations must enforce their own
ownership preconditions. They are not exposed as a guest writable alias.

The first normal native regression invocation compiled successfully but Windows
App Control 4551 prevented its test executable from starting. Its original
command/source/logs are retained under
`.cache/immutable-bytes-host-red-20261030-r1`. That is blocked execution, not a
passing test or an observed runtime RED. Subsequent executed results must be
recorded separately; no security policy or blocked executable was modified.
