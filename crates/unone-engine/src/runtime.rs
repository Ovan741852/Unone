use std::{
    cell::RefCell,
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    rc::Rc,
    time::SystemTime,
};

use mlua::{Function, Lua, Table, Value};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
    diagnostics::{ActionSuggestion, Diagnostic, EngineResult, SourceLocation},
    project::{ProjectConfig, ProjectPaths, TestSpec},
    world::{Vec2, World, WorldSnapshot},
};

const FIXED_DT: f64 = 1.0 / 60.0;

#[derive(Debug, Clone, Serialize)]
pub struct CheckReport {
    pub project: String,
    pub script: String,
    pub strict_mode: bool,
    pub entrypoints: Vec<String>,
    pub type_check: Option<TypeCheckReport>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TypeCheckReport {
    pub tool: String,
    pub files: Vec<String>,
    pub passed: bool,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunReport {
    pub project: String,
    pub seed: u64,
    pub status: String,
    pub frames: u64,
    pub observation_digest: String,
    pub world: WorldSnapshot,
    pub trace: Vec<TraceEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestCaseReport {
    pub name: String,
    pub passed: bool,
    pub frames: u64,
    pub observation_digest: Option<String>,
    pub failures: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestSuiteReport {
    pub project: String,
    pub passed: bool,
    pub cases: Vec<TestCaseReport>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TraceEvent {
    pub frame: u64,
    pub event: String,
    pub details: serde_json::Value,
}

#[derive(Debug, Clone, Default)]
struct InputState {
    down: BTreeMap<String, bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ScriptStamp {
    modified: SystemTime,
    size: u64,
}

pub struct EngineRuntime {
    config: ProjectConfig,
    paths: ProjectPaths,
    world: Rc<RefCell<World>>,
    input: Rc<RefCell<InputState>>,
    lua: Lua,
    api: Table,
    update_fn: Function,
    trace: Rc<RefCell<Vec<TraceEvent>>>,
    generation: u64,
    last_seen_script_stamp: Option<ScriptStamp>,
}

impl EngineRuntime {
    pub fn check(project_root: impl AsRef<Path>) -> EngineResult<CheckReport> {
        let (config, paths) = match ProjectPaths::discover(project_root) {
            Ok(value) => value,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let source = match fs::read_to_string(&paths.entry_script) {
            Ok(source) => source,
            Err(err) => {
                return EngineResult::failure(Diagnostic::error(
                    "SCRIPT_READ_FAILED",
                    "無法讀取入口腳本",
                    format!("{}：{}", paths.entry_script.display(), err),
                ));
            }
        };
        let lua = Lua::new();
        let value = match lua
            .load(&source)
            .set_name(paths.entry_script.to_string_lossy())
            .eval::<Value>()
        {
            Ok(value) => value,
            Err(err) => return EngineResult::failure(script_diagnostic(&paths, err.to_string())),
        };
        let table = match value {
            Value::Table(table) => table,
            _ => {
                return EngineResult::failure(Diagnostic::error(
                    "SCRIPT_ENTRY_INVALID",
                    "入口腳本必須回傳 Game table",
                    "入口腳本最後必須 return 一個包含 start 與 update function 的 table。",
                ));
            }
        };
        let mut entrypoints = Vec::new();
        for name in ["start", "update"] {
            match table.get::<Value>(name) {
                Ok(Value::Function(_)) => entrypoints.push(name.to_string()),
                Ok(_) => {
                    return EngineResult::failure(Diagnostic::error(
                        "SCRIPT_ENTRYPOINT_INVALID",
                        format!("Game.{name} 不是 function"),
                        format!(
                            "引擎需要 Game.{name}(api{}) 才能執行專案。",
                            if name == "update" { ", dt" } else { "" }
                        ),
                    ));
                }
                Err(err) => {
                    return EngineResult::failure(script_diagnostic(&paths, err.to_string()));
                }
            }
        }
        let strict_mode = source
            .lines()
            .next()
            .map(|line| line.trim() == "--!strict")
            .unwrap_or(false);
        let mut result = EngineResult::success(CheckReport {
            project: config.name,
            script: paths.entry_script.display().to_string(),
            strict_mode,
            entrypoints,
            type_check: None,
        });
        if !strict_mode {
            result.diagnostics.push(Diagnostic::warning(
                "STRICT_MODE_NOT_ENABLED",
                "入口腳本未啟用 strict mode",
                "目前只完成 Luau 語法與 Engine entrypoint contract 檢查；加入 --!strict 才能讓型別分析更早回報問題。",
            ));
        }
        result
    }

    pub fn check_with_types(project_root: impl AsRef<Path>) -> EngineResult<CheckReport> {
        let mut result = Self::check(&project_root);
        if !result.ok {
            return result;
        }
        let (_, paths) = match ProjectPaths::discover(project_root) {
            Ok(value) => value,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        match run_luau_analyzer(&paths) {
            Ok(report) => {
                if let Some(check) = result.value.as_mut() {
                    check.type_check = Some(report);
                }
            }
            Err(diagnostic) => {
                result.ok = false;
                result.diagnostics.push(*diagnostic);
            }
        }
        result
    }

    pub fn load(project_root: impl AsRef<Path>) -> Result<Self, Box<Diagnostic>> {
        let (config, paths) = ProjectPaths::discover(project_root)?;
        let world = Rc::new(RefCell::new(World::default()));
        if let Some(scene) = &paths.main_scene {
            world.borrow_mut().load_scene(scene)?;
        }
        let input = Rc::new(RefCell::new(InputState::default()));
        let trace = Rc::new(RefCell::new(Vec::new()));
        let lua = Lua::new();
        let api = build_api(
            &lua,
            Rc::clone(&world),
            Rc::clone(&input),
            Rc::clone(&trace),
        )
        .map_err(|err| {
            Box::new(Diagnostic::error(
                "ENGINE_API_BIND_FAILED",
                "無法建立 Luau Engine API",
                err.to_string(),
            ))
        })?;
        let placeholder = lua.create_function(|_, _: ()| Ok(())).map_err(|err| {
            Box::new(Diagnostic::error(
                "ENGINE_INIT_FAILED",
                "無法初始化 Luau runtime",
                err.to_string(),
            ))
        })?;
        let mut runtime = Self {
            config,
            paths,
            world,
            input,
            lua,
            api,
            update_fn: placeholder,
            trace,
            generation: 0,
            last_seen_script_stamp: None,
        };
        runtime.load_script(false)?;
        Ok(runtime)
    }

    pub fn set_input(&mut self, action: impl Into<String>, is_down: bool) {
        self.input.borrow_mut().down.insert(action.into(), is_down);
    }

    pub fn reload(&mut self) -> Result<(), Box<Diagnostic>> {
        self.load_script(true)
    }

    /// Reload the entry script once its file metadata changes.
    ///
    /// The changed stamp is remembered before attempting the reload so an
    /// invalid file does not spam the preview every frame. A later file edit
    /// produces a new stamp and can be retried.
    pub fn reload_if_changed(&mut self) -> Result<bool, Box<Diagnostic>> {
        let current = self.script_stamp()?;
        if self.last_seen_script_stamp.as_ref() == Some(&current) {
            return Ok(false);
        }
        self.last_seen_script_stamp = Some(current);
        self.reload()?;
        Ok(true)
    }

    pub fn run(&mut self, frames: u64, seed: u64) -> EngineResult<RunReport> {
        self.run_internal(frames, seed, None)
    }

    pub fn run_with_input_sequence(
        &mut self,
        frames: u64,
        seed: u64,
        input_sequence: &[BTreeMap<String, bool>],
    ) -> EngineResult<RunReport> {
        self.run_internal(frames, seed, Some(input_sequence))
    }

    fn run_internal(
        &mut self,
        frames: u64,
        seed: u64,
        input_sequence: Option<&[BTreeMap<String, bool>]>,
    ) -> EngineResult<RunReport> {
        for frame_index in 0..frames {
            if let Some(input_sequence) = input_sequence {
                let snapshot = input_sequence
                    .get(frame_index as usize)
                    .cloned()
                    .unwrap_or_default();
                self.input.borrow_mut().down = snapshot;
            }
            if let Err(err) = self.tick() {
                return EngineResult::failure(*err);
            }
        }
        let world = self.world.borrow().snapshot();
        let observation = serde_json::to_vec(&world).unwrap_or_default();
        let digest = format!("sha256:{}", hex_digest(&observation));
        EngineResult::success(RunReport {
            project: self.config.name.clone(),
            seed,
            status: "completed".to_string(),
            frames,
            observation_digest: digest,
            world,
            trace: self.trace.borrow().clone(),
        })
    }

    pub fn tick(&mut self) -> Result<WorldSnapshot, Box<Diagnostic>> {
        self.update_fn
            .call::<()>((self.api.clone(), FIXED_DT))
            .map_err(|err| Box::new(script_diagnostic(&self.paths, err.to_string())))?;
        self.world.borrow_mut().step_physics(FIXED_DT);
        {
            let mut world = self.world.borrow_mut();
            world.frame += 1;
            world.time_seconds = world.frame as f64 / 60.0;
        }
        Ok(self.world.borrow().snapshot())
    }

    pub fn run_tests(project_root: impl AsRef<Path>) -> EngineResult<TestSuiteReport> {
        let (config, paths) = match ProjectPaths::discover(project_root) {
            Ok(value) => value,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        if paths.test_files.is_empty() {
            return EngineResult::failure(Diagnostic::error(
                "TESTS_NOT_CONFIGURED",
                "專案沒有設定測試檔",
                "請在 project.unone.json 的 test_files 陣列加入 .test.json 檔案。",
            ));
        }
        let mut cases = Vec::new();
        for test_path in paths.test_files {
            let text = match fs::read_to_string(&test_path) {
                Ok(text) => text,
                Err(err) => {
                    return EngineResult::failure(Diagnostic::error(
                        "TEST_READ_FAILED",
                        "無法讀取測試檔",
                        format!("{}：{}", test_path.display(), err),
                    ));
                }
            };
            let spec: TestSpec = match serde_json::from_str(&text) {
                Ok(spec) => spec,
                Err(err) => {
                    return EngineResult::failure(Diagnostic::error(
                        "TEST_INVALID",
                        "測試檔不是有效 JSON",
                        format!("{}：{}", test_path.display(), err),
                    ));
                }
            };
            let mut runtime = match Self::load(&paths.root) {
                Ok(runtime) => runtime,
                Err(diagnostic) => return EngineResult::failure(*diagnostic),
            };
            for (action, is_down) in &spec.input {
                runtime.set_input(action.clone(), *is_down);
            }
            let run = if spec.input_sequence.is_empty() {
                runtime.run(spec.frames, spec.seed)
            } else {
                runtime.run_with_input_sequence(spec.frames, spec.seed, &spec.input_sequence)
            };
            let report = match run.value {
                Some(report) => report,
                None => {
                    return EngineResult::failure(
                        run.diagnostics.into_iter().next().unwrap_or_else(|| {
                            Diagnostic::error(
                                "TEST_RUN_FAILED",
                                "測試執行失敗",
                                "測試 runtime 沒有產生結果。",
                            )
                        }),
                    );
                }
            };
            let mut failures = Vec::new();
            for assertion in &spec.assertions {
                match evaluate_assertion(&report.world, assertion) {
                    Ok(()) => {}
                    Err(failure) => failures.push(failure),
                }
            }
            cases.push(TestCaseReport {
                name: spec.name,
                passed: failures.is_empty(),
                frames: report.frames,
                observation_digest: Some(report.observation_digest),
                failures,
            });
        }
        let passed = cases.iter().all(|case| case.passed);
        EngineResult::success(TestSuiteReport {
            project: config.name,
            passed,
            cases,
        })
    }

    pub fn observe(&self) -> WorldSnapshot {
        self.world.borrow().snapshot()
    }

    fn load_script(&mut self, is_reload: bool) -> Result<(), Box<Diagnostic>> {
        let script_stamp = self.script_stamp()?;
        let source = fs::read_to_string(&self.paths.entry_script).map_err(|err| {
            Box::new(Diagnostic::error(
                "SCRIPT_READ_FAILED",
                "無法讀取入口腳本",
                format!("{}：{}", self.paths.entry_script.display(), err),
            ))
        })?;
        let value = self
            .lua
            .load(&source)
            .set_name(self.paths.entry_script.to_string_lossy())
            .eval::<Value>()
            .map_err(|err| Box::new(script_diagnostic(&self.paths, err.to_string())))?;
        let table = match value {
            Value::Table(table) => table,
            _ => {
                return Err(Box::new(Diagnostic::error(
                    "SCRIPT_ENTRY_INVALID",
                    "入口腳本必須回傳 Game table",
                    "入口腳本最後必須 return 一個包含 start 與 update function 的 table。",
                )));
            }
        };
        let update_fn = table
            .get::<Function>("update")
            .map_err(|err| Box::new(script_diagnostic(&self.paths, err.to_string())))?;
        let start_fn = table
            .get::<Function>("start")
            .map_err(|err| Box::new(script_diagnostic(&self.paths, err.to_string())))?;
        if is_reload {
            if let Ok(on_reload) = table.get::<Function>("onReload") {
                on_reload
                    .call::<()>(self.api.clone())
                    .map_err(|err| Box::new(script_diagnostic(&self.paths, err.to_string())))?;
            }
            self.generation += 1;
            self.trace.borrow_mut().push(TraceEvent {
                frame: self.world.borrow().frame,
                event: "script_reloaded".to_string(),
                details: serde_json::json!({"generation": self.generation, "state_policy": "rust_owned_state_preserved"}),
            });
        } else {
            start_fn
                .call::<()>(self.api.clone())
                .map_err(|err| Box::new(script_diagnostic(&self.paths, err.to_string())))?;
        }
        self.update_fn = update_fn;
        self.last_seen_script_stamp = Some(script_stamp);
        Ok(())
    }

    fn script_stamp(&self) -> Result<ScriptStamp, Box<Diagnostic>> {
        let metadata = fs::metadata(&self.paths.entry_script).map_err(|err| {
            Box::new(Diagnostic::error(
                "SCRIPT_METADATA_FAILED",
                "無法取得入口腳本狀態",
                format!("{}：{}", self.paths.entry_script.display(), err),
            ))
        })?;
        let modified = metadata.modified().map_err(|err| {
            Box::new(Diagnostic::error(
                "SCRIPT_METADATA_FAILED",
                "無法取得入口腳本修改時間",
                format!("{}：{}", self.paths.entry_script.display(), err),
            ))
        })?;
        Ok(ScriptStamp {
            modified,
            size: metadata.len(),
        })
    }
}

fn build_api(
    lua: &Lua,
    world: Rc<RefCell<World>>,
    input: Rc<RefCell<InputState>>,
    trace: Rc<RefCell<Vec<TraceEvent>>>,
) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let entity = lua.create_table()?;
    let input_api = lua.create_table()?;
    let camera = lua.create_table()?;

    let spawn_world = Rc::clone(&world);
    entity.set(
        "spawn",
        lua.create_function(move |_, name: String| Ok(spawn_world.borrow_mut().spawn(&name)))?,
    )?;

    let get_world = Rc::clone(&world);
    entity.set(
        "getPosition",
        lua.create_function(move |lua, id: String| {
            let world = get_world.borrow();
            let entity = world
                .entities
                .get(&id)
                .ok_or_else(|| mlua::Error::RuntimeError(format!("Entity '{id}' 不存在。")))?;
            let table = lua.create_table()?;
            table.set("x", entity.transform.x)?;
            table.set("y", entity.transform.y)?;
            Ok(table)
        })?,
    )?;

    let set_world = Rc::clone(&world);
    entity.set(
        "setPosition",
        lua.create_function(move |_, (id, position): (String, Table)| {
            let x: f64 = position.get("x")?;
            let y: f64 = position.get("y")?;
            let mut world = set_world.borrow_mut();
            let entity = world
                .entities
                .get_mut(&id)
                .ok_or_else(|| mlua::Error::RuntimeError(format!("Entity '{id}' 不存在。")))?;
            entity.transform = Vec2 { x, y };
            Ok(())
        })?,
    )?;

    let get_velocity_world = Rc::clone(&world);
    entity.set(
        "getVelocity",
        lua.create_function(move |lua, id: String| {
            let velocity = get_velocity_world
                .borrow()
                .get_velocity(&id)
                .map_err(mlua::Error::RuntimeError)?;
            let table = lua.create_table()?;
            table.set("x", velocity.x)?;
            table.set("y", velocity.y)?;
            Ok(table)
        })?,
    )?;

    let set_velocity_world = Rc::clone(&world);
    entity.set(
        "setVelocity",
        lua.create_function(move |_, (id, velocity): (String, Table)| {
            let velocity = Vec2 {
                x: velocity.get("x")?,
                y: velocity.get("y")?,
            };
            set_velocity_world
                .borrow_mut()
                .set_velocity(&id, velocity)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let physics = lua.create_table()?;
    let impulse_world = Rc::clone(&world);
    physics.set(
        "applyImpulse",
        lua.create_function(move |_, (id, impulse): (String, Table)| {
            let impulse = Vec2 {
                x: impulse.get("x")?,
                y: impulse.get("y")?,
            };
            impulse_world
                .borrow_mut()
                .apply_impulse(&id, impulse)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let input_state = Rc::clone(&input);
    input_api.set(
        "isDown",
        lua.create_function(move |_, action: String| {
            Ok(input_state
                .borrow()
                .down
                .get(&action)
                .copied()
                .unwrap_or(false))
        })?,
    )?;

    let camera_get_world = Rc::clone(&world);
    camera.set(
        "getPosition",
        lua.create_function(move |lua, _: ()| {
            let position = camera_get_world.borrow().get_camera_position();
            let table = lua.create_table()?;
            table.set("x", position.x)?;
            table.set("y", position.y)?;
            Ok(table)
        })?,
    )?;

    let camera_set_world = Rc::clone(&world);
    camera.set(
        "setPosition",
        lua.create_function(move |_, position: Table| {
            let position = Vec2 {
                x: position.get("x")?,
                y: position.get("y")?,
            };
            camera_set_world.borrow_mut().set_camera_position(position);
            Ok(())
        })?,
    )?;

    let camera_zoom_world = Rc::clone(&world);
    camera.set(
        "getZoom",
        lua.create_function(move |_, _: ()| Ok(camera_zoom_world.borrow().get_camera_zoom()))?,
    )?;

    let camera_set_zoom_world = Rc::clone(&world);
    camera.set(
        "setZoom",
        lua.create_function(move |_, zoom: f64| {
            camera_set_zoom_world
                .borrow_mut()
                .set_camera_zoom(zoom)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let log_trace = Rc::clone(&trace);
    let log_world = Rc::clone(&world);
    api.set(
        "log",
        lua.create_function(move |_, message: String| {
            log_trace.borrow_mut().push(TraceEvent {
                frame: log_world.borrow().frame,
                event: "script_log".to_string(),
                details: serde_json::json!({"message": message}),
            });
            Ok(())
        })?,
    )?;
    api.set("entity", entity)?;
    api.set("input", input_api)?;
    api.set("physics", physics)?;
    api.set("camera", camera)?;
    Ok(api)
}

fn run_luau_analyzer(paths: &ProjectPaths) -> Result<TypeCheckReport, Box<Diagnostic>> {
    let analyzer = analyzer_path();
    let output = Command::new(&analyzer)
        .arg("--formatter=gnu")
        .arg(&paths.entry_script)
        .output()
        .map_err(|err| {
            let mut diagnostic = Diagnostic::error(
                "LUAU_ANALYZER_NOT_FOUND",
                "找不到 Luau static analyzer",
                "`game check --types` 需要官方 luau-analyze；目前 runtime 只內嵌 Luau 執行器，不會假裝執行完整型別分析。",
            );
            diagnostic.facts = serde_json::json!({
                "requested_tool": analyzer.display().to_string(),
                "error": err.to_string(),
                "override_environment": "UNONE_LUAU_ANALYZER",
            });
            diagnostic.suggested_actions = vec![ActionSuggestion {
                action: "install_luau_analyzer".to_string(),
                description: "安裝官方 luau-analyze，或設定 UNONE_LUAU_ANALYZER 指向可執行檔。".to_string(),
                command: Some("$env:UNONE_LUAU_ANALYZER = 'D:/tools/luau-analyze.exe'".to_string()),
            }];
            Box::new(diagnostic)
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = [stdout, stderr]
        .into_iter()
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let tool = analyzer.display().to_string();
    let files = vec![paths.entry_script.display().to_string()];
    if output.status.success() {
        return Ok(TypeCheckReport {
            tool,
            files,
            passed: true,
            output: combined,
        });
    }
    let mut diagnostic = Diagnostic::error(
        "LUAU_TYPECHECK_FAILED",
        "Luau static analyzer 發現型別或 lint 問題",
        "入口腳本通過 runtime contract，但沒有通過官方 luau-analyze；先修正 typecheck output，再進行 hot reload 或執行測試。",
    );
    diagnostic.facts = serde_json::json!({
        "tool": tool,
        "exit_code": output.status.code(),
        "files": files,
        "output": combined,
    });
    diagnostic.suggested_actions = vec![ActionSuggestion {
        action: "fix_typecheck".to_string(),
        description: "依 output 的檔案、行號與訊息修正 Luau 型別或 lint 問題。".to_string(),
        command: Some("game check --types --json".to_string()),
    }];
    Err(Box::new(diagnostic))
}

fn analyzer_path() -> PathBuf {
    if let Ok(path) = env::var("UNONE_LUAU_ANALYZER") {
        return PathBuf::from(path);
    }
    let local_tool = env::current_dir()
        .ok()
        .map(|root| root.join(".toolcache/luau-0.734/luau-analyze.exe"));
    if let Some(path) = local_tool.filter(|path| path.is_file()) {
        return path;
    }
    PathBuf::from("luau-analyze")
}

fn script_diagnostic(paths: &ProjectPaths, message: String) -> Diagnostic {
    let mut diagnostic = Diagnostic::error(
        "LUAU_RUNTIME_ERROR",
        "Luau 腳本無法載入或執行",
        message.clone(),
    );
    diagnostic.facts = serde_json::json!({
        "script": paths.entry_script.display().to_string(),
        "runtime": "Luau",
        "message": message,
    });
    diagnostic.source = Some(SourceLocation {
        file: paths.entry_script.display().to_string(),
        line: None,
        column: None,
    });
    diagnostic.likely_causes = vec![
        "入口腳本的語法或 Engine API 呼叫不符合目前契約".to_string(),
        "腳本在 runtime 使用了不存在的 Entity 或欄位".to_string(),
    ];
    diagnostic.suggested_actions = vec![
        ActionSuggestion {
            action: "check_script".to_string(),
            description: "先檢查入口腳本 contract。".to_string(),
            command: Some("game check --json".to_string()),
        },
        ActionSuggestion {
            action: "inspect_project".to_string(),
            description: "確認 scene 與 Entity id。".to_string(),
            command: Some("game project inspect --json".to_string()),
        },
    ];
    diagnostic
}

fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn evaluate_assertion(
    world: &WorldSnapshot,
    assertion: &crate::project::TestAssertion,
) -> Result<(), String> {
    let entity = world
        .entities
        .get(&assertion.entity)
        .ok_or_else(|| format!("Entity '{}' 不存在。", assertion.entity))?;
    let actual = match assertion.field.as_str() {
        "transform.x" => entity.transform.x,
        "transform.y" => entity.transform.y,
        field => {
            return Err(format!(
                "不支援的 assertion field '{field}'；目前支援 transform.x 與 transform.y。"
            ));
        }
    };
    if let Some(expected) = assertion.equals
        && (actual - expected).abs() > 0.000_001
    {
        return Err(format!(
            "{} {} 不等於預期 {}。",
            assertion.entity, assertion.field, expected
        ));
    }
    if let Some(expected) = assertion.greater_than
        && actual <= expected
    {
        return Err(format!(
            "{} {} = {}，沒有大於 {}。",
            assertion.entity, assertion.field, actual, expected
        ));
    }
    if let Some(expected) = assertion.less_than
        && actual >= expected
    {
        return Err(format!(
            "{} {} = {}，沒有小於 {}。",
            assertion.entity, assertion.field, actual, expected
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs};

    use tempfile::tempdir;

    use super::EngineRuntime;

    fn write_project(dir: &std::path::Path, script: &str) {
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::create_dir_all(dir.join("scenes")).unwrap();
        fs::write(
            dir.join("project.unone.json"),
            r#"{
            "name": "ReloadTest",
            "entry_script": "scripts/main.luau",
            "main_scene": "scenes/main.scene.json"
        }"#,
        )
        .unwrap();
        fs::write(
            dir.join("scenes/main.scene.json"),
            r#"{
            "entities": [{
                "id": "player",
                "name": "Player",
                "transform": {"x": 0.0, "y": 0.0}
            }]
        }"#,
        )
        .unwrap();
        fs::write(dir.join("scripts/main.luau"), script).unwrap();
    }

    const SCRIPT: &str = r#"--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type InputApi = { isDown: (action: string) -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi, log: (message: string) -> () }
local Game = {}
local speed: number = 4
function Game.start(api: EngineApi) end
function Game.update(api: EngineApi, dt: number)
    local p = api.entity.getPosition("player")
    if api.input.isDown("Right") then p.x += speed * dt end
    api.entity.setPosition("player", p)
end
return Game
"#;

    #[test]
    fn same_seed_and_input_produce_same_observation_digest() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), SCRIPT);
        let mut left = EngineRuntime::load(dir.path()).unwrap();
        let mut right = EngineRuntime::load(dir.path()).unwrap();
        left.set_input("Right", true);
        right.set_input("Right", true);
        let left_report = left.run(60, 42).value.unwrap();
        let right_report = right.run(60, 42).value.unwrap();
        assert_eq!(
            left_report.observation_digest,
            right_report.observation_digest
        );
    }

    #[test]
    fn failed_reload_keeps_previous_script_running() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), SCRIPT);
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();
        runtime.set_input("Right", true);
        runtime.run(30, 42);
        fs::write(dir.path().join("scripts/main.luau"), "return broken syntax").unwrap();
        assert!(runtime.reload().is_err());
        let report = runtime.run(30, 42).value.unwrap();
        let x = report.world.entities.get("player").unwrap().transform.x;
        assert!((x - 4.0).abs() < 0.000_001);
    }

    #[test]
    fn reload_if_changed_swaps_script_and_preserves_world_state() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), SCRIPT);
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();
        runtime.set_input("Right", true);
        runtime.run(30, 42);

        let faster_script = SCRIPT.replace("speed: number = 4", "speed: number = 12");
        fs::write(dir.path().join("scripts/main.luau"), faster_script).unwrap();
        assert!(runtime.reload_if_changed().unwrap());

        let report = runtime.run(30, 42).value.unwrap();
        let x = report.world.entities.get("player").unwrap().transform.x;
        assert!((x - 8.0).abs() < 0.000_001);
    }

    #[test]
    fn input_sequence_is_relative_to_run_and_clears_missing_frames() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), SCRIPT);
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();
        let mut held = BTreeMap::new();
        held.insert("Right".to_string(), true);
        let sequence = vec![held; 30]
            .into_iter()
            .chain((0..30).map(|_| BTreeMap::new()))
            .collect::<Vec<_>>();

        let report = runtime
            .run_with_input_sequence(60, 42, &sequence)
            .value
            .unwrap();
        let x = report.world.entities.get("player").unwrap().transform.x;
        assert!((x - 2.0).abs() < 0.000_001);
    }
}
