//! Surface materials for 3D meshes (ADR 0055, docs/materials.md): a base
//! colour multiplying the mesh texture, metallic and roughness for physically
//! based light, and an emissive glow. Scenes declare them by name, mesh3d
//! components refer to one, api.material.set adds or replaces one, and every
//! snapshot publishes them.
use serde::{Deserialize, Serialize};

pub const MAX_MATERIALS: usize = 256;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Material {
    /// "#rrggbb" (sRGB) multiplying the mesh texture; default "#ffffff".
    /// Primitive meshes with a material start from white.
    #[serde(default = "white")]
    pub color: String,
    /// [0,1], default 0: 1 is bare metal tinted by `color`.
    #[serde(default)]
    pub metallic: f64,
    /// [0,1], default 1: 0 is mirror-smooth, 1 fully rough.
    #[serde(default = "one")]
    pub roughness: f64,
    /// "#rrggbb" light the surface gives off whatever the lighting; default "#000000".
    #[serde(default = "black")]
    pub emissive: String,
    /// [0,100], default 1.
    #[serde(default = "one")]
    pub emissive_intensity: f64,
}

impl Default for Material {
    fn default() -> Self {
        Self { color: white(), metallic: 0., roughness: 1., emissive: black(), emissive_intensity: 1. }
    }
}

fn white() -> String {
    "#ffffff".into()
}
fn black() -> String {
    "#000000".into()
}
fn one() -> f64 {
    1.
}

fn color(value: &str, field: &str) -> Result<(), String> {
    let ok = value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
    if ok { Ok(()) } else { Err(format!("{field} must be a \"#rrggbb\" colour, got {value:?}")) }
}

fn unit(value: f64, field: &str, max: f64) -> Result<(), String> {
    if value.is_finite() && (0.0..=max).contains(&value) { Ok(()) } else { Err(format!("{field} must be in [0, {max}], got {value}")) }
}

/// Material names follow entity-id rules: 1-64 bytes of a-z, A-Z, 0-9, '_', '-', '.'.
pub fn valid_name(name: &str) -> bool {
    (1..=64).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}

impl Material {
    pub fn validate(&self, name: &str) -> Result<(), String> {
        if !valid_name(name) {
            return Err(format!("material name '{name}' must be 1-64 characters of a-z, A-Z, 0-9, '_', '-' or '.'"));
        }
        color(&self.color, &format!("material '{name}' color"))?;
        unit(self.metallic, &format!("material '{name}' metallic"), 1.)?;
        unit(self.roughness, &format!("material '{name}' roughness"), 1.)?;
        color(&self.emissive, &format!("material '{name}' emissive"))?;
        unit(self.emissive_intensity, &format!("material '{name}' emissive_intensity"), 100.)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_ranges() {
        let material: Material = serde_json::from_value(serde_json::json!({"metallic": 1})).unwrap();
        assert_eq!((material.color.as_str(), material.roughness, material.emissive.as_str()), ("#ffffff", 1., "#000000"));
        assert!(material.validate("gold").is_ok());
        for (value, expected) in [
            (serde_json::json!({"color": "red"}), "color"),
            (serde_json::json!({"roughness": 2}), "roughness"),
            (serde_json::json!({"emissive_intensity": -1}), "emissive_intensity"),
        ] {
            let material: Material = serde_json::from_value(value).unwrap();
            assert!(material.validate("m").unwrap_err().contains(expected));
        }
        assert!(Material::default().validate("bad name").unwrap_err().contains("material name"));
        assert!(serde_json::from_value::<Material>(serde_json::json!({"shine": 1})).is_err(), "unknown fields fail");
    }
}
