//! Precompiled entry scripts and modules run exactly like source compiled at
//! load, and a player admits them only with a matching compiler identity and
//! length. Production parity runs on a production feature set:
//! cargo test -p unone-engine --no-default-features --features all-systems --test script_bytecode
use std::collections::BTreeMap;
use unone_engine::{HostProject, ScriptBytecodeDecl, ScriptModuleBytecodeDecl, SCRIPT_BYTECODE_DATA_ID, SCRIPT_MODULE_BYTECODE_DATA_ID,
    compile_production_modules, compile_production_script};
#[cfg(not(any(feature = "dev-tools", feature = "preview-tools")))]
use unone_engine::{InputFrame, observation_digest};

const SCRIPT: &str = "local n=0\nreturn {start=function(api) api.observation.set('n',0) end,\nupdate=function(api,dt)\n n=n+dt*3.5\n for i=1,10 do n=(n*1.000001+i)%1000 end\n api.observation.set('n',n)\n if n>990 then error('overflow') end\nend}";

fn payload(script: &str, bytecode: Option<&ScriptBytecodeDecl>) -> Vec<u8> {
    let mut value = serde_json::json!({"config":{"name":"bytecode","entry_script":"main.luau"},"script":script});
    if let Some(decl) = bytecode { value["script_bytecode"] = serde_json::to_value(decl).unwrap(); }
    serde_json::to_vec(&value).unwrap()
}
fn load(script: &str, bytecode: Option<&ScriptBytecodeDecl>, data: BTreeMap<String, Vec<u8>>) -> Result<unone_engine::EngineRuntime, String> {
    HostProject::parse(&payload(script, bytecode)).and_then(|p| p.into_runtime_with_data(7, data)).map_err(|d| d.explanation)
}
fn error(result: Result<unone_engine::EngineRuntime, String>) -> String { result.err().expect("expected a rejected load") }
fn staged(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> { BTreeMap::from([(SCRIPT_BYTECODE_DATA_ID.to_string(), bytes.to_vec())]) }

#[test]
fn a_leading_tab_is_source_text_not_bytecode() {
    // Chunk auto-detection used to read any first byte below '\n' as bytecode.
    load("\treturn {start=function()end,update=function()end}", None, BTreeMap::new()).ok().expect("load");
}

#[test]
fn undeclared_or_doubly_declared_bytecode_is_rejected() {
    let compiled = compile_production_script(SCRIPT, false).unwrap();
    let decl = ScriptBytecodeDecl { source: "script.luaubc".into(), format: compiled.format.clone(), byte_length: compiled.bytes.len() };
    assert!(error(load(SCRIPT, None, staged(&compiled.bytes))).contains("SCRIPT_BYTECODE_UNDECLARED"));
    assert!(error(load(SCRIPT, Some(&decl), staged(&compiled.bytes))).contains("declare either script or script_bytecode"));
    assert!(error(load("", Some(&decl), BTreeMap::new())).contains("SCRIPT_BYTECODE_MISSING"));
}

#[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
#[test]
fn developer_and_preview_players_load_source_only() {
    assert_eq!(unone_engine::script_bytecode_format(), None);
    let compiled = compile_production_script(SCRIPT, false).unwrap();
    let decl = ScriptBytecodeDecl { source: "script.luaubc".into(), format: compiled.format, byte_length: compiled.bytes.len() };
    assert!(error(load("", Some(&decl), staged(&compiled.bytes))).contains("SCRIPT_BYTECODE_UNSUPPORTED"));
}

#[cfg(not(any(feature = "dev-tools", feature = "preview-tools")))]
#[test]
fn precompiled_entry_matches_source_every_frame_including_errors() {
    let compiled = compile_production_script(SCRIPT, cfg!(feature = "native-codegen")).unwrap();
    assert_eq!(unone_engine::script_bytecode_format().as_deref(), Some(compiled.format.as_str()));
    let decl = ScriptBytecodeDecl { source: "script.luaubc".into(), format: compiled.format.clone(), byte_length: compiled.bytes.len() };
    let mut source = load(SCRIPT, None, BTreeMap::new()).ok().expect("load");
    let mut bytecode = load("", Some(&decl), staged(&compiled.bytes)).ok().expect("load");
    let idle = InputFrame::default();
    for _ in 0..600 {
        let (a, b) = (source.tick_with_input(&idle), bytecode.tick_with_input(&idle));
        // Runtime errors carry the same chunk name and line from either form.
        assert_eq!(a.as_ref().err().map(|d| &d.explanation), b.as_ref().err().map(|d| &d.explanation));
        if a.is_err() { return; }
        assert_eq!(observation_digest(&source.observe()).unwrap(), observation_digest(&bytecode.observe()).unwrap());
    }
    panic!("the fixture should reach its scripted error");
}

#[cfg(not(any(feature = "dev-tools", feature = "preview-tools")))]
#[test]
fn players_reject_bytecode_from_another_compiler_or_a_truncated_download() {
    let compiled = compile_production_script(SCRIPT, cfg!(feature = "native-codegen")).unwrap();
    let decl = ScriptBytecodeDecl { source: "script.luaubc".into(), format: compiled.format.clone(), byte_length: compiled.bytes.len() };
    let other = ScriptBytecodeDecl { format: compiled.format.replace("/o2/", "/o1/"), ..decl.clone() };
    assert!(error(load("", Some(&other), staged(&compiled.bytes))).contains("SCRIPT_BYTECODE_INCOMPATIBLE"));
    assert!(error(load("", Some(&decl), staged(&compiled.bytes[..compiled.bytes.len() - 1]))).contains("SCRIPT_BYTECODE_INVALID"));
}

const MAIN: &str = "local counter = require('./world/counter')\nreturn {start=function(api) api.observation.set('n', counter.n) end,\nupdate=function(api,dt) counter.step(dt) api.observation.set('n', counter.n) end}";
const COUNTER: &str = "local shared = require('../shared')\nlocal M = {n = shared.base}\nfunction M.step(dt)\n M.n = M.n + dt * 3.5\n for i = 1, 10 do M.n = (M.n * 1.000001 + i) % 1000 end\n if M.n > 990 then error('overflow') end\nend\nreturn M";
const SHARED: &str = "return {base = 1}";

fn module_sources() -> BTreeMap<String, String> {
    [("world/counter.luau", COUNTER), ("shared.luau", SHARED)].into_iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}
/// A modular game: entry source or bytecode, module sources and/or module bytecode.
fn modules_payload(entry: Option<&ScriptBytecodeDecl>, sources: bool, modules: Option<&ScriptModuleBytecodeDecl>) -> serde_json::Value {
    let mut value = serde_json::json!({"config":{"name":"modules","entry_script":"scripts/main.luau"}});
    match entry {
        Some(decl) => value["script_bytecode"] = serde_json::to_value(decl).unwrap(),
        None => value["script"] = MAIN.into(),
    }
    if sources { value["script_modules"] = serde_json::to_value(module_sources()).unwrap(); }
    if let Some(decl) = modules { value["script_module_bytecode"] = serde_json::to_value(decl).unwrap(); }
    value
}
fn load_value(value: &serde_json::Value, data: BTreeMap<String, Vec<u8>>) -> Result<unone_engine::EngineRuntime, String> {
    HostProject::parse(&serde_json::to_vec(value).unwrap()).and_then(|p| p.into_runtime_with_data(7, data)).map_err(|d| d.explanation)
}
fn compiled_modules() -> (ScriptModuleBytecodeDecl, Vec<u8>) {
    let compiled = compile_production_modules(&module_sources(), cfg!(feature = "native-codegen")).unwrap();
    let decl = ScriptModuleBytecodeDecl { source: "script-modules.luaubc".into(), format: compiled.format, byte_length: compiled.bytes.len(), modules: compiled.modules };
    (decl, compiled.bytes)
}
fn staged_modules(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> { BTreeMap::from([(SCRIPT_MODULE_BYTECODE_DATA_ID.to_string(), bytes.to_vec())]) }

#[test]
fn modules_compile_back_to_back_in_key_order_and_name_a_broken_module() {
    let (decl, bytes) = compiled_modules();
    assert_eq!(decl.modules.keys().map(String::as_str).collect::<Vec<_>>(), ["shared.luau", "world/counter.luau"]);
    assert_eq!(decl.modules.values().sum::<usize>(), bytes.len());
    let shared = compile_production_script(SHARED, cfg!(feature = "native-codegen")).unwrap();
    assert_eq!(&bytes[..shared.bytes.len()], shared.bytes.as_slice());
    let mut broken = module_sources();
    broken.insert("world/broken.luau".into(), "return {".into());
    let message = compile_production_modules(&broken, false).err().expect("a syntax error");
    assert!(message.starts_with("world/broken.luau: "), "{message}");
}

#[test]
fn a_payload_names_every_file_its_host_stages() {
    let (decl, _) = compiled_modules();
    let entry = ScriptBytecodeDecl { source: "script.luaubc".into(), format: decl.format.clone(), byte_length: 1 };
    let mut value = modules_payload(Some(&entry), false, Some(&decl));
    value["data_assets"] = serde_json::json!([{"id":"map","source":"data/map.bin","loader":"bytes"}]);
    let project = HostProject::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(project.staged_files(), [("map", "data/map.bin"), (SCRIPT_BYTECODE_DATA_ID, "script.luaubc"),
        (SCRIPT_MODULE_BYTECODE_DATA_ID, "script-modules.luaubc")]);
    let source = HostProject::parse(&serde_json::to_vec(&modules_payload(None, true, None)).unwrap()).unwrap();
    assert!(source.staged_files().is_empty());
}

#[test]
fn module_bytecode_needs_one_declaration_and_its_staged_file() {
    let (decl, bytes) = compiled_modules();
    assert!(error(load_value(&modules_payload(None, true, None), staged_modules(&bytes))).contains("SCRIPT_BYTECODE_UNDECLARED"));
    assert!(error(load_value(&modules_payload(None, true, Some(&decl)), staged_modules(&bytes))).contains("declare either script_modules or script_module_bytecode"));
    assert!(error(load_value(&modules_payload(None, false, Some(&decl)), BTreeMap::new())).contains("SCRIPT_BYTECODE_MISSING"));
}

#[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
#[test]
fn developer_and_preview_players_load_module_source_only() {
    let (decl, bytes) = compiled_modules();
    assert!(error(load_value(&modules_payload(None, false, Some(&decl)), staged_modules(&bytes))).contains("SCRIPT_BYTECODE_UNSUPPORTED"));
}

#[cfg(not(any(feature = "dev-tools", feature = "preview-tools")))]
#[test]
fn precompiled_modules_match_source_every_frame_including_errors() {
    let entry = compile_production_script(MAIN, cfg!(feature = "native-codegen")).unwrap();
    let entry_decl = ScriptBytecodeDecl { source: "script.luaubc".into(), format: entry.format.clone(), byte_length: entry.bytes.len() };
    let (decl, bytes) = compiled_modules();
    let mut data = staged(&entry.bytes);
    data.extend(staged_modules(&bytes));
    let mut source = load_value(&modules_payload(None, true, None), BTreeMap::new()).ok().expect("load");
    let mut bytecode = load_value(&modules_payload(Some(&entry_decl), false, Some(&decl)), data).ok().expect("load");
    let idle = InputFrame::default();
    for _ in 0..600 {
        let (a, b) = (source.tick_with_input(&idle), bytecode.tick_with_input(&idle));
        assert_eq!(a.as_ref().err().map(|d| &d.explanation), b.as_ref().err().map(|d| &d.explanation));
        if let Err(diagnostic) = b {
            // The error comes from inside the module and names its file and line.
            assert!(diagnostic.explanation.contains("scripts/world/counter.luau\"]:6: overflow"), "{}", diagnostic.explanation);
            return;
        }
        assert_eq!(observation_digest(&source.observe()).unwrap(), observation_digest(&bytecode.observe()).unwrap());
    }
    panic!("the fixture should reach its scripted error");
}

#[cfg(not(any(feature = "dev-tools", feature = "preview-tools")))]
#[test]
fn players_reject_module_bytecode_from_another_compiler_or_a_bad_layout() {
    let (decl, bytes) = compiled_modules();
    let rejected = |decl: &ScriptModuleBytecodeDecl, bytes: &[u8]| error(load_value(&modules_payload(None, false, Some(decl)), staged_modules(bytes)));
    let other = ScriptModuleBytecodeDecl { format: decl.format.replace("/o2/", "/o1/"), ..decl.clone() };
    assert!(rejected(&other, &bytes).contains("SCRIPT_BYTECODE_INCOMPATIBLE"));
    assert!(rejected(&decl, &bytes[..bytes.len() - 1]).contains("SCRIPT_BYTECODE_INVALID"));
    // Module lengths must cover the file exactly, and no module is empty.
    let mut longer = decl.clone();
    *longer.modules.get_mut("shared.luau").unwrap() += 1;
    assert!(rejected(&longer, &bytes).contains("SCRIPT_BYTECODE_INVALID"));
    let mut empty = decl.clone();
    empty.modules.insert("shared.luau".into(), 0);
    empty.modules.insert("world/counter.luau".into(), bytes.len());
    let message = rejected(&empty, &bytes);
    assert!(message.contains("SCRIPT_BYTECODE_INVALID") && message.contains("shared.luau"), "{message}");
}
