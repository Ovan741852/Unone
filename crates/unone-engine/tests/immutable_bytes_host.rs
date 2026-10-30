//! Safe Rust hosts must honor the same frozen-buffer ownership as guest Luau.
//! The exported C function below is the exact VM entry bound as api.bytes.freeze.
use std::io::{self, Read, Seek, SeekFrom, Write};
use mlua::{Buffer, Lua, ffi};

unsafe extern "C-unwind" {
    fn unone_buffer_freeze(state: *mut ffi::lua_State) -> std::ffi::c_int;
    fn unone_buffer_span(state: *mut ffi::lua_State) -> std::ffi::c_int;
    #[cfg(all(feature = "native-codegen", not(feature = "preview-tools")))]
    fn unone_bytes_nativecompiled(state: *mut ffi::lua_State, index: std::ffi::c_int) -> std::ffi::c_int;
}

fn span(lua: &Lua, parent: &Buffer, offset: usize, len: usize) -> Buffer {
    // SAFETY: same VM C function registered by the public bytes namespace.
    let make = unsafe { lua.create_c_function(unone_buffer_span) }.unwrap();
    make.call((parent.clone(), offset, len)).unwrap()
}

fn data_address(lua: &Lua, buffer: &Buffer) -> usize {
    let mut address = 0;
    let expected_len = buffer.len();
    // Unit-only, read-only pointer inspection proves shared backing. No pointer
    // is exposed to guest code, retained after the Buffer or written through.
    unsafe {
        lua.exec_raw::<()>(buffer.clone(), |state| {
            let mut len = 0;
            address = ffi::lua_tobuffer(state, -1, &mut len) as usize;
            assert_eq!(len, expected_len);
        }).unwrap();
    }
    address
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
    let error = alias.write_bytes(0, b"Z").unwrap_err();
    assert!(error.to_string().contains("readonly buffer"));
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
    assert_eq!(cursor.stream_position().unwrap(), 0);
    let mut read = [0; 5];
    cursor.read_exact(&mut read).unwrap();
    assert_eq!(read.as_slice(), before.as_slice());
}

#[test]
fn cursor_created_while_mutable_observes_later_freeze_without_losing_read_access() {
    let lua = Lua::new();
    let buffer = lua.create_buffer(b"A\0BC\xff").unwrap();
    let mut cursor = buffer.clone().cursor();
    cursor.seek(SeekFrom::Start(1)).unwrap();
    let freeze = unsafe { lua.create_c_function(unone_buffer_freeze) }.unwrap();
    freeze.call::<Buffer>(buffer.clone()).unwrap();
    assert_eq!(cursor.write(b"Z").unwrap_err().kind(), io::ErrorKind::PermissionDenied);
    assert_eq!(cursor.stream_position().unwrap(), 1);
    let mut read = [0; 4];
    cursor.read_exact(&mut read).unwrap();
    assert_eq!(read, b"\0BC\xff"[..]);
    assert_eq!(buffer.to_vec(), b"A\0BC\xff");
}

#[test]
fn writable_host_writes_remain_valid_and_bad_ranges_are_atomic() {
    let lua = Lua::new();
    let buffer = lua.create_buffer(b"A\0BC\xff").unwrap();
    buffer.write_bytes(1, b"XY").unwrap();
    assert_eq!(buffer.to_vec(), b"AXYC\xff");
    for (offset, value) in [(usize::MAX, b"Z".as_slice()), (5, b"Z".as_slice())] {
        let before = buffer.to_vec();
        assert!(buffer.write_bytes(offset, value).is_err());
        assert_eq!(buffer.to_vec(), before);
    }
    buffer.write_bytes(5, b"").unwrap();
    let mut cursor = buffer.clone().cursor();
    cursor.seek(SeekFrom::Start(3)).unwrap();
    cursor.write_all(b"!?").unwrap();
    assert_eq!(buffer.to_vec(), b"AXY!?");
}

#[test]
fn zero_copy_views_have_their_own_host_bounds_and_never_allow_mutation() {
    let (lua, parent) = frozen();
    let view = span(&lua, &parent, 1, 3);
    assert_eq!(data_address(&lua, &view), data_address(&lua, &parent) + 1);
    assert_eq!(view.len(), 3);
    assert_eq!(view.to_vec(), b"\0BC");
    assert!(view.write_bytes(0, b"Z").is_err());
    assert_eq!(view.clone().cursor().write(b"Z").unwrap_err().kind(), io::ErrorKind::PermissionDenied);
    let mut cursor = view.cursor();
    let mut output = [0; 16];
    assert_eq!(cursor.read(&mut output).unwrap(), 3);
    assert_eq!(&output[..3], b"\0BC");
    assert_eq!(cursor.read(&mut output).unwrap(), 0);
    assert!(cursor.seek(SeekFrom::Start(4)).is_err());
    assert_eq!(parent.to_vec(), b"A\0BC\xff");
}

