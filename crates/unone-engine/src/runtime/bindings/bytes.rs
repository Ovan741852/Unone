//! Immutable bytes are ordinary Luau buffers made read-only by the VM (see
//! vendor/luau0-src/UNONE.md). Reads keep the VM's own `buffer.read*` fast
//! paths. Luau writes (including native-codegen functions) and safe Rust mlua
//! writes reject frozen roots and views. Trusted unsafe raw C/FFI pointer writes
//! remain outside this ownership guarantee.
use mlua::{Lua, Table, ffi};
use std::ffi::c_int;

unsafe extern "C-unwind" {
    fn unone_buffer_freeze(state: *mut ffi::lua_State) -> c_int;
    fn unone_buffer_isfrozen(state: *mut ffi::lua_State) -> c_int;
    fn unone_buffer_snapshot(state: *mut ffi::lua_State) -> c_int;
    fn unone_buffer_span(state: *mut ffi::lua_State) -> c_int;
    fn unone_buffer_equals(state: *mut ffi::lua_State) -> c_int;
    fn unone_buffer_equalsrange(state: *mut ffi::lua_State) -> c_int;
}

pub(super) fn bind(lua: &Lua) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    // SAFETY: the patched VM defines these as ordinary lua_CFunctions. They
    // touch only their own stack frame and raise misuse as Luau errors from
    // VM frames, never across Rust frames.
    unsafe {
        api.set("freeze", lua.create_c_function(unone_buffer_freeze)?)?;
        api.set("isFrozen", lua.create_c_function(unone_buffer_isfrozen)?)?;
        api.set("snapshot", lua.create_c_function(unone_buffer_snapshot)?)?;
        api.set("span", lua.create_c_function(unone_buffer_span)?)?;
        api.set("equals", lua.create_c_function(unone_buffer_equals)?)?;
        api.set("equalsRange", lua.create_c_function(unone_buffer_equalsrange)?)?;
    }
    Ok(api)
}

/// Freeze a buffer from Rust, as api.bytes.freeze does.
pub(super) fn freeze(lua: &Lua, buffer: &mlua::Buffer) -> mlua::Result<()> {
    // SAFETY: exec_raw pushes the buffer as the only argument; lua_setreadonly
    // flips its readonly byte, and the pop leaves the stack as it found it.
    unsafe {
        lua.exec_raw::<()>(buffer.clone(), |state| {
            ffi::lua_setreadonly(state, -1, 1);
            ffi::lua_pop(state, 1);
        })
    }
}
