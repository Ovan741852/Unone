//! Retained world-space meshes built at runtime. The game owns the vertex data
//! and its meaning; the engine validates it once and keeps it until it changes,
//! and the host's camera places it on the GPU. Moving the camera therefore
//! costs no vertex work in Luau, unlike preprojected `projected` geometry.
use crate::{Transform3DData, Vec3};
use base64::Engine;
use serde::{Deserialize, Serialize, ser::SerializeStruct};
use serde_json::value::RawValue;
use std::sync::{Arc, OnceLock};

pub const GEOMETRY3D_FORMAT: &str = "f32le-p3-uv2-rgba4-u32-v1";
/// position.xyz, uv (v0 at the bottom, as for mesh assets), linear RGBA 0..1.
pub const GEOMETRY3D_VERTEX_BYTES: usize = 36;
pub const MAX_GEOMETRY3D_MESHES: usize = 1024;
pub const MAX_GEOMETRY3D_VERTICES: usize = 262_144;
pub const MAX_GEOMETRY3D_INDICES: usize = 1_572_864;
pub const MAX_WORLD_GEOMETRY3D_VERTICES: usize = 2_097_152;
const MAX_COORDINATE: f32 = 1_000_000.0;
const MAX_UV: f32 = 65_536.0;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum Geometry3DBlend {
    /// Writes depth; texture alpha is ignored.
    #[default]
    Opaque,
    /// Writes depth; discards fragments whose alpha is below `alpha_cutoff`.
    Cutout,
    /// Alpha-blended over earlier draws without writing depth, in `order`.
    Transparent,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum Geometry3DFilter { Nearest, #[default] Linear }
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum Geometry3DAddress { #[default] Clamp, Repeat }

/// Unlit appearance: texture (when declared) times vertex color.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Geometry3DMaterial {
    #[serde(default)]
    pub blend: Geometry3DBlend,
    #[serde(default = "default_cutoff")]
    pub alpha_cutoff: f32,
    #[serde(default)]
    pub double_sided: bool,
    #[serde(default)]
    pub filter: Geometry3DFilter,
    #[serde(default)]
    pub address: Geometry3DAddress,
    /// Draw order among transparent meshes; opaque meshes rely on depth.
    #[serde(default)]
    pub order: i32,
}
fn default_cutoff() -> f32 { 0.5 }
impl Default for Geometry3DMaterial {
    fn default() -> Self {
        Self { blend: Geometry3DBlend::Opaque, alpha_cutoff: default_cutoff(), double_sided: false,
            filter: Geometry3DFilter::Linear, address: Geometry3DAddress::Clamp, order: 0 }
    }
}

/// A mesh and its placement. Bytes are immutable and shared by snapshots;
/// `revision` changes only when the mesh content (not its placement) changes.
#[derive(Debug, Clone)]
pub struct Geometry3D {
    pub texture: Option<String>,
    pub material: Geometry3DMaterial,
    pub transform: Transform3DData,
    pub visible: bool,
    pub vertices: Arc<[u8]>,
    pub indices: Arc<[u8]>,
    pub revision: u64,
    encoded: Arc<OnceLock<[String; 2]>>,
    canonical: Arc<OnceLock<Box<RawValue>>>,
}

/// Where a mesh draws. Canonical observations publish placements apart from
/// mesh content, so moving a mesh never re-encodes or re-hashes its vertices.
#[derive(Debug, Clone, Serialize)]
pub struct Geometry3DPlacement {
    pub transform: Transform3DData,
    pub visible: bool,
}

/// Validated content for `World::set_geometry3d`, before a revision is issued.
#[derive(Debug, Clone)]
pub struct Geometry3DContent {
    pub texture: Option<String>,
    pub material: Geometry3DMaterial,
    pub transform: Transform3DData,
    pub visible: bool,
    pub vertices: Vec<u8>,
    pub indices: Vec<u8>,
}

fn invalid(message: &str) -> String { format!("GEOMETRY3D_INVALID: {message}") }

pub(crate) fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 { return Err(invalid("id must contain 1..128 UTF-8 bytes")); }
    Ok(())
}

pub(crate) fn validate_transform(transform: &Transform3DData) -> Result<(), String> {
    let finite = |v: Vec3| [v.x, v.y, v.z].iter().all(|n| n.is_finite() && n.abs() <= f64::from(MAX_COORDINATE));
    if !finite(transform.position) || !finite(transform.rotation) || !finite(transform.scale)
        || [transform.scale.x, transform.scale.y, transform.scale.z].iter().any(|s| *s < 0.)
    {
        return Err(invalid("finite transform within +/-1000000 and nonnegative scale required"));
    }
    Ok(())
}

impl Geometry3DContent {
    pub fn validate(&self) -> Result<(), String> {
        if self.texture.as_ref().is_some_and(|t| t.is_empty() || t.len() > 256) {
            return Err(invalid("texture asset ID must contain 1..256 UTF-8 bytes"));
        }
        let m = &self.material;
        if !m.alpha_cutoff.is_finite() || !(0.0..=1.0).contains(&m.alpha_cutoff) || !(-32768..=32767).contains(&m.order) {
            return Err(invalid("alpha_cutoff in 0..1 and order in -32768..32767 required"));
        }
        validate_transform(&self.transform)?;
        let (vertices, indices) = (&self.vertices, &self.indices);
        if !vertices.len().is_multiple_of(GEOMETRY3D_VERTEX_BYTES) || !indices.len().is_multiple_of(4) {
            return Err(invalid("36-byte vertices and u32 indices required"));
        }
        let (vertex_count, index_count) = (vertices.len() / GEOMETRY3D_VERTEX_BYTES, indices.len() / 4);
        if !(3..=MAX_GEOMETRY3D_VERTICES).contains(&vertex_count) || !(3..=MAX_GEOMETRY3D_INDICES).contains(&index_count) || !index_count.is_multiple_of(3) {
            return Err(invalid("3..262144 vertices and 3..1572864 indices forming triangles required"));
        }
        for record in vertices.chunks_exact(GEOMETRY3D_VERTEX_BYTES) {
            for field in 0..9 {
                let n = f32::from_le_bytes(record[field * 4..field * 4 + 4].try_into().unwrap());
                let ok = n.is_finite() && match field {
                    0..=2 => n.abs() <= MAX_COORDINATE,
                    3 | 4 => n.abs() <= MAX_UV,
                    _ => (0.0..=1.0).contains(&n),
                };
                if !ok { return Err(invalid("finite positions within +/-1000000, uv within +/-65536 and RGBA in 0..1 required")); }
            }
        }
        if indices.chunks_exact(4).any(|i| u32::from_le_bytes(i.try_into().unwrap()) as usize >= vertex_count) {
            return Err(invalid("every index must reference a vertex"));
        }
        Ok(())
    }
    fn same_mesh(&self, other: &Geometry3D) -> bool {
        self.texture == other.texture && self.material == other.material
            && *self.vertices == *other.vertices && *self.indices == *other.indices
    }
}

impl Geometry3D {
    pub fn vertex_count(&self) -> usize { self.vertices.len() / GEOMETRY3D_VERTEX_BYTES }
    pub fn index_count(&self) -> usize { self.indices.len() / 4 }
    /// Base64 vertices and indices, encoded once per mesh generation.
    pub fn encoded(&self) -> &[String; 2] {
        self.encoded.get_or_init(|| {
            let engine = &base64::engine::general_purpose::STANDARD;
            [engine.encode(&self.vertices), engine.encode(&self.indices)]
        })
    }
    pub fn placement(&self) -> Geometry3DPlacement {
        Geometry3DPlacement { transform: self.transform.clone(), visible: self.visible }
    }
}

struct Content<'a>(&'a Geometry3D);
impl Serialize for Content<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mesh = self.0;
        let mut s = serializer.serialize_struct("Geometry3D", 7 + usize::from(mesh.texture.is_some()))?;
        s.serialize_field("format", GEOMETRY3D_FORMAT)?;
        if let Some(texture) = &mesh.texture { s.serialize_field("texture", texture)?; }
        s.serialize_field("material", &mesh.material)?;
        s.serialize_field("vertex_count", &mesh.vertex_count())?;
        s.serialize_field("index_count", &mesh.index_count())?;
        s.serialize_field("revision", &mesh.revision)?;
        let [vertices, indices] = mesh.encoded();
        s.serialize_field("vertices", vertices)?;
        s.serialize_field("indices", indices)?;
        s.end()
    }
}

