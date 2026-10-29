#![cfg(feature = "dev-tools")]
use std::fs;
use serde_json::{Value,json};
use unone_engine::{EngineRuntime,ProjectConfig,StepStatus};

fn fixture() -> tempfile::TempDir {
    let dir=tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("fixtures")).unwrap();
    fs::write(dir.path().join("project.unone.json"),serde_json::to_vec(&json!({
        "name":"saved UI fixture","entry_script":"main.luau","verify":{"steps":["layout"]},
        "ui_previews":[{"name":"saved screen","frames":1,"save_fixture":"fixtures/saved state.json"}]
    })).unwrap()).unwrap();
    fs::write(dir.path().join("fixtures/saved state.json"),r#"{"screen":"workshop","coins":17}"#).unwrap();
    fs::write(dir.path().join("main.luau"),r#"
local Game={}
function Game.start(api)
    local saved=api.save.get()
    local screen=if saved then saved.screen else "fresh"
    api.observation.set("restoredInStart",saved or false)
    api.ui.setRoot({kind="screen",id=screen,node="fixture",children={{kind="text",id=screen.."-title",text=screen,rect={x=10,y=70,width=60,height=10}}}})
end
function Game.update(api,_dt)
    if api.input.wasPressed("Next") then
        api.ui.setRoot({kind="screen",id="next",node="fixture",children={{kind="text",id="next-title",text="next",rect={x=10,y=70,width=60,height=10}}}})
    end
end
return Game
"#).unwrap();dir
}

#[test]
fn ui_preview_fixture_restores_before_start_and_preserves_fresh_default() {
    let dir=fixture();
    let loaded=EngineRuntime::load_ui_preview(dir.path(),42,Some("fixtures/saved state.json")).unwrap();
    assert_eq!(loaded.observe().observations["restoredInStart"],json!({"screen":"workshop","coins":17}));
    assert_eq!(loaded.observe().ui.unwrap().id,"workshop");
    let fresh=EngineRuntime::load_ui_preview(dir.path(),42,None).unwrap();
    let ordinary=EngineRuntime::load_with_seed(dir.path(),42).unwrap();
    assert_eq!(fresh.observe().ui,ordinary.observe().ui);
    assert_eq!(fresh.observe().ui.unwrap().id,"fresh");
}

#[test]
fn ui_preview_fixture_verify_uses_saved_state_then_input_replay() {
    let dir=fixture();let config_path=dir.path().join("project.unone.json");
    let result=unone_engine::verify(dir.path());assert!(result.ok,"{:?}",result.diagnostics);
    let step=&result.value.unwrap().steps[0];assert_eq!(step.status,StepStatus::Passed);
    assert!(step.summary.contains("workshop-title"));assert!(step.command.contains("--save-fixture \"fixtures/saved state.json\""));
    let mut config:Value=serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
    config["ui_previews"][0]["input_sequence"]=json!("fixtures/input.json");
    fs::write(dir.path().join("fixtures/input.json"),r#"[{"actions":{"Next":true}}]"#).unwrap();
    fs::write(&config_path,serde_json::to_vec(&config).unwrap()).unwrap();
    let result=unone_engine::verify(dir.path());assert!(result.ok,"{:?}",result.diagnostics);
    assert!(result.value.unwrap().steps[0].summary.contains("next-title"));
}

#[test]
fn ui_preview_fixture_reports_invalid_json_missing_files_and_unsafe_paths() {
    let dir=fixture();fs::write(dir.path().join("fixtures/broken.json"),b"{bad").unwrap();
    for (path,code) in [("fixtures/broken.json","UI_SAVE_FIXTURE_INVALID_JSON"),
        ("fixtures/missing.json","UI_SAVE_FIXTURE_READ_FAILED"),("../outside.json","UI_SAVE_FIXTURE_PATH_INVALID"),
        ("/absolute.json","UI_SAVE_FIXTURE_PATH_INVALID"),("C:/absolute.json","UI_SAVE_FIXTURE_PATH_INVALID"),
        ("fixtures\\saved state.json","UI_SAVE_FIXTURE_PATH_INVALID"),("fixtures/./saved state.json","UI_SAVE_FIXTURE_PATH_INVALID")]{
        let error=match EngineRuntime::load_ui_preview(dir.path(),42,Some(path)){Ok(_)=>panic!("accepted {path}"),Err(e)=>e};
        assert_eq!(error.code,code,"{path}");
    }
    let config_path=dir.path().join("project.unone.json");
    let mut config:Value=serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
    config["ui_previews"][0]["save_fixture"]=json!("fixtures/broken.json");
    fs::write(config_path,serde_json::to_vec(&config).unwrap()).unwrap();
    let report=unone_engine::verify(dir.path());assert!(!report.ok);
    assert_eq!(report.value.unwrap().steps[0].diagnostics[0].code,"UI_SAVE_FIXTURE_INVALID_JSON");
}

#[test]
fn ui_preview_fixture_supports_unicode_space_paths_without_modifying_inputs() {
    let dir=fixture();let name="fixtures/門派 saved state.json";
    let bytes=fs::read(dir.path().join("fixtures/saved state.json")).unwrap();
    fs::write(dir.path().join(name),&bytes).unwrap();
    let before=fs::read(dir.path().join("project.unone.json")).unwrap();
    let runtime=EngineRuntime::load_ui_preview(dir.path(),17,Some(name)).unwrap();
    assert_eq!(runtime.observe().ui.unwrap().id,"workshop");
    assert_eq!(fs::read(dir.path().join(name)).unwrap(),bytes);
    assert_eq!(fs::read(dir.path().join("project.unone.json")).unwrap(),before);
}

#[test]
fn ui_preview_fixture_metadata_is_deserialization_only_and_schema_declared() {
    let value=json!({"name":"project","ui_previews":[{"name":"preview","save_fixture":"fixtures/private.json"}]});
    let config:ProjectConfig=serde_json::from_value(value).unwrap();
    assert_eq!(config.ui_previews[0].save_fixture.as_deref(),Some("fixtures/private.json"));
    let encoded=serde_json::to_value(config).unwrap();
    assert!(encoded["ui_previews"][0].get("save_fixture").is_none());
    let schema=unone_engine::contract_schema("project").unwrap();
    assert_eq!(schema["$defs"]["UiPreviewSpec"]["properties"]["save_fixture"]["writeOnly"],true);
}

#[cfg(unix)]
#[test]
fn ui_preview_fixture_cannot_follow_a_symlink_outside_the_project() {
    let dir=fixture();let outside=tempfile::tempdir().unwrap();
    fs::write(outside.path().join("save.json"),"{}").unwrap();
    std::os::unix::fs::symlink(outside.path(),dir.path().join("linked")).unwrap();
    let error=match EngineRuntime::load_ui_preview(dir.path(),42,Some("linked/save.json")){Ok(_)=>panic!("escaped root"),Err(e)=>e};
    assert_eq!(error.code,"UI_SAVE_FIXTURE_PATH_INVALID");
    let error=match EngineRuntime::load_ui_preview(dir.path(),42,Some("linked/missing/save.json")){Ok(_)=>panic!("escaped parent"),Err(e)=>e};
    assert_eq!(error.code,"UI_SAVE_FIXTURE_PATH_INVALID");
}

#[cfg(windows)]
#[test]
fn ui_preview_fixture_cannot_follow_a_windows_symlink_outside_the_project() {
    let dir=fixture();let outside=tempfile::tempdir().unwrap();
    fs::write(outside.path().join("save.json"),"{}").unwrap();
    let linked=dir.path().join("linked");
    if let Err(error)=std::os::windows::fs::symlink_dir(outside.path(),&linked) {
        eprintln!("Windows symlink creation unavailable ({error}); exercising a directory junction instead");
        let output=std::process::Command::new("cmd.exe").args(["/d","/c","mklink","/J"])
            .arg(&linked).arg(outside.path()).output().unwrap();
        assert!(output.status.success(),"could not create test junction: {}",String::from_utf8_lossy(&output.stderr));
    }
    for path in ["linked/save.json","linked/missing/save.json"] {
        let error=match EngineRuntime::load_ui_preview(dir.path(),42,Some(path)){Ok(_)=>panic!("escaped {path}"),Err(e)=>e};
        assert_eq!(error.code,"UI_SAVE_FIXTURE_PATH_INVALID");
    }
    fs::remove_dir(linked).unwrap();
    eprintln!("MEASURED Windows directory-link target and missing descendant containment");
}
