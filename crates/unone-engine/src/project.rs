use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::diagnostics::{ActionSuggestion, Diagnostic, EngineResult};
use crate::world::Vec2;

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectConfig {
    pub name: String,
    #[serde(default = "default_entry_script")]
    pub entry_script: String,
    #[serde(default)]
    pub main_scene: Option<String>,
    #[serde(default)]
    pub test_files: Vec<String>,
    #[serde(default)]
    pub bundle_manifest: Option<String>,
    #[serde(default)]
    pub asset_manifest: Option<String>,
    /// Screens `verify` must check the layout of.
    ///
    /// Without this only the opening screen is ever drawn, so a broken win or
    /// lose screen passes every gate. Each entry says how to reach a screen,
    /// the same way `test_files` says how to reach a state worth asserting.
    #[serde(default)]
    pub ui_previews: Vec<UiPreviewSpec>,
    /// Engine systems this game explicitly turns on or off.
    ///
    /// Anything not declared keeps the engine default; the engine rejects
    /// unknown ids instead of treating a typo as a disabled system.
    #[serde(default)]
    pub systems: BTreeMap<String, bool>,
    /// Which gates `verify` runs, in what order, and which of them are
    /// advisory.
    ///
    /// Undeclared means the engine's default order with every gate required.
    #[serde(default)]
    pub verify: Option<VerifyConfig>,
    /// Sound categories and the rules between them.
    ///
    /// Undeclared means no rules, not no sound: a game can still play and loop
    /// without ever naming a category. Categories exist to say what happens
    /// *between* sounds, which is the part the engine owns.
    #[serde(default)]
    pub audio: Option<crate::audio::AudioConfig>,
}

fn default_entry_script() -> String {
    "scripts/main.luau".to_string()
}

