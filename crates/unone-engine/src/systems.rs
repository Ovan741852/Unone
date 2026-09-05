//! Declared engine systems and the project switches that turn them off.
//!
//! A game only pays for what it declares. The engine owns the list of systems,
//! their defaults and what disabling one actually changes; the game owns the
//! decision. Nothing here guesses: an unknown system id is an error, and a
//! system with no implementation cannot be enabled just because a plan asks
//! for it.

use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::{
    diagnostics::{ActionSuggestion, Diagnostic, EngineResult},
    project::{ProjectConfig, ProjectPaths},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemStatus {
    /// Implemented in the engine and usable now.
    Available,
    /// The engine side exists, but the runtime that draws it lives in a host
    /// that has not implemented it yet.
    HostRequired,
    /// The contract exists, but no host renders or executes it yet.
    NotImplemented,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemDescriptor {
    pub id: String,
    pub summary: String,
    pub status: SystemStatus,
    pub default_enabled: bool,
    /// Whether a game may turn this system off at all.
    pub optional: bool,
    /// Luau API surface this system owns.
    pub luau_api: Vec<String>,
    /// Observation/snapshot fields this system produces.
    pub observation: Vec<String>,
    /// What a game gives up by disabling it.
    pub when_disabled: String,
    /// Why a game would choose to disable it.
    pub disable_when: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemState {
    #[serde(flatten)]
    pub descriptor: SystemDescriptor,
    pub enabled: bool,
    /// `default` or `project`.
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemReport {
    pub project: String,
    pub systems: Vec<SystemState>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemSearchReport {
    pub query: String,
    pub matches: Vec<SystemDescriptor>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemSetReport {
    pub project: String,
    pub id: String,
    pub enabled: bool,
    pub previously_enabled: bool,
    pub changed: bool,
    pub config: String,
}

/// Effective on/off state for every declared system.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SystemSettings {
    #[serde(flatten)]
    enabled: BTreeMap<String, bool>,
}

impl Default for SystemSettings {
    fn default() -> Self {
        Self {
            enabled: descriptors()
                .into_iter()
                .map(|descriptor| (descriptor.id, descriptor.default_enabled))
                .collect(),
        }
    }
}

impl SystemSettings {
    /// Resolve declared switches against the engine defaults.
    ///
    /// An unknown id, or a switch that contradicts what the engine can
    /// actually do, fails here instead of silently doing nothing at runtime.
    pub fn resolve(declared: &BTreeMap<String, bool>) -> Result<Self, Box<Diagnostic>> {
        let mut settings = Self::default();
        for (id, enabled) in declared {
            let Some(descriptor) = describe(id) else {
                let mut diagnostic = Diagnostic::error(
                    "SYSTEM_UNKNOWN",
                    "project.unone.json 宣告了引擎沒有的 system",
                    format!("引擎沒有 system '{id}'；不會把 typo 當成關閉某個系統。"),
                );
                diagnostic.facts = serde_json::json!({
                    "system": id,
                    "available": descriptors()
                        .into_iter()
                        .map(|descriptor| descriptor.id)
                        .collect::<Vec<_>>(),
                });
                diagnostic.suggested_actions.push(ActionSuggestion {
                    action: "list_systems".to_string(),
                    description: "列出引擎宣告的 system 與預設值。".to_string(),
                    command: Some("game systems list --json".to_string()),
                });
                return Err(Box::new(diagnostic));
            };
            if !*enabled && !descriptor.optional {
                return Err(Box::new(Diagnostic::error(
                    "SYSTEM_NOT_OPTIONAL",
                    "這個 system 不能關閉",
                    format!(
                        "system '{id}' 是 runtime 的必要部分：{}",
                        descriptor.when_disabled
                    ),
                )));
            }
            if *enabled && descriptor.status == SystemStatus::NotImplemented {
                let mut diagnostic = Diagnostic::error(
                    "SYSTEM_NOT_IMPLEMENTED",
                    "這個 system 目前沒有實作",
                    format!(
                        "system '{id}' 只有契約，沒有引擎或 host 實作；啟用它不會產生任何行為，因此視為設定錯誤。"
                    ),
                );
                diagnostic.facts = serde_json::json!({"system": id, "status": descriptor.status});
                return Err(Box::new(diagnostic));
            }
            settings.enabled.insert(id.clone(), *enabled);
        }
        Ok(settings)
    }

    /// Resolve the systems a loaded project asks for.
    pub fn from_config(config: &ProjectConfig) -> Result<Self, Box<Diagnostic>> {
        Self::resolve(&config.systems)
    }

    pub fn is_enabled(&self, id: &str) -> bool {
        self.enabled.get(id).copied().unwrap_or(false)
    }

    pub fn enabled_ids(&self) -> Vec<String> {
        self.enabled
            .iter()
            .filter(|(_, enabled)| **enabled)
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub fn disabled_ids(&self) -> Vec<String> {
        self.enabled
            .iter()
            .filter(|(_, enabled)| !**enabled)
            .map(|(id, _)| id.clone())
            .collect()
    }
}

pub fn describe(id: &str) -> Option<SystemDescriptor> {
    descriptors()
        .into_iter()
        .find(|descriptor| descriptor.id.eq_ignore_ascii_case(id.trim()))
}

/// Find systems by meaning, the same way `api search` finds capabilities.
pub fn search(query: &str) -> Vec<SystemDescriptor> {
    let normalized = query.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return descriptors();
    }
    let terms: Vec<String> = normalized.split_whitespace().map(str::to_string).collect();
    descriptors()
        .into_iter()
        .filter(|descriptor| {
            let searchable = format!(
                "{} {} {} {} {} {}",
                descriptor.id,
                descriptor.summary,
                descriptor.when_disabled,
                descriptor.disable_when,
                descriptor.luau_api.join(" "),
                descriptor.observation.join(" ")
            )
            .to_ascii_lowercase();
            terms.iter().any(|term| searchable.contains(term.as_str()))
        })
        .collect()
}

/// Report the systems a project actually runs with.
pub fn inspect(project_root: impl AsRef<Path>) -> EngineResult<SystemReport> {
    let (config, _) = match ProjectPaths::discover(project_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let settings = match SystemSettings::from_config(&config) {
        Ok(settings) => settings,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let systems = descriptors()
        .into_iter()
        .map(|descriptor| {
            let declared = config.systems.contains_key(&descriptor.id);
            SystemState {
                enabled: settings.is_enabled(&descriptor.id),
                source: if declared { "project" } else { "default" }.to_string(),
                descriptor,
            }
        })
        .collect();
    EngineResult::success(SystemReport {
        project: config.name,
        systems,
    })
}

/// Turn one system on or off in the game's own project config.
pub fn set(
    project_root: impl AsRef<Path>,
    id: &str,
    enabled: bool,
) -> EngineResult<SystemSetReport> {
    let (config, paths) = match ProjectPaths::discover(project_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let previous = match SystemSettings::from_config(&config) {
        Ok(settings) => settings,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let mut declared = config.systems.clone();
    declared.insert(id.trim().to_string(), enabled);
    if let Err(diagnostic) = SystemSettings::resolve(&declared) {
        return EngineResult::failure(*diagnostic);
    }
    let previously_enabled = previous.is_enabled(id.trim());

    let text = match fs::read_to_string(&paths.config) {
        Ok(text) => text,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_CONFIG_READ_FAILED",
                "無法讀取專案設定",
                format!("{}：{}", paths.config.display(), error),
            ));
        }
    };
    let mut document: serde_json::Value = match serde_json::from_str(&text) {
        Ok(document) => document,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_CONFIG_INVALID",
                "專案設定不是有效 JSON",
                format!("{}：{}", paths.config.display(), error),
            ));
        }
    };
    let Some(object) = document.as_object_mut() else {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_CONFIG_INVALID",
            "專案設定必須是 JSON object",
            "systems 只能寫進 project.unone.json 的最上層 object。",
        ));
    };
    let systems = object
        .entry("systems")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let Some(systems) = systems.as_object_mut() else {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_CONFIG_INVALID",
            "systems 必須是 JSON object",
            "systems 的格式是每個 system id 對應 true 或 false。",
        ));
    };
    systems.insert(id.trim().to_string(), serde_json::Value::Bool(enabled));

    let mut serialized = match serde_json::to_string_pretty(&document) {
        Ok(text) => text,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_CONFIG_WRITE_FAILED",
                "無法序列化專案設定",
                error.to_string(),
            ));
        }
    };
    serialized.push('\n');
    if let Err(error) = fs::write(&paths.config, serialized) {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_CONFIG_WRITE_FAILED",
            "無法寫入專案設定",
            format!("{}：{}", paths.config.display(), error),
        ));
    }

    let mut result = EngineResult::success(SystemSetReport {
        project: config.name,
        id: id.trim().to_string(),
        enabled,
        previously_enabled,
        changed: previously_enabled != enabled,
        config: paths.config.display().to_string(),
    });
    result.effects.push(format!(
        "system '{}' set to {} in project.unone.json",
        id.trim(),
        enabled
    ));
    result
}

