//! Updateable presentation geometry. Games own sample values and editing rules.
use crate::{MeshAsset, Vec3};
use serde::{Deserialize, Serialize};

pub const MAX_HEIGHTFIELD_SIDE: u32 = 512;
pub const MAX_HEIGHTFIELD_SAMPLES: usize = 262_144;
pub const MAX_HEIGHTFIELDS: usize = 16;
pub const MAX_WORLD_HEIGHTFIELD_SAMPLES: usize = 1_048_576;
const MAX_COORDINATE: f64 = 100_000.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct HeightfieldDefinition {
    pub width: u32,
    pub depth: u32,
    /// Row-major samples, X increasing fastest. Values are local Y coordinates.
    pub heights: Vec<f32>,
    pub cell_size: f32,
    pub origin: Vec3,
    pub texture: String,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct HeightfieldPatch {
    /// Zero-based sample coordinates, not cell coordinates.
    pub x: u32,
    pub z: u32,
    pub width: u32,
    pub depth: u32,
    pub heights: Vec<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Heightfield {
    #[serde(flatten)]
    definition: HeightfieldDefinition,
    revision: u64,
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 {
        return Err("HEIGHTFIELD_INVALID: id must contain 1..128 UTF-8 bytes".into());
    }
    Ok(())
}

fn validate_heights(heights: &[f32], expected: usize, origin_y: f64) -> Result<(), String> {
    if heights.len() != expected
        || heights.iter().any(|height| {
            !height.is_finite()
                || f64::from(*height).abs() > MAX_COORDINATE
                || (origin_y + f64::from(*height)).abs() > MAX_COORDINATE
        })
    {
        return Err("HEIGHTFIELD_INVALID: exact sample count and finite local/world heights within +/-100000 required".into());
    }
    Ok(())
}

impl HeightfieldDefinition {
    pub fn validate(&self) -> Result<(), String> {
        if !(2..=MAX_HEIGHTFIELD_SIDE).contains(&self.width)
            || !(2..=MAX_HEIGHTFIELD_SIDE).contains(&self.depth)
            || self.sample_count() > MAX_HEIGHTFIELD_SAMPLES
        {
            return Err("HEIGHTFIELD_INVALID: width/depth must be 2..512, at most 262144 samples".into());
        }
        if !self.cell_size.is_finite() || self.cell_size <= 0.0 || self.cell_size > 10_000.0 {
            return Err("HEIGHTFIELD_INVALID: cell_size must be finite in (0,10000]".into());
        }
        let end_x = self.origin.x + f64::from(self.width - 1) * f64::from(self.cell_size);
        let end_z = self.origin.z + f64::from(self.depth - 1) * f64::from(self.cell_size);
        if [self.origin.x, self.origin.y, self.origin.z, end_x, end_z]
            .iter()
            .any(|value| !value.is_finite() || value.abs() > MAX_COORDINATE)
        {
            return Err("HEIGHTFIELD_INVALID: origin and grid extent must be finite within +/-100000".into());
        }
        if self.texture.is_empty() || self.texture.len() > 256 {
            return Err("HEIGHTFIELD_INVALID: texture asset ID must contain 1..256 UTF-8 bytes".into());
        }
        validate_heights(&self.heights, self.sample_count(), self.origin.y)
    }

    pub fn sample_count(&self) -> usize {
        self.width as usize * self.depth as usize
    }
}

impl Heightfield {
    pub fn new(definition: HeightfieldDefinition) -> Result<Self, String> {
        definition.validate()?;
        Ok(Self { definition, revision: 1 })
    }

    pub fn definition(&self) -> &HeightfieldDefinition {
        &self.definition
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Generate local-space geometry only when a host's (id, revision) cache changes.
    /// Apply definition.origin separately. UVs cover [0,1], with one fixed diagonal
    /// and upward-facing winding per cell. This does not create collision geometry.
    /// Unlike imported static meshes, v=0 is the texture image's top row (sample
    /// row z=0); hosts must not apply their generic static-mesh V flip to it.
    pub fn mesh(&self) -> MeshAsset {
        let d = &self.definition;
        let mut positions = Vec::with_capacity(d.sample_count() * 3);
        let mut uvs = Vec::with_capacity(d.sample_count() * 2);
        let mut indices = Vec::with_capacity((d.width - 1) as usize * (d.depth - 1) as usize * 6);
        for z in 0..d.depth {
            for x in 0..d.width {
                positions.extend_from_slice(&[
                    x as f32 * d.cell_size,
                    d.heights[(z * d.width + x) as usize],
                    z as f32 * d.cell_size,
                ]);
                uvs.extend_from_slice(&[x as f32 / (d.width - 1) as f32, z as f32 / (d.depth - 1) as f32]);
                if x + 1 < d.width && z + 1 < d.depth {
                    let a = z * d.width + x;
                    indices.extend_from_slice(&[a, a + d.width, a + 1, a + 1, a + d.width, a + d.width + 1]);
                }
            }
        }
        MeshAsset { version: 1, positions, uvs, indices, texture: d.texture.clone(), lods: Vec::new() }
    }

    pub fn update(&mut self, patch: HeightfieldPatch) -> Result<(), String> {
        let d = &self.definition;
        if patch.width == 0 || patch.depth == 0
            || patch.x.checked_add(patch.width).is_none_or(|end| end > d.width)
            || patch.z.checked_add(patch.depth).is_none_or(|end| end > d.depth)
        {
            return Err("HEIGHTFIELD_PATCH_INVALID: nonempty sample rectangle must fit the field".into());
        }
        validate_heights(&patch.heights, patch.width as usize * patch.depth as usize, d.origin.y)?;
        let changed = (0..patch.depth as usize).any(|row| {
            let target = (patch.z as usize + row) * d.width as usize + patch.x as usize;
            let source = row * patch.width as usize;
            d.heights[target..target + patch.width as usize] != patch.heights[source..source + patch.width as usize]
        });
        if !changed { return Ok(()); }
        let revision = self.revision.checked_add(1).ok_or("HEIGHTFIELD_REVISION_LIMIT")?;
        for row in 0..patch.depth as usize {
            let target = (patch.z as usize + row) * self.definition.width as usize + patch.x as usize;
            let source = row * patch.width as usize;
            self.definition.heights[target..target + patch.width as usize]
                .copy_from_slice(&patch.heights[source..source + patch.width as usize]);
        }
        self.revision = revision;
        Ok(())
    }
}

impl crate::world::World {
    pub(crate) fn set_heightfield(&mut self, id: String, definition: HeightfieldDefinition) -> Result<(), String> {
        validate_id(&id)?;
        let mut next = Heightfield::new(definition)?;
        if let Some(previous) = self.heightfields.get(&id) {
            if previous.definition == next.definition { return Ok(()); }
        } else if self.heightfields.len() >= MAX_HEIGHTFIELDS {
            return Err("HEIGHTFIELD_LIMIT: at most 16 fields per world".into());
        }
        let other_samples: usize = self.heightfields.iter()
            .filter(|(key, _)| **key != id)
            .map(|(_, field)| field.definition.sample_count()).sum();
        if other_samples + next.definition.sample_count() > MAX_WORLD_HEIGHTFIELD_SAMPLES {
            return Err("HEIGHTFIELD_LIMIT: at most 1048576 samples per world".into());
        }
        next.revision = self.heightfield_revision.checked_add(1).ok_or("HEIGHTFIELD_REVISION_LIMIT")?;
        self.heightfield_revision = next.revision;
        self.heightfields.insert(id, next);
        Ok(())
    }

    pub(crate) fn update_heightfield(&mut self, id: &str, patch: HeightfieldPatch) -> Result<(), String> {
        let mut next = self.heightfields.get(id)
            .ok_or_else(|| format!("HEIGHTFIELD_MISSING: {id}"))?.clone();
        let previous_revision = next.revision;
        next.update(patch)?;
        if next.revision == previous_revision { return Ok(()); }
        next.revision = self.heightfield_revision.checked_add(1).ok_or("HEIGHTFIELD_REVISION_LIMIT")?;
        self.heightfield_revision = next.revision;
        self.heightfields.insert(id.to_owned(), next);
        Ok(())
    }

    pub(crate) fn remove_heightfield(&mut self, id: &str) -> Result<(), String> {
        self.heightfields.remove(id).map(|_| ())
            .ok_or_else(|| format!("HEIGHTFIELD_MISSING: {id}"))
    }
}
