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
    api.set("yuv420ToRgba", lua.create_function(yuv420_to_rgba)?)?;
    Ok(api)
}

/// Whole planes of a picture: the conversion a script would pay per pixel.
#[allow(clippy::type_complexity)]
fn yuv420_to_rgba(_: &Lua, (y, y_stride, u, v, uv_stride, width, height, out): (mlua::Buffer, usize, mlua::Buffer, mlua::Buffer, usize, usize, usize, mlua::Buffer)) -> mlua::Result<()> {
    let invalid = |what: &str| mlua::Error::RuntimeError(format!("BYTES_RANGE_INVALID: yuv420ToRgba {what}"));
    if width == 0 || height == 0 || width % 2 != 0 || height % 2 != 0 { return Err(invalid("needs an even, non-zero size")); }
    if y_stride < width || uv_stride < width / 2 { return Err(invalid("stride smaller than the row")); }
    let (y, u, v) = (y.to_vec(), u.to_vec(), v.to_vec());
    if y.len() < y_stride * height { return Err(invalid("luma plane too small")); }
    if u.len() < uv_stride * (height / 2) || v.len() < uv_stride * (height / 2) { return Err(invalid("chroma plane too small")); }
    if out.len() != width * height * 4 { return Err(invalid("output must hold width * height * 4 bytes")); }
    let mut rgba = vec![255u8; width * height * 4];
    for (row, line) in rgba.chunks_exact_mut(width * 4).enumerate() {
        let luma = &y[row * y_stride..row * y_stride + width];
        let at = (row / 2) * uv_stride;
        let (cb, cr) = (&u[at..at + width / 2], &v[at..at + width / 2]);
        for (column, pixels) in line.chunks_exact_mut(8).enumerate() {
            let (cu, cv) = (i32::from(cb[column]) - 128, i32::from(cr[column]) - 128);
            let (dr, dg, db) = ((359 * cv) >> 8, (-88 * cu - 183 * cv) >> 8, (454 * cu) >> 8);
            for (pixel, l) in pixels.chunks_exact_mut(4).zip(&luma[column * 2..column * 2 + 2]) {
                let l = i32::from(*l);
                pixel[0] = (l + dr).clamp(0, 255) as u8;
                pixel[1] = (l + dg).clamp(0, 255) as u8;
                pixel[2] = (l + db).clamp(0, 255) as u8;
            }
        }
    }
    out.write_bytes(0, &rgba)
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
