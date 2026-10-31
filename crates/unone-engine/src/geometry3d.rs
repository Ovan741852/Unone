//! Retained world-space meshes built at runtime. The game owns the vertex data
//! and its meaning; the engine validates it once and keeps it until it changes,
//! and the host's camera places it on the GPU. Moving the camera therefore
//! costs no vertex work in Luau, unlike preprojected `projected` geometry.
use crate::{Transform3DData, Vec3};
use base64::Engine;
use serde::{Deserialize, Serialize, ser::SerializeStruct};
use std::sync::{Arc, OnceLock};

pub const GEOMETRY3D_FORMAT: &str = "f32le-p3-uv2-rgba4-u32-v1";
/// position.xyz, uv (v0 at the bottom, as for mesh assets), linear RGBA 0..1.
pub const GEOMETRY3D_VERTEX_BYTES: usize = 36;
pub const GEOMETRY3D_BILLBOARD_FORMAT: &str = "f32le-p3-o2-uv2-rgba4-u32-v1";
/// Screen billboards: anchor position.xyz, pixel offset.xy (+x right, +y down),
/// uv, linear RGBA 0..1.
pub const GEOMETRY3D_BILLBOARD_VERTEX_BYTES: usize = 44;
pub const GEOMETRY3D_ATTRIBUTE_FORMAT: &str = "f32le-p3-uv2-rgba4-attr-u32-v1";
// Meshes whose shader material declares attributes: position.xyz, uv, linear
// RGBA 0..1, then each declared attribute in order as finite floats.
/// The largest vertex layout, for bounding buffers before they are copied.
pub const MAX_GEOMETRY3D_VERTEX_BYTES: usize = GEOMETRY3D_VERTEX_BYTES + 4 * crate::shader::MAX_SHADER_ATTRIBUTE_FLOATS;
pub const MAX_GEOMETRY3D_MESHES: usize = 1024;
pub const MAX_GEOMETRY3D_VERTICES: usize = 262_144;
pub const MAX_GEOMETRY3D_INDICES: usize = 1_572_864;
pub const MAX_WORLD_GEOMETRY3D_VERTICES: usize = 2_097_152;
/// Placements per mesh, drawn as GPU instances of one mesh.
pub const MAX_GEOMETRY3D_INSTANCES: usize = 4096;
const MAX_COORDINATE: f32 = 1_000_000.0;
const MAX_UV: f32 = 65_536.0;
const MAX_PIXEL_OFFSET: f32 = 65_536.0;

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
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum Geometry3DBillboard {
    /// Vertices are world positions.
    #[default]
    None,
    /// Each vertex is a world anchor plus a pixel offset: sprites, labels and
    /// markers that keep their pixel size and face the screen at any distance.
    Screen,
}

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
    #[serde(default)]
    pub billboard: Geometry3DBillboard,
    /// World units the depth test moves toward the camera without moving the
    /// image, so a standing sprite is not cut by the ground behind its anchor.
    #[serde(default)]
    pub depth_bias: f32,
    /// A declared `scene.shader_materials` ID shading the mesh, optionally with
    /// its own vertex stage and per-vertex attributes. Billboards keep the
    /// built-in material.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shader: Option<String>,
}
fn default_cutoff() -> f32 { 0.5 }
impl Default for Geometry3DMaterial {
    fn default() -> Self {
        Self { blend: Geometry3DBlend::Opaque, alpha_cutoff: default_cutoff(), double_sided: false,
            filter: Geometry3DFilter::Linear, address: Geometry3DAddress::Clamp, order: 0,
            billboard: Geometry3DBillboard::None, depth_bias: 0.0, shader: None }
    }
}
impl Geometry3DMaterial {
    /// Vertex bytes and format when the shader declares `attribute_floats`
    /// extra floats per vertex.
    pub fn layout(&self, attribute_floats: usize) -> (usize, &'static str) {
        match (self.billboard, attribute_floats) {
            (Geometry3DBillboard::Screen, _) => (GEOMETRY3D_BILLBOARD_VERTEX_BYTES, GEOMETRY3D_BILLBOARD_FORMAT),
            (_, 0) => (GEOMETRY3D_VERTEX_BYTES, GEOMETRY3D_FORMAT),
            (_, n) => (GEOMETRY3D_VERTEX_BYTES + 4 * n, GEOMETRY3D_ATTRIBUTE_FORMAT),
        }
    }
}

