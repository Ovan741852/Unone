//! Safe Rust hosts must honor the same frozen-buffer ownership as guest Luau.
//! The exported C function below is the exact VM entry bound as api.bytes.freeze.
use std::io::{self, Write};
use std::panic::{AssertUnwindSafe, catch_unwind};
use mlua::{Buffer, Lua, ffi};

unsafe extern "C-unwind" {
    fn unone_buffer_freeze(state: *mut ffi::lua_State) -> std::ffi::c_int;
}

fn frozen() -> (Lua, Buffer) {
    let lua = Lua::new();
    let buffer = lua.create_buffer(b"A\0BC\xff").unwrap();
    // SAFETY: this is the patched VM's normal Lua C function, also registered
    // by the public engine binding. No direct pointer mutation is performed.
    let freeze = unsafe { lua.create_c_function(unone_buffer_freeze) }.unwrap();
    let result: Buffer = freeze.call(buffer.clone()).unwrap();
    assert_eq!(result, buffer);
    (lua, buffer)
}

#[test]
fn safe_host_write_bytes_cannot_mutate_a_frozen_alias() {
    let (_lua, buffer) = frozen();
    let before = buffer.to_vec();
    let alias = buffer.clone();
    // The baseline API returns (). The hardened API may return a rejection;
    // either way no safe host operation may modify the frozen payload.
    let _attempt = catch_unwind(AssertUnwindSafe(|| {
        let _ = alias.write_bytes(0, b"Z");
    }));
    assert_eq!(buffer.to_vec(), before, "safe Buffer::write_bytes mutated frozen backing");
}

#[test]
fn safe_host_cursor_cannot_mutate_a_frozen_alias() {
    let (_lua, buffer) = frozen();
    let before = buffer.to_vec();
    let mut cursor = buffer.clone().cursor();
    let result = cursor.write(b"Z");
    assert_eq!(buffer.to_vec(), before, "safe cursor::write mutated frozen backing");
    assert_eq!(result.unwrap_err().kind(), io::ErrorKind::PermissionDenied);
}
