use crate::{projected_frame::ProjectedFrameDraw,projected_frame_material::FrameClipPolicy};
pub(crate) fn invalid(message:&str)->String {format!("PROJECTED_FRAME_INVALID: {message}")}
fn component(vertex:&[u8],i:usize)->f32 {f32::from_le_bytes(vertex[i*4..i*4+4].try_into().unwrap())}

pub(crate) fn validate_draw(d:&ProjectedFrameDraw,profile:&str)->Result<(),String> {
    let constant_color=profile==crate::PROJECTED_FRAME_PROFILE;
    let vertices=&d.vertices;let indices=&d.indices;
    if d.id.is_empty()||d.id.len()>128||d.texture.is_empty()||d.texture.len()>256 {
        return Err(invalid("draw id1..128B and texture1..256B required"));
    }
    if vertices.len()<120||vertices.len()%40!=0||vertices.len()/40>crate::projected::MAX_PROJECTED_VERTICES {
        return Err(invalid("3..262144 packed40B vertices required"));
    }
    if indices.is_empty()||indices.len()%12!=0||indices.len()/4>crate::projected::MAX_PROJECTED_INDICES {
        return Err(invalid("nonempty bounded u32 triangle indices required"));
    }
    for vertex in vertices.chunks_exact(40) {
        for i in 0..10 {
            let n=component(vertex,i);
            if !n.is_finite()||n.abs()>1e9||(i==3&&n<=0.)||(i>=6&&!(0.0..=1.0).contains(&n)) {
                return Err(invalid("finite bounded clip/UV, positiveW and RGBA0..1 required"));
            }
        }
    }
    for triangle in indices.chunks_exact(12) {
        let mut rgba:Option<&[u8]>=None;
        for index in triangle.chunks_exact(4) {
            let i=u32::from_le_bytes(index.try_into().unwrap()) as usize;
            if i>=vertices.len()/40{return Err(invalid("index outside vertex range"));}
            let vertex=vertices.get(i*40..i*40+40).ok_or_else(||invalid("index outside vertex range"))?;
            if component(vertex,3).to_bits()!=1f32.to_bits()||!(0.0..=1.0).contains(&component(vertex,2)) {
                return Err(invalid("indexed W exactly1 and z0..1 required"));
            }
            if d.clip_policy==FrameClipPolicy::Inside&&(component(vertex,0).abs()>1.||component(vertex,1).abs()>1.) {
                return Err(invalid("inside policy needs XY within clip rectangle"));
            }
            if constant_color&&rgba.is_some_and(|first|first!=&vertex[24..40]) {return Err(invalid("constant indexed triangle RGBA bits required"));}
            rgba=Some(&vertex[24..40]);
        }
    }
    if let Some(s)=&d.scissor {s.validate()?;}
    d.material.validate()
}