#[derive(Debug, Clone)]
pub struct ProjectPaths {
    pub root: PathBuf,
    pub config: PathBuf,
    pub entry_script: PathBuf,
    pub main_scene: Option<PathBuf>,
    pub test_files: Vec<PathBuf>,
    pub bundle_manifest: Option<PathBuf>,
    pub asset_manifest: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectFileStatus {
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInspectReport {
    pub project: String,
    pub root: String,
    pub config: ProjectFileStatus,
    pub entry_script: ProjectFileStatus,
    pub main_scene: Option<ProjectFileStatus>,
    pub test_files: Vec<ProjectFileStatus>,
    pub bundle_manifest: Option<ProjectFileStatus>,
    pub asset_manifest: Option<ProjectFileStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInitReport {
    pub project: String,
    pub root: String,
    pub files: Vec<ProjectInitFile>,
    pub workflow_scope: String,
    pub suggested_next_actions: Vec<ProjectInitAction>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInitFile {
    pub path: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInitAction {
    pub executable: String,
    pub argv: Vec<String>,
    pub reason: String,
    pub prerequisites: Vec<usize>,
}

/// Resolve a project-relative path without allowing lexical traversal or
/// symlinks to escape the project root.
///
/// Project paths use `/` as their portable separator. The final component may
/// be missing so callers can report a useful missing-file diagnostic; every
/// existing target or ancestor is still checked canonically.
pub(crate) fn resolve_project_path(
    root: &Path,
    relative: &str,
) -> Result<PathBuf, Box<Diagnostic>> {
    if relative.trim().is_empty()
        || relative.contains('\\')
        || relative.contains('\0')
        || relative.starts_with('/')
        || relative.starts_with("//")
        || relative.as_bytes().get(1) == Some(&b':')
    {
        return Err(Box::new(Diagnostic::error(
            "PROJECT_PATH_OUTSIDE_PROJECT",
            "Project path is not a safe relative path",
            format!(
                "'{relative}' must use a project-relative forward-slash path; it cannot be absolute, a drive path, or contain backslashes."
            ),
        )));
    }

    for component in relative.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err(Box::new(Diagnostic::error(
                "PROJECT_PATH_OUTSIDE_PROJECT",
                "Project path escapes the project root",
                format!(
                    "'{relative}' contains a blank, current-directory, or parent path component; only explicit project-relative paths are accepted."
                ),
            )));
        }
        if component.contains(':') {
            return Err(Box::new(Diagnostic::error(
                "PROJECT_PATH_OUTSIDE_PROJECT",
                "Project path is not a portable relative path",
                format!("'{relative}' contains an invalid drive or URL marker."),
            )));
        }
    }

    let canonical_root = fs::canonicalize(root).map_err(|error| {
        Box::new(Diagnostic::error(
            "PROJECT_ROOT_INVALID",
            "Could not resolve the project root",
            format!("{}: {}", root.display(), error),
        ))
    })?;
    let candidate = canonical_root.join(relative);

    let mut existing = candidate.as_path();
    let canonical_existing = loop {
        match fs::symlink_metadata(existing) {
            Ok(_) => break fs::canonicalize(existing),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                existing = existing.parent().ok_or_else(|| {
                    Box::new(Diagnostic::error(
                        "PROJECT_PATH_INVALID",
                        "Could not resolve the project path",
                        format!("'{relative}' has no existing parent directory to inspect."),
                    ))
                })?;
            }
            Err(error) => {
                return Err(Box::new(Diagnostic::error(
                    "PROJECT_PATH_RESOLVE_FAILED",
                    "Could not resolve the project path",
                    format!("{}: {}", existing.display(), error),
                )));
            }
        }
    }
    .map_err(|error| {
        Box::new(Diagnostic::error(
            "PROJECT_PATH_RESOLVE_FAILED",
            "Could not resolve the project path",
            format!("{}: {}", existing.display(), error),
        ))
    })?;
    if !canonical_existing.starts_with(&canonical_root) {
        return Err(Box::new(Diagnostic::error(
            "PROJECT_PATH_OUTSIDE_PROJECT",
            "Project path escapes the project root through a symlink",
            format!(
                "'{relative}' resolves to '{}', outside project root '{}'.",
                canonical_existing.display(),
                canonical_root.display()
            ),
        )));
    }

    Ok(candidate)
}

impl ProjectPaths {
    pub fn discover(root: impl AsRef<Path>) -> Result<(ProjectConfig, Self), Box<Diagnostic>> {
        let root = fs::canonicalize(root.as_ref()).map_err(|error| {
            Box::new(Diagnostic::error(
                "PROJECT_ROOT_NOT_FOUND",
                "Unone project root was not found",
                format!("{}: {}", root.as_ref().display(), error),
            ))
        })?;
        let config_path = resolve_project_path(&root, "project.unone.json")?;
        let text = fs::read_to_string(&config_path).map_err(|err| {
            Box::new(Diagnostic::error(
                "PROJECT_CONFIG_NOT_FOUND",
                "Unone project configuration was not found",
                format!("Could not read {}: {}", config_path.display(), err),
            ))
        })?;
        let config: ProjectConfig = serde_json::from_str(&text).map_err(|err| {
            Box::new(Diagnostic::error(
                "PROJECT_CONFIG_INVALID",
                "Unone project configuration is not valid JSON",
                format!("{}: {}", config_path.display(), err),
            ))
        })?;
        let entry_script = resolve_project_path(&root, &config.entry_script)?;
        let main_scene = config
            .main_scene
            .as_deref()
            .map(|path| resolve_project_path(&root, path))
            .transpose()?;
        let test_files = config
            .test_files
            .iter()
            .map(|path| resolve_project_path(&root, path))
            .collect::<Result<Vec<_>, _>>()?;
        let asset_manifest = config
            .asset_manifest
            .as_deref()
            .map(|path| resolve_project_path(&root, path))
            .transpose()?;
        let bundle_manifest = config
            .bundle_manifest
            .as_deref()
            .map(|path| resolve_project_path(&root, path))
            .transpose()?;
        Ok((
            config,
            Self {
                root,
                config: config_path,
                entry_script,
                main_scene,
                test_files,
                bundle_manifest,
                asset_manifest,
            },
        ))
    }
}

/// Bootstrap a minimal, valid game project without adding game-specific rules.
///
/// This is a developer-tool operation. It gives an AI a canonical project
/// schema and entrypoint instead of requiring it to infer required fields.
pub fn init(project_root: impl AsRef<Path>, name: &str) -> EngineResult<ProjectInitReport> {
    let mut writer = StdInitFileWriter;
    init_with_writer(project_root, name, &mut writer)
}

fn init_with_writer<W: InitFileWriter>(
    project_root: impl AsRef<Path>,
    name: &str,
    writer: &mut W,
) -> EngineResult<ProjectInitReport> {
    let requested_root = project_root.as_ref().to_path_buf();
    let requested_root_text = path_string(&requested_root);
    let tracker = InitTracker::default();
    if name.trim().is_empty() {
        return init_failure(
            Diagnostic::error(
                "PROJECT_INIT_NAME_INVALID",
            "Project name cannot be empty",
            "Provide a non-empty --name; project init does not guess a project name for AI.",
            ),
            None,
            "preflight",
            &requested_root_text,
            &tracker,
        );
    }

    let artifacts = init_artifacts(name);
    let root_plan = match preflight_init_root(&requested_root) {
        Ok(root_plan) => root_plan,
        Err(failure) => {
            let InitPreflightFailure {
                diagnostic,
                root,
                failed_path,
            } = *failure;
            return init_failure(
                diagnostic,
                root.as_deref(),
                "preflight",
                &failed_path,
                &tracker,
            );
        }
    };
    let plan = InitPlan::new(root_plan, artifacts);
    execute_init(&plan, name, writer)
}

/// The entry script a new project starts from.
///
/// The engine's Luau runtime has no module require, so a single-file game must
/// carry its own type declarations. Inlining the engine's canonical contract is
/// what makes `game check --types` able to reject a call to an API that does
/// not exist; a scaffold typed `any` reports success for anything.
fn scaffold_script() -> String {
    let types = crate::api::typings()
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "--!strict
-- Engine type contract, inlined by `project init`.
-- Refresh it after an engine upgrade with `game api typings`.
{}

-- Game code starts here. Rules, numbers, ViewModels and save schemas are
-- game-owned; the engine only provides the API declared above.
local Game = {{}}

function Game.start(_api: EngineApi)
end

function Game.update(api: EngineApi, dt: number)
    if api.input.isDown(\"Right\") then
        local position = api.entity.getPosition(\"example\")
        position.x += dt
        api.entity.setPosition(\"example\", position)
    end
end

return Game
",
        types.trim()
    )
}

struct InitFileSpec {
    project_relative_path: &'static str,
    role: &'static str,
    bytes: Vec<u8>,
}

struct InitDirectory {
    absolute_path: PathBuf,
    project_relative_path: Option<String>,
}

struct InitRootPlan {
    root: PathBuf,
    directories: Vec<InitDirectory>,
}

struct InitPlan {
    root: PathBuf,
    directories: Vec<InitDirectory>,
    files: Vec<InitFileSpecWithPath>,
}

struct InitFileSpecWithPath {
    absolute_path: PathBuf,
    project_relative_path: String,
    role: String,
    bytes: Vec<u8>,
}

impl InitPlan {
    fn new(root_plan: InitRootPlan, artifacts: Vec<InitFileSpec>) -> Self {
        let root = root_plan.root;
        let mut directories = root_plan.directories;
        for project_relative_path in ["scenes", "scripts", "tests"] {
            directories.push(InitDirectory {
                absolute_path: root.join(project_relative_path),
                project_relative_path: Some(project_relative_path.to_string()),
            });
        }

        let mut files = artifacts
            .into_iter()
            .map(|artifact| InitFileSpecWithPath {
                absolute_path: root.join(artifact.project_relative_path),
                project_relative_path: artifact.project_relative_path.to_string(),
                role: artifact.role.to_string(),
                bytes: artifact.bytes,
            })
            .collect::<Vec<_>>();
        files.sort_by(|left, right| left.project_relative_path.cmp(&right.project_relative_path));

        Self {
            root,
            directories,
            files,
        }
    }
}

#[derive(Debug)]
struct InitPreflightFailure {
    diagnostic: Diagnostic,
    root: Option<PathBuf>,
    failed_path: String,
}

#[derive(Debug, Default)]
struct InitTracker {
    created_files: Vec<CreatedInitFile>,
    created_directories: Vec<CreatedInitDirectory>,
}

#[derive(Debug, Clone)]
struct CreatedInitFile {
    absolute_path: PathBuf,
    project_relative_path: String,
    complete: bool,
}

#[derive(Debug, Clone)]
struct CreatedInitDirectory {
    absolute_path: PathBuf,
    project_relative_path: Option<String>,
}

impl InitTracker {
    fn record_directory(&mut self, directory: &InitDirectory) {
        self.created_directories.push(CreatedInitDirectory {
            absolute_path: directory.absolute_path.clone(),
            project_relative_path: directory.project_relative_path.clone(),
        });
    }

    fn record_file(&mut self, file: &InitFileSpecWithPath) -> usize {
        self.created_files.push(CreatedInitFile {
            absolute_path: file.absolute_path.clone(),
            project_relative_path: file.project_relative_path.clone(),
            complete: false,
        });
        self.created_files.len() - 1
    }

    fn complete_file(&mut self, index: usize) {
        self.created_files[index].complete = true;
    }

    fn facts(&self, root: Option<&Path>, phase: &str, failed_path: &str) -> serde_json::Value {
        let mut files = self.created_files.clone();
        files.sort_by(|left, right| left.absolute_path.cmp(&right.absolute_path));
        let mut directories = self.created_directories.clone();
        directories.sort_by(|left, right| left.absolute_path.cmp(&right.absolute_path));

        serde_json::json!({
            "root": root.map(path_string),
            "phase": phase,
            "failed_path": failed_path,
            "created_files": files
                .iter()
                .map(|file| serde_json::json!({
                    "absolute_path": path_string(&file.absolute_path),
                    "project_relative_path": file.project_relative_path.clone(),
                    "complete": file.complete,
                }))
                .collect::<Vec<_>>(),
            "created_directories": directories
                .iter()
                .map(|directory| serde_json::json!({
                    "absolute_path": path_string(&directory.absolute_path),
                    "project_relative_path": directory.project_relative_path.clone(),
                }))
                .collect::<Vec<_>>(),
        })
    }

    fn effects(&self) -> Vec<String> {
        let mut effects = self
            .created_directories
            .iter()
            .map(|directory| {
                (
                    directory.absolute_path.clone(),
                    format!(
                        "created_directory:{}",
                        path_string(&directory.absolute_path)
                    ),
                )
            })
            .chain(self.created_files.iter().map(|file| {
                (
                    file.absolute_path.clone(),
                    format!("created_file:{}", path_string(&file.absolute_path)),
                )
            }))
            .collect::<Vec<_>>();
        effects.sort_by(|left, right| left.0.cmp(&right.0));
        effects.into_iter().map(|(_, effect)| effect).collect()
    }
}

trait InitFileWriter {
    fn create_new(&mut self, path: &Path) -> io::Result<Box<dyn Write>>;
}

struct StdInitFileWriter;

impl InitFileWriter for StdInitFileWriter {
    fn create_new(&mut self, path: &Path) -> io::Result<Box<dyn Write>> {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map(|file| Box::new(file) as Box<dyn Write>)
    }
}

fn init_artifacts(name: &str) -> Vec<InitFileSpec> {
    let mut config_bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "name": name,
        "entry_script": "scripts/main.luau",
        "main_scene": "scenes/main.scene.json",
        "test_files": [
            "tests/bootstrap-idle.test.json",
            "tests/bootstrap-input.test.json",
        ],
    }))
    .expect("a serde_json::Value is always serializable");
    config_bytes.push(b'\n');

    let mut files = vec![
        InitFileSpec {
            project_relative_path: "project.unone.json",
            role: "project_config",
            bytes: config_bytes,
        },
        InitFileSpec {
            project_relative_path: "scripts/main.luau",
            role: "entry_script",
            bytes: scaffold_script().into_bytes(),
        },
        InitFileSpec {
            project_relative_path: "scenes/main.scene.json",
            role: "main_scene",
            bytes: json_bytes(serde_json::json!({
                "entities": [{
                    "id": "example",
                    "transform": {"x": 0.0, "y": 0.0},
                }],
            })),
        },
        InitFileSpec {
            project_relative_path: "tests/bootstrap-idle.test.json",
            role: "bootstrap_idle_test",
            bytes: json_bytes(serde_json::json!({
                "name": "bootstrap-idle",
                "frames": 60,
                "seed": 42,
                "input": {},
                "assertions": [
                    {"entity": "example", "field": "transform.x", "equals": 0.0},
                    {"entity": "example", "field": "transform.y", "equals": 0.0},
                ],
            })),
        },
        InitFileSpec {
            project_relative_path: "tests/bootstrap-input.test.json",
            role: "bootstrap_input_test",
            bytes: json_bytes(serde_json::json!({
                "name": "bootstrap-input",
                "frames": 60,
                "seed": 42,
                "input": {"Right": true},
                "assertions": [
                    {"entity": "example", "field": "transform.x", "equals": 1.0},
                    {"entity": "example", "field": "transform.y", "equals": 0.0},
                ],
            })),
        },
    ];
    files.sort_by(|left, right| left.project_relative_path.cmp(right.project_relative_path));
    files
}

fn json_bytes(value: serde_json::Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(&value).expect("a serde_json::Value is serializable");
    bytes.push(b'\n');
    bytes
}

fn preflight_init_root(requested: &Path) -> Result<InitRootPlan, Box<InitPreflightFailure>> {
    let requested_text = path_string(requested);
    let absolute = match absolute_init_root(requested) {
        Ok(path) => path,
        Err(explanation) => {
            // Saying what is wrong without saying what to type sends the author
            // guessing at path syntax, which is where `..` came from.
            let mut diagnostic = Diagnostic::error(
                "PROJECT_ROOT_INVALID",
                "Invalid project root path",
                explanation,
            );
            diagnostic.suggested_actions.push(ActionSuggestion {
                action: "use_absolute_project_root".to_string(),
                description: "Use an absolute path; relative paths cannot contain '..'. In PowerShell, create the directory and resolve it first:"
                    .to_string(),
                command: Some(
                    "New-Item -ItemType Directory -Force ../my-game | Out-Null; game --project (Resolve-Path ../my-game) --json project init --name MyGame"
                        .to_string(),
                ),
            });
            return Err(Box::new(InitPreflightFailure {
                diagnostic,
                root: None,
                failed_path: requested_text,
            }));
        }
    };

    let (nearest_existing, target_exists) = {
        let mut cursor = absolute.clone();
        loop {
            match fs::symlink_metadata(&cursor) {
                Ok(_) => {
                    let target_exists = cursor == absolute;
                    break (cursor, target_exists);
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    let Some(parent) = cursor.parent() else {
                        return Err(Box::new(InitPreflightFailure {
                            diagnostic: Diagnostic::error(
                                "PROJECT_ROOT_INVALID",
                                "Could not resolve the project root path",
                                "No existing ancestor can be safely inspected.",
                            ),
                            root: None,
                            failed_path: requested_text,
                        }));
                    };
                    if parent == cursor {
                        return Err(Box::new(InitPreflightFailure {
                            diagnostic: Diagnostic::error(
                                "PROJECT_ROOT_INVALID",
                                "Could not resolve the project root path",
                                "No existing ancestor can be safely inspected.",
                            ),
                            root: None,
                            failed_path: requested_text,
                        }));
                    }
                    cursor = parent.to_path_buf();
                }
                Err(error) => {
                    return Err(Box::new(InitPreflightFailure {
                        diagnostic: Diagnostic::error(
                            "PROJECT_ROOT_INVALID",
                            "Could not inspect the project root path",
                            format!("{}: {}", cursor.display(), error),
                        ),
                        root: None,
                        failed_path: requested_text,
                    }));
                }
            }
        }
    };

    let mut ancestors = nearest_existing
        .ancestors()
        .map(|path| path.to_path_buf())
        .collect::<Vec<_>>();
    ancestors.reverse();
    for ancestor in ancestors {
        let metadata = match fs::symlink_metadata(&ancestor) {
            Ok(metadata) => metadata,
            Err(error) => {
                return Err(Box::new(InitPreflightFailure {
                    diagnostic: Diagnostic::error(
                        "PROJECT_ROOT_INVALID",
                        "Could not inspect the project root ancestor",
                        format!("{}: {}", ancestor.display(), error),
                    ),
                    root: None,
                    failed_path: requested_text,
                }));
            }
        };
        let is_reparse = match init_metadata_is_reparse(&ancestor, &metadata) {
            Ok(value) => value,
            Err(error) => {
                return Err(Box::new(InitPreflightFailure {
                    diagnostic: Diagnostic::error(
                        "PROJECT_ROOT_INVALID",
                        "Could not inspect the project root ancestor",
                        format!("{}: {}", ancestor.display(), error),
                    ),
                    root: None,
                    failed_path: requested_text,
                }));
            }
        };
        if is_reparse {
            return Err(Box::new(InitPreflightFailure {
                diagnostic: Diagnostic::error(
                    "PROJECT_ROOT_INVALID",
                    "project init rejects symlinks, junctions, and reparse points",
                    format!(
                        "{} is a link/reparse path component; project creation will not follow it.",
                        ancestor.display()
                    ),
                ),
                root: None,
                failed_path: requested_text,
            }));
        }
        if !metadata.is_dir() {
            return Err(Box::new(InitPreflightFailure {
                diagnostic: Diagnostic::error(
                    "PROJECT_ROOT_INVALID",
                    "project root path component is not a directory",
                    format!(
                        "{} is not a directory; project creation will not create a project beneath it.",
                        ancestor.display()
                    ),
                ),
                root: None,
                failed_path: requested_text,
            }));
        }
    }

    if target_exists {
        let canonical_root = match fs::canonicalize(&absolute) {
            Ok(path) => path,
            Err(error) => {
                return Err(Box::new(InitPreflightFailure {
                    diagnostic: Diagnostic::error(
                        "PROJECT_ROOT_INVALID",
                        "Could not canonicalize the project root",
                        format!("{}: {}", absolute.display(), error),
                    ),
                    root: None,
                    failed_path: requested_text,
                }));
            }
        };
        let mut entries = match fs::read_dir(&canonical_root) {
            Ok(entries) => entries,
            Err(error) => {
                return Err(Box::new(InitPreflightFailure {
                    diagnostic: Diagnostic::error(
                        "PROJECT_ROOT_INVALID",
                        "Could not list the project root",
                        format!(
                            "{}: {}; an unreadable directory cannot be treated as empty.",
                            canonical_root.display(),
                            error
                        ),
                    ),
                    root: Some(canonical_root),
                    failed_path: path_string(&absolute),
                }));
            }
        };
        match entries.next() {
            Some(Ok(entry)) => {
                return Err(Box::new(InitPreflightFailure {
                    diagnostic: Diagnostic::error(
                        "PROJECT_ALREADY_EXISTS",
                        "project init requires a truly empty root",
                        format!(
                            "{} already contains {}; project init will not clean, merge, or overwrite existing contents.",
                            canonical_root.display(),
                            entry.path().display()
                        ),
                    ),
                    root: Some(canonical_root.clone()),
                    failed_path: path_string(&canonical_root),
                }));
            }
            Some(Err(error)) => {
                return Err(Box::new(InitPreflightFailure {
                    diagnostic: Diagnostic::error(
                        "PROJECT_ROOT_INVALID",
                        "Could not list the project root",
                        format!(
                            "{}: {}; an unreadable directory cannot be treated as empty.",
                            canonical_root.display(),
                            error
                        ),
                    ),
                    root: Some(canonical_root),
                    failed_path: path_string(&absolute),
                }));
            }
            None => {
                return Ok(InitRootPlan {
                    root: canonical_root,
                    directories: Vec::new(),
                });
            }
        }
    }

    let missing_components = match missing_root_components(&absolute, &nearest_existing) {
        Ok(components) if !components.is_empty() => components,
        Ok(_) => {
            return Err(Box::new(InitPreflightFailure {
                diagnostic: Diagnostic::error(
                    "PROJECT_ROOT_INVALID",
                    "Could not resolve the project root path",
                    "No missing components were found between the project root and the nearest existing ancestor.",
                ),
                root: None,
                failed_path: requested_text,
            }));
        }
        Err(explanation) => {
            return Err(Box::new(InitPreflightFailure {
                diagnostic: Diagnostic::error(
                    "PROJECT_ROOT_INVALID",
                    "Could not resolve the project root path",
                    explanation,
                ),
                root: None,
                failed_path: requested_text,
            }));
        }
    };
    let canonical_ancestor = match fs::canonicalize(&nearest_existing) {
        Ok(path) => path,
        Err(error) => {
            return Err(Box::new(InitPreflightFailure {
                diagnostic: Diagnostic::error(
                    "PROJECT_ROOT_INVALID",
                    "Could not canonicalize the nearest existing ancestor",
                    format!("{}: {}", nearest_existing.display(), error),
                ),
                root: None,
                failed_path: requested_text,
            }));
        }
    };

    let mut root = canonical_ancestor;
    let last_component = missing_components.len() - 1;
    let mut directories = Vec::with_capacity(missing_components.len());
    for (index, component) in missing_components.into_iter().enumerate() {
        root.push(component);
        directories.push(InitDirectory {
            absolute_path: root.clone(),
            project_relative_path: (index == last_component).then(|| ".".to_string()),
        });
    }
    Ok(InitRootPlan { root, directories })
}

fn absolute_init_root(requested: &Path) -> Result<PathBuf, String> {
    if requested.to_string_lossy().contains('\0') {
        return Err("project root path cannot contain NUL.".to_string());
    }
    if requested
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(
            "project root path does not accept parent '..' components; provide a path already within the intended scope."
                .to_string(),
        );
    }
    #[cfg(windows)]
    if matches!(requested.components().next(), Some(Component::Prefix(_)))
        && !requested.is_absolute()
    {
        return Err(
            "Windows drive-relative project root paths are unsafe; provide a complete absolute path."
                .to_string(),
        );
    }

