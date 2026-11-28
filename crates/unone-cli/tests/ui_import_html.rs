use serde_json::{Value, json};
use std::{fs, process::Command};

// Exercise independent paths and arguments through the actual installed command.
#[test]
fn installed_cli_forwards_html_import_to_its_sdk_tool() {
    let sdk = tempfile::tempdir().unwrap();
    let bin = sdk.path().join("bin");
    let tool = sdk.path().join("tools/html-view");
    fs::create_dir_all(&bin).unwrap();
    fs::create_dir_all(&tool).unwrap();
    fs::write(sdk.path().join("sdk.json"), "{}").unwrap();
    let executable = bin.join(format!("game{}", std::env::consts::EXE_SUFFIX));
    fs::copy(env!("CARGO_BIN_EXE_game"), &executable).unwrap();
    fs::write(
        tool.join("cli.mjs"),
        r#"
        const args = process.argv.slice(2);
        if (args.includes('--help')) console.log('import-html: --file --selector --viewport --out');
        else {
            console.log(JSON.stringify({args, cwd: process.cwd()}));
            console.error('import diagnostic'); process.exitCode = 7;
        }
    "#,
    )
    .unwrap();
    let work = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new(&executable)
            .current_dir(work.path())
            .env_remove("UNONE_SDK_ROOT")
            .args(["ui", "import-html"])
            .args(args)
            .output()
            .unwrap()
    };
    let help = run(&["--help"]);
    assert!(
        help.status.success(),
        "{}",
        String::from_utf8_lossy(&help.stderr)
    );
    assert!(String::from_utf8_lossy(&help.stdout).contains("--selector"));
    let args = [
        "--file",
        "a page.html",
        "--selector",
        "main > .card",
        "--viewport",
        "926x428",
        "--viewport",
        "768x1024",
        "--out",
        "assets/來源",
        "--touch",
    ];
    let result = run(&args);
    assert_eq!(result.status.code(), Some(7));
    let child = serde_json::from_slice::<Value>(&result.stdout).unwrap();
    assert_eq!(child["args"], json!(args));
    assert_eq!(
        std::path::Path::new(child["cwd"].as_str().unwrap()),
        work.path()
    );
    assert!(String::from_utf8_lossy(&result.stderr).contains("import diagnostic"));
}
