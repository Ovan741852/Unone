//! Declarative materials for sprites and geometry3d meshes. Core validates and
//! transports author data and the interface between stages; the
//! official renderer owns GPU compilation and resource lifetime.
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MAX_SHADER_MATERIALS: usize = 64;
pub const MAX_SHADER_UNIFORMS: usize = 32;
pub const MAX_SHADER_SOURCE_BYTES: usize = 16_384;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(untagged)]
pub enum ShaderUniform {
    Float(f64),
    Vec2([f64; 2]),
    Vec3([f64; 3]),
    Vec4([f64; 4]),
}

impl ShaderUniform {
    pub(crate) fn valid(&self) -> bool {
        match self {
            Self::Float(x) => x.is_finite() && x.abs() <= f32::MAX as f64,
            Self::Vec2(x) => x
                .iter()
                .all(|x| x.is_finite() && x.abs() <= f32::MAX as f64),
            Self::Vec3(x) => x
                .iter()
                .all(|x| x.is_finite() && x.abs() <= f32::MAX as f64),
            Self::Vec4(x) => x
                .iter()
                .all(|x| x.is_finite() && x.abs() <= f32::MAX as f64),
        }
    }

    pub(crate) fn same_type(&self, other: &Self) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}

pub const MAX_SHADER_ATTRIBUTES: usize = 8;
/// Extra floats per vertex across all declared attributes.
pub const MAX_SHADER_ATTRIBUTE_FLOATS: usize = 16;
pub const MAX_SHADER_VARYINGS: usize = 8;

/// A named per-vertex input of 1..4 floats.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ShaderAttribute {
    pub name: String,
    pub size: u8,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ShaderInterpolation {
    /// Interpolated across the triangle.
    #[default]
    Smooth,
    /// The triangle's provoking (last) vertex value everywhere.
    Flat,
}

/// A value of 1..4 floats the vertex stage writes and the fragment stage reads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ShaderVarying {
    pub name: String,
    pub size: u8,
    #[serde(default)]
    pub interpolation: ShaderInterpolation,
}

pub const MAX_SHADER_SAMPLERS: usize = 8;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ShaderSamplerType {
    /// `sampler2D`: image assets and rgba8/float data textures.
    #[default]
    Float,
    /// `isampler2D`: r32i/rgba32i data textures, read exactly with texelFetch.
    Int,
}

/// What a sampler reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ShaderTextureSource {
    /// A declared texture2d asset.
    Asset(String),
    /// A runtime data texture (`api.texture`), bound with `api.shader.setTexture`.
    Data(String),
}

/// A texture input of both mesh stages. Unbound samplers read zero.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ShaderSampler {
    #[serde(rename = "type", default)]
    pub kind: ShaderSamplerType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<ShaderTextureSource>,
}

/// A declared material: the stages and the interface between mesh data, the
/// vertex stage and the fragment stage. Sprites use only the fragment stage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ShaderMaterialDefinition {
    /// GLSL ES 1.00 function: vec4 unoneShade(vec2 uv, vec4 color).
    pub fragment: String,
    /// GLSL ES 3.00 function `vec4 unoneVertex(vec3 position, mat4 model)`
    /// returning the clip-space position. Only geometry3d meshes have a vertex
    /// stage, so a material declaring one cannot shade sprites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertex: Option<String>,
    #[serde(default)]
    pub uniforms: BTreeMap<String, ShaderUniform>,
    /// Extra floats each vertex of a mesh using this material carries after
    /// its color, in this order; the vertex stage reads them by name.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attributes: Vec<ShaderAttribute>,
    /// Values passed from the vertex stage to the fragment stage by name.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub varyings: Vec<ShaderVarying>,
    /// Texture inputs of both stages: lookup tables, palettes, data maps.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub samplers: BTreeMap<String, ShaderSampler>,
}

pub(crate) fn valid_identifier(id: &str) -> bool {
    let mut bytes = id.bytes();
    id.len() <= 64
        && matches!(bytes.next(), Some(b'a'..=b'z' | b'A'..=b'Z' | b'_'))
        && bytes.all(|x| x.is_ascii_alphanumeric() || x == b'_')
}

/// Names a material may declare. Mesh stages also see the renderer's own
/// vertex inputs and matrices, so a vertex-stage material cannot reuse them.
fn author_name(name: &str, mesh: bool) -> bool {
    valid_identifier(name)
        && !name.starts_with("gl_")
        && !name.starts_with("unone_")
        && !name.contains("__")
        && !matches!(
            name,
            "main" | "uniform" | "varying" | "attribute" | "precision" | "float" | "vec2" | "vec3"
                | "vec4" | "void" | "in" | "out" | "flat" | "texture" | "texture2D"
        )
        && !(mesh
            && matches!(
                name,
                "position" | "uv" | "color" | "normal" | "instanceMatrix" | "modelMatrix" | "viewMatrix"
                    | "projectionMatrix" | "modelViewMatrix" | "normalMatrix" | "cameraPosition" | "isOrthographic"
            ))
}