/// A mesh and its placements. Bytes are immutable and shared by snapshots;
/// `revision` changes only when the mesh content (not its placement) changes.
#[derive(Debug, Clone)]
pub struct Geometry3D {
    pub texture: Option<String>,
    pub material: Geometry3DMaterial,
    /// One transform per drawn instance of the mesh.
    pub transforms: Vec<Transform3DData>,
    pub visible: bool,
    pub vertices: Arc<[u8]>,
    pub indices: Arc<[u8]>,
    pub revision: u64,
    /// Floats per vertex the shader material declares after the color.
    attribute_floats: usize,
    encoded: Arc<OnceLock<[String; 2]>>,
}

/// Where a mesh draws. Canonical observations publish placements apart from
/// mesh content, so moving a mesh never re-encodes or re-hashes its vertices.
#[derive(Debug, Clone, Serialize)]
pub struct Geometry3DPlacement {
    pub transforms: Vec<Transform3DData>,
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
    /// Checks the content against its layout: `attribute_floats` extra floats
    /// per vertex, as the shader material declares.
    pub fn validate(&self, attribute_floats: usize) -> Result<(), String> {
        if self.texture.as_ref().is_some_and(|t| t.is_empty() || t.len() > 256) {
            return Err(invalid("texture asset ID must contain 1..256 UTF-8 bytes"));
        }
        let m = &self.material;
        if !m.alpha_cutoff.is_finite() || !(0.0..=1.0).contains(&m.alpha_cutoff) || !(-32768..=32767).contains(&m.order)
            || !m.depth_bias.is_finite() || m.depth_bias.abs() > MAX_COORDINATE
        {
            return Err(invalid("alpha_cutoff in 0..1, order in -32768..32767 and finite depth_bias required"));
        }
        if m.billboard == Geometry3DBillboard::Screen && m.shader.is_some() {
            return Err(invalid("screen billboards keep the built-in material"));
        }
        validate_transform(&self.transform)?;
        let (vertices, indices, stride) = (&self.vertices, &self.indices, m.layout(attribute_floats).0);
        if !vertices.len().is_multiple_of(stride) || !indices.len().is_multiple_of(4) {
            return Err(invalid("36-byte vertices (44 for billboards, plus 4 per declared attribute float) and u32 indices required"));
        }
        let (vertex_count, index_count) = (vertices.len() / stride, indices.len() / 4);
        if !(3..=MAX_GEOMETRY3D_VERTICES).contains(&vertex_count) || !(3..=MAX_GEOMETRY3D_INDICES).contains(&index_count) || !index_count.is_multiple_of(3) {
            return Err(invalid("3..262144 vertices and 3..1572864 indices forming triangles required"));
        }
        // Billboards carry a pixel offset after the anchor and declared
        // attributes follow the color; position, uv and color are shared.
        let offset_fields = if m.billboard == Geometry3DBillboard::Screen { 2 } else { 0 };
        for record in vertices.chunks_exact(stride) {
            for field in 0..stride / 4 {
                let n = f32::from_le_bytes(record[field * 4..field * 4 + 4].try_into().unwrap());
                let ok = n.is_finite() && match field {
                    0..=2 => n.abs() <= MAX_COORDINATE,
                    f if f < 3 + offset_fields => n.abs() <= MAX_PIXEL_OFFSET,
                    f if f < 5 + offset_fields => n.abs() <= MAX_UV,
                    f if f < 9 + offset_fields => (0.0..=1.0).contains(&n),
                    _ => true,
                };
                if !ok { return Err(invalid("finite positions within +/-1000000, offsets and uv within +/-65536, RGBA in 0..1 and finite attributes required")); }
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
    pub fn format(&self) -> &'static str { self.material.layout(self.attribute_floats).1 }
    pub fn vertex_count(&self) -> usize { self.vertices.len() / self.material.layout(self.attribute_floats).0 }
    pub fn index_count(&self) -> usize { self.indices.len() / 4 }
    /// Base64 vertices and indices for hosts without memory views, encoded once
    /// per mesh generation.
    pub fn encoded(&self) -> &[String; 2] {
        self.encoded.get_or_init(|| {
            let engine = &base64::engine::general_purpose::STANDARD;
            [engine.encode(&self.vertices), engine.encode(&self.indices)]
        })
    }
    pub fn placement(&self) -> Geometry3DPlacement {
        Geometry3DPlacement { transforms: self.transforms.clone(), visible: self.visible }
    }
}

/// Canonical form: the content's shape and its deterministic revision, which
/// changes exactly when the bytes, texture or material change, as instance
/// batches identify theirs. The bytes themselves never enter observations or
/// their digest, so a large mesh costs no encoding or hashing per tick; hosts
/// receive them through their transport. Placement is published separately.
impl Serialize for Geometry3D {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("Geometry3D", 5 + usize::from(self.texture.is_some()))?;
        s.serialize_field("format", self.format())?;
        if let Some(texture) = &self.texture { s.serialize_field("texture", texture)?; }
        s.serialize_field("material", &self.material)?;
        s.serialize_field("vertex_count", &self.vertex_count())?;
        s.serialize_field("index_count", &self.index_count())?;
        s.serialize_field("revision", &self.revision)?;
        s.end()
    }
}

impl crate::world::World {
    pub(crate) fn set_geometry3d(&mut self, id: String, content: Geometry3DContent) -> Result<(), String> {
        validate_id(&id)?;
        // Scene materials are fixed until the next scene, which clears meshes,
        // so the layout resolved here stays valid for the mesh's lifetime.
        let attribute_floats = match &content.material.shader {
            None => 0,
            Some(shader) => self.shader_materials.get(shader).ok_or_else(|| format!(
                "SHADER_MATERIAL_UNKNOWN: '{shader}' is not declared in scene.shader_materials"))?.attribute_floats(),
        };
        content.validate(attribute_floats)?;
        if let Some(current) = self.geometry3d.get_mut(&id) && content.same_mesh(current) {
            // Placement-only change: keep the mesh generation and its encoding.
            current.transforms = vec![content.transform];
            current.visible = content.visible;
            return Ok(());
        }
        if !self.geometry3d.contains_key(&id) && self.geometry3d.len() >= MAX_GEOMETRY3D_MESHES {
            return Err("GEOMETRY3D_LIMIT: at most 1024 meshes per world".into());
        }
        let stride = content.material.layout(attribute_floats).0;
        let others: usize = self.geometry3d.iter().filter(|(key, _)| **key != id).map(|(_, mesh)| mesh.vertex_count()).sum();
        if others + content.vertices.len() / stride > MAX_WORLD_GEOMETRY3D_VERTICES {
            return Err("GEOMETRY3D_LIMIT: at most 2097152 vertices per world".into());
        }
        let revision = self.geometry3d_revision.checked_add(1).ok_or("GEOMETRY3D_REVISION_LIMIT")?;
        self.geometry3d_revision = revision;
        self.geometry3d.insert(id, Geometry3D {
            texture: content.texture, material: content.material, transforms: vec![content.transform], visible: content.visible,
            vertices: content.vertices.into(), indices: content.indices.into(), revision, attribute_floats,
            encoded: Arc::new(OnceLock::new()),
        });
        Ok(())
    }

    pub(crate) fn set_geometry3d_transform(&mut self, id: &str, transform: Transform3DData) -> Result<(), String> {
        self.set_geometry3d_transforms(id, vec![transform])
    }

    /// Draws one mesh at every transform, as GPU instances.
    pub(crate) fn set_geometry3d_transforms(&mut self, id: &str, transforms: Vec<Transform3DData>) -> Result<(), String> {
        if transforms.len() > MAX_GEOMETRY3D_INSTANCES {
            return Err("GEOMETRY3D_LIMIT: at most 4096 transforms per mesh".into());
        }
        for transform in &transforms { validate_transform(transform)?; }
        self.geometry3d.get_mut(id).ok_or_else(|| format!("GEOMETRY3D_MISSING: {id}"))?.transforms = transforms;
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
        assert_eq!(world.geometry3d["ground"].transforms[0].position.x, 5.);
        let tiles: Vec<_> = (0..9).map(|i| { let mut t = Transform3DData::default(); t.position.x = f64::from(i) * 128.; t }).collect();
        world.set_geometry3d_transforms("ground", tiles).unwrap();
        assert_eq!((world.geometry3d["ground"].transforms.len(), world.geometry3d["ground"].revision), (9, first.revision));
        assert!(world.set_geometry3d_transforms("ground", vec![Transform3DData::default(); MAX_GEOMETRY3D_INSTANCES + 1]).is_err());
        let mut changed = vertices.clone();
        changed[0..4].copy_from_slice(&2f32.to_le_bytes());
        world.set_geometry3d("ground".into(), content(changed, indices)).unwrap();
        assert_eq!(world.geometry3d["ground"].revision, first.revision + 1);
        let json = serde_json::to_value(&world.geometry3d["ground"]).unwrap();
        assert_eq!(json["vertex_count"], 4);
        assert_eq!(json["revision"], first.revision + 1);
        assert!(json.get("vertices").is_none() && json.get("indices").is_none(), "canonical meshes carry no bytes");
        let [encoded, _] = world.geometry3d["ground"].encoded();
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(encoded).unwrap().len(), 4 * GEOMETRY3D_VERTEX_BYTES);
    }
    #[test]
    fn screen_billboards_use_their_own_vertex_layout() {
        let mut world = crate::world::World::default();
        let mut vertices = Vec::new();
        for (ox, oy) in [(-8f32, -16f32), (8., -16.), (-8., 0.), (8., 0.)] {
            for n in [1f32, 2., 3., ox, oy, 0., 0., 1., 1., 1., 1.] { vertices.extend_from_slice(&n.to_le_bytes()); }
        }
        let indices: Vec<u8> = [0u32, 2, 1, 1, 2, 3].iter().flat_map(|i| i.to_le_bytes()).collect();
        let mut sprite = content(vertices.clone(), indices.clone());
        sprite.material.billboard = Geometry3DBillboard::Screen;
        sprite.material.depth_bias = 0.5;
        world.set_geometry3d("person".into(), sprite.clone()).unwrap();
        let json = serde_json::to_value(&world.geometry3d["person"]).unwrap();
        assert_eq!((json["format"].as_str().unwrap(), json["vertex_count"].as_u64().unwrap()), (GEOMETRY3D_BILLBOARD_FORMAT, 4));
        // The same bytes are not a whole number of plain 36-byte vertices.
        assert!(world.set_geometry3d("plain".into(), content(vertices.clone(), indices.clone())).is_err());
        let mut far = vertices.clone();
        far[12..16].copy_from_slice(&1e6f32.to_le_bytes());
        sprite.vertices = far;
        assert!(world.set_geometry3d("person".into(), sprite).unwrap_err().starts_with("GEOMETRY3D_INVALID"));
    }
    #[test]
    fn shader_meshes_take_the_vertex_layout_their_material_declares() {
        use crate::shader::{ShaderAttribute, ShaderMaterialDefinition};
        let mut world = crate::world::World::default();
        // Two declared attributes, cell (3 floats) and corner (1), follow the color.
        let mut vertices = Vec::new();
        for (x, z) in [(0f32, 0f32), (1., 0.), (0., 1.)] {
            for n in [x, 0., z, x, z, 1., 1., 1., 1., -70000., 2.5, 3., 4.] { vertices.extend_from_slice(&n.to_le_bytes()); }
        }
        let indices: Vec<u8> = [0u32, 1, 2].iter().flat_map(|i| i.to_le_bytes()).collect();
        let mut mesh = content(vertices.clone(), indices.clone());
        mesh.material.shader = Some("exact".into());
        assert!(world.set_geometry3d("land".into(), mesh.clone()).unwrap_err().starts_with("SHADER_MATERIAL_UNKNOWN"));
        let exact = ShaderMaterialDefinition {
            fragment: "vec4 unoneShade(vec2 uv, vec4 color) { return color; }".into(),
            vertex: Some("vec4 unoneVertex(vec3 position, mat4 model) { return vec4(cell.xy, corner, 1.0); }".into()),
            uniforms: Default::default(),
            attributes: vec![ShaderAttribute { name: "cell".into(), size: 3 }, ShaderAttribute { name: "corner".into(), size: 1 }],
            varyings: vec![], samplers: Default::default() };
        exact.validate().unwrap();
        world.shader_materials.insert("exact".into(), exact.clone());
        world.set_geometry3d("land".into(), mesh.clone()).unwrap();
        let json = serde_json::to_value(&world.geometry3d["land"]).unwrap();
        assert_eq!((json["format"].as_str().unwrap(), json["vertex_count"].as_u64().unwrap()), (GEOMETRY3D_ATTRIBUTE_FORMAT, 3));
        assert_eq!(json["material"]["shader"].as_str(), Some("exact"));
        assert!(serde_json::to_value(Geometry3DMaterial::default()).unwrap().get("shader").is_none(), "plain materials keep their canonical form");
        let mut nan = vertices.clone();
        nan[48..52].copy_from_slice(&f32::NAN.to_le_bytes());
        let mut bad = mesh.clone();
        bad.vertices = nan;
        assert!(world.set_geometry3d("land".into(), bad).unwrap_err().starts_with("GEOMETRY3D_INVALID"));
        // A material without attributes reads plain 36-byte vertices, so these do not fit.
        world.shader_materials.insert("plain".into(), ShaderMaterialDefinition { attributes: vec![], ..exact.clone() });
        let mut plain = mesh.clone();
        plain.material.shader = Some("plain".into());
        assert!(world.set_geometry3d("other".into(), plain).unwrap_err().starts_with("GEOMETRY3D_INVALID"));
        let mut billboard = mesh;
        billboard.material.billboard = Geometry3DBillboard::Screen;
        assert!(world.set_geometry3d("other".into(), billboard).unwrap_err().contains("billboards"));
        // Two attribute floats make 44-byte vertices, the billboard size: the
        // material, not the size, decides that field 3 is an attribute.
        let mut wide = Vec::new();
        for (x, z) in [(0f32, 0f32), (1., 0.), (0., 1.)] {
            for n in [x, 0., z, x, z, 1., 1., 1., 1., -70000., 1.] { wide.extend_from_slice(&n.to_le_bytes()); }
        }
        world.shader_materials.insert("pair".into(), ShaderMaterialDefinition {
            attributes: vec![ShaderAttribute { name: "cell".into(), size: 2 }], ..exact });
        let mut pair = content(wide, indices);
        pair.material.shader = Some("pair".into());
        world.set_geometry3d("pair".into(), pair).unwrap();
        assert_eq!(world.geometry3d["pair"].vertex_count(), 3);
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
