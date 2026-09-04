use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::diagnostics::Diagnostic;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Default for Vec2 {
    fn default() -> Self { Self { x: 0.0, y: 0.0 } }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneFile {
    #[serde(default)]
    pub entities: Vec<SceneEntity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneEntity {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub transform: Vec2,
    #[serde(default)]
    pub sprite: Option<SpriteData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpriteData {
    pub asset: String,
    #[serde(default = "default_true")]
    pub visible: bool,
}

fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize)]
pub struct EntitySnapshot {
    pub id: String,
    pub name: String,
    pub transform: Vec2,
    pub sprite: Option<SpriteData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorldSnapshot {
    pub frame: u64,
    pub time_seconds: f64,
    pub entities: BTreeMap<String, EntitySnapshot>,
}

#[derive(Debug, Clone)]
pub(crate) struct EntityState {
    pub id: String,
    pub name: String,
    pub transform: Vec2,
    pub sprite: Option<SpriteData>,
}

#[derive(Debug, Default)]
pub(crate) struct World {
    pub frame: u64,
    pub time_seconds: f64,
    pub entities: BTreeMap<String, EntityState>,
}

impl World {
    pub fn load_scene(&mut self, path: &Path) -> Result<(), Diagnostic> {
        let text = fs::read_to_string(path).map_err(|err| {
            Diagnostic::error(
                "SCENE_READ_FAILED",
                "無法讀取主場景",
                format!("{}：{}", path.display(), err),
            )
        })?;
        let scene: SceneFile = serde_json::from_str(&text).map_err(|err| {
            Diagnostic::error(
                "SCENE_INVALID",
                "主場景不是有效的 Unone scene JSON",
                format!("{}：{}", path.display(), err),
            )
        })?;
        for entity in scene.entities {
            self.entities.insert(entity.id.clone(), EntityState {
                id: entity.id,
                name: entity.name,
                transform: entity.transform,
                sprite: entity.sprite,
            });
        }
        Ok(())
    }

    pub(crate) fn spawn(&mut self, name: &str) -> String {
        let base = if name.is_empty() { "entity" } else { name };
        let mut id = base.to_string();
        let mut index = 2;
        while self.entities.contains_key(&id) {
            id = format!("{base}_{index}");
            index += 1;
        }
        self.entities.insert(id.clone(), EntityState {
            id: id.clone(),
            name: name.to_string(),
            transform: Vec2::default(),
            sprite: None,
        });
        id
    }

    pub(crate) fn snapshot(&self) -> WorldSnapshot {
        let entities = self.entities.iter().map(|(id, entity)| (id.clone(), EntitySnapshot {
            id: entity.id.clone(),
            name: entity.name.clone(),
            transform: entity.transform,
            sprite: entity.sprite.clone(),
        })).collect();
        WorldSnapshot { frame: self.frame, time_seconds: self.time_seconds, entities }
    }
}