    if requested.is_absolute() {
        Ok(requested.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|current| current.join(requested))
            .map_err(|error| format!("Could not get the current directory: {error}"))
    }
}

fn missing_root_components(
    absolute: &Path,
    nearest_existing: &Path,
) -> Result<Vec<std::ffi::OsString>, String> {
    let mut cursor = absolute.to_path_buf();
    let mut components = Vec::new();
    while cursor != nearest_existing {
        let name = cursor
            .file_name()
            .ok_or_else(|| format!("{} has no creatable path component.", cursor.display()))?;
        components.push(name.to_os_string());
        let parent = cursor
            .parent()
            .ok_or_else(|| format!("{} has no parent directory to inspect.", cursor.display()))?;
        if parent == cursor {
            return Err(format!("{} cannot reach an existing ancestor.", cursor.display()));
        }
        cursor = parent.to_path_buf();
    }
    components.reverse();
    Ok(components)
}

fn init_metadata_is_reparse(path: &Path, metadata: &fs::Metadata) -> io::Result<bool> {
    if metadata.file_type().is_symlink() {
        return Ok(true);
    }
    init_platform_reparse_point(path)
}

#[cfg(windows)]
fn init_platform_reparse_point(path: &Path) -> io::Result<bool> {
    use std::os::windows::ffi::OsStrExt;

    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_REPARSE_POINT, GetFileAttributesW, INVALID_FILE_ATTRIBUTES,
    };

    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let attributes = unsafe { GetFileAttributesW(wide.as_ptr()) };
    if attributes == INVALID_FILE_ATTRIBUTES {
        return Err(io::Error::last_os_error());
    }
    Ok(attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0)
}