impl ShaderMaterialDefinition {
    /// Extra floats per vertex for meshes using this material.
    pub fn attribute_floats(&self) -> usize {
        self.attributes.iter().map(|a| usize::from(a.size)).sum()
    }

    /// Materials only geometry3d meshes can use: sprites have no vertex stage
    /// and no texture inputs beyond their own image.
    pub fn mesh_only(&self) -> bool {
        self.vertex.is_some() || !self.samplers.is_empty()
    }

    fn validate_interface(&self) -> Result<(), String> {
        if self.vertex.is_none() && !(self.attributes.is_empty() && self.varyings.is_empty()) {
            return Err("SHADER_DEFINITION_INVALID: attributes and varyings need a vertex stage".into());
        }
        if self.attributes.len() > MAX_SHADER_ATTRIBUTES || self.attribute_floats() > MAX_SHADER_ATTRIBUTE_FLOATS
            || self.varyings.len() > MAX_SHADER_VARYINGS || self.samplers.len() > MAX_SHADER_SAMPLERS
        {
            return Err("SHADER_DEFINITION_INVALID: at most 8 attributes of 16 floats in total, 8 varyings and 8 samplers".into());
        }
        let mesh = self.mesh_only();
        let mut names = std::collections::BTreeSet::new();
        let inputs = self.attributes.iter().map(|a| (a.name.as_str(), a.size))
            .chain(self.varyings.iter().map(|v| (v.name.as_str(), v.size)))
            .chain(self.samplers.keys().map(|name| (name.as_str(), 1)));
        for (name, size) in inputs {
            if !author_name(name, mesh) || !(1..=4).contains(&size) || self.uniforms.contains_key(name) || !names.insert(name) {
                return Err(format!(
                    "SHADER_INPUT_INVALID: '{name}' must be a unique unreserved GLSL identifier of 1..4 floats"
                ));
            }
        }
        for (name, sampler) in &self.samplers {
            match &sampler.source {
                None => {}
                Some(ShaderTextureSource::Asset(asset)) if sampler.kind == ShaderSamplerType::Float && !asset.is_empty() && asset.len() <= 256 => {}
                Some(ShaderTextureSource::Asset(_)) => return Err(format!(
                    "SHADER_TEXTURE_INVALID: '{name}' reads an asset, which needs a float sampler and a 1..256 byte asset ID")),
                Some(ShaderTextureSource::Data(_)) => return Err(format!(
                    "SHADER_TEXTURE_INVALID: '{name}': data textures exist only at runtime; bind them with api.shader.setTexture")),
            }
        }
        Ok(())
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.fragment.trim().is_empty()
            || self.fragment.len() > MAX_SHADER_SOURCE_BYTES
            || !self.fragment.contains("unoneShade")
            || self.fragment.contains("#version")
        {
            return Err("SHADER_DEFINITION_INVALID: fragment must define unoneShade, omit #version, and use at most 16384 UTF-8 bytes; see docs/shader-materials.md".into());
        }
        if self.vertex.as_ref().is_some_and(|vertex| vertex.trim().is_empty()
            || vertex.len() > MAX_SHADER_SOURCE_BYTES
            || !vertex.contains("unoneVertex")
            || vertex.contains("#version"))
        {
            return Err("SHADER_DEFINITION_INVALID: vertex must define unoneVertex, omit #version, and use at most 16384 UTF-8 bytes; see docs/shader-materials.md".into());
        }
        if self.uniforms.len() > MAX_SHADER_UNIFORMS {
            return Err("SHADER_DEFINITION_INVALID: at most 32 uniforms are supported".into());
        }
        for (name, value) in &self.uniforms {
            if !author_name(name, self.vertex.is_some()) || !value.valid() {
                return Err(format!(
                    "SHADER_UNIFORM_INVALID: '{name}' must be an unreserved GLSL identifier with finite f32-compatible scalar/vec2/vec3/vec4 values"
                ));
            }
        }
        self.validate_interface()
    }
}

/// The material a sprite may use: declared, and without a mesh vertex stage.
pub(crate) fn sprite_material<'a>(
    materials: &'a BTreeMap<String, ShaderMaterialDefinition>,
    id: &str,
) -> Result<&'a ShaderMaterialDefinition, String> {
    let definition = materials.get(id).ok_or_else(|| {
        format!("SHADER_MATERIAL_UNKNOWN: '{id}' is not declared in scene.shader_materials")
    })?;
    if definition.mesh_only() {
        return Err(format!(
            "SHADER_TARGET_UNSUPPORTED: '{id}' has a vertex stage or samplers, which only geometry3d meshes use"
        ));
    }
    Ok(definition)
}