/// Canonical form: the complete mesh content, so digests and inspection see it;
/// placement is published separately. The JSON is encoded once per mesh
/// generation and then copied, never re-escaped. Official hosts publish memory
/// views of the same bytes instead.
impl Serialize for Geometry3D {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let raw = self.canonical.get_or_init(|| serde_json::value::to_raw_value(&Content(self)).expect("mesh content serializes"));
        raw.serialize(serializer)
    }
}

impl crate::world::World {
    pub(crate) fn set_geometry3d(&mut self, id: String, content: Geometry3DContent) -> Result<(), String> {
        validate_id(&id)?;
        content.validate()?;
        if let Some(current) = self.geometry3d.get_mut(&id) && content.same_mesh(current) {
            // Placement-only change: keep the mesh generation and its encoding.
            current.transform = content.transform;
            current.visible = content.visible;
            return Ok(());
        }
        if !self.geometry3d.contains_key(&id) && self.geometry3d.len() >= MAX_GEOMETRY3D_MESHES {
            return Err("GEOMETRY3D_LIMIT: at most 1024 meshes per world".into());
        }
        let others: usize = self.geometry3d.iter().filter(|(key, _)| **key != id).map(|(_, mesh)| mesh.vertex_count()).sum();
        if others + content.vertices.len() / GEOMETRY3D_VERTEX_BYTES > MAX_WORLD_GEOMETRY3D_VERTICES {
            return Err("GEOMETRY3D_LIMIT: at most 2097152 vertices per world".into());
        }
        let revision = self.geometry3d_revision.checked_add(1).ok_or("GEOMETRY3D_REVISION_LIMIT")?;
        self.geometry3d_revision = revision;
        self.geometry3d.insert(id, Geometry3D {
            texture: content.texture, material: content.material, transform: content.transform, visible: content.visible,
            vertices: content.vertices.into(), indices: content.indices.into(), revision,
            encoded: Arc::new(OnceLock::new()), canonical: Arc::new(OnceLock::new()),
        });
        Ok(())
    }

