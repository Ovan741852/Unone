//! Portable presentation feedback. Resource ownership itself stays outside World.
use std::collections::{BTreeMap, BTreeSet};
use serde::{Deserialize, Serialize};
use crate::{ShaderMaterialDefinition, ShaderUniform, SpriteSheet, Transform2DData, Vec2};

pub const MAX_SPRITE_RESOURCES: usize = 4096;
pub const MAX_PRESENTATION_RECEIPTS: usize = 256;
pub const MAX_SPRITE_RESOURCE_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_PRESENTATION_INTEGER: u64 = (1u64 << 53) - 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct AssetCatalogEntry { pub id: String, pub kind: String }

#[derive(Debug, Clone, Serialize)]
pub struct SpriteResourcePlan {
    pub id: String,
    pub asset: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material: Option<ShaderMaterialDefinition>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpriteResourcePlanUpdate {
    pub revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<Vec<SpriteResourcePlan>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum SpriteResourceState { Loading, Ready, Error }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct SpriteResourceReceipt {
    pub id: String, pub state: SpriteResourceState, pub epoch: u64, pub bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum SpriteSubmissionState { Submitted, Error }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct SpriteAppearanceReceipt {
    pub entity: String, pub revision: u64, pub state: SpriteSubmissionState, pub epoch: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct PresentationResourceInput {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resources: Vec<SpriteResourceReceipt>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub appearances: Vec<SpriteAppearanceReceipt>,
}

impl PresentationResourceInput {
    pub fn is_empty(&self) -> bool { self.resources.is_empty() && self.appearances.is_empty() }
    pub fn validate(&self) -> Result<(), String> {
        if self.resources.len() > MAX_PRESENTATION_RECEIPTS || self.appearances.len() > MAX_PRESENTATION_RECEIPTS {
            return Err("INPUT_PRESENTATION_INVALID: at most 256 resource and 256 appearance receipts per tick".into());
        }
        let mut ids = BTreeSet::new();
        for r in &self.resources {
            validate_key(&r.id)?; validate_epoch(r.epoch)?; validate_error(&r.error)?;
            if r.bytes > MAX_SPRITE_RESOURCE_BYTES || !ids.insert(&r.id) {
                return Err("INPUT_PRESENTATION_INVALID: duplicate resource or decoded bytes exceed 1 GiB".into());
            }
        }
        let mut entities = BTreeSet::new();
        for a in &self.appearances {
            validate_key(&a.entity)?; validate_epoch(a.epoch)?; validate_epoch(a.revision)?;
            validate_error(&a.error)?;
            if !entities.insert(&a.entity) { return Err("INPUT_PRESENTATION_INVALID: duplicate appearance entity".into()); }
        }
        Ok(())
    }
}

fn validate_key(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 1024 {
        return Err("INPUT_PRESENTATION_INVALID: IDs must contain 1..1024 UTF-8 bytes".into());
    }
    Ok(())
}
fn validate_epoch(value: u64) -> Result<(), String> {
    if value == 0 || value > MAX_PRESENTATION_INTEGER {
        return Err("INPUT_PRESENTATION_INVALID: revision and epoch must be positive exact safe integers".into());
    }
    Ok(())
}
fn validate_error(value: &Option<String>) -> Result<(), String> {
    if value.as_ref().is_some_and(|s| s.is_empty() || s.len() > 4096) {
        return Err("INPUT_PRESENTATION_INVALID: error must contain 1..4096 UTF-8 bytes".into());
    }
    Ok(())
}

/// The full desired instance appearance; the resource fixes its asset/material.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct SpriteAppearance {
    pub transform: Transform2DData,
    #[serde(default = "default_size")]
    pub size: Vec2,
    #[serde(default = "visible")]
    pub visible: bool,
    #[serde(default)]
    pub layer: i32,
    #[serde(default)]
    pub sheet: Option<SpriteSheet>,
    #[serde(default)]
    pub frame: u32,
    #[serde(default)]
    pub uniforms: BTreeMap<String, ShaderUniform>,
}
fn default_size() -> Vec2 { Vec2 { x: 1., y: 1. } }
fn visible() -> bool { true }

#[cfg(feature = "dev-tools")]
pub(crate) fn read_catalog(paths: &crate::ProjectPaths) -> Result<Vec<AssetCatalogEntry>, Box<crate::Diagnostic>> {
    if paths.asset_manifest.is_none() { return Ok(Vec::new()); }
    Ok(crate::asset::load_declared_manifest(paths)?.assets.into_iter()
        .filter(|asset| asset.kind == "texture2d").map(|asset| AssetCatalogEntry { id: asset.id, kind: asset.kind }).collect())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpriteAppearanceMetadata { pub resource: String, pub revision: u64 }
