//! Generic preprojected clip-space geometry. Projection and picking remain game-owned.
use base64::Engine;
use serde::{Serialize,Deserialize,ser::SerializeStruct};
use std::sync::{Arc, OnceLock};

pub const PROJECTED_FORMAT: &str = "f32le-clip4-uv2-rgba4-u32-v1";
pub const MAX_PROJECTED_VERTICES: usize = 262_144;
pub const MAX_PROJECTED_INDICES: usize = 1_572_864;
pub const MAX_PROJECTED_BATCHES: usize = 256;
pub(crate) fn is_visible(value:&bool)->bool {*value}
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize,Default)]
#[serde(rename_all="snake_case")]
pub enum ProjectedColorMode {#[default] Linear,Encoded}
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize,Default)]
#[serde(rename_all="snake_case")]
pub enum ProjectedFilter {#[default] Nearest,Linear}
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize,Default)]
#[serde(rename_all="snake_case")]
pub enum ProjectedSamplingSpace {#[default] Linear,Encoded}
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize,Default)]
#[serde(rename_all="snake_case")]
pub enum ProjectedAddressMode {#[default] Clamp,Repeat}
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize,Default)]
#[serde(rename_all="snake_case")]
pub enum ProjectedAlphaCompare {#[default] GreaterEqual,Greater}
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize,Default)]
#[serde(rename_all="snake_case")]
pub enum ProjectedBlend {#[default] Opaque,SourceOver}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectedScissor {pub x:u32,pub y:u32,pub width:u32,pub height:u32}
impl ProjectedScissor {
    pub fn validate(&self)->Result<(),String> {
        if self.width==0 || self.height==0 || self.x.checked_add(self.width).is_none_or(|n|n>32768)
            || self.y.checked_add(self.height).is_none_or(|n|n>32768) {return Err(invalid("scissor needs nonempty physical pixel rectangle within0..32768"));}Ok(())
    }
    pub fn intersection(&self,width:u32,height:u32)->Option<[u32;4]> {
        let x=self.x.min(width);let y=self.y.min(height);
        let w=self.x.saturating_add(self.width).min(width)-x;let h=self.y.saturating_add(self.height).min(height)-y;
        if w==0 || h==0 {None} else {Some([x,y,w,h])}
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectedViewport {
    pub width: u32,
    pub height: u32,
    pub aspect: f64,
    pub revision: u64,
}
impl Default for ProjectedViewport {
    fn default() -> Self { Self { width:1280,height:720,aspect:1280./720.,revision:1 } }
}

#[derive(Debug, Clone)]
pub struct ProjectedBatch {
    pub texture: String,
    pub order: i32,
    pub depth_test: bool,
    pub depth_write: bool,
    pub scissor:Option<ProjectedScissor>,
    pub color_mode:ProjectedColorMode,
    pub filter:ProjectedFilter,
    pub sampling_space:ProjectedSamplingSpace,
    pub address_mode:ProjectedAddressMode,
    pub alpha_cutoff:f32,
    pub alpha_compare:ProjectedAlphaCompare,
    pub blend:ProjectedBlend,
    pub vertices: Arc<[u8]>,
    pub indices: Arc<[u8]>,
    pub revision: u64,
    encoded_vertices: Arc<OnceLock<String>>,
    encoded_indices: Arc<OnceLock<String>>,
}
impl Serialize for ProjectedBatch {
    fn serialize<S: serde::Serializer>(&self, serializer:S)->Result<S::Ok,S::Error> {
        let fields=15+usize::from(self.scissor.is_some())+usize::from(self.alpha_compare!=ProjectedAlphaCompare::GreaterEqual)+usize::from(self.blend!=ProjectedBlend::Opaque);
        let mut s=serializer.serialize_struct("ProjectedBatch",fields)?;
        s.serialize_field("format",PROJECTED_FORMAT)?;
        s.serialize_field("texture",&self.texture)?;
        s.serialize_field("order",&self.order)?;
        s.serialize_field("depth_test",&self.depth_test)?;
        s.serialize_field("depth_write",&self.depth_write)?;
        s.serialize_field("color_mode",&self.color_mode)?;
        s.serialize_field("filter",&self.filter)?;
        s.serialize_field("sampling_space",&self.sampling_space)?;
        s.serialize_field("address_mode",&self.address_mode)?;
        s.serialize_field("alpha_cutoff",&self.alpha_cutoff)?;
        if self.alpha_compare!=ProjectedAlphaCompare::GreaterEqual {s.serialize_field("alpha_compare",&self.alpha_compare)?;}
        if self.blend!=ProjectedBlend::Opaque {s.serialize_field("blend",&self.blend)?;}
        if let Some(scissor)=&self.scissor {s.serialize_field("scissor",scissor)?;}
        s.serialize_field("vertex_count",&(self.vertices.len()/40))?;
        s.serialize_field("index_count",&(self.indices.len()/4))?;
        s.serialize_field("vertices",self.encoded_vertices.get_or_init(||base64::engine::general_purpose::STANDARD.encode(&self.vertices)))?;
        s.serialize_field("indices",self.encoded_indices.get_or_init(||base64::engine::general_purpose::STANDARD.encode(&self.indices)))?;
        s.serialize_field("revision",&self.revision)?;
        s.end()
    }
}

fn invalid(message:&str)->String { format!("PROJECTED_INVALID: {message}") }
fn validate_vertices(bytes:&[u8])->Result<(),String> {
    if bytes.len()<120 || bytes.len()%40!=0 || bytes.len()/40>MAX_PROJECTED_VERTICES {
        return Err(invalid("3..262144 packed40B vertices required"));
    }
    for vertex in bytes.chunks_exact(40) {
        for i in 0..10 {
            let n=f32::from_le_bytes(vertex[i*4..i*4+4].try_into().unwrap());
            if !n.is_finite() || n.abs()>1_000_000_000. || (i==3 && n<=0.) || (i>=6 && !(0.0..=1.0).contains(&n)) {
                return Err(invalid("finite clip/UV, positiveW and linearRGBA in0..1 required"));
            }
        }
    }
    Ok(())
}
impl ProjectedBatch {
    pub fn new(texture:String,vertices:Vec<u8>,indices:Vec<u8>,order:i32,depth_test:bool,depth_write:bool)->Result<Self,String> {
        if texture.is_empty() || texture.len()>256 || !(-32768..=32767).contains(&order) {
            return Err(invalid("texture1..256B and integer order-32768..32767 required"));
        }
        validate_vertices(&vertices)?;
        if indices.is_empty() || indices.len()%12!=0 || indices.len()/4>MAX_PROJECTED_INDICES {
            return Err(invalid("nonempty u32 triangle-list indices required; max1572864"));
        }
        if indices.chunks_exact(4).any(|b|u32::from_le_bytes(b.try_into().unwrap()) as usize>=vertices.len()/40) {
            return Err(invalid("index outside vertex range"));
        }
        Ok(Self {texture,order,depth_test,depth_write,scissor:None,color_mode:ProjectedColorMode::Linear,filter:ProjectedFilter::Nearest,sampling_space:ProjectedSamplingSpace::Linear,address_mode:ProjectedAddressMode::Clamp,alpha_cutoff:0.05,alpha_compare:ProjectedAlphaCompare::GreaterEqual,blend:ProjectedBlend::Opaque,vertices:vertices.into(),indices:indices.into(),revision:0,
            encoded_vertices:Arc::new(OnceLock::new()),encoded_indices:Arc::new(OnceLock::new())})
    }
    fn same(&self,b:&Self)->bool {
        self.texture==b.texture && self.order==b.order && self.depth_test==b.depth_test && self.depth_write==b.depth_write && self.scissor==b.scissor
            && self.color_mode==b.color_mode && self.filter==b.filter && self.sampling_space==b.sampling_space && self.address_mode==b.address_mode && self.alpha_cutoff==b.alpha_cutoff
            && self.alpha_compare==b.alpha_compare && self.blend==b.blend && self.vertices==b.vertices && self.indices==b.indices
    }
    pub fn with_scissor(mut self,scissor:Option<ProjectedScissor>)->Result<Self,String> {
        if let Some(rect)=&scissor {rect.validate()?;}self.scissor=scissor;Ok(self)
    }
    pub fn with_material(mut self,color_mode:ProjectedColorMode,filter:ProjectedFilter,alpha_cutoff:f32)->Result<Self,String> {
        if !alpha_cutoff.is_finite() || !(0.0..=1.0).contains(&alpha_cutoff) {return Err(invalid("finite alpha_cutoff in0..1 required"));}
        self.color_mode=color_mode;self.filter=filter;self.alpha_cutoff=alpha_cutoff;Ok(self)
    }
    pub fn with_sampling_space(mut self,space:ProjectedSamplingSpace)->Self {self.sampling_space=space;self}
    pub fn with_address_mode(mut self,mode:ProjectedAddressMode)->Self {self.address_mode=mode;self}
    pub fn with_alpha_compare(mut self,mode:ProjectedAlphaCompare)->Self {self.alpha_compare=mode;self}
    pub fn with_blend(mut self,mode:ProjectedBlend)->Result<Self,String> {
        if mode==ProjectedBlend::SourceOver && (self.depth_test || self.depth_write) {
            return Err(invalid("source_over requires depth_test=false and depth_write=false"));
        }
        self.blend=mode;Ok(self)
    }
}
impl crate::world::World {
    pub(crate) fn set_projected(&mut self,id:String,mut batch:ProjectedBatch)->Result<(),String> {
        if self.projected_frame.is_some(){return Err("PROJECTED_FRAME_MIXED: active Frame cannot mix legacy batches".into());}
        if id.is_empty() || id.len()>128 { return Err(invalid("id1..128B required")); }
        if self.projected_geometry.get(&id).is_some_and(|old|old.same(&batch)) { return Ok(()); }
        if !self.projected_geometry.contains_key(&id) && self.projected_geometry.len()>=MAX_PROJECTED_BATCHES {
            return Err("PROJECTED_LIMIT: at most256 batches".into());
        }
        let (mut vertices,mut indices)=(batch.vertices.len()/40,batch.indices.len()/4);
        for (key,b) in &self.projected_geometry {
            if key!=&id {vertices+=b.vertices.len()/40;indices+=b.indices.len()/4;}
        }
        if vertices>1_048_576 || indices>6_291_456 {return Err("PROJECTED_LIMIT: world geometry budget exceeded".into());}
        batch.revision=self.projected_revision.checked_add(1).ok_or("PROJECTED_REVISION_LIMIT")?;
        self.projected_revision=batch.revision;
        self.projected_geometry.insert(id,batch);Ok(())
    }
    pub(crate) fn remove_projected(&mut self,id:&str)->Result<(),String> {
        if self.projected_frame.is_some(){return Err("PROJECTED_FRAME_MIXED: active Frame cannot mix legacy batches".into());}
        self.projected_geometry.remove(id).map(|_|()).ok_or_else(||format!("PROJECTED_MISSING: {id}"))
    }
    pub(crate) fn set_projected_viewport(&mut self,width:u32,height:u32)->Result<(),String> {
        if width==0 || height==0 || width>32768 || height>32768 {return Err("PROJECTED_VIEWPORT_INVALID: pixel dimensions1..32768 required".into());}
        let old=&self.projected_viewport;
        if old.width==width && old.height==height {return Ok(());}
        self.projected_viewport=ProjectedViewport {width,height,aspect:width as f64/height as f64,
            revision:old.revision.checked_add(1).ok_or("PROJECTED_REVISION_LIMIT")?};Ok(())
    }
}
