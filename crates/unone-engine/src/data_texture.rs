//! Runtime data textures: texel arrays a game builds in Luau for shader
//! materials to sample -- lookup tables, palettes, height and flag maps. Like
//! geometry3d meshes, the engine validates the bytes once and keeps them
//! immutable; observations identify a texture by its shape and revision, and
//! hosts receive the bytes through their transport.
use serde::{Deserialize, Serialize, ser::SerializeStruct};
use base64::Engine;
use std::sync::{Arc, OnceLock};

pub const MAX_DATA_TEXTURES: usize = 64;
pub const MAX_DATA_TEXTURE_SIZE: u32 = 4096;
pub const MAX_DATA_TEXTURE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_WORLD_DATA_TEXTURE_BYTES: usize = 64 * 1024 * 1024;

/// Texel layout, little-endian. Integer formats are read exactly with
/// `texelFetch` from an `int` sampler; the others from a `float` sampler.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum DataTextureFormat {
    /// Four bytes per texel, read as 0..1.
    Rgba8,
    R32i,
    Rgba32i,
    R32f,
    Rgba32f,
}
impl DataTextureFormat {
    pub fn texel_bytes(self) -> usize {
        match self { Self::Rgba8 | Self::R32i | Self::R32f => 4, Self::Rgba32i | Self::Rgba32f => 16 }
    }
    pub fn integer(self) -> bool { matches!(self, Self::R32i | Self::Rgba32i) }
}

#[derive(Debug, Clone)]
pub struct DataTexture {
    pub width: u32,
    pub height: u32,
    pub format: DataTextureFormat,
    pub bytes: Arc<[u8]>,
    /// Changes exactly when the texels or shape change.
    pub revision: u64,
    encoded: Arc<OnceLock<String>>,
}
impl DataTexture {
    /// Base64 texels for hosts without memory views, encoded once per revision.
    pub fn encoded(&self) -> &str {
        self.encoded.get_or_init(|| base64::engine::general_purpose::STANDARD.encode(&self.bytes))
    }
}
/// Canonical form: shape and revision, never the texels.
impl Serialize for DataTexture {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("DataTexture", 4)?;
        s.serialize_field("width", &self.width)?;
        s.serialize_field("height", &self.height)?;
        s.serialize_field("format", &self.format)?;
        s.serialize_field("revision", &self.revision)?;
        s.end()
    }
}

fn invalid(message: &str) -> String { format!("DATA_TEXTURE_INVALID: {message}") }

/// A texel rectangle within a texture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DataTextureRegion { pub x: u32, pub y: u32, pub width: u32, pub height: u32 }

impl crate::world::World {
    pub(crate) fn set_data_texture(&mut self, id: String, width: u32, height: u32, format: DataTextureFormat, bytes: Vec<u8>) -> Result<(), String> {
        if id.is_empty() || id.len() > 128 { return Err(invalid("id must contain 1..128 UTF-8 bytes")); }
        if !(1..=MAX_DATA_TEXTURE_SIZE).contains(&width) || !(1..=MAX_DATA_TEXTURE_SIZE).contains(&height) {
            return Err(invalid("width and height in 1..4096 required"));
        }
        let expected = width as usize * height as usize * format.texel_bytes();
        if expected > MAX_DATA_TEXTURE_BYTES { return Err("DATA_TEXTURE_LIMIT: at most 16 MiB per texture".into()); }
        if bytes.len() != expected { return Err(invalid("data must hold exactly width*height texels of the format")); }
        if let Some(current) = self.data_textures.get(&id)
            && (current.width, current.height, current.format) == (width, height, format) && *current.bytes == *bytes
        {
            return Ok(());
        }
        if !self.data_textures.contains_key(&id) && self.data_textures.len() >= MAX_DATA_TEXTURES {
            return Err("DATA_TEXTURE_LIMIT: at most 64 data textures per world".into());
        }
        let others: usize = self.data_textures.iter().filter(|(key, _)| **key != id).map(|(_, t)| t.bytes.len()).sum();
        if others + bytes.len() > MAX_WORLD_DATA_TEXTURE_BYTES { return Err("DATA_TEXTURE_LIMIT: at most 64 MiB of data textures per world".into()); }
        let revision = self.next_data_texture_revision()?;
        self.data_textures.insert(id, DataTexture { width, height, format, bytes: bytes.into(), revision, encoded: Arc::new(OnceLock::new()) });
        Ok(())
    }