#[allow(
    clippy::too_many_arguments,
    reason = "one call site per declared system"
)]
fn descriptor(
    id: &str,
    summary: &str,
    status: SystemStatus,
    default_enabled: bool,
    optional: bool,
    luau_api: Vec<&str>,
    observation: Vec<&str>,
    when_disabled: &str,
    disable_when: &str,
) -> SystemDescriptor {
    SystemDescriptor {
        id: id.to_string(),
        summary: summary.to_string(),
        status,
        default_enabled,
        optional,
        luau_api: luau_api.into_iter().map(str::to_string).collect(),
        observation: observation.into_iter().map(str::to_string).collect(),
        when_disabled: when_disabled.to_string(),
        disable_when: disable_when.to_string(),
    }
}

fn descriptors() -> Vec<SystemDescriptor> {
    vec![
        descriptor(
            "world",
            "Entity、Transform 與 Sprite 的 ECS world state。",
            SystemStatus::Available,
            true,
            false,
            vec!["api.entity.*"],
            vec!["world.entities"],
            "沒有 world 就沒有可觀測的遊戲狀態，因此不可關閉。",
            "不適用。",
        ),
        descriptor(
            "input",
            "語意 action 與 world/screen pointer 的 host 輸入邊界。",
            SystemStatus::Available,
            true,
            false,
            vec!["api.input.isDown", "api.input.pointer"],
            vec!["world.pointer"],
            "沒有 input 就無法重播 deterministic 測試，因此不可關閉。",
            "不適用。",
        ),
        descriptor(
            "observation",
            "typed ViewModel 的 semantic projection 與 observation digest。",
            SystemStatus::Available,
            true,
            false,
            vec!["api.observation.set"],
            vec!["observation", "observation_digest"],
            "沒有 observation 就無法做 semantic assertion，因此不可關閉。",
            "不適用。",
        ),
        descriptor(
            "physics2d",
            "2D 剛體的 fixed-step 積分：重力、地面反彈（依 restitution）與圓形碰撞。沒有摩擦力與角速度——落地的物體會保持水平速度一直滑下去，直到遊戲自己減速它。",
            SystemStatus::Available,
            true,
            true,
            vec!["api.physics.applyImpulse"],
            vec!["world.entities[].rigidbody", "world.physics"],
            "關閉後引擎不再推進任何剛體；RigidBody2D 會保持 scene 的初始值，api.physics 會回報 SYSTEM_DISABLED。開啟時請注意它模擬的範圍：沒有摩擦、沒有旋轉、沒有碰撞事件，碰撞只解位置與速度。",
            "棋盤、放置、AVG、老虎機這類沒有物理模擬的遊戲；關閉可移除每 frame 的積分成本與非必要的 digest 變動來源。",
        ),
        descriptor(
            "camera2d",
            "2D 相機位置與縮放。",
            SystemStatus::Available,
            true,
            true,
            vec!["api.camera.setPosition", "api.camera.setZoom"],
            vec!["world.camera"],
            "關閉後 api.camera 會回報 SYSTEM_DISABLED，snapshot 仍輸出預設相機讓 host 有固定視野。",
            "固定畫面、不捲動的遊戲。",
        ),
        descriptor(
            "camera3d",
            "3D 相機與 Mesh3D/Transform3D 的觀測投影。",
            SystemStatus::Available,
            true,
            true,
            vec!["api.camera3d.setPosition", "api.camera3d.setTarget"],
            vec!["world.camera3d", "world.entities[].mesh3d"],
            "關閉後 api.camera3d 會回報 SYSTEM_DISABLED；api.entity 的 3D transform 目前不受此開關影響。",
            "純 2D 遊戲；關閉可讓「這個專案不該出現 3D 相機」變成可驗證的事實。",
        ),
        descriptor(
            "random",
            "以 seed 決定、可重播的遊戲亂數。",
            SystemStatus::Available,
            true,
            true,
            vec!["api.random.nextFloat", "api.random.nextInt"],
            vec![],
            "關閉後 api.random 會回報 SYSTEM_DISABLED。",
            "完全 deterministic、不允許任何亂數來源的遊戲或關卡驗證。",
        ),
        descriptor(
            "ui",
            "engine 驗證的最小 UI tree 傳輸（screen/text/button/rect/action）。",
            SystemStatus::Available,
            true,
            true,
            vec!["api.ui.setRoot"],
            vec!["ui"],
            "關閉後 api.ui 會回報 SYSTEM_DISABLED，host 不會收到 UI tree。",
            "只有 headless 模擬或由 host 自行組 UI 的遊戲。",
        ),
        descriptor(
            "save",
            "遊戲自訂版本與 migration 的 JSON save payload 傳輸。",
            SystemStatus::Available,
            true,
            true,
            vec!["api.save.set", "api.save.get"],
            vec!["save_payload"],
            "關閉後 api.save 會回報 SYSTEM_DISABLED。",
            "沒有存檔的關卡驗證或 demo。",
        ),
        descriptor(
            "spine",
            "Spine 骨骼動畫：遊戲發布語意動畫狀態，host 執行 Spine runtime。",
            SystemStatus::HostRequired,
            false,
            true,
            vec!["api.animation.play", "api.animation.stop"],
            vec!["world.entities[].animation"],
            "關閉後 api.animation 會回報 SYSTEM_DISABLED，scene 宣告的 animation 仍會出現在 snapshot。",
            "沒有骨骼動畫的遊戲；這是預設關閉的系統。目前只有 web/presentation 這個 Web host 會以 spine-webgl 播放，native preview 與 Android host 都不會；引擎只負責傳輸與 determinism。",
        ),
        descriptor(
            "effekseer",
            "Effekseer 特效：遊戲發布語意特效事件，host 執行 Effekseer runtime。",
            SystemStatus::HostRequired,
            false,
            true,
            vec!["api.effect.spawn", "api.effect.stop"],
            vec!["world.effects"],
            "關閉後 api.effect 會回報 SYSTEM_DISABLED，snapshot 不會有任何 effect。",
            "沒有粒子特效的遊戲；這是預設關閉的系統。目前只有 web/presentation 這個 Web host 會以 Effekseer for WebGL 播放，native preview 與 Android host 都不會；引擎只負責傳輸與 determinism。",
        ),
    ]
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{SystemSettings, describe, descriptors, search};

    #[test]
    fn defaults_follow_the_engine_declaration() {
        let settings = SystemSettings::default();
        assert!(settings.is_enabled("physics2d"));
        assert!(settings.is_enabled("camera3d"));
        assert!(!settings.is_enabled("spine"));
        for descriptor in descriptors() {
            assert_eq!(
                settings.is_enabled(&descriptor.id),
                descriptor.default_enabled,
                "{} default",
                descriptor.id
            );
        }
    }

    #[test]
    fn resolves_declared_switches_and_rejects_impossible_ones() {
        let declared = BTreeMap::from([("physics2d".to_string(), false)]);
        let settings = SystemSettings::resolve(&declared).unwrap();
        assert!(!settings.is_enabled("physics2d"));
        assert!(settings.is_enabled("ui"));

        let unknown = BTreeMap::from([("physics4d".to_string(), false)]);
        assert_eq!(
            SystemSettings::resolve(&unknown).unwrap_err().code,
            "SYSTEM_UNKNOWN"
        );

        let required = BTreeMap::from([("observation".to_string(), false)]);
        assert_eq!(
            SystemSettings::resolve(&required).unwrap_err().code,
            "SYSTEM_NOT_OPTIONAL"
        );

        let host_required = BTreeMap::from([("spine".to_string(), true)]);
        assert!(
            SystemSettings::resolve(&host_required)
                .unwrap()
                .is_enabled("spine")
        );
    }

    #[test]
    fn finds_systems_by_meaning() {
        let matches = search("物理");
        assert!(matches.iter().any(|system| system.id == "physics2d"));
        assert!(search("骨骼").iter().any(|system| system.id == "spine"));
        assert!(describe("PHYSICS2D").is_some());
        assert!(describe("nope").is_none());
    }
}
