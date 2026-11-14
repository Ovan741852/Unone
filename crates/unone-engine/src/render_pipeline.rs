//! The render pipeline a game declares in project.unone.json: an ordered list
//! of named passes the official hosts execute (ADR 0048). Game Luau adjusts
//! declared passes with api.render.setPass; the current pipeline is published
//! in every snapshot, so replays and every host draw the same passes.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Pass kinds the engine defines. Any other kind is a host extension and must
/// be namespaced with a dot, such as "studio.crt".
pub const BUILTIN_RENDER_PASSES: &[&str] =
    &["scene", "ao", "fog", "bloom", "tonemap", "grade", "vignette", "fxaa", "projected", "ui"];
/// What each built-in pass is for, in the words people and AI search with
/// (`game find`). Keep one entry per BUILTIN_RENDER_PASSES kind.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct RenderPassGuide {
    pub kind: &'static str,
    pub summary: &'static str,
    pub params: &'static str,
    pub keywords: &'static [&'static str],
}

pub const RENDER_PASS_GUIDE: &[RenderPassGuide] = &[
    RenderPassGuide { kind: "scene", summary: "The world: sprites, meshes, instances, heightfields and particles. Required and first.", params: "none",
        keywords: &["scene", "world", "場景"] },
    RenderPassGuide { kind: "ao", summary: "Depth-based ambient occlusion: darkens creases and contact points in 3D scenes.", params: "strength [0,4] (1.7)",
        keywords: &["ao", "ssao", "ambient occlusion", "occlusion", "contact shadow", "環境光遮蔽", "遮蔽"] },
    RenderPassGuide { kind: "fog", summary: "Distance fog by view depth, exp2 or linear; the background stays clear.", params: "mode exp2|linear, color #rrggbb, density [0,10] (0.02), start (0), end (100)",
        keywords: &["fog", "haze", "mist", "atmosphere", "distance fade", "depth fade", "霧", "霧氣", "雾", "大氣"] },
    RenderPassGuide { kind: "bloom", summary: "Quarter-resolution bloom: bright areas glow.", params: "threshold [0,16] (0.55), strength [0,4] (0.75)",
        keywords: &["bloom", "glow", "glare", "光暈", "泛光", "發光", "辉光"] },
    RenderPassGuide { kind: "tonemap", summary: "Exposure and the ACES tone curve before sRGB output.", params: "mode aces|none (none), exposure (0,8] (1)",
        keywords: &["tonemap", "tone mapping", "tone map", "exposure", "hdr", "aces", "曝光", "色調映射"] },
    RenderPassGuide { kind: "grade", summary: "Colour grade after the tone curve: saturation, contrast, brightness and tint.", params: "saturation, contrast, brightness [0,4] (1), tint #rrggbb (#ffffff)",
        keywords: &["grade", "grading", "color grading", "colour grading", "color correction", "saturation", "contrast", "brightness", "tint", "desaturate", "調色", "飽和度", "對比", "亮度", "色調"] },
    RenderPassGuide { kind: "vignette", summary: "Darkens or tints the screen edges.", params: "strength [0,1] (0.5), radius [0,2] (0.6), softness (0,2] (0.6), color #rrggbb (#000000)",
        keywords: &["vignette", "edge darkening", "dark corners", "暗角", "暈影", "晕影"] },
    RenderPassGuide { kind: "fxaa", summary: "Fast approximate anti-aliasing over the final image, before extensions.", params: "none",
        keywords: &["fxaa", "anti-aliasing", "antialiasing", "anti alias", "antialias", "jaggies", "jagged edges", "smooth edges", "抗鋸齒", "鋸齒", "抗锯齿"] },
    RenderPassGuide { kind: "projected", summary: "Projected geometry drawn after the post passes.", params: "none",
        keywords: &["projected geometry"] },
    RenderPassGuide { kind: "ui", summary: "The UI, drawn last; disabling it hides the UI while input still routes.", params: "none",
        keywords: &["hide ui", "hud pass"] },
];

/// The order passes must be declared in, as people read it in errors.
const ORDER: &str = "scene, then ao, fog, bloom, tonemap, grade, vignette, fxaa, then extensions, then projected, then ui";
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
        "fog" => 2,
        "bloom" => 3,
        "tonemap" => 4,
        "grade" => 5,
        "vignette" => 6,
        "fxaa" => 7,
        "projected" => 9,
        "ui" => 10,
        _ => 8,
    }
}

/// A colour param is "#rrggbb" text.
fn color(pass: &RenderPass, key: &str) -> Result<(), String> {
    match pass.params.get(key) {
        None => Ok(()),
        Some(RenderParam::Text(text))
            if text.len() == 7 && text.starts_with('#') && text[1..].bytes().all(|b| b.is_ascii_hexdigit()) => Ok(()),
        Some(other) => Err(format!("pass '{}' {key} must be a \"#rrggbb\" colour, got {other:?}", pass.id)),
    }
}