    /// Replaces the texels of one region; the rest of the texture is kept.
    pub(crate) fn update_data_texture(&mut self, id: &str, region: DataTextureRegion, bytes: &[u8]) -> Result<(), String> {
        let current = self.data_textures.get(id).ok_or_else(|| format!("DATA_TEXTURE_MISSING: {id}"))?;
        let DataTextureRegion { x, y, width, height } = region;
        if width == 0 || height == 0 || x.checked_add(width).is_none_or(|end| end > current.width)
            || y.checked_add(height).is_none_or(|end| end > current.height)
        {
            return Err(invalid("region must be non-empty and inside the texture"));
        }
        let texel = current.format.texel_bytes();
        let row = width as usize * texel;
        if bytes.len() != row * height as usize { return Err(invalid("data must hold exactly the region's texels")); }
        let stride = current.width as usize * texel;
        let mut texels = current.bytes.to_vec();
        let mut changed = false;
        for line in 0..height as usize {
            let at = (y as usize + line) * stride + x as usize * texel;
            let source = &bytes[line * row..(line + 1) * row];
            if texels[at..at + row] != *source { texels[at..at + row].copy_from_slice(source); changed = true; }
        }
        if !changed { return Ok(()); }
        let revision = self.next_data_texture_revision()?;
        let target = self.data_textures.get_mut(id).expect("checked above");
        target.bytes = texels.into();
        target.revision = revision;
        target.encoded = Arc::new(OnceLock::new());
        Ok(())
    }

    pub(crate) fn remove_data_texture(&mut self, id: &str) -> Result<(), String> {
        if let Some((material, sampler)) = self.shader_materials.iter().find_map(|(m, d)| d.samplers.iter()
            .find(|(_, s)| s.source == Some(crate::shader::ShaderTextureSource::Data(id.into()))).map(|(n, _)| (m.clone(), n.clone())))
        {
            return Err(format!("DATA_TEXTURE_BOUND: '{id}' is bound to '{material}.{sampler}'; unbind it first"));
        }
        self.data_textures.remove(id).map(|_| ()).ok_or_else(|| format!("DATA_TEXTURE_MISSING: {id}"))
    }

    fn next_data_texture_revision(&mut self) -> Result<u64, String> {
        self.data_texture_revision = self.data_texture_revision.checked_add(1).ok_or("DATA_TEXTURE_REVISION_LIMIT")?;
        Ok(self.data_texture_revision)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn textures_keep_their_revision_until_texels_change_and_regions_update_in_place() {
        let mut world = crate::world::World::default();
        let texels: Vec<u8> = (0..4i32).flat_map(|v| (v * -1000).to_le_bytes()).collect();
        world.set_data_texture("heights".into(), 2, 2, DataTextureFormat::R32i, texels.clone()).unwrap();
        let first = world.data_textures["heights"].revision;
        world.set_data_texture("heights".into(), 2, 2, DataTextureFormat::R32i, texels.clone()).unwrap();
        assert_eq!(world.data_textures["heights"].revision, first, "identical texels keep the revision");
        let json = serde_json::to_value(&world.data_textures["heights"]).unwrap();
        assert_eq!(json, serde_json::json!({"width":2,"height":2,"format":"r32i","revision":first}), "observations carry no texels");
        world.update_data_texture("heights", DataTextureRegion { x: 1, y: 1, width: 1, height: 1 }, &7i32.to_le_bytes()).unwrap();
        let t = &world.data_textures["heights"];
        assert_eq!((t.revision, i32::from_le_bytes(t.bytes[12..16].try_into().unwrap()), &t.bytes[..12]), (first + 1, 7, &texels[..12]));
        world.update_data_texture("heights", DataTextureRegion { x: 1, y: 1, width: 1, height: 1 }, &7i32.to_le_bytes()).unwrap();
        assert_eq!(world.data_textures["heights"].revision, first + 1, "an unchanged region keeps the revision");
        for (region, data) in [((1, 1, 2, 1), vec![0u8; 8]), ((0, 0, 1, 1), vec![0u8; 3]), ((0, 0, 0, 1), vec![])] {
            let (x, y, width, height) = region;
            assert!(world.update_data_texture("heights", DataTextureRegion { x, y, width, height }, &data).unwrap_err().starts_with("DATA_TEXTURE_INVALID"));
        }
        assert!(world.set_data_texture("bad".into(), 2, 2, DataTextureFormat::Rgba32f, texels.clone()).unwrap_err().starts_with("DATA_TEXTURE_INVALID"));
        assert!(world.set_data_texture("big".into(), 4097, 1, DataTextureFormat::Rgba8, vec![0; 4097 * 4]).unwrap_err().starts_with("DATA_TEXTURE_INVALID"));
        assert!(world.update_data_texture("missing", DataTextureRegion { x: 0, y: 0, width: 1, height: 1 }, &[0; 4]).unwrap_err().starts_with("DATA_TEXTURE_MISSING"));
        world.remove_data_texture("heights").unwrap();
        world.set_data_texture("heights".into(), 2, 2, DataTextureFormat::R32i, texels).unwrap();
        assert!(world.data_textures["heights"].revision > first + 1, "a recreated texture never reuses a revision");
    }
}
