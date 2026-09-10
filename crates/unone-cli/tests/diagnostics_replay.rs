use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

fn fixture() -> (tempfile::TempDir, Value) {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("project.unone.json"),
        include_str!("../../../docs/fixtures/diagnostics/project/project.unone.json"),
    )
    .unwrap();
    fs::write(
        dir.path().join("main.luau"),
        include_str!("../../../docs/fixtures/diagnostics/project/main.luau"),
    )
    .unwrap();
    let target = command(dir.path(), &["replay", "fingerprint"]);
    let schema = include_str!("../../../docs/fixtures/diagnostics/scenario.schema.json");
    let hash = format!("sha256:{:x}", Sha256::digest(schema.as_bytes()));
    let r = json!({"reproduction":{"schemaVersion":1,"mode":"exact_version","game":target["game"],"engine":target["engine"],"assets":target["assets"],
        "scenarioSchema":{"schemaRef":"https://unone.dev/examples/counter.scenario.v1","id":"https://unone.dev/examples/counter.scenario.v1","version":1,"hash":hash},
        "captureOrigin":{"kind":"start"},"seed":"18446744073709551615","scenario":{"initialCount":0},
        "inputs":{"schemaRef":"https://unone.dev/schema/input.schema.json","startTick":0,"frames":[{},{},{}],"completeThroughTick":2,"complete":true,"truncated":false},
        "expected":{"kind":"invariant","id":"counter","expectedValue":3,"endCondition":{"kind":"after_tick","tick":2}},"adapter":{"id":"example.counter","version":"1"}},
        "target":target,"scenarioSchema":schema,"mode":"exact_version","maxTicks":3,"timeoutMs":60000});
    (dir, r)
}
fn command(project: &Path, args: &[&str]) -> Value {
    let out = Command::new(env!("CARGO_BIN_EXE_game"))
        .arg("--project")
        .arg(project)
        .arg("--json")
        .args(args)
        .output()
        .unwrap();
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(out.status.success(), v["ok"].as_bool().unwrap(), "{v}");
    assert!(!v["value"].is_null(), "{v}");
    if args.get(1) == Some(&"scenario") {
        let value = &v["value"];
        let passed = matches!(
            value["status"].as_str(),
            Some("reproduced" | "not_reproduced")
        ) && matches!(
            value["regressionStatus"].as_str(),
            Some("passed" | "not_evaluated")
        );
        assert_eq!(v["ok"], passed, "{v}");
        let schema: Value =
            serde_json::from_str(include_str!("../../../docs/replay-result.schema.json")).unwrap();
        jsonschema::validator_for(&schema)
            .unwrap()
            .validate(value)
            .unwrap();
    }
    v["value"].clone()
}
fn replay(dir: &Path, r: &Value) -> Value {
    let input = dir.join("request.json");
    fs::write(&input, serde_json::to_vec(r).unwrap()).unwrap();
    command(
        dir,
        &["replay", "scenario", "--request", input.to_str().unwrap()],
    )
}
#[test]
fn real_runtime_reproduces_override_regression_and_never_pads_inputs() {
    let (d, mut r) = fixture();
    let p = replay(d.path(), &r);
    assert_eq!(p["status"], "reproduced", "{p}");
    assert_eq!(p["regressionStatus"], "not_evaluated");
    assert_eq!(p["ticksExecuted"], 3);
    r["expectedOverride"] = json!({"kind":"invariant","id":"counter","expectedValue":4,"endCondition":{"kind":"after_tick","tick":2}});
    r["regressionChecks"] =
        json!([{"id":"counter","expectedValue":3,"endCondition":{"kind":"after_tick","tick":2}}]);
    let p = replay(d.path(), &r);
    assert_eq!(p["status"], "not_reproduced", "{p}");
    assert_eq!(p["originalMatcher"]["matched"], true);
    assert_eq!(p["regressionStatus"], "passed");
    r["regressionChecks"][0]["id"] = json!("missing");
    assert_eq!(replay(d.path(), &r)["regressionStatus"], "incomplete");
    r["reproduction"]["inputs"]["frames"] = json!([{}]);
    assert_eq!(replay(d.path(), &r)["status"], "incomplete");
}
#[test]
fn rejects_bad_schema_and_versions_and_preserves_capture() {
    let (d, mut r) = fixture();
    r["reproduction"]["scenario"]["initialCount"] = json!("bad");
    assert_eq!(replay(d.path(), &r)["status"], "incompatible");
    r["reproduction"]["scenario"]["initialCount"] = json!(0);
    r["reproduction"]["game"]["revision"] = json!("old");
    assert_eq!(replay(d.path(), &r)["status"], "incompatible");
    r["mode"] = json!("compatible_version");
    let p = replay(d.path(), &r);
    assert_eq!(p["status"], "reproduced", "{p}");
    let after: Value =
        serde_json::from_slice(&fs::read(d.path().join("request.json")).unwrap()).unwrap();
    assert_eq!(after, r);
    r["maxTicks"] = json!(1);
    assert_eq!(replay(d.path(), &r)["status"], "incomplete");
}
#[test]
fn kills_start_and_restore_hangs_and_separates_unexpected_crashes() {
    let (d, mut r) = fixture();
    let source = fs::read_to_string(d.path().join("main.luau")).unwrap();
    for from in [
        "function Game.start(api) end",
        "restore = function(capture, api)",
    ] {
        let replacement = if from.starts_with("function") {
            "function Game.start(api) while true do end end"
        } else {
            "restore = function(capture, api) while true do end"
        };
        fs::write(
            d.path().join("main.luau"),
            source.replace(from, replacement),
        )
        .unwrap();
        r["target"] = command(d.path(), &["replay", "fingerprint"]);
        for key in ["game", "engine", "assets"] {
            r["reproduction"][key] = r["target"][key].clone();
        }
        r["timeoutMs"] = json!(1500);
        let p = replay(d.path(), &r);
        assert_eq!(p["status"], "incomplete", "{p}");
        assert!(p["reason"].as_str().unwrap().contains("timeout"));
    }
    fs::write(
        d.path().join("main.luau"),
        source.replace("ticks += 1", "error('unexpected crash')"),
    )
    .unwrap();
    r["target"] = command(d.path(), &["replay", "fingerprint"]);
    for key in ["game", "engine", "assets"] {
        r["reproduction"][key] = r["target"][key].clone();
    }
    r["timeoutMs"] = json!(60000);
    assert_eq!(replay(d.path(), &r)["status"], "execution_failed");
}
#[test]
fn asset_content_changes_identity_even_when_manifest_does_not() {
    let (d, _) = fixture();
    let config = json!({"name":"assets","entry_script":"main.luau","asset_manifest":"assets.json"});
    fs::write(d.path().join("project.unone.json"), config.to_string()).unwrap();
    fs::write(
        d.path().join("assets.json"),
        r#"{"assets":[{"id":"x","source":"x.bin"}]}"#,
    )
    .unwrap();
    let file: PathBuf = d.path().join("x.bin");
    fs::write(&file, "one").unwrap();
    let before = command(d.path(), &["replay", "fingerprint"]);
    fs::write(file, "two").unwrap();
    let after = command(d.path(), &["replay", "fingerprint"]);
    assert_ne!(before["assets"], after["assets"]);
}