#[test]
fn nested_views_pin_only_the_root_and_release_it_after_the_last_view() {
    let lua = Lua::new();
    let root = lua.create_buffer(vec![37; 1024 * 1024]).unwrap();
    let freeze = unsafe { lua.create_c_function(unone_buffer_freeze) }.unwrap();
    freeze.call::<Buffer>(root.clone()).unwrap();
    let weak = lua.create_table().unwrap();
    let meta = lua.create_table().unwrap();
    meta.set("__mode", "v").unwrap();
    weak.set_metatable(Some(meta)).unwrap();
    let parent = span(&lua, &root, 7, 100);
    let child = span(&lua, &parent, 5, 10);
    weak.set("root", root.clone()).unwrap();
    weak.set("parent", parent.clone()).unwrap();
    assert_eq!(data_address(&lua, &child), data_address(&lua, &root) + 12);

    // Unit-only collection verifies reachability and metadata allocation; it is
    // never used for player natural-GC frequency, leak-free or FPS acceptance.
    lua.gc_collect().unwrap();
    let before = lua.used_memory();
    let mut views = Vec::new();
    for _ in 0..16 { views.push(span(&lua, &root, 0, root.len())); }
    assert!(lua.used_memory().saturating_sub(before) < 128 * 1024,
        "span metadata allocation must not copy16MiB of logical payload");
    drop(views);
    drop(root);
    drop(parent);
    for _ in 0..3 { lua.gc_collect().unwrap(); }
    assert!(weak.get::<Option<Buffer>>("root").unwrap().is_some());
    assert!(weak.get::<Option<Buffer>>("parent").unwrap().is_none(),
        "nested views must flatten their owner instead of retaining parent chains");
    assert_eq!(child.to_vec(), [37; 10]);
    drop(child);
    for _ in 0..3 { lua.gc_collect().unwrap(); }
    assert!(weak.get::<Option<Buffer>>("root").unwrap().is_none());
    assert!(lua.used_memory() < before,
        "last view retirement must release the large root allocation");
}

#[cfg(all(feature = "native-codegen", not(feature = "preview-tools")))]
#[test]
fn actual_native_writer_compiled_before_freeze_and_native_view_reads_keep_vm_guards() {
    assert!(unone_engine::execution_mode().native_codegen_requested);
    assert_ne!(unsafe { ffi::luau_codegen_supported() }, 0,
        "this gate requires actual supported native codegen, not a compiled-feature fallback");
    let lua = Lua::new();
    lua.set_compiler(mlua::Compiler::new().set_optimization_level(2).set_type_info_level(1));
    lua.enable_jit(true);
    lua.sandbox(true).unwrap();
    let functions: mlua::Table = lua.load(r#"
local function writer(data: buffer)
    buffer.writeu32(data, 0, 0xDEADBEEF)
end
local function reader(data: buffer, offset: number): number
    return buffer.readu32(data, offset)
end
local function literalReader(data: buffer): number
    return buffer.readu32(data, 0 / 0)
end
return {writer=writer,reader=reader,literalReader=literalReader}
"#).eval().unwrap();
    let writer: mlua::Function = functions.get("writer").unwrap();
    let reader: mlua::Function = functions.get("reader").unwrap();
    let literal_reader: mlua::Function = functions.get("literalReader").unwrap();
    for function in [&writer, &reader, &literal_reader] {
        // Private host-only proof: eligibility or a void compile() call is not
        // sufficient. The VM verifies a bound native LuaProto entry directly.
        unsafe {
            lua.exec_raw::<()>(function.clone(), |state| {
                ffi::luau_codegen_compile(state, -1);
                assert_eq!(unone_bytes_nativecompiled(state, -1), 1);
            }).unwrap();
        }
    }
    let root = lua.create_buffer(b"\x78\x56\x34\x12\xab\xcd\xef\0").unwrap();
    writer.call::<()>(root.clone()).unwrap();
    assert_eq!(root.read_bytes::<4>(0), [0xef, 0xbe, 0xad, 0xde]);
    let freeze = unsafe { lua.create_c_function(unone_buffer_freeze) }.unwrap();
    freeze.call::<Buffer>(root.clone()).unwrap();
    let before = root.to_vec();
    assert!(writer.call::<()>(root.clone()).unwrap_err().to_string().contains("readonly buffer"));
    assert_eq!(root.to_vec(), before);
    let view = span(&lua, &root, 1, 4);
    assert_eq!(reader.call::<f64>((view.clone(), 0)).unwrap(), f64::from(0xabdeadbe_u32));
    assert!(reader.call::<f64>((view.clone(), 1)).unwrap_err().to_string().contains("buffer access out of bounds"));
    for offset in [0.5, f64::NAN, f64::INFINITY, f64::NEG_INFINITY, f64::MAX] {
        let error = reader.call::<f64>((view.clone(), offset)).unwrap_err();
        assert!(error.to_string().contains("buffer range"), "{error}");
    }
    assert!(reader.call::<f64>((view.clone(), "0")).unwrap_err().to_string().contains("buffer range"));
    assert!(literal_reader.call::<f64>(view.clone()).unwrap_err().to_string().contains("buffer range"));
    assert!(reader.call::<f64>((view, 4294967296_f64)).is_err());
    unsafe {
        lua.exec_raw::<()>(writer, |state| {
            assert_eq!(unone_bytes_nativecompiled(state, -1), 1);
        }).unwrap();
    }
}