impl World {
    pub(crate) fn set_shader_material(
        &mut self,
        entity: &str,
        material: &str,
    ) -> Result<(), String> {
        sprite_material(&self.shader_materials, material)?;
        let target = self
            .entities
            .get_mut(entity)
            .ok_or_else(|| format!("ENTITY_UNKNOWN: '{entity}'"))?;
        if target.sprite.is_none() {
            return Err(format!(
                "SHADER_TARGET_UNSUPPORTED: '{entity}' must have a 2D sprite"
            ));
        }
        target.shader_material = Some(material.into());
        target.sprite_uniforms.clear(); target.sprite_appearance = None;
        Ok(())
    }

    pub(crate) fn clear_shader_material(&mut self, entity: &str) -> Result<(), String> {
        let target = self
            .entities
            .get_mut(entity)
            .ok_or_else(|| format!("ENTITY_UNKNOWN: '{entity}'"))?;
        target.shader_material = None;
        target.sprite_uniforms.clear(); target.sprite_appearance = None;
        Ok(())
    }

    pub(crate) fn set_shader_uniform(
        &mut self,
        material: &str,
        name: &str,
        value: ShaderUniform,
    ) -> Result<(), String> {
        if !value.valid() {
            return Err(
                "SHADER_UNIFORM_INVALID: values must be finite f32-compatible numbers".into(),
            );
        }
        let definition = self
            .shader_materials
            .get_mut(material)
            .ok_or_else(|| format!("SHADER_MATERIAL_UNKNOWN: '{material}'"))?;
        let current = definition.uniforms.get_mut(name).ok_or_else(|| {
            format!("SHADER_UNIFORM_UNKNOWN: '{material}.{name}' is not declared")
        })?;
        if !current.same_type(&value) {
            return Err(format!(
                "SHADER_UNIFORM_TYPE: '{material}.{name}' must retain its declared scalar/vector width"
            ));
        }
        *current = value;
        Ok(())
    }
}

