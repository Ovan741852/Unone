use std::{fs, path::Path, process::{Command, Output}};
use serde_json::{Value, json};

fn cli(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_game")).arg("--project").arg(root).arg("--json").args(args).output().unwrap()
}

fn update(root: &Path, script: &str) -> (bool, Value) {
    let output=cli(root,&["api","typings","--update-script",script]);
    let value=serde_json::from_slice(&output.stdout).unwrap_or_else(|error| panic!("invalid CLI JSON {error}: {}",String::from_utf8_lossy(&output.stderr)));
    (output.status.success(),value)
}

#[test]
fn explicit_script_refresh_preserves_game_bytes_and_crlf_and_is_idempotent() {
    let directory=tempfile::tempdir().unwrap();
    let script=directory.path().join("gameplay.luau");
    let prefix="\u{feff}--!strict\r\n-- 星艦 UI\r\n";
    let suffix="\r\n\r\nlocal Game={}\r\nlocal title='月球 → 🚀'\r\nreturn Game";
    let before=format!("{prefix}-- BEGIN UNONE API TYPES\r\nexport type EngineApi=any\r\n-- END UNONE API TYPES{suffix}");
    fs::write(&script,&before).unwrap();
    let (success,result)=update(directory.path(),"gameplay.luau");
    assert!(success,"{result}");
    assert_eq!(result["value"]["changed"],true);
    assert_eq!(result["value"]["script"],"gameplay.luau");
    assert_eq!(result["value"]["bytes_before"],json!(before.len()));
    let expected=format!("{prefix}{}{suffix}",unone_engine::api_typings_block().replace('\n',"\r\n"));
    assert_eq!(fs::read(&script).unwrap(),expected.as_bytes());
    let modified=fs::metadata(&script).unwrap().modified().unwrap();
    let (success,result)=update(directory.path(),"gameplay.luau");
    assert!(success,"{result}");
    assert_eq!(result["value"]["changed"],false);
    assert_eq!(result["effects"],json!([]));
    assert_eq!(fs::metadata(&script).unwrap().modified().unwrap(),modified);
}

#[test]
fn malformed_or_unmarked_scripts_fail_without_modifying_any_bytes() {
    let directory=tempfile::tempdir().unwrap();
    let script=directory.path().join("gameplay.luau");
    for source in [
        "--!strict\nlocal ui:any={}\nreturn ui".to_string(),
        "-- END UNONE API TYPES\n-- BEGIN UNONE API TYPES".to_string(),
        "-- BEGIN UNONE API TYPES\n-- BEGIN UNONE API TYPES\n-- END UNONE API TYPES".to_string(),
        "-- BEGIN UNONE API TYPES\nlocal text='-- END UNONE API TYPES'".to_string(),
    ] {
        fs::write(&script,source.as_bytes()).unwrap();
        let (success,result)=update(directory.path(),"gameplay.luau");
        assert!(!success,"{result}");
        assert_eq!(result["diagnostics"][0]["code"],"API_TYPINGS_MARKERS_INVALID");
        assert_eq!(result["diagnostics"][0]["facts"]["changed"],false);
        assert_eq!(fs::read(&script).unwrap(),source.as_bytes());
    }
}

#[test]
fn missing_targets_and_unsafe_paths_are_not_created_or_written() {
    let directory=tempfile::tempdir().unwrap();
    let root=directory.path().join("project");
    fs::create_dir(&root).unwrap();
    let outside=directory.path().join("outside.luau");
    fs::write(&outside,"outside must survive").unwrap();
    for path in ["../outside.luau","/outside.luau","C:/outside.luau","scripts\\main.luau","scripts/../main.luau"] {
        let (success,result)=update(&root,path);
        assert!(!success,"{path}: {result}");
        assert_eq!(result["diagnostics"][0]["code"],"PROJECT_PATH_OUTSIDE_PROJECT");
    }
    let (success,result)=update(&root,"missing/main.luau");
    assert!(!success,"{result}");
    assert_eq!(result["diagnostics"][0]["code"],"API_TYPINGS_SCRIPT_READ_FAILED");
    assert!(!root.join("missing").exists());
    assert_eq!(fs::read_to_string(outside).unwrap(),"outside must survive");
}

#[test]
fn update_script_conflicts_with_output_and_leaves_both_paths_untouched() {
    let directory=tempfile::tempdir().unwrap();
    let script=directory.path().join("gameplay.luau");
    fs::write(&script,"original script").unwrap();
    let output_path=directory.path().join("types.luau");
    let output=cli(directory.path(),&["api","typings","--update-script","gameplay.luau","--output",output_path.to_str().unwrap()]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("cannot be used with"));
    assert!(!output_path.exists());
    assert_eq!(fs::read_to_string(script).unwrap(),"original script");
}

#[test]
fn project_init_uses_the_shared_marked_block_and_existing_typings_modes_are_unchanged() {
    let directory=tempfile::tempdir().unwrap();
    let project=directory.path().join("new-project");
    let initialized=cli(&project,&["project","init","--name","type-refresh"]);
    assert!(initialized.status.success(),"{}",String::from_utf8_lossy(&initialized.stdout));
    let source=fs::read_to_string(project.join("scripts/main.luau")).unwrap();
    assert!(source.starts_with("--!strict\n"));
    assert!(source.contains(&unone_engine::api_typings_block()));
    let (success,result)=update(&project,"scripts/main.luau");
    assert!(success,"{result}");
    assert_eq!(result["value"]["changed"],false);
    let stdout=cli(&project,&["api","typings"]);
    let result:Value=serde_json::from_slice(&stdout.stdout).unwrap();
    assert!(stdout.status.success());
    assert_eq!(result["value"]["typings"],unone_engine::api_typings());
    let output_path=directory.path().join("separate-types.luau");
    let output=cli(&project,&["api","typings","--output",output_path.to_str().unwrap()]);
    assert!(output.status.success());
    assert_eq!(fs::read_to_string(output_path).unwrap(),unone_engine::api_typings());
}

#[test]
#[cfg(unix)]
fn a_symlink_cannot_redirect_type_refresh_outside_the_project() {
    let directory=tempfile::tempdir().unwrap();
    let project=directory.path().join("project");
    fs::create_dir(&project).unwrap();
    let outside=directory.path().join("outside.luau");
    fs::write(&outside,"outside must survive").unwrap();
    std::os::unix::fs::symlink(&outside,project.join("main.luau")).unwrap();
    let (success,result)=update(&project,"main.luau");
    assert!(!success,"{result}");
    assert_eq!(result["diagnostics"][0]["code"],"PROJECT_PATH_OUTSIDE_PROJECT");
    assert_eq!(fs::read_to_string(outside).unwrap(),"outside must survive");
}
