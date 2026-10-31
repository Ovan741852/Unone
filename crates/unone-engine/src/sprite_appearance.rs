//! Validate the complete appearance before changing any entity field.
use std::collections::BTreeMap;
use crate::{SpriteAppearance, SpriteAppearanceMetadata, SpriteData, ShaderUniform};
use crate::world::{World, Transform2DData};

pub(crate) struct AppliedAppearance {
    transform: Transform2DData, sprite: SpriteData,
    material: Option<String>, uniforms: BTreeMap<String, ShaderUniform>,
}

impl World {
    pub(crate) fn validate_sprite_appearance(&self, id: &str, asset: &str, material: Option<&str>, appearance: &SpriteAppearance) -> Result<AppliedAppearance, String> {
        crate::world::validate_transform2d(appearance.transform.position, appearance.transform.rotation,
            appearance.transform.scale, "Sprite appearance transform").map_err(|d| d.explanation.clone())?;
        let entity = self.entities.get(id).ok_or_else(|| format!("ENTITY_UNKNOWN: '{id}'"))?;
        if entity.transform3d.is_some() { return Err(format!("ENTITY_DIMENSION_MISMATCH: '{id}' has Transform3D")); }
        let sprite = SpriteData { asset: asset.into(), size: appearance.size, visible: appearance.visible,
            layer: appearance.layer, sheet: appearance.sheet, frame: appearance.frame };
        if !crate::scene::sprite_size_valid(&sprite) {
            return Err("SPRITE_APPEARANCE_INVALID: size must be finite and positive".into());
        }
        if let Some(error) = crate::scene::sprite_frame_problem(&sprite) {
            return Err(format!("SPRITE_APPEARANCE_INVALID: {error}"));
        }
        let mut uniforms = match material {
            Some(id) => crate::shader::sprite_material(&self.shader_materials, id)?.uniforms.clone(),
            None => BTreeMap::new(),
        };
        if appearance.uniforms.len() > crate::shader::MAX_SHADER_UNIFORMS {
            return Err("SHADER_UNIFORM_INVALID: at most 32 instance uniforms".into());
        }
        for (name, value) in &appearance.uniforms {
            let declared = uniforms.get(name).ok_or_else(|| format!("SHADER_UNIFORM_UNKNOWN: '{name}' is not declared by the prepared material"))?;
            if !value.valid() { return Err(format!("SHADER_UNIFORM_INVALID: '{name}' must be finite and f32-compatible")); }
            if !declared.same_type(value) { return Err(format!("SHADER_UNIFORM_TYPE: '{name}' must retain its declared width")); }
            uniforms.insert(name.clone(), value.clone());
        }
        Ok(AppliedAppearance { transform: appearance.transform.clone(), sprite, material: material.map(str::to_owned), uniforms })
    }

    pub(crate) fn matches_sprite_appearance(&self, id: &str, desired: &AppliedAppearance) -> bool {
        let e = &self.entities[id];
        e.transform == desired.transform.position && e.rotation == desired.transform.rotation
            && e.scale == desired.transform.scale && e.sprite.as_ref() == Some(&desired.sprite)
            && e.shader_material == desired.material && e.sprite_uniforms == desired.uniforms
            && e.sprite_animation.is_none()
    }

    pub(crate) fn apply_sprite_appearance(&mut self, id: &str, desired: AppliedAppearance, metadata: SpriteAppearanceMetadata) {
        let e = self.entities.get_mut(id).expect("validated appearance entity");
        e.transform = desired.transform.position; e.rotation = desired.transform.rotation; e.scale = desired.transform.scale;
        e.sprite = Some(desired.sprite); e.shader_material = desired.material;
        e.sprite_uniforms = desired.uniforms; e.sprite_appearance = Some(metadata); e.sprite_animation = None;
    }
}