impl World {
    /// Binds (or with `None` unbinds) what a declared sampler reads. A data
    /// texture must exist and match the sampler's type.
    pub(crate) fn set_shader_texture(&mut self, material: &str, sampler: &str, source: Option<ShaderTextureSource>) -> Result<(), String> {
        let definition = self.shader_materials.get(material).ok_or_else(|| format!("SHADER_MATERIAL_UNKNOWN: '{material}'"))?;
        let declared = definition.samplers.get(sampler)
            .ok_or_else(|| format!("SHADER_SAMPLER_UNKNOWN: '{material}.{sampler}' is not declared"))?;
        match &source {
            None => {}
            Some(ShaderTextureSource::Data(id)) => {
                let texture = self.data_textures.get(id).ok_or_else(|| format!("DATA_TEXTURE_MISSING: {id}"))?;
                if texture.format.integer() != (declared.kind == ShaderSamplerType::Int) {
                    return Err(format!("SHADER_TEXTURE_TYPE: '{material}.{sampler}' reads {:?} texels; '{id}' is {:?}", declared.kind, texture.format));
                }
            }
            Some(ShaderTextureSource::Asset(asset)) => {
                if declared.kind != ShaderSamplerType::Float || asset.is_empty() || asset.len() > 256 {
                    return Err(format!("SHADER_TEXTURE_TYPE: '{material}.{sampler}' needs a float sampler and a 1..256 byte asset ID for an asset"));
                }
            }
        }
        self.shader_materials.get_mut(material).expect("checked above")
            .samplers.get_mut(sampler).expect("checked above").source = source;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn mesh() -> ShaderMaterialDefinition {
        serde_json::from_value(serde_json::json!({
            "fragment": "vec4 unoneShade(vec2 uv, vec4 color) { return color + specular; }",
            "vertex": "vec4 unoneVertex(vec3 position, mat4 model) { specular = vec4(cell, 1.0); return vec4(position, 1.0); }",
            "uniforms": {"zoom": 1.0},
            "attributes": [{"name": "cell", "size": 3}],
            "varyings": [{"name": "specular", "size": 4, "interpolation": "flat"}]
        })).unwrap()
    }
    #[test]
    fn stage_interfaces_are_unique_bounded_and_need_a_vertex_stage() {
        let definition = mesh();
        definition.validate().unwrap();
        assert_eq!((definition.attribute_floats(), definition.varyings[0].interpolation), (3, ShaderInterpolation::Flat));
        let reject = |change: &dyn Fn(&mut ShaderMaterialDefinition)| {
            let mut definition = mesh();
            change(&mut definition);
            definition.validate().unwrap_err()
        };
        assert!(reject(&|d| d.vertex = None).contains("need a vertex stage"));
        assert!(reject(&|d| d.attributes[0].name = "zoom".into()).starts_with("SHADER_INPUT_INVALID"), "inputs never shadow uniforms");
        assert!(reject(&|d| d.varyings[0].name = "cell".into()).starts_with("SHADER_INPUT_INVALID"));
        assert!(reject(&|d| d.attributes[0].name = "position".into()).starts_with("SHADER_INPUT_INVALID"), "renderer inputs stay reserved");
        assert!(reject(&|d| d.attributes[0].size = 5).starts_with("SHADER_INPUT_INVALID"));
        assert!(reject(&|d| d.attributes = (0..5).map(|i| ShaderAttribute { name: format!("a{i}"), size: 4 }).collect()).contains("16 floats"));
        assert!(reject(&|d| { d.uniforms.insert("color".into(), ShaderUniform::Float(0.)); }).starts_with("SHADER_UNIFORM_INVALID"));
        assert!(reject(&|d| d.vertex = Some("void main() {}".into())).contains("unoneVertex"));
        // Sprite materials keep their names: only vertex-stage materials see the renderer's inputs.
        let sprite: ShaderMaterialDefinition = serde_json::from_value(serde_json::json!({
            "fragment": "vec4 unoneShade(vec2 uv, vec4 c) { return c * color.x; }", "uniforms": {"color": 1.0}})).unwrap();
        sprite.validate().unwrap();
        let materials = BTreeMap::from([("glow".to_string(), sprite), ("land".to_string(), mesh())]);
        sprite_material(&materials, "glow").unwrap();
        assert!(sprite_material(&materials, "land").unwrap_err().starts_with("SHADER_TARGET_UNSUPPORTED"));
        assert!(sprite_material(&materials, "none").unwrap_err().starts_with("SHADER_MATERIAL_UNKNOWN"));
    }
    #[test]
    fn samplers_bind_assets_or_runtime_data_textures_of_their_type() {
        let mut definition = mesh();
        definition.samplers.insert("heights".into(), ShaderSampler { kind: ShaderSamplerType::Int, source: None });
        definition.samplers.insert("ground".into(), ShaderSampler { kind: ShaderSamplerType::Float, source: Some(ShaderTextureSource::Asset("texture://ground".into())) });
        definition.validate().unwrap();
        let as_json = serde_json::to_value(&definition.samplers).unwrap();
        assert_eq!(as_json, serde_json::json!({"ground":{"type":"float","source":{"asset":"texture://ground"}},"heights":{"type":"int"}}));
        let mut data = definition.clone();
        data.samplers.get_mut("heights").unwrap().source = Some(ShaderTextureSource::Data("heights".into()));
        assert!(data.validate().unwrap_err().contains("runtime"), "scenes cannot name runtime textures");
        let mut clash = definition.clone();
        clash.samplers.insert("cell".into(), ShaderSampler::default());
        assert!(clash.validate().unwrap_err().starts_with("SHADER_INPUT_INVALID"));
        let mut fragment_only = definition.clone();
        fragment_only.vertex = None;
        fragment_only.attributes.clear();
        fragment_only.varyings.clear();
        fragment_only.fragment = "vec4 unoneShade(vec2 uv, vec4 color) { return color; }".into();
        fragment_only.validate().unwrap();
        assert!(fragment_only.mesh_only(), "samplers are a mesh input");

        let mut world = World::default();
        world.shader_materials.insert("land".into(), definition);
        world.set_data_texture("heights".into(), 1, 1, crate::DataTextureFormat::R32i, vec![0; 4]).unwrap();
        world.set_data_texture("palette".into(), 1, 1, crate::DataTextureFormat::Rgba8, vec![0; 4]).unwrap();
        let data = |id: &str| Some(ShaderTextureSource::Data(id.into()));
        world.set_shader_texture("land", "heights", data("heights")).unwrap();
        assert!(world.set_shader_texture("land", "heights", data("palette")).unwrap_err().starts_with("SHADER_TEXTURE_TYPE"));
        assert!(world.set_shader_texture("land", "heights", data("missing")).unwrap_err().starts_with("DATA_TEXTURE_MISSING"));
        assert!(world.set_shader_texture("land", "heights", Some(ShaderTextureSource::Asset("texture://x".into()))).unwrap_err().starts_with("SHADER_TEXTURE_TYPE"));
        assert!(world.set_shader_texture("land", "nothing", None).unwrap_err().starts_with("SHADER_SAMPLER_UNKNOWN"));
        assert!(world.remove_data_texture("heights").unwrap_err().starts_with("DATA_TEXTURE_BOUND"), "bound textures cannot vanish under a material");
        world.set_shader_texture("land", "heights", None).unwrap();
        world.remove_data_texture("heights").unwrap();
    }
}
