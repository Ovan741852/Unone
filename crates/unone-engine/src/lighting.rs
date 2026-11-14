//! Scene lighting (ADR 0054): an ambient term, one directional sun with an
//! optional shadow map, and up to eight point lights. A scene declares it,
//! game Luau replaces it with api.lighting.set, and every snapshot publishes
//! it, so replays and every host light the scene the same way. Without a
//! declaration 3D content stays unlit, exactly as before.
//!
//! The model is Lambert diffuse with intensity 1 meaning full brightness:
//! colour = albedo * (ambient + sum(light * max(dot(n, l), 0) * shadow * falloff)).
use serde::{Deserialize, Serialize};

use crate::Vec3;

pub const MAX_POINT_LIGHTS: usize = 8;
pub const SHADOW_MAP_SIZES: [u32; 4] = [512, 1024, 2048, 4096];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Lighting {
    /// Light reaching every surface equally.
    #[serde(default)]
    pub ambient: AmbientLight,
    /// Sky light from above fading to ground light from below, added to ambient.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hemisphere: Option<HemisphereLight>,
    /// An HDR panorama lighting meshes with materials (image-based light).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<Environment>,
    /// One directional light, such as the sun or the moon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sun: Option<SunLight>,
    /// Up to eight point lights; they cast no shadows.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub points: Vec<PointLight>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct AmbientLight {
    /// "#rrggbb" (sRGB), default "#ffffff".
    #[serde(default = "white")]
    pub color: String,
    /// [0,16], default 0.3.
    #[serde(default = "ambient_intensity")]
    pub intensity: f64,
}