fn number_or(pass: &RenderPass, key: &str, fallback: f64) -> f64 {
    match pass.params.get(key) {
        Some(RenderParam::Number(value)) => *value,
        _ => fallback,
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
                    "pass '{}' kind '{}' is neither built in ({}) nor a namespaced extension such as 'studio.crt'",
                    pass.id, pass.kind, BUILTIN_RENDER_PASSES.join(", ")
                ));
            }
            let stage = stage(&pass.kind);
            // Built-in kinds appear once; extensions may repeat within their stage.
            let repeated = builtin && self.passes[..index].iter().any(|earlier| earlier.kind == pass.kind);
            if repeated || stage < last_stage || (index > 0 && stage == 0) {
                return Err(format!(
                    "pass '{}' ({}) is out of order: {ORDER}; built-in kinds appear at most once",
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
            "fog" => &["mode", "color", "density", "start", "end"],
            "bloom" => &["threshold", "strength"],
            "tonemap" => &["mode", "exposure"],
            "grade" => &["saturation", "contrast", "brightness", "tint"],
            "vignette" => &["strength", "radius", "softness", "color"],
            "scene" | "fxaa" | "projected" | "ui" => &[],
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
            "fog" => {
                if let Some(mode) = pass.params.get("mode")
                    && !matches!(mode, RenderParam::Text(text) if text == "exp2" || text == "linear")
                {
                    return Err(format!("pass '{}' mode must be \"exp2\" or \"linear\"", pass.id));
                }
                color(pass, "color")?;
                number(pass, "density", 0.0, 10.0, false)?;
                number(pass, "start", 0.0, 1e6, false)?;
                number(pass, "end", 0.0, 1e6, true)?;
                let (start, end) = (number_or(pass, "start", 0.0), number_or(pass, "end", 100.0));
                if end <= start {
                    return Err(format!("pass '{}' end ({end}) must be greater than start ({start})", pass.id));
                }
                Ok(())
            }
            "grade" => {
                for key in ["saturation", "contrast", "brightness"] {
                    number(pass, key, 0.0, 4.0, false)?;
                }
                color(pass, "tint")
            }
            "vignette" => {
                number(pass, "strength", 0.0, 1.0, false)?;
                number(pass, "radius", 0.0, 2.0, false)?;
                number(pass, "softness", 0.0, 2.0, true)?;
                color(pass, "color")
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
            {"id": "haze", "kind": "fog", "params": {"mode": "linear", "color": "#9AB0c8", "start": 10, "end": 80}},
            {"id": "glow", "kind": "bloom", "params": {"threshold": 0.8, "strength": 1.0}},
            {"id": "tone", "kind": "tonemap", "params": {"mode": "aces", "exposure": 1.1}},
            {"id": "look", "kind": "grade", "params": {"saturation": 1.2, "contrast": 1.1, "brightness": 0.9, "tint": "#fff4e0"}},
            {"id": "edge", "kind": "vignette", "params": {"strength": 0.4, "radius": 0.7, "softness": 0.5, "color": "#000000"}},
            {"id": "aa", "kind": "fxaa"},
            {"id": "tint", "kind": "studio.tint", "params": {"radius": 0.7, "on": true}},
            {"id": "projected", "kind": "projected"},
            {"id": "ui", "kind": "ui"}
        ])).is_ok());
        let cases = [
            (serde_json::json!([{"id": "glow", "kind": "bloom"}]), "first pass"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "t", "kind": "tonemap"}, {"id": "b", "kind": "bloom"}]), "out of order"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "u", "kind": "ui"}, {"id": "p", "kind": "projected"}]), "out of order"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "b", "kind": "bloom"}, {"id": "b2", "kind": "bloom"}]), "out of order"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "v", "kind": "sepia"}]), "namespaced extension"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "b", "kind": "bloom", "params": {"radius": 1}}]), "has no param 'radius'"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "b", "kind": "bloom", "params": {"strength": 9}}]), "strength must be a number"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "t", "kind": "tonemap", "params": {"exposure": 0}}]), "exposure must be a number"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "t", "kind": "tonemap", "params": {"mode": "filmic"}}]), "mode must be"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "w", "kind": "ui"}]), "declared twice"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "a", "kind": "fxaa"}, {"id": "v", "kind": "vignette"}]), "out of order"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "e", "kind": "studio.tint"}, {"id": "a", "kind": "fxaa"}]), "out of order"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "f", "kind": "fog", "params": {"color": "blue"}}]), "colour"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "f", "kind": "fog", "params": {"mode": "exp"}}]), "mode must be"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "f", "kind": "fog", "params": {"start": 200}}]), "greater than start"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "g", "kind": "grade", "params": {"saturation": 5}}]), "saturation must be"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "v", "kind": "vignette", "params": {"softness": 0}}]), "softness must be"),
            (serde_json::json!([{"id": "w", "kind": "scene"}, {"id": "a", "kind": "fxaa", "params": {"quality": 1}}]), "has no param 'quality'"),
        ];
        for (passes, expected) in cases {
            let error = pipeline(passes.clone()).unwrap_err();
            assert!(error.contains(expected), "{passes}: expected '{expected}' in {error}");
        }
    }

    #[test]
    fn every_builtin_pass_has_one_guide_entry() {
        let kinds: Vec<_> = RENDER_PASS_GUIDE.iter().map(|guide| guide.kind).collect();
        assert_eq!(kinds, BUILTIN_RENDER_PASSES, "guide entries follow the declaration order");
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