#[test]
fn bundle_script_entries_do_not_pollute_asset_identity() {
    let (d, _) = fixture();
    fs::write(
        d.path().join("project.unone.json"),
        r#"{"name":"bundled","entry_script":"main.luau","bundle_manifest":"bundles.json"}"#,
    )
    .unwrap();
    let mut manifest = json!({"version":1,"bundles":[{"id":"script","version":"1","source":"main.luau","sha256":"old","size_bytes":10}]});
    fs::write(d.path().join("bundles.json"), manifest.to_string()).unwrap();
    let before = command(d.path(), &["replay", "fingerprint"]);
    let main = fs::read_to_string(d.path().join("main.luau")).unwrap();
    fs::write(
        d.path().join("main.luau"),
        format!("{main}\n-- only source changed\n"),
    )
    .unwrap();
    manifest["bundles"][0]["sha256"] = json!("new");
    fs::write(d.path().join("bundles.json"), manifest.to_string()).unwrap();
    let after = command(d.path(), &["replay", "fingerprint"]);
    assert_eq!(before["assets"], after["assets"]);
    assert_ne!(before["game"], after["game"]);
}

#[test]
fn missing_evidence_and_checkpoint_never_prove_absence() {
    let (d, mut r) = fixture();
    r["reproduction"]["captureOrigin"] =
        json!({"kind":"checkpoint","tick":0,"rngOwnership":"core_rng"});
    r["reproduction"]["initialState"] = json!({"some":"state"});
    assert_eq!(replay(d.path(), &r)["status"], "incomplete");
    r["reproduction"]["captureOrigin"] = json!({"kind":"start"});
    let source = fs::read_to_string(d.path().join("main.luau")).unwrap();
    fs::write(
        d.path().join("main.luau"),
        source.replace(
            "return {invariants = {counter = ticks, retained = #held}, diagnostics = {}}",
            "return {}",
        ),
    )
    .unwrap();
    r["target"] = command(d.path(), &["replay", "fingerprint"]);
    for key in ["game", "engine", "assets"] {
        r["reproduction"][key] = r["target"][key].clone();
    }
    r["reproduction"]["expected"] = json!({"kind":"diagnostic","code":"absent","flag":"absent","endCondition":{"kind":"after_tick","tick":2}});
    assert_eq!(replay(d.path(), &r)["status"], "incomplete");
    fs::remove_file(d.path().join("main.luau")).unwrap();
    assert_eq!(replay(d.path(), &r)["status"], "execution_failed");
}