impl Default for AmbientLight {
    fn default() -> Self {
        Self { color: white(), intensity: ambient_intensity() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Environment {
    /// A declared `data` asset whose source is a Radiance .hdr equirectangular panorama.
    pub map: String,
    /// [0,16], default 1.
    #[serde(default = "one")]
    pub intensity: f64,
    /// Degrees around the up axis, [-360, 360], default 0.
    #[serde(default)]
    pub rotation: f64,
    /// Also draw the panorama behind the scene as its sky; default false.
    #[serde(default)]
    pub background: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct HemisphereLight {
    /// Light from straight above, "#rrggbb"; default "#ffffff".
    #[serde(default = "white")]
    pub sky: String,
    /// Light from straight below, "#rrggbb"; default "#444444".
    #[serde(default = "ground")]
    pub ground: String,
    /// [0,16], default 0.5. A surface tilted halfway gets the mix.
    #[serde(default = "hemisphere_intensity")]
    pub intensity: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct SunLight {
    /// The direction the light travels, from the sun towards the scene, such
    /// as {x = -0.4, y = -1, z = -0.3}. Any non-zero length.
    pub direction: Vec3,
    /// "#rrggbb" (sRGB), default "#ffffff".
    #[serde(default = "white")]
    pub color: String,
    /// [0,16], default 1: a white surface facing the sun is fully lit.
    #[serde(default = "one")]
    pub intensity: f64,
    /// Present to cast shadows from 3D meshes, instances and heightfields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadows: Option<Shadows>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Shadows {
    /// Shadow map resolution: 512, 1024, 2048 or 4096 (default 2048).
    #[serde(default = "shadow_size")]
    pub size: u32,
    /// Half the width of the square area around the camera target that casts
    /// and receives shadows, in world units: (0, 10000], default 20.
    #[serde(default = "shadow_distance")]
    pub distance: f64,
    /// Depth offset against shadow acne, in shadow-map depth: [0, 0.05], default 0.001.
    #[serde(default = "shadow_bias")]
    pub bias: f64,
}

impl Default for Shadows {
    fn default() -> Self {
        Self { size: shadow_size(), distance: shadow_distance(), bias: shadow_bias() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct PointLight {
    pub position: Vec3,
    /// "#rrggbb" (sRGB), default "#ffffff".
    #[serde(default = "white")]
    pub color: String,
    /// [0,100], default 1.
    #[serde(default = "one")]
    pub intensity: f64,
    /// Distance where the light reaches zero: (0, 1e6], default 10. The
    /// falloff is (1 - (d / range)^4)^2, full near the light.
    #[serde(default = "point_range")]
    pub range: f64,
}

fn white() -> String {
    "#ffffff".into()
}
fn one() -> f64 {
    1.
}
fn ground() -> String {
    "#444444".into()
}
fn hemisphere_intensity() -> f64 {
    0.5
}
fn ambient_intensity() -> f64 {
    0.3
}
fn shadow_size() -> u32 {
    2048
}
fn shadow_distance() -> f64 {
    20.
}
fn shadow_bias() -> f64 {
    0.001
}
fn point_range() -> f64 {
    10.
}

fn color(value: &str, field: &str) -> Result<(), String> {
    let ok = value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
    if ok { Ok(()) } else { Err(format!("{field} must be a \"#rrggbb\" colour, got {value:?}")) }
}

fn range(value: f64, field: &str, min: f64, max: f64, min_exclusive: bool) -> Result<(), String> {
    let ok = value.is_finite() && value <= max && (value > min || (!min_exclusive && value == min));
    if ok {
        Ok(())
    } else {
        Err(format!("{field} must be in {}{min}, {max}], got {value}", if min_exclusive { "(" } else { "[" }))
    }
}

fn position(value: &Vec3, field: &str) -> Result<(), String> {
    let ok = [value.x, value.y, value.z].iter().all(|v| v.is_finite() && v.abs() <= 1e9);
    if ok { Ok(()) } else { Err(format!("{field} must be finite coordinates within 1e9")) }
}

impl Lighting {
    pub fn validate(&self) -> Result<(), String> {
        color(&self.ambient.color, "ambient.color")?;
        range(self.ambient.intensity, "ambient.intensity", 0., 16., false)?;
        if let Some(environment) = &self.environment {
            if environment.map.trim().is_empty() || environment.map.len() > 256 {
                return Err("environment.map must name a declared data asset holding an .hdr panorama".into());
            }
            range(environment.intensity, "environment.intensity", 0., 16., false)?;
            range(environment.rotation, "environment.rotation", -360., 360., false)?;
        }
        if let Some(hemisphere) = &self.hemisphere {
            color(&hemisphere.sky, "hemisphere.sky")?;
            color(&hemisphere.ground, "hemisphere.ground")?;
            range(hemisphere.intensity, "hemisphere.intensity", 0., 16., false)?;
        }
        if let Some(sun) = &self.sun {
            position(&sun.direction, "sun.direction")?;
            let length = (sun.direction.x.powi(2) + sun.direction.y.powi(2) + sun.direction.z.powi(2)).sqrt();
            if length < 1e-6 {
                return Err("sun.direction must not be zero; it is the way the light travels, such as {x = -0.4, y = -1, z = -0.3}".into());
            }
            color(&sun.color, "sun.color")?;
            range(sun.intensity, "sun.intensity", 0., 16., false)?;
            if let Some(shadows) = &sun.shadows {
                if !SHADOW_MAP_SIZES.contains(&shadows.size) {
                    return Err(format!("sun.shadows.size must be one of {SHADOW_MAP_SIZES:?}, got {}", shadows.size));
                }
                range(shadows.distance, "sun.shadows.distance", 0., 10_000., true)?;
                range(shadows.bias, "sun.shadows.bias", 0., 0.05, false)?;
            }
        }
        if self.points.len() > MAX_POINT_LIGHTS {
            return Err(format!("points holds at most {MAX_POINT_LIGHTS} lights, got {}", self.points.len()));
        }
        for (index, point) in self.points.iter().enumerate() {
            position(&point.position, &format!("points[{index}].position"))?;
            color(&point.color, &format!("points[{index}].color"))?;
            range(point.intensity, &format!("points[{index}].intensity"), 0., 100., false)?;
            range(point.range, &format!("points[{index}].range"), 0., 1e6, true)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(value: serde_json::Value) -> Result<Lighting, String> {
        let lighting: Lighting = serde_json::from_value(value).map_err(|error| error.to_string())?;
        lighting.validate().map(|()| lighting)
    }

    #[test]
    fn defaults_fill_a_minimal_declaration() {
        let lighting = parse(serde_json::json!({"sun": {"direction": {"x": 0, "y": -1, "z": 0}, "shadows": {}}})).unwrap();
        assert_eq!(lighting.ambient, AmbientLight { color: "#ffffff".into(), intensity: 0.3 });
        let sun = lighting.sun.unwrap();
        assert_eq!((sun.color.as_str(), sun.intensity), ("#ffffff", 1.));
        assert_eq!(sun.shadows, Some(Shadows { size: 2048, distance: 20., bias: 0.001 }));
        assert_eq!(parse(serde_json::json!({})).unwrap().points, vec![]);
    }

    #[test]
    fn invalid_lighting_names_the_field() {
        let point = |extra: serde_json::Value| {
            let mut point = serde_json::json!({"position": {"x": 0, "y": 1, "z": 0}});
            point.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            point
        };
        let cases = [
            (serde_json::json!({"ambient": {"color": "white"}}), "ambient.color"),
            (serde_json::json!({"ambient": {"intensity": 20}}), "ambient.intensity"),
            (serde_json::json!({"sun": {"direction": {"x": 0, "y": 0, "z": 0}}}), "must not be zero"),
            (serde_json::json!({"sun": {"direction": {"x": 0, "y": -1, "z": 0}, "shadows": {"size": 3000}}}), "shadows.size"),
            (serde_json::json!({"sun": {"direction": {"x": 0, "y": -1, "z": 0}, "shadows": {"distance": 0}}}), "shadows.distance"),
            (serde_json::json!({"points": [point(serde_json::json!({"range": 0}))]}), "points[0].range"),
            (serde_json::json!({"points": vec![point(serde_json::json!({})); 9]}), "at most 8"),
            (serde_json::json!({"sun": {"direction": {"x": 0, "y": -1, "z": 0}, "castShadows": true}}), "unknown field"),
        ];
        for (value, expected) in cases {
            let error = parse(value.clone()).unwrap_err();
            assert!(error.contains(expected), "{value}: expected {expected} in {error}");
        }
    }
}
