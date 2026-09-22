//! Shared decoder contract for exported static meshes and authored LODs.
use serde::Deserialize;
use anyhow::{Result,ensure};
#[derive(Deserialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct MeshAsset {
 pub version:u32,pub positions:Vec<f32>,pub uvs:Vec<f32>,pub indices:Vec<u32>,pub texture:String,
 #[serde(default)] pub lods:Vec<MeshLod>,
}
#[derive(Deserialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct MeshLod {pub distance:f32,pub positions:Vec<f32>,pub uvs:Vec<f32>,pub indices:Vec<u32>}
pub fn validate_mesh_geometry(p:&[f32],uv:&[f32],i:&[u32])->Result<()> {
 ensure!(p.len()>=9&&p.len()<=3_000_000&&p.len().is_multiple_of(3)&&p.iter().all(|v|v.is_finite()),"MESH_INVALID: positions");
 ensure!(uv.len()==p.len()/3*2&&uv.iter().all(|v|v.is_finite()),"MESH_INVALID: uvs");
 ensure!(!i.is_empty()&&i.len()<=6_000_000&&i.len().is_multiple_of(3)&&i.iter().all(|v|(*v as usize)<p.len()/3),"MESH_INVALID: indices");Ok(())
}
impl MeshAsset {pub fn validate(&self)->Result<()> {
 ensure!(self.version==1,"MESH_INVALID: version must be 1");ensure!(!self.texture.is_empty(),"MESH_INVALID: texture asset id");validate_mesh_geometry(&self.positions,&self.uvs,&self.indices)?;
 ensure!(self.lods.len()<=3,"MESH_LOD_LIMIT: at most three lower-detail levels");
 let mut distance=0.;let mut indices=self.indices.len();
 for l in &self.lods {ensure!(l.distance.is_finite()&&l.distance>distance&&l.indices.len()<indices,"MESH_LOD_ORDER: increasing positive distance and decreasing triangles required");validate_mesh_geometry(&l.positions,&l.uvs,&l.indices)?;distance=l.distance;indices=l.indices.len();}Ok(())
}}
#[cfg(test)]mod tests {use super::*;
 #[test]fn lod_typo_and_invalid_order_fail(){
 let v=serde_json::json!({"version":1,"positions":[0,0,0,1,0,0,0,1,0],"uvs":[0,0,0,0,0,0],"indices":[0,1,2],"texture":"texture://test"});
 let mut typo=v.clone();typo["lod"]=serde_json::json!([]);assert!(serde_json::from_value::<MeshAsset>(typo).is_err());
 let mut same=v;let level=serde_json::json!({"distance":10,"positions":same["positions"],"uvs":same["uvs"],"indices":same["indices"]});same["lods"]=serde_json::json!([level]);assert!(serde_json::from_value::<MeshAsset>(same).unwrap().validate().is_err());
 }
}