#[cfg(windows)]
#[test]
fn parent_termination_kills_infinite_worker_via_job() {
    use std::{os::windows::process::CommandExt,process::{Child,Stdio}};
    use windows_sys::Win32::{Foundation::{CloseHandle,WAIT_OBJECT_0},System::Threading::{OpenProcess,WaitForSingleObject,PROCESS_SYNCHRONIZE}};
    struct Cleanup(Child);
    impl Drop for Cleanup {fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
    let (d,mut r)=fixture();
    let source=fs::read_to_string(d.path().join("main.luau")).unwrap();
    fs::write(d.path().join("main.luau"),source.replace("function Game.start(api) end","function Game.start(api) while true do end end")).unwrap();
    r["target"]=command(d.path(),&["replay","fingerprint"]);
    for key in ["game","engine","assets"] {r["reproduction"][key]=r["target"][key].clone();}
    let input=d.path().join("request.json");fs::write(&input,r.to_string()).unwrap();
    let mut parent=Cleanup(Command::new(env!("CARGO_BIN_EXE_game")).arg("--project").arg(d.path()).args(["--json","replay","scenario","--request"]).arg(input)
        .env("TEMP",d.path()).env("TMP",d.path()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(0x08000000).spawn().unwrap());
    let query=format!("Get-CimInstance Win32_Process -Filter 'ParentProcessId = {}' | Where-Object {{ $_.CommandLine -like '*scenario-worker*' }} | Select-Object -ExpandProperty ProcessId",parent.0.id());
    let mut worker=None;
    for _ in 0..5 {
        let q=Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command",&query]).creation_flags(0x08000000).output().unwrap();
        if let Ok(pid)=String::from_utf8_lossy(&q.stdout).trim().parse::<u32>() {worker=Some(pid);break;}
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let worker=worker.expect("The isolated worker must start before its parent is killed");
    let handle=unsafe{OpenProcess(PROCESS_SYNCHRONIZE,0,worker)};
    assert!(!handle.is_null(),"Must observe live worker handle");
    parent.0.kill().unwrap();parent.0.wait().unwrap();
    let status=unsafe{WaitForSingleObject(handle,3000)};
    unsafe{CloseHandle(handle);}
    assert_eq!(status,WAIT_OBJECT_0,"Worker must terminate with parent, not wait for 60-second watchdog");
}
