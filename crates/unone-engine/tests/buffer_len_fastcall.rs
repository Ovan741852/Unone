//! `buffer.len` is a Luau builtin fast call (Unone's LBF_BUFFER_LEN patch in
//! vendor/luau0-src): no C call on the hot path, the same results and errors.
use unone_engine::EngineRuntime;

fn compile(source: &str) -> Vec<u8> {
    mlua::Compiler::new().set_optimization_level(2).compile(source).unwrap()
}

#[test]
fn buffer_len_compiles_to_a_fast_call_like_string_len() {
    // A fast call adds one instruction before the import and call it skips;
    // `lex` is an unknown method of the same length, compiled as a plain call.
    let size = |library: &str, method: &str| compile(&format!("local v = ... return {library}.{method}(v)")).len();
    let string_fast = size("string", "len") - size("string", "lex");
    assert!(string_fast > 0);
    assert_eq!(size("buffer", "len") - size("buffer", "lex"), string_fast);
}

#[test]
fn buffer_len_reports_roots_frozen_buffers_and_views_and_rejects_other_values() {
    let runtime = EngineRuntime::load_source_with_seed("buffer-len", "main.luau", r#"
return {start=function(api)
 local root = buffer.create(7)
 assert(buffer.len(root) == 7)
 assert(buffer.len(buffer.create(0)) == 0)
 local frozen = api.bytes.freeze(buffer.fromstring('X\0reloadY'))
 assert(buffer.len(frozen) == 9)
 local view = api.bytes.span(frozen, 1, 7)
 assert(buffer.len(view) == 7)
 assert(buffer.len(api.bytes.span(view, 1, 6)) == 6)
 local total = 0
 for _ = 1, 1000 do total += buffer.len(view) end
 assert(total == 7000)
 local ok, message = pcall(function() return buffer.len('text') end)
 assert(not ok and string.find(message, 'buffer expected', 1, true), message)
 ok, message = pcall(function() return (buffer.len :: any)() end)
 assert(not ok and string.find(message, 'buffer expected', 1, true), message)
 ok, message = pcall(buffer.len, 42)
 assert(not ok and string.find(message, 'buffer expected', 1, true), message)
 api.observation.set('buffer_len_checked', true)
end, update=function() end}
"#, None, 42).unwrap();
    assert_eq!(runtime.semantic_observations()["buffer_len_checked"], true);
}
