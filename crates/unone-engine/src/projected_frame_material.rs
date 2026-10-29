//! Explicit encoded-RGB reference material; no game raw-state identifiers.
use serde::{Deserialize,Serialize};
macro_rules! choices {
    ($name:ident {$($value:ident),+})=>{
        #[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]
        #[serde(rename_all="snake_case")]
        pub enum $name {$($value),+}
    };
}
choices!(ProjectedCompare {Never,Less,Equal,LessEqual,Greater,NotEqual,GreaterEqual,Always});
choices!(FrameRgb {TextureTimesVertex});
choices!(FrameTextureAlpha {Sampled,One});
choices!(FrameAlpha {Texture,Vertex,TextureTimesVertex});
choices!(FrameAdd {Add});
choices!(FrameBlendSource {SourceAlpha});
choices!(FrameBlendDestination {One,OneMinusSourceAlpha});
choices!(FrameClipPolicy {Clip,Inside});

pub(crate) fn normalized<'de,D:serde::Deserializer<'de>>(d:D)->Result<f32,D::Error> {
    let n=f64::deserialize(d)?;
    if !n.is_finite() || !(0.0..=1.0).contains(&n) {
        return Err(serde::de::Error::custom("finite normalized number in0..1 required"));
    }
    Ok(if n==0. {0.} else {n as f32})
}

#[derive(Debug,Clone,PartialEq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameInitial {pub rgb8:[u8;3],#[serde(deserialize_with="normalized")]pub depth:f32}
#[derive(Debug,Clone,PartialEq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameAlphaTest {
    pub enabled:bool,pub compare:ProjectedCompare,
    #[serde(deserialize_with="normalized")]pub reference:f32,
}
#[derive(Debug,Clone,PartialEq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameBlend {
    pub enabled:bool,pub operation:FrameAdd,pub source:FrameBlendSource,pub destination:FrameBlendDestination,
}
#[derive(Debug,Clone,PartialEq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameDepth {pub test:bool,pub write:bool,pub compare:ProjectedCompare}
#[derive(Debug,Clone,PartialEq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameSampler {
    pub min:crate::ProjectedFilter,pub mag:crate::ProjectedFilter,
    pub address_u:crate::ProjectedAddressMode,pub address_v:crate::ProjectedAddressMode,
}
#[derive(Debug,Clone,PartialEq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectedFrameMaterial {
    pub rgb:FrameRgb,pub texture_alpha:FrameTextureAlpha,pub alpha:FrameAlpha,
    pub alpha_test:FrameAlphaTest,pub blend:FrameBlend,pub depth:FrameDepth,pub sampler:FrameSampler,
}
impl ProjectedFrameMaterial {
    pub(crate) fn validate(&self)->Result<(),String> {
        if !self.depth.test&&self.depth.write {
            return Err("PROJECTED_FRAME_DEPTH_UNSUPPORTED: disabled test with writes is outside this profile".into());
        }
        if !self.alpha_test.reference.is_finite() || !(0.0..=1.0).contains(&self.alpha_test.reference) {
            return Err("PROJECTED_FRAME_INVALID: normalized alpha reference required".into());
        }
        Ok(())
    }
}
