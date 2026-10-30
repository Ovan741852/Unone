//! The render pipeline a game declares in project.unone.json: an ordered list
//! of named passes the official hosts execute (ADR 0048). Game Luau adjusts
//! declared passes with api.render.setPass; the current pipeline is published
//! in every snapshot, so replays and every host draw the same passes.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Pass kinds the engine defines. Any other kind is a host extension and must
/// be namespaced with a dot, such as "studio.vignette".
pub const BUILTIN_RENDER_PASSES: &[&str] = &["scene", "ao", "bloom", "tonemap", "projected", "ui"];
const MAX_PASSES: usize = 32;
const MAX_EXTENSION_PARAMS: usize = 16;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct RenderPipeline {
    /// Contract version; 1 is the only one.
    pub version: u32,
    pub passes: Vec<RenderPass>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct RenderPass {
    /// Stable name game code uses with api.render.setPass.
    pub id: String,
    pub kind: String,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    /// Kind-specific settings; absent ones use the host default.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, RenderParam>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(untagged)]
pub enum RenderParam {
    Bool(bool),
    Number(f64),
    Text(String),
}

fn enabled_by_default() -> bool {
    true
}

/// Where a pass may sit: the scene first, post passes in their fixed built-in
/// order then extensions, projected geometry, and the UI last.
fn stage(kind: &str) -> u8 {
    match kind {
        "scene" => 0,
        "ao" => 1,
        "bloom" => 2,
        "tonemap" => 3,
        "projected" => 5,
        "ui" => 6,
        _ => 4,
    }
}

fn valid_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-'))
}

fn number(pass: &RenderPass, key: &str, min: f64, max: f64, min_exclusive: bool) -> Result<(), String> {
    match pass.params.get(key) {
        None => Ok(()),
        Some(RenderParam::Number(value))
            if value.is_finite() && *value <= max && (*value > min || (!min_exclusive && *value == min)) => Ok(()),
        Some(other) => Err(format!(
            "pass '{}' {key} must be a number in {}{min}, {max}], got {other:?}",
            pass.id, if min_exclusive { "(" } else { "[" }
        )),
    }
}

impl RenderPipeline {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!("version must be 1, got {}", self.version));
        }
        if self.passes.is_empty() || self.passes.len() > MAX_PASSES {
            return Err(format!("passes must list 1 to {MAX_PASSES} passes"));
        }
        if self.passes[0].kind != "scene" {
            return Err("the first pass must be the one 'scene' pass".into());
        }
        let mut ids = std::collections::BTreeSet::new();
        let mut last_stage = 0;
        for (index, pass) in self.passes.iter().enumerate() {
            if !valid_name(&pass.id) {
                return Err(format!("pass id '{}' must be 1-64 characters of a-z, 0-9, '.', '_' or '-'", pass.id));
            }
            if !ids.insert(pass.id.as_str()) {
                return Err(format!("pass id '{}' is declared twice", pass.id));
            }
            let builtin = BUILTIN_RENDER_PASSES.contains(&pass.kind.as_str());
            if !builtin && !(valid_name(&pass.kind) && pass.kind.contains('.')) {
                return Err(format!(
                    "pass '{}' kind '{}' is neither built in ({}) nor a namespaced extension such as 'studio.vignette'",
                    pass.id, pass.kind, BUILTIN_RENDER_PASSES.join(", ")
                ));
            }
            let stage = stage(&pass.kind);
            // Built-in kinds appear once; extensions may repeat within their stage.
            let repeated = builtin && self.passes[..index].iter().any(|earlier| earlier.kind == pass.kind);
            if repeated || stage < last_stage || (index > 0 && stage == 0) {
                return Err(format!(
                    "pass '{}' ({}) is out of order: scene, then ao, bloom, tonemap, then extensions, then projected, then ui; built-in kinds appear at most once",
                    pass.id, pass.kind
                ));
            }
            last_stage = stage;
            self.validate_params(pass, builtin)?;
        }
        Ok(())
    }

    fn validate_params(&self, pass: &RenderPass, builtin: bool) -> Result<(), String> {
        let allowed: &[&str] = match pass.kind.as_str() {
            "ao" => &["strength"],
            "bloom" => &["threshold", "strength"],
            "tonemap" => &["mode", "exposure"],
            "scene" | "projected" | "ui" => &[],
            _ => {
                if pass.params.len() > MAX_EXTENSION_PARAMS {
                    return Err(format!("pass '{}' has more than {MAX_EXTENSION_PARAMS} params", pass.id));
                }
                for (key, value) in &pass.params {
                    let key_ok = (1..=64).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
                    let value_ok = match value {
                        RenderParam::Number(number) => number.is_finite(),
                        RenderParam::Text(text) => text.len() <= 256,
                        RenderParam::Bool(_) => true,
                    };
                    if !key_ok || !value_ok {
                        return Err(format!("pass '{}' param '{key}' needs a 1-64 character [A-Za-z0-9_] name and a finite number, boolean or string of at most 256 bytes", pass.id));
                    }
                }
                return Ok(());
            }
        };
        debug_assert!(builtin);
        if let Some(key) = pass.params.keys().find(|key| !allowed.contains(&key.as_str())) {
            return Err(format!(
                "pass '{}' ({}) has no param '{key}'; it accepts [{}]",
                pass.id, pass.kind, allowed.join(", ")
            ));
        }
        match pass.kind.as_str() {
            "ao" => number(pass, "strength", 0.0, 4.0, false),
            "bloom" => number(pass, "threshold", 0.0, 16.0, false).and_then(|()| number(pass, "strength", 0.0, 4.0, false)),
            "tonemap" => {
                if let Some(mode) = pass.params.get("mode")
                    && !matches!(mode, RenderParam::Text(text) if text == "aces" || text == "none")
                {
                    return Err(format!("pass '{}' mode must be \"aces\" or \"none\"", pass.id));
                }
                number(pass, "exposure", 0.0, 8.0, true)
            }
            _ => Ok(()),
        }
    }

    /// Switch or retune one declared pass. The pipeline is unchanged on error.
    pub fn set_pass(
        &mut self,
        id: &str,
        enabled: Option<bool>,
        params: BTreeMap<String, RenderParam>,
    ) -> Result<(), String> {
        let Some(index) = self.passes.iter().position(|pass| pass.id == id) else {
            let ids: Vec<_> = self.passes.iter().map(|pass| pass.id.as_str()).collect();
            return Err(format!("RENDER_PASS_UNKNOWN: no pass '{id}' is declared; declared: [{}]", ids.join(", ")));
        };
        let mut next = self.clone();
        let pass = &mut next.passes[index];
        if let Some(enabled) = enabled {
            pass.enabled = enabled;
        }
        pass.params.extend(params);
        next.validate().map_err(|error| format!("RENDER_PIPELINE_INVALID: {error}"))?;
        *self = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pipeline(passes: serde_json::Value) -> Result<RenderPipeline, String> {
        let pipeline: RenderPipeline = serde_json::from_value(serde_json::json!({"version": 1, "passes": passes}))
            .map_err(|e| e.to_string())?;
        pipeline.validate().map(|()| pipeline)
    }

    #[test]
    fn order_kinds_and_params_follow_the_contract() {
        assert!(pipeline(serde_json::json!([
            {"id": "world", "kind": "scene"},
            {"id": "ao", "kind": "ao", "params": {"strength": 1.2}},
            {"id": "glow", "kind": "bloom", "params": {"threshold": 0.8, "strength": 1.0}},
            {"id": "tone", "kind": "tonemap", "params": {"mode": "aces", "exposure": 1.1}},
            {"id": "vignette", "kind": "studio.vignette", "params": {"radius": 0.7, "on": true}},
            {"id": "projected", "kind": "projected"},
            {"id": "ui", "kind": "ui"}
        ])).is_ok());
        let cases = [
            (serde_json::json!([{"id": "glow", "kind": "bloom"}]), "first pass"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "t", "kind": "tonemap"}, {"id": "b", "kind": "bloom"}]), "out of order"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "u", "kind": "ui"}, {"id": "p", "kind": "projected"}]), "out of order"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "b", "kind": "bloom"}, {"id": "b2", "kind": "bloom"}]), "out of order"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "v", "kind": "vignette"}]), "namespaced extension"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "b", "kind": "bloom", "params": {"radius": 1}}]), "has no param 'radius'"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "b", "kind": "bloom", "params": {"strength": 9}}]), "strength must be a number"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "t", "kind": "tonemap", "params": {"exposure": 0}}]), "exposure must be a number"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "t", "kind": "tonemap", "params": {"mode": "filmic"}}]), "mode must be"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "w", "kind": "ui"}]), "declared twice"),
        ];
        for (passes, expected) in cases {
            let error = pipeline(passes.clone()).unwrap_err();
            assert!(error.contains(expected), "{passes}: expected '{expected}' in {error}");
        }
    }

    #[test]
    fn set_pass_merges_params_and_keeps_the_pipeline_on_error() {
        let mut pipeline = pipeline(serde_json::json!([
            {"id": "world", "kind": "scene"}, {"id": "glow", "kind": "bloom", "params": {"threshold": 0.8}}
        ])).unwrap();
        pipeline.set_pass("glow", Some(false), BTreeMap::from([("strength".into(), RenderParam::Number(2.0))])).unwrap();
        assert!(!pipeline.passes[1].enabled);
        assert_eq!(pipeline.passes[1].params.len(), 2);
        let before = pipeline.clone();
        assert!(pipeline.set_pass("glow", None, BTreeMap::from([("strength".into(), RenderParam::Number(99.0))])).unwrap_err().starts_with("RENDER_PIPELINE_INVALID"));
        assert!(pipeline.set_pass("missing", Some(true), BTreeMap::new()).unwrap_err().starts_with("RENDER_PASS_UNKNOWN"));
        assert_eq!(pipeline, before);
    }
}