#[cfg(not(windows))]
fn init_platform_reparse_point(_path: &Path) -> io::Result<bool> {
    Ok(false)
}

fn execute_init<W: InitFileWriter>(
    plan: &InitPlan,
    project_name: &str,
    writer: &mut W,
) -> EngineResult<ProjectInitReport> {
    let mut tracker = InitTracker::default();
    for directory in &plan.directories {
        if let Err(error) = fs::create_dir(&directory.absolute_path) {
            return init_failure(
                Diagnostic::error(
                    "PROJECT_INIT_WRITE_FAILED",
                    "Could not create the project init directory",
                    format!("{}: {}", directory.absolute_path.display(), error),
                ),
                Some(&plan.root),
                "create_directory",
                &path_string(&directory.absolute_path),
                &tracker,
            );
        }
        tracker.record_directory(directory);
    }

    for file in &plan.files {
        let mut output = match writer.create_new(&file.absolute_path) {
            Ok(output) => output,
            Err(error) => {
                return init_failure(
                    Diagnostic::error(
                        "PROJECT_INIT_WRITE_FAILED",
                        "Could not create the project init file",
                        format!("{}: {}", file.absolute_path.display(), error),
                    ),
                    Some(&plan.root),
                    "create_file",
                    &path_string(&file.absolute_path),
                    &tracker,
                );
            }
        };
        let file_index = tracker.record_file(file);
        if let Err(error) = output.write_all(&file.bytes) {
            return init_failure(
                Diagnostic::error(
                    "PROJECT_INIT_WRITE_FAILED",
                    "Could not completely write the project init file",
                    format!("{}: {}", file.absolute_path.display(), error),
                ),
                Some(&plan.root),
                "write_file",
                &path_string(&file.absolute_path),
                &tracker,
            );
        }
        tracker.complete_file(file_index);
    }

    let mut result = EngineResult::success(ProjectInitReport {
        project: project_name.to_string(),
        root: path_string(&plan.root),
        files: plan
            .files
            .iter()
            .map(|file| ProjectInitFile {
                path: file.project_relative_path.clone(),
                role: file.role.clone(),
            })
            .collect(),
        workflow_scope: "new_unmodified_scaffold".to_string(),
        suggested_next_actions: suggested_next_actions(&plan.root),
    });
    result.effects = tracker.effects();
    result
}

fn init_failure<T: Serialize>(
    mut diagnostic: Diagnostic,
    root: Option<&Path>,
    phase: &str,
    failed_path: &str,
    tracker: &InitTracker,
) -> EngineResult<T> {
    diagnostic.facts = tracker.facts(root, phase, failed_path);
    let effects = tracker.effects();
    let mut result = EngineResult::failure(diagnostic);
    result.effects = effects;
    result
}

fn suggested_next_actions(root: &Path) -> Vec<ProjectInitAction> {
    let project = path_string(root);
    vec![
        ProjectInitAction {
            executable: "game".to_string(),
            argv: vec![
                "--project".to_string(),
                project.clone(),
                "--json".to_string(),
                "verify".to_string(),
            ],
            reason: "First verify the newly generated, unmodified five-file starter; this only confirms the onboarding smoke test.".to_string(),
            prerequisites: Vec::new(),
        },
        ProjectInitAction {
            executable: "game".to_string(),
            argv: vec![
                "--project".to_string(),
                project.clone(),
                "--json".to_string(),
                "bundle".to_string(),
                "pack".to_string(),
            ],
            reason: "Create the bundle only after verify; init does not implicitly pack or activate a bundle.".to_string(),
            prerequisites: vec![0],
        },
        ProjectInitAction {
            executable: "game".to_string(),
            argv: vec![
                "--project".to_string(),
                project.clone(),
                "--json".to_string(),
                "bundle".to_string(),
                "install".to_string(),
                "--all".to_string(),
            ],
            reason: "Activate every bundle declared by the manifest after packing; this step remains explicit.".to_string(),
            prerequisites: vec![1],
        },
        ProjectInitAction {
            executable: "game".to_string(),
            argv: vec![
                "--project".to_string(),
                project,
                "--json".to_string(),
                "bundle".to_string(),
                "inspect".to_string(),
            ],
            reason: "Inspect the active bundle after installation; after adding assets, return to the existing pack → verify/strict → install workflow.".to_string(),
            prerequisites: vec![2],
        },
    ]
}

