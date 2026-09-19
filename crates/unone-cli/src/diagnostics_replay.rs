//! Headless replay orchestration. Fresh process + immutable staged inputs; no gameplay rules.
use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use unone_engine::{
    Diagnostic, EngineResult, EngineRuntime, InputFrame, PreviewRequest, ProjectConfig,
};

#[cfg(windows)]
mod worker_lifetime {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::JobObjects::*,
    };
    pub(super) struct Guard(HANDLE);
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    pub(super) fn bind(child: &std::process::Child) -> Result<Guard> {
        // Non-inheritable, unnamed handle. Only the parent owns the Job.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let guard = Guard(handle);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            )
        };
        if configured == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        if unsafe { AssignProcessToJobObject(handle, child.as_raw_handle()) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(guard)
    }
}

const MAX_JSON: u64 = 8 * 1024 * 1024;
const MAX_TICKS: u64 = 100_000;
#[derive(Debug)]
struct ReplayFault {
    status: &'static str,
    detail: String,
}
impl std::fmt::Display for ReplayFault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.detail.fmt(f)
    }
}
impl std::error::Error for ReplayFault {}
fn fault(status: &'static str, detail: impl ToString) -> anyhow::Error {
    ReplayFault {
        status,
        detail: detail.to_string(),
    }
    .into()
}
fn outcome(value: Value) -> EngineResult<Value> {
    let complete = matches!(
        value["status"].as_str(),
        Some("reproduced" | "not_reproduced")
    ) && matches!(
        value["regressionStatus"].as_str(),
        Some("passed" | "not_evaluated")
    );
    let mut report = EngineResult::success(value);
    if !complete {
        report.ok = false;
        report.diagnostics.push(Diagnostic::error(
            "REPLAY_GATE_NOT_PASSED",
            "Replay or regression evaluation did not complete successfully",
            report.value.as_ref().unwrap()["reason"]
                .as_str()
                .unwrap_or("Inspect status and regressionStatus"),
        ));
    }
    report
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    reproduction: Value,
    target: Value,
    scenario_schema: String,
    mode: String,
    #[serde(default)]
    expected_override: Option<Value>,
    #[serde(default)]
    regression_checks: Vec<Value>,
    max_ticks: u64,
    timeout_ms: u64,
    #[serde(default)]
    memory: Option<MemoryOptions>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MemoryOptions {
    sample_every_ticks: u64,
    warmup_ticks: u64,
    collect: bool,
    label: String,
}

fn failure(error: impl std::fmt::Display) -> EngineResult<Value> {
    EngineResult::failure(Diagnostic::error(
        "REPLAY_REQUEST_FAILED",
        "Cannot run diagnostic replay",
        error.to_string(),
    ))
}
fn result(status: &str, reason: &str) -> Value {
    json!({"schemaVersion":1,"status":status,"reason":reason,"regressionStatus":"not_evaluated",
        "mode":null,"source":null,"target":null,"adapter":null,"ticksExecuted":null,"backend":"headless_native",
        "statusMatcher":null,"originalMatcher":null,"overrideMatcher":null,"regressionChecks":[],
        "performance":null,"memory":null,"memoryOptions":null,"adapterInspectWallMs":null,"samplingScope":null,"limitations":[]})
}
fn version_mismatch(reason: &str, expected: &Value, actual: &Value) -> Value {
    let fields = [
        "/game/id",
        "/game/revision",
        "/game/scriptHash",
        "/engine/version",
        "/engine/coreRevision",
        "/assets/manifestHash",
    ];
    let differences: Vec<_> = fields
        .into_iter()
        .filter(|p| expected.pointer(p) != actual.pointer(p))
        .map(|p| json!({"path":p,"expected":expected.pointer(p),"actual":actual.pointer(p)}))
        .collect();
    let mut report = result("incompatible", reason);
    report["fingerprintDifferences"] = json!(differences);
    report["actualTarget"] = actual.clone();
    report
}
fn read_json(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&read_bytes(path)?)?)
}
fn read_bytes(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(MAX_JSON + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_JSON {
        bail!("JSON exceeds 8 MiB");
    }
    Ok(bytes)
}
fn hash(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}
fn file_hash(path: &Path) -> Result<String> {
    let mut f = fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = [0; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("sha256:{:x}", h.finalize()))
}
fn safe_path(root: &Path, name: &str) -> Result<PathBuf> {
    if name.is_empty()
        || name.contains(['\\', ':'])
        || name.starts_with('/')
        || name
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
    {
        bail!("Invalid project-relative path: {name}");
    }
    let mut segment = root.to_path_buf();
    for part in name.split('/') {
        segment.push(part);
        if fs::symlink_metadata(&segment)?.file_type().is_symlink() {
            bail!("Symlinks are not supported in replay paths: {name}");
        }
    }
    let p = root
        .join(name)
        .canonicalize()
        .with_context(|| format!("Missing project file {name}"))?;
    if !p.starts_with(root) {
        bail!("File escapes project: {name}");
    }
    Ok(p)
}
fn script_files(
    root: &Path,
    dir: &Path,
    names: &mut BTreeSet<String>,
    visited: &mut usize,
) -> Result<()> {
    for e in fs::read_dir(dir)? {
        *visited += 1;
        if *visited > 50000 {
            return Err(fault("incomplete", "Project scan exceeds 50000 entries"));
        }
        let e = e?;
        let p = e.path();
        let ty = e.file_type()?;
        if ty.is_symlink() {
            bail!(
                "Replay requires a self-contained project without symlinks: {}",
                p.display()
            );
        }
        if ty.is_dir() {
            if ![".git", ".unone", "node_modules", "target", "dist", "build"]
                .contains(&e.file_name().to_string_lossy().as_ref())
            {
                script_files(root, &p, names, visited)?;
            }
        } else if p.extension().is_some_and(|s| s == "luau" || s == "lua") {
            names.insert(
                p.strip_prefix(root)?
                    .to_str()
                    .context("Non-UTF8 source path")?
                    .replace('\\', "/"),
            );
        }
    }
    Ok(())
}
// All payload bytes are copied first, then hashed from the private snapshot. This
// also prevents edits during replay from producing a report for different bytes.
fn stage(root: &Path) -> Result<(tempfile::TempDir, Value)> {
    let root = root.canonicalize()?;
    let config_bytes = read_bytes(&safe_path(&root, "project.unone.json")?)?;
    let config: ProjectConfig = serde_json::from_slice(&config_bytes)?;
    let mut frozen_metadata = BTreeMap::from([("project.unone.json".to_string(), config_bytes)]);
    let mut sources = BTreeSet::new();
    script_files(&root, &root, &mut sources, &mut 0)?;
    sources.insert(config.entry_script.clone());
    sources.extend(config.job_scripts.values().cloned());
    let mut assets = BTreeSet::from(["project.unone.json".to_string()]);
    if let Some(p) = &config.main_scene {
        assets.insert(p.clone());
    }
    if let Some(p) = &config.asset_manifest {
        assets.insert(p.clone());
        let bytes = read_bytes(&safe_path(&root, p)?)?;
        let manifest: unone_engine::AssetManifest = serde_json::from_slice(&bytes)?;
        frozen_metadata.insert(p.clone(), bytes);
        for a in manifest.assets {
            assets.insert(a.source);
            assets.extend(a.files);
            if let Some(e) = a.encoding {
                assets.extend(e.companions.into_iter().map(|c| c.path));
            }
        }
    }
    if let Some(p) = &config.bundle_manifest {
        assets.insert(p.clone());
        let bytes = read_bytes(&safe_path(&root, p)?)?;
        let manifest: unone_engine::BundleManifest = serde_json::from_slice(&bytes)?;
        frozen_metadata.insert(p.clone(), bytes);
        for b in manifest.bundles {
            assets.insert(b.source);
        }
    }
    let temp = if let Some(base) = std::env::var_os("UNONE_REPLAY_TEMP_ROOT") {
        tempfile::tempdir_in(base)?
    } else {
        tempfile::tempdir()?
    };
    let mut total = 0u64;
    for name in sources.union(&assets) {
        let p = safe_path(&root, name)?;
        total = total
            .checked_add(fs::metadata(&p)?.len())
            .context("Size overflow")?;
        if total > 2 * 1024 * 1024 * 1024 {
            return Err(fault("incomplete", "Replay snapshot exceeds 2 GiB"));
        }
        let target = temp.path().join(name);
        fs::create_dir_all(target.parent().unwrap())?;
        if let Some(bytes) = frozen_metadata.get(name) {
            fs::write(target, bytes)?;
        } else {
            fs::copy(p, target)?;
        }
    }
    let manifest = |names: &BTreeSet<String>| -> Result<Value> {
        let mut names: Vec<_> = names.iter().collect();
        names.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        let files=names.into_iter().map(|p|Ok(json!({"path":p,"sha256":file_hash(&temp.path().join(p))?.trim_start_matches("sha256:")}))).collect::<Result<Vec<_>>>()?;
        Ok(json!({"schemaVersion":1,"files":files,"entrypoints":[config.entry_script]}))
    };
    let script = manifest(&sources)?;
    // Bundle inventories can list main.luau as a resource. Its bytes belong to
    // scriptHash, not asset identity. Bundle metadata is retained independently
    // in the overall content revision so source/version edits do not masquerade
    // as changed texture/scene payloads.
    let mut asset_files: BTreeSet<_> = assets.difference(&sources).cloned().collect();
    if let Some(p) = &config.bundle_manifest {
        asset_files.remove(p);
    }
    let asset = manifest(&asset_files)?;
    let bundle_hash = config
        .bundle_manifest
        .as_ref()
        .map(|p| file_hash(&temp.path().join(p)))
        .transpose()?;
    let script_hash = hash(&serde_json::to_vec(&script)?);
    let asset_hash = hash(&serde_json::to_vec(&asset)?);
    let identity = json!({"game":{"id":config.name,"revision":hash(&serde_json::to_vec(&json!([script_hash,asset_hash,bundle_hash]))?),"scriptHash":script_hash},
        "engine":{"version":env!("CARGO_PKG_VERSION"),"coreRevision":file_hash(&std::env::current_exe()?)?},
        "assets":{"manifestHash":asset_hash}});
    Ok((temp, identity))
}
pub fn fingerprint_result(project: &Path) -> EngineResult<Value> {
    match stage(project) {
        Ok((_, v)) => EngineResult::success(v),
        Err(e) => failure(e),
    }
}
pub fn describe() -> Value {
    json!({"schemaVersion":1,"guide":include_str!("../../../docs/diagnostics-replay.md"),
        "reproductionSchema":serde_json::from_str::<Value>(include_str!("../../../docs/reproduction.schema.json")).unwrap(),
        "resultSchema":serde_json::from_str::<Value>(include_str!("../../../docs/replay-result.schema.json")).unwrap(),
        "adapterExample":include_str!("../../../docs/fixtures/diagnostics/project/main.luau")})
}
pub fn run(project: &Path, path: &Path) -> EngineResult<Value> {
    match isolated(project, path) {
        Ok(v) => outcome(v),
        Err(e) => failure(e),
    }
}
fn isolated(project: &Path, path: &Path) -> Result<Value> {
    let raw = read_json(path)?;
    let request: Request = serde_json::from_value(raw.clone())?;
    if !(1..=60000).contains(&request.timeout_ms) {
        bail!("timeoutMs must be 1..60000");
    }
    let mut input = tempfile::NamedTempFile::new()?;
    serde_json::to_writer(&mut input, &raw)?;
    input.flush()?;
    let output = tempfile::NamedTempFile::new()?;
    // Parent ownership ensures a killed worker cannot strand its staged assets.
    let staging = tempfile::tempdir()?;
    let mut child = Command::new(std::env::current_exe()?)
        .args(["--project"])
        .arg(project.canonicalize()?)
        .args(["--json", "replay", "scenario-worker", "--request"])
        .arg(input.path())
        .arg("--output")
        .arg(output.path())
        .arg("--timeout-ms")
        .arg(request.timeout_ms.to_string())
        .env("UNONE_REPLAY_TEMP_ROOT", staging.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    // Closing this non-inheritable Job handle kills the child if this parent
    // exits or crashes. Other targets also have the worker's own watchdog.
    #[cfg(windows)]
    let _lifetime = match worker_lifetime::bind(&child) {
        Ok(guard) => guard,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                if status.code() == Some(124) {
                    return Ok(result("incomplete", "Worker watchdog deadline expired"));
                }
                return Ok(result(
                    "execution_failed",
                    "Isolated worker failed; inspect request/schema/project with replay fingerprint",
                ));
            }
            let envelope = read_json(output.path())?;
            return envelope
                .get("value")
                .cloned()
                .filter(|v| !v.is_null())
                .ok_or_else(|| anyhow!("Worker returned no report: {envelope}"));
        }
        if start.elapsed() >= Duration::from_millis(request.timeout_ms) {
            child.kill()?;
            child.wait()?;
            return Ok(result(
                "incomplete",
                "timeoutMs expired, including staging/start/restore/update/inspection; no successful replay verdict",
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
pub fn worker(project: &Path, path: &Path, timeout_ms: u64) -> EngineResult<Value> {
    let (done, wait) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            wait.recv_timeout(Duration::from_millis(timeout_ms.clamp(1, 60000))),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            std::process::exit(124);
        }
    });
    let output = (|| -> Result<Value> {
        let raw = read_json(path)?;
        let request: Request = serde_json::from_value(raw)?;
        execute(project, &request)
    })();
    // Validation errors are data, so even invalid captures get an explicit status.
    let report = outcome(output.unwrap_or_else(|e| {
        let status = e
            .downcast_ref::<ReplayFault>()
            .map(|e| e.status)
            .unwrap_or_else(|| {
                if e.chain().any(|cause| cause.is::<std::io::Error>()) {
                    "execution_failed"
                } else {
                    "incompatible"
                }
            });
        result(status, &e.to_string())
    }));
    let _ = done.send(());
    report
}
struct Offline;
impl jsonschema::Retrieve for Offline {
    fn retrieve(
        &self,
        uri: &jsonschema::Uri<String>,
    ) -> std::result::Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        if uri.as_str() == "https://unone.dev/schema/input.schema.json" {
            Ok(serde_json::from_str(include_str!(
                "../../../docs/input.schema.json"
            ))?)
        } else {
            Err(format!(
                "External schema resolution disabled: {uri}; bundle schema with local $defs"
            )
            .into())
        }
    }
}
fn validate(schema: &Value, instance: &Value) -> Result<()> {
    let validator = jsonschema::draft202012::options()
        .with_retriever(Offline)
        .build(schema)?;
    if let Some(e) = validator.iter_errors(instance).next() {
        bail!("Schema validation at {}: {}", e.instance_path(), e);
    }
    Ok(())
}
fn expected_schema() -> Value {
    let mut s: Value =
        serde_json::from_str(include_str!("../../../docs/reproduction.schema.json")).unwrap();
    s["required"] = json!([]);
    s["properties"] = json!({});
    s.as_object_mut().unwrap().remove("allOf");
    s.as_object_mut().unwrap().remove("additionalProperties");
    s["oneOf"] =
        json!([{"$ref":"#/$defs/expectedDiagnostic"},{"$ref":"#/$defs/expectedInvariant"}]);
    s
}
fn execute(project: &Path, r: &Request) -> Result<Value> {
    validate(
        &serde_json::from_str(include_str!("../../../docs/reproduction.schema.json"))?,
        &r.reproduction,
    )?;
    if !["exact_version", "compatible_version"].contains(&r.mode.as_str()) {
        bail!("Unknown request mode");
    }
    if !(1..=MAX_TICKS).contains(&r.max_ticks) || r.regression_checks.len() > 64 {
        bail!("maxTicks must be 1..100000; at most 64 regression checks");
    }
    if r.reproduction["captureOrigin"]["kind"] != "start" {
        return Ok(result(
            "incomplete",
            "Checkpoint restoration is not implemented; capture from start with explicit inputs",
        ));
    }
    let expected = &r.reproduction["expected"];
    if let Some(e) = &r.expected_override {
        validate(&expected_schema(), e)?;
    }
    let mut checks = Vec::new();
    let mut ids = BTreeSet::new();
    for check in &r.regression_checks {
        let mut c = check.clone();
        if c.get("kind").is_some() {
            bail!("regressionChecks must omit kind; it is always invariant");
        }
        c["kind"] = json!("invariant");
        validate(&expected_schema(), &c)?;
        if !ids.insert(c["id"].as_str().unwrap().to_string()) {
            bail!("Duplicate regression id");
        }
        checks.push(c);
    }
    if let Some(m) = &r.memory {
        if m.sample_every_ticks == 0 || m.label.is_empty() || m.label.len() > 160 {
            bail!("Invalid memory sampling options");
        }
    }
    if hash(r.scenario_schema.as_bytes()) != r.reproduction["scenarioSchema"]["hash"] {
        bail!("Scenario schema hash mismatch; hash exact UTF-8 schema text, preserving whitespace");
    }
    let scenario_schema: Value = serde_json::from_str(&r.scenario_schema)?;
    if scenario_schema["$id"] != r.reproduction["scenarioSchema"]["id"] {
        bail!("Scenario schema id mismatch");
    }
    if scenario_schema["x-unone-version"] != r.reproduction["scenarioSchema"]["version"] {
        bail!("Schema x-unone-version must match scenarioSchema.version");
    }
    validate(&scenario_schema, &r.reproduction["scenario"])?;
    let inputs = &r.reproduction["inputs"];
    let start_tick = inputs["startTick"].as_u64().unwrap();
    if start_tick != 0 {
        return Ok(result("incomplete", "Start capture must have startTick 0"));
    }
    let frames: Vec<InputFrame> = serde_json::from_value(inputs["frames"].clone())?;
    if frames.len() > MAX_TICKS as usize {
        return Err(fault("incomplete", "Input limit exceeded"));
    }
    for f in &frames {
        f.validate().map_err(|e| anyhow!(e.explanation))?;
    }
    if frames.is_empty()
        || inputs["completeThroughTick"].as_u64() != Some(frames.len() as u64 - 1)
        || inputs["complete"] != true
        || inputs["truncated"] != false
    {
        return Ok(result(
            "incomplete",
            "Input coverage is missing/inconsistent/truncated; no implicit empty-frame padding",
        ));
    }
    let seed = r.reproduction["seed"]
        .as_str()
        .context("Start replay requires an explicit decimal u64 seed")?
        .parse::<u64>()?;
    let (staged, actual) = stage(project).map_err(|e| {
        if e.is::<ReplayFault>() {
            e
        } else {
            fault("execution_failed", e)
        }
    })?;
    if r.target != actual {
        return Ok(version_mismatch(
            "Explicit target does not match actual staged game/engine/assets fingerprints; run replay fingerprint",
            &r.target,
            &actual,
        ));
    }
    let source = json!({"game":r.reproduction["game"],"engine":r.reproduction["engine"],"assets":{"manifestHash":r.reproduction["assets"]["manifestHash"]}});
    if r.mode == "exact_version" && source != actual {
        return Ok(version_mismatch(
            "Exact-version game/engine/assets fingerprints differ",
            &source,
            &actual,
        ));
    }
    let mut runtime = match EngineRuntime::load_with_seed_and_save(
        staged.path(),
        seed,
        r.reproduction.get("save").cloned(),
    ) {
        Ok(r) => r,
        Err(e) => return Ok(result("execution_failed", &e.explanation)),
    };
    let identity = runtime
        .replay_adapter_identity()
        .map_err(|e| anyhow!(e.explanation))?;
    if r.mode == "exact_version" && identity != r.reproduction["adapter"] {
        return Ok(result("incompatible", "Adapter identity/version differs"));
    }
    if r.mode == "compatible_version" {
        let compatibility=runtime.replay_adapter_call("compatible",json!({"source":source,"target":actual,"sourceAdapter":r.reproduction["adapter"],"targetAdapter":identity,"scenarioSchema":r.reproduction["scenarioSchema"]})).map_err(|e|fault("execution_failed",e.explanation))?;
        if compatibility != true {
            return Ok(result(
                "incompatible",
                "Adapter did not explicitly accept source/target compatibility",
            ));
        }
    }
    match runtime.replay_adapter_call("restore", r.reproduction.clone()) {
        Ok(v) if v == true => {}
        Ok(_) => {
            return Ok(result(
                "incomplete",
                "Adapter could not completely initialize this scenario",
            ));
        }
        Err(e) => return Ok(result("execution_failed", &e.explanation)),
    }
    runtime
        .preview_request(PreviewRequest::ProfileStart { sampling: true })
        .map_err(|e| fault("execution_failed", e.explanation))?;
    let mut matchers = vec![Matcher::new(expected.clone())];
    let selected = if let Some(e) = &r.expected_override {
        matchers.push(Matcher::new(e.clone()));
        1
    } else {
        0
    };
    let regression_start = matchers.len();
    matchers.extend(checks.into_iter().map(Matcher::new));
    let mut ticks = 0;
    let mut inspect_wall_ms = 0.0;
    let mut stopped = None;
    for (i, input) in frames.iter().take(r.max_ticks as usize).enumerate() {
        if let Err(e) = runtime.tick_with_input(input) {
            stopped = Some(("execution_failed", e.explanation));
            break;
        }
        ticks += 1;
        let inspection_start = Instant::now();
        let mut evidence = match runtime.replay_adapter_call("inspect", json!({"tick":i})) {
            Ok(v) => v,
            Err(e) => {
                stopped = Some(("execution_failed", e.explanation));
                break;
            }
        };
        inspect_wall_ms += inspection_start.elapsed().as_secs_f64() * 1000.0;
        // Portable Luau's empty table maps to {}; accept it only as an empty
        // diagnostics list, never interpret missing/malformed channels as absence.
        if evidence["diagnostics"]
            .as_object()
            .is_some_and(|m| m.is_empty())
        {
            evidence["diagnostics"] = json!([]);
        }
        let evidence_valid = evidence.as_object().is_some_and(|m| m.len() == 2)
            && evidence["invariants"].is_object()
            && evidence["diagnostics"].as_array().is_some_and(|ds| {
                ds.iter().all(|d| {
                    d.as_object().is_some_and(|m| m.len() == 2)
                        && ["code", "flag"]
                            .iter()
                            .all(|k| d[*k].as_str().is_some_and(|s| !s.is_empty()))
                })
            });
        if !evidence_valid {
            stopped = Some(("incomplete", "Adapter must return invariants object and diagnostics array of {code,flag}; missing evidence cannot prove absence".into()));
            break;
        }
        if serde_json::to_vec(&evidence)?.len() > 65536 {
            stopped = Some((
                "incomplete",
                "Adapter evidence exceeded 64 KiB per tick".into(),
            ));
            break;
        }
        for m in &mut matchers {
            m.update(i as u64, &evidence);
        }
        if let Some(m) = &r.memory {
            if ticks % m.sample_every_ticks == 0 {
                runtime
                    .memory_sample(&m.label, m.collect, ticks <= m.warmup_ticks)
                    .map_err(|e| fault("execution_failed", e.explanation))?;
            }
        }
        if matchers.iter().all(|m| m.ended) {
            break;
        }
    }
    let status = if let Some((s, _)) = &stopped {
        *s
    } else if !matchers[selected].evaluated {
        "incomplete"
    } else if matchers[selected].matched {
        "reproduced"
    } else {
        "not_reproduced"
    };
    let regressions = &matchers[regression_start..];
    let regression_status = if regressions.is_empty() {
        "not_evaluated"
    } else if regressions.iter().any(|m| m.evaluated && !m.matched) {
        "failed"
    } else if stopped.is_some() || regressions.iter().any(|m| !m.evaluated) {
        "incomplete"
    } else {
        "passed"
    };
    let profile = runtime
        .preview_request(PreviewRequest::ProfileStop {})
        .map_err(|e| fault("execution_failed", e.explanation))?;
    Ok(
        json!({"schemaVersion":1,"status":status,"reason":stopped.map(|(_,s)|s).unwrap_or_else(||if status=="incomplete"{"Input/maxTicks ended before matcher end condition".into()}else{"Selected matcher evaluated".into()}),
        "mode":r.mode,"source":source,"target":actual,"adapter":identity,"ticksExecuted":ticks,"backend":"headless_native","statusMatcher":if selected==0{"original"}else{"override"},
        "adapterInspectWallMs":inspect_wall_ms,"samplingScope":"Luau gameplay; replay adapter callbacks are excluded from function sampling. VM allocation/GC metrics cover update only.",
        "originalMatcher":matchers[0].report(),"overrideMatcher":if selected==1{Some(matchers[1].report())}else{None},
        "regressionStatus":regression_status,"regressionChecks":regressions.iter().map(Matcher::report).collect::<Vec<_>>(),
        "performance":profile,"memory":runtime.memory_report(),"memoryOptions":r.memory.as_ref().map(|m|json!({"collect":m.collect,"sampleEveryTicks":m.sample_every_ticks,"warmupTicks":m.warmup_ticks,"label":m.label})),
        "limitations":["Headless Luau/Core replay only; does not replay browser/native rendering or external services.","Checkpoint, automatic capture, registry/trace storage and schema migrations are not implemented.","Full GC sampling changes collection scheduling; compare it separately from ordinary playback."]}),
    )
}
struct Matcher {
    expected: Value,
    evaluated: bool,
    ended: bool,
    matched: bool,
    seen: bool,
    actual: Value,
}
impl Matcher {
    fn new(expected: Value) -> Self {
        Self {
            expected,
            evaluated: false,
            ended: false,
            matched: false,
            seen: false,
            actual: Value::Null,
        }
    }
    fn update(&mut self, tick: u64, evidence: &Value) {
        if self.ended {
            return;
        }
        let diagnostics = evidence["diagnostics"].as_array();
        if self.expected["kind"] == "diagnostic" {
            self.seen |= diagnostics.is_some_and(|ds| {
                ds.iter().any(|d| {
                    d["code"] == self.expected["code"] && d["flag"] == self.expected["flag"]
                })
            });
        }
        let end = &self.expected["endCondition"];
        let ended = if end["kind"] == "after_tick" {
            end["tick"].as_u64() == Some(tick)
        } else {
            diagnostics.is_some_and(|ds| ds.iter().any(|d| d["flag"] == end["flag"]))
        };
        if !ended {
            return;
        }
        self.ended = true;
        if self.expected["kind"] == "diagnostic" {
            self.evaluated = true;
            self.matched = self.seen;
            self.actual = json!(self.seen);
        } else if let Some(v) = self.expected["id"]
            .as_str()
            .and_then(|id| evidence["invariants"].get(id))
        {
            self.evaluated = true;
            self.matched = v == &self.expected["expectedValue"];
            self.actual = v.clone();
        }
    }
    fn report(&self) -> Value {
        json!({"expected":self.expected,"evaluated":self.evaluated,"matched":if self.evaluated {Some(self.matched)}else{None},"actual":self.actual,"status":if !self.evaluated{"skipped"}else if self.matched{"pass"}else{"fail"}})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_vector() {
        let m = json!({"schemaVersion":1,"files":[{"path":"scripts/main.luau","sha256":"a".repeat(64)}],"entrypoints":["scripts/main.luau"]});
        assert_eq!(
            hash(&serde_json::to_vec(&m).unwrap()),
            "sha256:36e88d88ca2f8a23bee1a9e696bb48a03043ff111ce43a38f8a06d2586a1a560"
        );
    }
    #[test]
    fn missing_invariant_is_not_a_pass_and_diagnostics_wait_for_end() {
        let mut m = Matcher::new(
            json!({"kind":"invariant","id":"x","expectedValue":null,"endCondition":{"kind":"after_tick","tick":0}}),
        );
        m.update(0, &json!({}));
        assert!(!m.evaluated);
        let mut m = Matcher::new(
            json!({"kind":"diagnostic","code":"oops","flag":"test","endCondition":{"kind":"after_tick","tick":2}}),
        );
        m.update(0, &json!({"diagnostics":[{"code":"oops","flag":"test"}]}));
        assert!(!m.evaluated);
        m.update(2, &json!({}));
        assert!(m.evaluated && m.matched);
    }
}
