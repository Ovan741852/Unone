//! Declarative sprite materials. Core validates/transports author data; the
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ShaderMaterialDefinition {
    /// GLSL ES 1.00 function: vec4 unoneShade(vec2 uv, vec4 color).
    pub fragment: String,
    #[serde(default)]
    pub uniforms: BTreeMap<String, ShaderUniform>,
}

pub(crate) fn valid_identifier(id: &str) -> bool {
    let mut bytes = id.bytes();
    id.len() <= 64
        && matches!(bytes.next(), Some(b'a'..=b'z' | b'A'..=b'Z' | b'_'))
        && bytes.all(|x| x.is_ascii_alphanumeric() || x == b'_')
}

impl ShaderMaterialDefinition {
    pub fn validate(&self) -> Result<(), String> {
        if self.fragment.trim().is_empty()
            || self.fragment.len() > MAX_SHADER_SOURCE_BYTES
            || !self.fragment.contains("unoneShade")
            || self.fragment.contains("#version")
        {
            return Err("SHADER_DEFINITION_INVALID: fragment must define unoneShade, omit #version, and use at most 16384 UTF-8 bytes; see docs/shader-materials.md".into());
        }
        if self.uniforms.len() > MAX_SHADER_UNIFORMS {
            return Err("SHADER_DEFINITION_INVALID: at most 32 uniforms are supported".into());
        }
        for (name, value) in &self.uniforms {
            if !valid_identifier(name)
                || name.starts_with("gl_")
                || name.starts_with("unone_")
                || name.contains("__")
                || matches!(
                    name.as_str(),
                    "main"
                        | "uniform"
                        | "varying"
                        | "attribute"
                        | "precision"
                        | "float"
                        | "vec2"
                        | "vec3"
                        | "vec4"
                        | "void"
                        | "in"
                        | "out"
                        | "texture"
                        | "texture2D"
                )
                || !value.valid()
            {
                return Err(format!(
                    "SHADER_UNIFORM_INVALID: '{name}' must be an unreserved GLSL identifier with finite f32-compatible scalar/vec2/vec3/vec4 values"
                ));
            }
        }
        Ok(())
    }
}

impl World {
    pub(crate) fn set_shader_material(
        &mut self,
        entity: &str,
        material: &str,
    ) -> Result<(), String> {
        if !self.shader_materials.contains_key(material) {
            return Err(format!(
                "SHADER_MATERIAL_UNKNOWN: '{material}' is not declared in scene.shader_materials"
            ));
        }
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