pub fn inspect(project_root: impl AsRef<Path>) -> EngineResult<ProjectInspectReport> {
    let (config, paths) = match ProjectPaths::discover(project_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let report = ProjectInspectReport {
        project: config.name,
        root: paths.root.display().to_string(),
        config: file_status(&paths.config),
        entry_script: file_status(&paths.entry_script),
        main_scene: paths.main_scene.as_deref().map(file_status),
        test_files: paths
            .test_files
            .iter()
            .map(|path| file_status(path))
            .collect(),
        bundle_manifest: paths.bundle_manifest.as_deref().map(file_status),
        asset_manifest: paths.asset_manifest.as_deref().map(file_status),
    };
    let mut result = EngineResult::success(report);
    if let Some(report) = &result.value {
        let mut missing = Vec::new();
        if !report.entry_script.exists {
            missing.push(report.entry_script.path.clone());
        }
        if let Some(scene) = &report.main_scene
            && !scene.exists
        {
            missing.push(scene.path.clone());
        }
        missing.extend(
            report
                .test_files
                .iter()
                .filter(|file| !file.exists)
                .map(|file| file.path.clone()),
        );
        if let Some(bundle) = &report.bundle_manifest
            && !bundle.exists
        {
            missing.push(bundle.path.clone());
        }
        if let Some(assets) = &report.asset_manifest
            && !assets.exists
        {
            missing.push(assets.path.clone());
        }
        if !missing.is_empty() {
            result.diagnostics.push(Diagnostic::warning(
                "PROJECT_FILES_MISSING",
                "The project declares files that do not exist",
                "The configuration is readable, but an entrypoint, scene, test, asset manifest, or bundle manifest is missing; fix the path or create the file next.",
            ));
            if let Some(diagnostic) = result.diagnostics.last_mut() {
                diagnostic.facts = serde_json::json!({"missing": missing});
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs::{self, OpenOptions},
        io::{self, Write},
        path::Path,
    };

    use tempfile::tempdir;

    use super::{
        InitFileWriter, TestAssertion, TestSpec, init, inspect, path_string, resolve_project_path,
    };

    #[test]
    fn init_creates_the_five_file_starter_and_structured_actions() {
        let directory = tempdir().expect("temp project directory");
        let result = init(directory.path(), "ai-smoke");
        assert!(result.ok, "{:?}", result.diagnostics);
        let report = result.value.expect("init report");
        assert_eq!(report.project, "ai-smoke");
        assert_eq!(
            report.root,
            path_string(&fs::canonicalize(directory.path()).unwrap())
        );
        assert_eq!(
            report
                .files
                .iter()
                .map(|file| (file.path.as_str(), file.role.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("project.unone.json", "project_config"),
                ("scenes/main.scene.json", "main_scene"),
                ("scripts/main.luau", "entry_script"),
                ("tests/bootstrap-idle.test.json", "bootstrap_idle_test"),
                ("tests/bootstrap-input.test.json", "bootstrap_input_test"),
            ]
        );
        assert_eq!(report.workflow_scope, "new_unmodified_scaffold");
        assert_eq!(report.suggested_next_actions.len(), 4);
        assert_eq!(report.suggested_next_actions[0].executable, "game");
        assert_eq!(
            report.suggested_next_actions[0].argv,
            vec![
                "--project".to_string(),
                report.root.clone(),
                "--json".to_string(),
                "verify".to_string()
            ]
        );
        assert_eq!(
            report.suggested_next_actions[0].prerequisites,
            Vec::<usize>::new()
        );
        assert_eq!(report.suggested_next_actions[1].prerequisites, vec![0]);
        assert_eq!(report.suggested_next_actions[2].prerequisites, vec![1]);
        assert_eq!(report.suggested_next_actions[3].prerequisites, vec![2]);
        assert!(
            result
                .effects
                .iter()
                .any(|effect| effect.contains("created_file:"))
        );

        let config: super::ProjectConfig = serde_json::from_str(
            &fs::read_to_string(directory.path().join("project.unone.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(config.entry_script, "scripts/main.luau");
        assert_eq!(config.main_scene.as_deref(), Some("scenes/main.scene.json"));
        assert_eq!(
            config.test_files,
            vec![
                "tests/bootstrap-idle.test.json".to_string(),
                "tests/bootstrap-input.test.json".to_string(),
            ]
        );

        let script = fs::read_to_string(directory.path().join("scripts/main.luau")).unwrap();
        assert!(script.starts_with("--!strict\n"));
        assert!(script.contains("export type EngineApi"));
        assert!(script.contains("api.input.isDown(\"Right\")"));
        assert!(script.contains("position.x += dt"));

        let scene: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(directory.path().join("scenes/main.scene.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(scene["entities"][0]["id"], "example");
        assert_eq!(
            scene["entities"][0]["transform"],
            serde_json::json!({"x": 0.0, "y": 0.0})
        );
        assert!(scene["entities"][0].get("rigidbody").is_none());
        assert!(scene["entities"][0].get("sprite").is_none());
        assert!(scene["entities"][0].get("asset").is_none());

        let idle: TestSpec = serde_json::from_str(
            &fs::read_to_string(directory.path().join("tests/bootstrap-idle.test.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(idle.frames, 60);
        assert_eq!(idle.seed, 42);
        assert!(idle.input.is_empty());
        assert_eq!(idle.assertions.len(), 2);
        assert!(
            idle.assertions
                .iter()
                .all(|assertion| assertion.validate().is_ok())
        );

        let input: TestSpec = serde_json::from_str(
            &fs::read_to_string(directory.path().join("tests/bootstrap-input.test.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(input.frames, 60);
        assert_eq!(input.seed, 42);
        assert_eq!(input.input.get("Right"), Some(&true));
        assert_eq!(input.assertions.len(), 2);
        assert!(
            input
                .assertions
                .iter()
                .all(|assertion| assertion.validate().is_ok())
        );

        let inspected = inspect(directory.path());
        assert!(inspected.ok, "{:?}", inspected.diagnostics);
        let report = inspected.value.expect("inspect report");
        assert!(report.entry_script.exists);
        assert!(report.main_scene.expect("main scene").exists);
        assert_eq!(report.test_files.len(), 2);
        assert!(report.test_files.iter().all(|file| file.exists));
    }

    #[test]
    fn generated_bootstrap_tests_run_and_wrong_movement_amount_fails() {
        let directory = tempdir().expect("temp project directory");
        assert!(init(directory.path(), "runtime-smoke").ok);

        let tests = crate::runtime::EngineRuntime::run_tests(directory.path());
        assert!(tests.ok, "{:?}", tests.diagnostics);
        let suite = tests.value.expect("test suite report");
        assert!(suite.passed, "{:?}", suite.cases);
        assert_eq!(suite.cases.len(), 2);

        let input_path = directory.path().join("tests/bootstrap-input.test.json");
        let original = fs::read(&input_path).unwrap();
        let mut changed: serde_json::Value = serde_json::from_slice(&original).unwrap();
        changed["assertions"][0]["equals"] = serde_json::json!(2.0);
        fs::write(&input_path, super::json_bytes(changed)).unwrap();

        let failed = crate::runtime::EngineRuntime::run_tests(directory.path());
        assert!(failed.ok, "test execution itself should complete");
        assert!(!failed.value.expect("failed assertion suite").passed);

        fs::write(input_path, original).unwrap();
    }

    #[test]
    fn init_rejects_empty_name_nonempty_root_and_repeat_without_mutation() {
        let directory = tempdir().expect("temp project directory");
        let empty_root = directory.path().join("empty-name");
        let empty_name = init(&empty_root, " \t");
        assert!(!empty_name.ok);
        assert_eq!(empty_name.diagnostics[0].code, "PROJECT_INIT_NAME_INVALID");
        assert!(empty_name.effects.is_empty());
        assert!(!empty_root.exists());
        assert_eq!(empty_name.diagnostics[0].facts["phase"], "preflight");
        assert!(empty_name.diagnostics[0].facts["root"].is_null());
        assert_eq!(
            empty_name.diagnostics[0].facts["failed_path"],
            serde_json::json!(path_string(&empty_root))
        );

        let nonempty_root = directory.path().join("nonempty");
        fs::create_dir(&nonempty_root).unwrap();
        fs::write(nonempty_root.join(".git"), b"sentinel").unwrap();
        let before = snapshot_tree(&nonempty_root);
        let nonempty = init(&nonempty_root, "should-not-overwrite");
        assert!(!nonempty.ok);
        assert_eq!(nonempty.diagnostics[0].code, "PROJECT_ALREADY_EXISTS");
        assert!(nonempty.effects.is_empty());
        assert_eq!(snapshot_tree(&nonempty_root), before);
        assert_eq!(nonempty.diagnostics[0].facts["phase"], "preflight");
        assert!(
            nonempty.diagnostics[0].facts["created_files"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert!(
            nonempty.diagnostics[0].facts["created_directories"]
                .as_array()
                .unwrap()
                .is_empty()
        );

        let created_root = directory.path().join("created");
        assert!(init(&created_root, "repeat").ok);
        let created_before = snapshot_tree(&created_root);
        let repeated = init(&created_root, "different-name");
        assert!(!repeated.ok);
        assert_eq!(repeated.diagnostics[0].code, "PROJECT_ALREADY_EXISTS");
        assert!(repeated.effects.is_empty());
        assert_eq!(snapshot_tree(&created_root), created_before);
    }

    #[test]
    fn init_rejects_parent_component_but_accepts_dot_and_unicode_paths() {
        let directory = tempdir().expect("temp project directory");
        let escaped = directory
            .path()
            .join("..")
            .join("unone-init-parent-component-must-not-exist");
        assert!(!escaped.exists());
        let escaped_result = init(&escaped, "escaped");
        assert!(!escaped_result.ok);
        assert_eq!(escaped_result.diagnostics[0].code, "PROJECT_ROOT_INVALID");
        assert!(escaped_result.effects.is_empty());
        assert!(escaped_result.diagnostics[0].facts["root"].is_null());
        assert_eq!(
            escaped_result.diagnostics[0].facts["failed_path"],
            serde_json::json!(path_string(&escaped))
        );
        assert!(!escaped.exists());

        let dot_root = directory.path().join(".").join("dot-project");
        let dot_result = init(&dot_root, "dot-project");
        assert!(dot_result.ok, "{:?}", dot_result.diagnostics);
        assert_eq!(
            dot_result.value.unwrap().root,
            path_string(&fs::canonicalize(directory.path().join("dot-project")).unwrap())
        );

        let unicode_root = directory.path().join("空 白-project");
        let unicode_result = init(&unicode_root, "unicode-project");
        assert!(unicode_result.ok, "{:?}", unicode_result.diagnostics);
        assert!(unicode_root.join("project.unone.json").is_file());
    }

    #[test]
    fn init_rejects_a_file_as_root_without_touching_it() {
        let directory = tempdir().expect("temp project directory");
        let file_root = directory.path().join("root-file");
        fs::write(&file_root, b"unchanged").unwrap();
        let before = fs::read(&file_root).unwrap();

        let result = init(&file_root, "file-root");
        assert!(!result.ok);
        assert_eq!(result.diagnostics[0].code, "PROJECT_ROOT_INVALID");
        assert!(result.effects.is_empty());
        assert_eq!(fs::read(&file_root).unwrap(), before);
        assert_eq!(result.diagnostics[0].facts["phase"], "preflight");
        assert!(
            result.diagnostics[0].facts["created_files"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    #[cfg(unix)]
    #[test]
    fn init_rejects_symlink_and_dangling_link_roots_and_ancestors() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp project directory");
        let outside = tempdir().expect("outside directory");
        let linked = directory.path().join("linked");
        symlink(outside.path(), &linked).expect("create linked directory");
        let before = snapshot_tree(directory.path());

        let linked_root = init(linked.join("new-project"), "linked");
        assert!(!linked_root.ok);
        assert_eq!(linked_root.diagnostics[0].code, "PROJECT_ROOT_INVALID");
        assert!(linked_root.effects.is_empty());
        assert_eq!(snapshot_tree(directory.path()), before);

        let dangling = directory.path().join("dangling");
        symlink(directory.path().join("not-created"), &dangling).expect("create dangling link");
        let dangling_root = init(&dangling, "dangling");
        assert!(!dangling_root.ok);
        assert_eq!(dangling_root.diagnostics[0].code, "PROJECT_ROOT_INVALID");
        assert!(dangling_root.effects.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn init_rejects_windows_reparse_roots_and_ancestors() {
        use std::os::windows::fs::symlink_dir;

        let directory = tempdir().expect("temp project directory");
        let outside = tempdir().expect("outside directory");
        let linked = directory.path().join("linked");
        if let Err(error) = symlink_dir(outside.path(), &linked) {
            eprintln!(
                "SKIP init_rejects_windows_reparse_roots_and_ancestors: symlink_dir failed: {error} (kind={:?})",
                error.kind()
            );
            return;
        }
        let before = snapshot_tree(directory.path());

        let linked_root = init(linked.join("new-project"), "linked");
        assert!(!linked_root.ok);
        assert_eq!(linked_root.diagnostics[0].code, "PROJECT_ROOT_INVALID");
        assert!(linked_root.effects.is_empty());
        assert_eq!(snapshot_tree(directory.path()), before);

        let dangling = directory.path().join("dangling");
        symlink_dir(directory.path().join("not-created"), &dangling).expect("create dangling link");
        let dangling_root = init(&dangling, "dangling");
        assert!(!dangling_root.ok);
        assert_eq!(dangling_root.diagnostics[0].code, "PROJECT_ROOT_INVALID");
        assert!(dangling_root.effects.is_empty());
    }

    #[test]
    fn init_create_failure_reports_directories_and_no_files() {
        let directory = tempdir().expect("temp project directory");
        let root = directory.path().join("create-failure");
        let mut writer = FaultInitFileWriter {
            fail_create_at: Some(0),
            fail_write_at: None,
            create_index: 0,
        };

        let result = super::init_with_writer(&root, "fault", &mut writer);
        assert!(!result.ok);
        assert!(result.value.is_none());
        let canonical_root = fs::canonicalize(&root).unwrap();
        let facts = &result.diagnostics[0].facts;
        assert_eq!(facts["phase"], "create_file");
        assert_eq!(
            facts["failed_path"],
            serde_json::json!(path_string(&canonical_root.join("project.unone.json")))
        );
        assert!(facts["created_files"].as_array().unwrap().is_empty());
        assert_eq!(facts["created_directories"].as_array().unwrap().len(), 4);
        assert_eq!(result.effects.len(), 4);
        assert!(!root.join("project.unone.json").exists());
        assert!(root.join("scripts").is_dir());
        assert!(root.join("scenes").is_dir());
        assert!(root.join("tests").is_dir());

        let retry = init(&root, "retry");
        assert!(!retry.ok);
        assert_eq!(retry.diagnostics[0].code, "PROJECT_ALREADY_EXISTS");
        assert!(retry.effects.is_empty());
    }

    #[test]
    fn init_mid_write_failure_tracks_partial_file_and_retry_is_no_overwrite() {
        let directory = tempdir().expect("temp project directory");
        let root = directory.path().join("write-failure");
        let mut writer = FaultInitFileWriter {
            fail_create_at: None,
            fail_write_at: Some(1),
            create_index: 0,
        };

        let result = super::init_with_writer(&root, "fault", &mut writer);
        assert!(!result.ok);
        assert!(result.value.is_none());
        let facts = &result.diagnostics[0].facts;
        assert_eq!(facts["phase"], "write_file");
        let canonical_root = fs::canonicalize(&root).unwrap();
        let created_files = facts["created_files"].as_array().unwrap();
        assert_eq!(created_files.len(), 2);
        assert_eq!(
            created_files[0]["project_relative_path"],
            "project.unone.json"
        );
        assert_eq!(created_files[0]["complete"], true);
        assert_eq!(
            created_files[1]["project_relative_path"],
            "scenes/main.scene.json"
        );
        assert_eq!(created_files[1]["complete"], false);

        let config_path = canonical_root.join("project.unone.json");
        let scene_path = canonical_root.join("scenes/main.scene.json");
        assert!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(&config_path).unwrap()).is_ok()
        );
        let partial_scene = fs::read(&scene_path).unwrap();
        let expected_scene = super::init_artifacts("fault")
            .into_iter()
            .find(|file| file.project_relative_path == "scenes/main.scene.json")
            .unwrap()
            .bytes;
        assert!(!partial_scene.is_empty());
        assert!(partial_scene.len() < expected_scene.len());
        assert!(
            result
                .effects
                .iter()
                .any(|effect| effect == &format!("created_file:{}", path_string(&config_path)))
        );
        assert!(
            result
                .effects
                .iter()
                .any(|effect| effect == &format!("created_file:{}", path_string(&scene_path)))
        );

        let before_retry = snapshot_tree(&root);
        let retry = init(&root, "retry");
        assert!(!retry.ok);
        assert_eq!(retry.diagnostics[0].code, "PROJECT_ALREADY_EXISTS");
        assert!(retry.effects.is_empty());
        assert_eq!(snapshot_tree(&root), before_retry);
    }

    struct FaultInitFileWriter {
        fail_create_at: Option<usize>,
        fail_write_at: Option<usize>,
        create_index: usize,
    }

    struct FaultFile {
        file: std::fs::File,
        fail_first_write: bool,
        failed: bool,
    }

    impl InitFileWriter for FaultInitFileWriter {
        fn create_new(&mut self, path: &Path) -> io::Result<Box<dyn Write>> {
            let index = self.create_index;
            self.create_index += 1;
            if self.fail_create_at == Some(index) {
                return Err(io::Error::other("injected create_new failure"));
            }
            let file = OpenOptions::new().write(true).create_new(true).open(path)?;
            Ok(Box::new(FaultFile {
                file,
                fail_first_write: self.fail_write_at == Some(index),
                failed: false,
            }))
        }
    }

    impl Write for FaultFile {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if self.fail_first_write && !self.failed {
                self.failed = true;
                let partial = bytes.len().min(8);
                if partial != 0 {
                    self.file.write_all(&bytes[..partial])?;
                }
                return Err(io::Error::other("injected mid-write failure"));
            }
            self.file.write(bytes)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.file.flush()
        }
    }

    fn snapshot_tree(root: &Path) -> BTreeMap<String, (String, Vec<u8>)> {
        fn visit(
            root: &Path,
            directory: &Path,
            snapshot: &mut BTreeMap<String, (String, Vec<u8>)>,
        ) {
            for entry in fs::read_dir(directory).unwrap() {
                let entry = entry.unwrap();
                let path = entry.path();
                let relative = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                let file_type = entry.file_type().unwrap();
                if file_type.is_symlink() {
                    snapshot.insert(
                        relative,
                        (
                            "symlink".to_string(),
                            fs::read_link(&path)
                                .unwrap()
                                .to_string_lossy()
                                .as_bytes()
                                .to_vec(),
                        ),
                    );
                } else if file_type.is_dir() {
                    snapshot.insert(relative.clone(), ("directory".to_string(), Vec::new()));
                    visit(root, &path, snapshot);
                } else {
                    snapshot.insert(relative, ("file".to_string(), fs::read(&path).unwrap()));
                }
            }
        }

        let mut snapshot = BTreeMap::new();
        visit(root, root, &mut snapshot);
        snapshot
    }

    #[test]
    fn test_assertions_reject_ambiguous_targets_and_comparators() {
        let valid: TestAssertion = serde_json::from_value(serde_json::json!({
            "entity": "player",
            "field": "transform.x",
            "greater_than": 1.0
        }))
        .unwrap();
        assert!(valid.validate().is_ok());

        let ambiguous: TestAssertion = serde_json::from_value(serde_json::json!({
            "entity": "player",
            "field": "transform.x",
            "equals": 1.0,
            "greater_than": 0.0
        }))
        .unwrap();
        assert!(ambiguous
            .validate()
            .unwrap_err()
            .contains("exactly one of equals"));

        let mixed_target: TestAssertion = serde_json::from_value(serde_json::json!({
            "observation": {"key": "state", "equals": {}},
            "equals": 1.0
        }))
        .unwrap();
        assert!(mixed_target.validate().is_err());
    }

    #[test]
    fn resolver_returns_safe_missing_leaf_and_rejects_lexical_escape() {
        let directory = tempdir().expect("temp project directory");
        let missing = resolve_project_path(directory.path(), "assets/missing.svg")
            .expect("missing final file is a caller-reportable path");
        let canonical_root = fs::canonicalize(directory.path()).unwrap();
        assert_eq!(missing, canonical_root.join("assets/missing.svg"));
        assert!(resolve_project_path(directory.path(), "../outside.svg").is_err());
        assert!(resolve_project_path(directory.path(), "assets\\missing.svg").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn resolver_rejects_dangling_symlink_and_missing_linked_ancestor() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp project directory");
        symlink(
            directory.path().join("not-created-target"),
            directory.path().join("dangling"),
        )
        .expect("create dangling symlink");
        assert!(resolve_project_path(directory.path(), "dangling").is_err());
        assert!(resolve_project_path(directory.path(), "dangling/asset.bin").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn resolver_rejects_dangling_symlink_and_missing_linked_ancestor() {
        use std::os::windows::fs::symlink_dir;

        let directory = tempdir().expect("temp project directory");
        if let Err(error) = symlink_dir(
            directory.path().join("not-created-target"),
            directory.path().join("dangling"),
        ) {
            eprintln!(
                "SKIP resolver_rejects_dangling_symlink_and_missing_linked_ancestor: symlink_dir failed: {error} (kind={:?})",
                error.kind()
            );
            return;
        }
        eprintln!("MEASURED Windows dangling directory symlink containment");
        assert!(resolve_project_path(directory.path(), "dangling").is_err());
        assert!(resolve_project_path(directory.path(), "dangling/asset.bin").is_err());
    }

    #[test]
    fn resolver_returns_canonical_path_for_existing_contained_directory() {
        let directory = tempdir().expect("temp project directory");
        fs::create_dir_all(directory.path().join("inside")).expect("inside directory");
        let resolved = resolve_project_path(directory.path(), "inside/asset.svg")
            .expect("safe missing descendant");
        let canonical_root = fs::canonicalize(directory.path()).unwrap();
        assert_eq!(resolved, canonical_root.join("inside/asset.svg"));
    }

    #[cfg(unix)]
    #[test]
    fn resolver_rejects_existing_symlink_target_outside_project() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp project directory");
        let outside = tempdir().expect("outside directory");
        fs::create_dir_all(outside.path().join("target")).expect("outside target directory");
        symlink(
            outside.path().join("target"),
            directory.path().join("linked"),
        )
        .expect("create outside symlink");

        assert!(resolve_project_path(directory.path(), "linked").is_err());
        assert!(resolve_project_path(directory.path(), "linked/asset.bin").is_err());
    }
}

fn file_status(path: &Path) -> ProjectFileStatus {
    ProjectFileStatus {
        path: path.display().to_string(),
        exists: path.is_file(),
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// The gates this project wants `verify` to run.
///
/// The default order is the engine's opinion, not a law. A project that draws
/// no screen, or that is mid-way through acquiring assets, should be able to
/// say so once in its config rather than teaching its author to read past a
/// red line — a gate people learn to ignore is worse than a gate that says it
/// is advisory.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyConfig {
    #[serde(default)]
    pub steps: Vec<VerifyStepSpec>,
}

/// One declared gate: either the bare id, or the id with its settings.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum VerifyStepSpec {
    Name(String),
    Detailed(VerifyStepDetail),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyStepDetail {
    pub step: String,
    /// A failing advisory gate is reported and does not fail the run.
    #[serde(default = "default_true_flag")]
    pub required: bool,
    /// Reserved: a project-owned command as a gate. Declaring it is an error in
    /// this build rather than a step that silently never runs.
    #[serde(default)]
    pub command: Option<serde_json::Value>,
}

fn default_true_flag() -> bool {
    true
}

impl VerifyStepSpec {
    pub fn step(&self) -> &str {
        match self {
            Self::Name(name) => name,
            Self::Detailed(detail) => &detail.step,
        }
    }

    pub fn required(&self) -> bool {
        match self {
            Self::Name(_) => true,
            Self::Detailed(detail) => detail.required,
        }
    }

    pub fn reserved_command(&self) -> bool {
        matches!(self, Self::Detailed(detail) if detail.command.is_some())
    }
}

/// One test case, one file.
///
/// Unknown keys are rejected: a test file with a misspelled or invented key
/// used to load with that key ignored, so a file whose assertions lived under
/// the wrong name passed green while checking nothing.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestSpec {
    pub name: String,
    #[serde(default = "default_test_frames")]
    pub frames: u64,
    #[serde(default = "default_test_seed")]
    pub seed: u64,
    #[serde(default)]
    pub input: BTreeMap<String, bool>,
    #[serde(default)]
    pub input_sequence: Vec<InputFrame>,
    #[serde(default)]
    pub load_save: Option<serde_json::Value>,
    #[serde(default)]
    pub assertions: Vec<TestAssertion>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct InputFrame {
    #[serde(default)]
    pub actions: BTreeMap<String, bool>,
    #[serde(default)]
    pub pointer: Option<PointerInput>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PointerInput {
    pub position: Vec2,
    #[serde(default)]
    pub down: bool,
    /// Host-normalized logical UI coordinates. When omitted, world position
    /// is used as a compatibility-free default for headless callers.
    #[serde(default)]
    pub screen_position: Option<Vec2>,
}

fn default_test_frames() -> u64 {
    60
}
fn default_test_seed() -> u64 {
    42
}

#[derive(Debug, Clone, Deserialize)]
pub struct TestAssertion {
    #[serde(default)]
    pub entity: Option<String>,
    #[serde(default)]
    pub field: Option<String>,
    #[serde(default)]
    pub equals: Option<f64>,
    #[serde(default)]
    pub greater_than: Option<f64>,
    #[serde(default)]
    pub less_than: Option<f64>,
    #[serde(default)]
    pub observation: Option<ObservationAssertion>,
    #[serde(default)]
    pub ui: Option<UiAssertion>,
    #[serde(default)]
    pub animation: Option<AnimationAssertion>,
    #[serde(default)]
    pub effects: Option<EffectsAssertion>,
    #[serde(default)]
    pub audio: Option<AudioAssertion>,
}

impl TestAssertion {
    pub fn validate(&self) -> Result<(), String> {
        let target_count = [
            self.observation.is_some(),
            self.ui.is_some(),
            self.animation.is_some(),
            self.effects.is_some(),
            self.audio.is_some(),
            self.entity.is_some() || self.field.is_some(),
        ]
        .into_iter()
        .filter(|present| *present)
        .count();
        if target_count != 1 {
            return Err(
                "An assertion must provide exactly one target: observation, ui, animation, effects, audio, or entity/field."
                .to_string(),
            );
        }
        if (self.ui.is_some()
            || self.animation.is_some()
            || self.effects.is_some()
            || self.audio.is_some())
            && self.has_numeric_comparator()
        {
            return Err(
                "Non-entity assertions cannot provide equals, greater_than, or less_than numeric comparators."
                    .to_string(),
            );
        }
        if let Some(observation) = &self.observation {
            if observation.key.trim().is_empty() {
                return Err("Observation assertion key cannot be empty.".to_string());
            }
            if self.has_numeric_comparator() {
                return Err("Observation assertions cannot provide numeric comparators.".to_string());
            }
        }
        if let Some(animation) = &self.animation
            && animation.entity.trim().is_empty()
        {
            return Err("Animation assertion entity cannot be empty.".to_string());
        }
        if let Some(audio) = &self.audio
            && audio.events.is_none()
            && audio.loops.is_none()
        {
            return Err(
                "An audio assertion must provide at least one of events or loops; otherwise it checks nothing."
                    .to_string(),
            );
        }
        if self.entity.is_some() || self.field.is_some() {
            if self
                .entity
                .as_deref()
                .is_none_or(|entity| entity.trim().is_empty())
            {
                return Err("An entity assertion must provide a non-empty entity.".to_string());
            }
            let field = self
                .field
                .as_deref()
                .ok_or_else(|| "An entity assertion must provide a field.".to_string())?;
            if !matches!(field, "transform.x" | "transform.y") {
                return Err(format!("Unsupported assertion field '{field}'."));
            }
            if self.numeric_comparator_count() != 1 {
                return Err(
                    "An entity assertion must provide exactly one of equals, greater_than, or less_than."
                        .to_string(),
                );
            }
        }
        Ok(())
    }

    fn has_numeric_comparator(&self) -> bool {
        self.numeric_comparator_count() != 0
    }

    fn numeric_comparator_count(&self) -> usize {
        [
            self.equals.is_some(),
            self.greater_than.is_some(),
            self.less_than.is_some(),
        ]
        .into_iter()
        .filter(|present| *present)
        .count()
    }
}

/// Full equality against one entity's published animation state.
#[derive(Debug, Clone, Deserialize)]
pub struct AnimationAssertion {
    pub entity: String,
    pub equals: serde_json::Value,
}

/// Full equality against the live effect list a host would be playing.
#[derive(Debug, Clone, Deserialize)]
pub struct EffectsAssertion {
    pub equals: serde_json::Value,
}

/// Full equality against what the game asked to be heard.
///
/// `events` is what was fired on the asserted frame; `loops` is what should
/// still be playing. They are separate because a test usually cares about one
/// or the other: "the reel stopped and made a noise" is an event, "the music
/// survived the win screen" is a loop.
#[derive(Debug, Clone, Deserialize)]
pub struct AudioAssertion {
    #[serde(default)]
    pub events: Option<serde_json::Value>,
    #[serde(default)]
    pub loops: Option<serde_json::Value>,
}

/// One reachable screen the layout gate should inspect.
#[derive(Debug, Clone, Deserialize)]
pub struct UiPreviewSpec {
    pub name: String,
    #[serde(default = "default_preview_frames")]
    pub frames: u64,
    #[serde(default = "default_preview_seed")]
    pub seed: u64,
    /// Project-relative per-frame input replay that reaches this screen.
    #[serde(default)]
    pub input_sequence: Option<String>,
}

fn default_preview_frames() -> u64 {
    1
}

fn default_preview_seed() -> u64 {
    42
}

#[derive(Debug, Clone, Deserialize)]
pub struct ObservationAssertion {
    pub key: String,
    pub equals: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UiAssertion {
    pub equals: serde_json::Value,
}