    pub(crate) fn set_geometry3d_transform(&mut self, id: &str, transform: Transform3DData) -> Result<(), String> {
        validate_transform(&transform)?;
        self.geometry3d.get_mut(id).ok_or_else(|| format!("GEOMETRY3D_MISSING: {id}"))?.transform = transform;
        Ok(())
    }

    pub(crate) fn set_geometry3d_visible(&mut self, id: &str, visible: bool) -> Result<(), String> {
        self.geometry3d.get_mut(id).ok_or_else(|| format!("GEOMETRY3D_MISSING: {id}"))?.visible = visible;
        Ok(())
    }

    pub(crate) fn remove_geometry3d(&mut self, id: &str) -> Result<(), String> {
        self.geometry3d.remove(id).map(|_| ()).ok_or_else(|| format!("GEOMETRY3D_MISSING: {id}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(crate) fn quad() -> (Vec<u8>, Vec<u8>) {
        let mut vertices = Vec::new();
        for (x, z) in [(0f32, 0f32), (1., 0.), (0., 1.), (1., 1.)] {
            for n in [x, 0., z, x, z, 1., 1., 1., 1.] { vertices.extend_from_slice(&n.to_le_bytes()); }
        }
        let indices = [0u32, 2, 1, 1, 2, 3].iter().flat_map(|i| i.to_le_bytes()).collect();
        (vertices, indices)
    }
    fn content(vertices: Vec<u8>, indices: Vec<u8>) -> Geometry3DContent {
        Geometry3DContent { texture: Some("texture://ground".into()), material: Geometry3DMaterial::default(),
            transform: Transform3DData::default(), visible: true, vertices, indices }
    }
    #[test]
    fn placement_changes_keep_the_mesh_generation_and_content_changes_advance_it() {
        let mut world = crate::world::World::default();
        let (vertices, indices) = quad();
        world.set_geometry3d("ground".into(), content(vertices.clone(), indices.clone())).unwrap();
        let first = world.geometry3d["ground"].clone();
        let mut moved = content(vertices.clone(), indices.clone());
        moved.transform.position.x = 5.;
        world.set_geometry3d("ground".into(), moved).unwrap();
        assert_eq!(world.geometry3d["ground"].revision, first.revision);
        assert!(Arc::ptr_eq(&world.geometry3d["ground"].vertices, &first.vertices));
        assert_eq!(world.geometry3d["ground"].transform.position.x, 5.);
        let mut changed = vertices.clone();
        changed[0..4].copy_from_slice(&2f32.to_le_bytes());
        world.set_geometry3d("ground".into(), content(changed, indices)).unwrap();
        assert_eq!(world.geometry3d["ground"].revision, first.revision + 1);
        let json = serde_json::to_value(&world.geometry3d["ground"]).unwrap();
        assert_eq!(json["vertex_count"], 4);
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(json["vertices"].as_str().unwrap()).unwrap().len(), 4 * GEOMETRY3D_VERTEX_BYTES);
    }
    #[test]
    fn invalid_content_never_replaces_the_current_mesh() {
        let mut world = crate::world::World::default();
        let (vertices, indices) = quad();
        world.set_geometry3d("ground".into(), content(vertices.clone(), indices.clone())).unwrap();
        let mut nan = vertices.clone();
        nan[0..4].copy_from_slice(&f32::NAN.to_le_bytes());
        let mut color = vertices.clone();
        color[20..24].copy_from_slice(&1.5f32.to_le_bytes());
        let mut index = indices.clone();
        index[0..4].copy_from_slice(&9u32.to_le_bytes());
        for (v, i) in [(nan, indices.clone()), (color, indices.clone()), (vertices.clone(), index), (vertices[..35].to_vec(), indices.clone()), (vertices.clone(), indices[..8].to_vec())] {
            assert!(world.set_geometry3d("ground".into(), content(v, i)).unwrap_err().starts_with("GEOMETRY3D_INVALID"));
        }
        assert_eq!(world.geometry3d["ground"].revision, 1);
        let mut bad = Transform3DData::default();
        bad.scale.x = -1.;
        assert!(world.set_geometry3d_transform("ground", bad).is_err());
        assert!(world.set_geometry3d_visible("missing", false).unwrap_err().starts_with("GEOMETRY3D_MISSING"));
        world.remove_geometry3d("ground").unwrap();
        world.set_geometry3d("ground".into(), content(vertices, indices)).unwrap();
        assert_eq!(world.geometry3d["ground"].revision, 2, "a recreated mesh never reuses a revision");
    }
}
