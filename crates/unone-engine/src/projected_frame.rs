//! Atomic ordered reference frames, distinct from legacy projected batches.
use std::sync::{Arc,OnceLock};
use serde::{Serialize,ser::SerializeStruct};
use base64::Engine;
use crate::{ProjectedScissor,projected_frame_material::{FrameClipPolicy,FrameInitial,ProjectedFrameMaterial}};
use crate::projected_frame_validation::{invalid,validate_draw};
pub const PROJECTED_FRAME_PROFILE:&str="rgb8_encoded_rebuild_v1";
pub const PROJECTED_FRAME_GOURAUD_PROFILE:&str="rgb8_encoded_gouraud_v1";
pub const MAX_PROJECTED_FRAME_DRAWS:usize=1024;
pub(crate) fn parse_frame_profile(profile:&str)->Result<&'static str,String> {
    match profile {
        PROJECTED_FRAME_PROFILE=>Ok(PROJECTED_FRAME_PROFILE),
        PROJECTED_FRAME_GOURAUD_PROFILE=>Ok(PROJECTED_FRAME_GOURAUD_PROFILE),
        _=>Err(invalid("unknown frame profile")),
    }
}
fn serialize_revision<S:serde::Serializer>(n:&u64,s:S)->Result<S::Ok,S::Error> {
    if *n<=9_007_199_254_740_991 {s.serialize_u64(*n)}else{s.serialize_str(&n.to_string())}
}

#[derive(Debug,Clone)]
pub struct ProjectedFrameDraw {
    pub id:String,pub texture:String,pub clip_policy:FrameClipPolicy,pub material:ProjectedFrameMaterial,
    pub scissor:Option<ProjectedScissor>,pub vertices:Arc<[u8]>,pub indices:Arc<[u8]>,
    encoded:Arc<OnceLock<[String;2]>>,
}
impl ProjectedFrameDraw {
    pub fn new(id:String,texture:String,clip_policy:FrameClipPolicy,material:ProjectedFrameMaterial,
        scissor:Option<ProjectedScissor>,vertices:Vec<u8>,indices:Vec<u8>)->Result<Self,String> {
        Self::new_for_profile(PROJECTED_FRAME_PROFILE,id,texture,clip_policy,material,scissor,vertices,indices)
    }
    pub fn new_for_profile(profile:&str,id:String,texture:String,clip_policy:FrameClipPolicy,material:ProjectedFrameMaterial,
        scissor:Option<ProjectedScissor>,vertices:Vec<u8>,indices:Vec<u8>)->Result<Self,String> {
        let profile=parse_frame_profile(profile)?;
        let draw=Self{id,texture,clip_policy,material,scissor,vertices:vertices.into(),indices:indices.into(),encoded:Arc::new(OnceLock::new())};
        validate_draw(&draw,profile)?;Ok(draw)
    }
    fn same(&self,b:&Self)->bool {
        self.id==b.id&&self.texture==b.texture&&self.clip_policy==b.clip_policy&&self.material==b.material
            &&self.scissor==b.scissor&&self.vertices==b.vertices&&self.indices==b.indices
    }
}
impl Serialize for ProjectedFrameDraw {
    fn serialize<S:serde::Serializer>(&self,s:S)->Result<S::Ok,S::Error> {
        let mut s=s.serialize_struct("ProjectedFrameDraw",9+usize::from(self.scissor.is_some()))?;
        let encoded=self.encoded.get_or_init(||[base64::engine::general_purpose::STANDARD.encode(&self.vertices),base64::engine::general_purpose::STANDARD.encode(&self.indices)]);
        s.serialize_field("format",crate::PROJECTED_FORMAT)?;s.serialize_field("id",&self.id)?;
        s.serialize_field("texture",&self.texture)?;s.serialize_field("clip_policy",&self.clip_policy)?;
        s.serialize_field("material",&self.material)?;
        if let Some(scissor)=&self.scissor {s.serialize_field("scissor",scissor)?;}
        s.serialize_field("vertex_count",&(self.vertices.len()/40))?;s.serialize_field("index_count",&(self.indices.len()/4))?;
        s.serialize_field("vertices",&encoded[0])?;s.serialize_field("indices",&encoded[1])?;s.end()
    }
}
#[derive(Debug,Clone,Serialize)]
pub struct ProjectedFrame {
    pub profile:&'static str,pub initial:FrameInitial,pub draws:Vec<ProjectedFrameDraw>,
    #[serde(serialize_with="serialize_revision")]pub revision:u64,
}
impl ProjectedFrame {
    pub fn new(initial:FrameInitial,draws:Vec<ProjectedFrameDraw>)->Result<Self,String> {
        Self::new_for_profile(PROJECTED_FRAME_PROFILE,initial,draws)
    }
    pub fn new_for_profile(profile:&str,initial:FrameInitial,draws:Vec<ProjectedFrameDraw>)->Result<Self,String> {
        let profile=parse_frame_profile(profile)?;
        if draws.len()>MAX_PROJECTED_FRAME_DRAWS {return Err(invalid("at most1024 ordered draws"));}
        if !initial.depth.is_finite()||!(0.0..=1.0).contains(&initial.depth) {return Err(invalid("normalized initial depth required"));}
        let mut ids=std::collections::BTreeSet::new();let (mut vertices,mut indices)=(0,0);
        for draw in &draws {
            validate_draw(draw,profile)?;if !ids.insert(&draw.id) {return Err(invalid("unique draw ids required"));}
            vertices+=draw.vertices.len()/40;indices+=draw.indices.len()/4;
        }
        if vertices>1_048_576||indices>6_291_456 {return Err(invalid("world geometry budget exceeded"));}
        Ok(Self{profile,initial,draws,revision:0})
    }
    fn same(&self,b:&Self)->bool {
        self.profile==b.profile&&self.initial==b.initial&&self.draws.len()==b.draws.len()&&self.draws.iter().zip(&b.draws).all(|(a,b)|a.same(b))
    }
}
impl crate::world::World {
    pub(crate) fn set_projected_frame(&mut self,mut frame:ProjectedFrame)->Result<(),String> {
        if !self.projected_geometry.is_empty(){return Err("PROJECTED_FRAME_MIXED: remove legacy batches before setFrame".into());}
        if self.projected_frame.as_ref().is_some_and(|old|old.same(&frame)){return Ok(());}
        let revision=self.projected_revision.checked_add(1).ok_or("PROJECTED_REVISION_LIMIT")?;
        frame.revision=revision;self.projected_revision=revision;self.projected_frame=Some(frame);Ok(())
    }
}
