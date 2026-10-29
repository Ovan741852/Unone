use std::fs;
use clap::Parser;
use serde_json::{Value,json};
use super::{Cli,Command,UiCommand};

#[test]
fn ui_preview_fixture_cli_accepts_explicit_portable_save_path() {
    let cli=Cli::try_parse_from(["game","ui","preview","--save-fixture","fixtures/saved state.json","--strict"]).unwrap();
    match cli.command {
        Command::Ui{command:UiCommand::Preview{save_fixture,strict,..}}=>{
            assert_eq!(save_fixture.as_deref(),Some("fixtures/saved state.json"));assert!(strict);
        }
        _=>panic!("wrong subcommand"),
    }
    let cli=Cli::try_parse_from(["game","ui","preview"]).unwrap();
    match cli.command {
        Command::Ui{command:UiCommand::Preview{save_fixture,..}}=>assert!(save_fixture.is_none()),
        _=>panic!("wrong subcommand"),
    }
}

#[test]
fn ui_preview_fixture_export_content_strips_metadata_and_never_collects_qa_save_files() {
    let dir=tempfile::tempdir().unwrap();fs::create_dir(dir.path().join("fixtures")).unwrap();
    let secret=b"{\"test_marker\":\"QA_PRIVATE_SAVE_BYTES\"}";
    fs::write(dir.path().join("fixtures/private.json"),secret).unwrap();
    fs::write(dir.path().join("main.luau"),"return {start=function(api) api.observation.set('restored',api.save.get() or false) end,update=function()end}").unwrap();
    let config=json!({"name":"export preview fixture","entry_script":"main.luau",
        "ui_previews":[{"name":"authoring only","save_fixture":"fixtures/private.json"}]});
    fs::write(dir.path().join("project.unone.json"),serde_json::to_vec(&config).unwrap()).unwrap();
    let (authoring_config,_,_,files)=super::export::content(dir.path()).unwrap();
    assert_eq!(authoring_config.ui_previews[0].save_fixture.as_deref(),Some("fixtures/private.json"));
    assert_eq!(files.len(),2,"only project and empty asset manifest should be copied");
    let payload:Value=serde_json::from_slice(&files.iter().find(|(path,_)|path=="content/project.json").unwrap().1).unwrap();
    assert!(payload["config"]["ui_previews"][0].get("save_fixture").is_none());
    for (path,bytes) in &files {
        assert!(!path.contains("private.json"));
        let text=String::from_utf8_lossy(bytes);
        assert!(!text.contains("save_fixture")&&!text.contains("private.json")&&!text.contains("QA_PRIVATE_SAVE_BYTES"));
    }
    let runtime=unone_engine::HostProject::parse(&serde_json::to_vec(&payload).unwrap()).unwrap().into_runtime(42).unwrap();
    assert_eq!(runtime.observe().observations["restored"],false,"exported production boot must use fresh state");
    // A declared fixture is not required at production export time.
    fs::remove_file(dir.path().join("fixtures/private.json")).unwrap();
    super::export::content(dir.path()).unwrap();
}
