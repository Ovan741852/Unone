//! Precompiled entry scripts run exactly like source compiled at load, and a
//! player admits them only with a matching compiler identity and length.
//! Production parity runs on a production feature set:
//! cargo test -p unone-engine --no-default-features --features all-systems --test script_bytecode
use std::collections::BTreeMap;
use unone_engine::{HostProject, InputFrame, ScriptBytecodeDecl, SCRIPT_BYTECODE_DATA_ID, compile_production_script, observation_digest};

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
