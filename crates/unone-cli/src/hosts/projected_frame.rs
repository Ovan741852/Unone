use anyhow::{Result,ensure};
use serde::{Serialize,Deserialize};
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum ProjectedMaterialProfile {Rgb8EncodedRebuildV1,Rgb8EncodedGouraudV1}
pub fn declared<'de,D:serde::Deserializer<'de>>(d:D)->Result<Option<ProjectedMaterialProfile>,D::Error> {
    ProjectedMaterialProfile::deserialize(d).map(Some)
}
pub fn validate(profile:Option<ProjectedMaterialProfile>,raster:Option<super::projected_raster::ProjectedRasterPolicy>,aa:Option<bool>,bloom:bool,official:bool)->Result<()> {
    if profile.is_none(){return Ok(());}
    ensure!(official,"PROJECTED_FRAME_OFFICIAL_WEBGL_ONLY: custom renderer cannot declare material profile");
    ensure!(raster==Some(super::projected_raster::ProjectedRasterPolicy::UpperLeftChecked)&&aa==Some(false)&&!bloom,
        "PROJECTED_FRAME_PROFILE_UNSUPPORTED: explicit upper_left_checked/antialias false/Bloom off required");Ok(())
}
pub fn native_gate(profile:Option<ProjectedMaterialProfile>)->Result<()> {
    ensure!(profile.is_none(),"HOST_PROJECTED_FRAME_UNSUPPORTED: encoded reference Frame is official WebGL2 only");Ok(())
}
pub fn capability(web:bool)->serde_json::Value {
    serde_json::json!({"omitted":"legacy_unchanged","explicit":if web{"official_webgl2_checked_only"}else{"unsupported"},
        "profile":"rgb8_encoded_rebuild_v1","profiles":["rgb8_encoded_rebuild_v1","rgb8_encoded_gouraud_v1"],"initial_destination":"caller_encoded_rgb8_depth_complete_rebuild_each_redraw",
        "precision":"rgba8_unorm/depth32float/reference_only","target_validation":"actual_attachments_FBO_textureSize_readback",
        "original_gpu_parity":false,"constructor_only":true})
}
#[cfg(test)]
mod tests {
    use super::*;use serde_json::json;
    #[test]
    fn declaration_is_closed_optional_and_requires_checked_official_single_sample() {
        let omitted=super::super::PresentationSettings::default();assert!(serde_json::to_value(&omitted).unwrap().get("projected_material_profile").is_none());
        for value in [json!(null),json!(true),json!(1),json!(""),json!("rgb8")] {
            assert!(serde_json::from_value::<super::super::PresentationSettings>(json!({"projected_material_profile":value})).is_err());
        }
        let good=json!({"projected_material_profile":"rgb8_encoded_rebuild_v1","projected_raster":"upper_left_checked","antialias":false});
        let settings:super::super::PresentationSettings=serde_json::from_value(good.clone()).unwrap();settings.validate_renderer().unwrap();
        assert!(native_gate(settings.projected_material_profile).unwrap_err().to_string().contains("HOST_PROJECTED_FRAME_UNSUPPORTED"));
        for (key,value) in [("antialias",json!(true)),("bloom",json!(true)),("projected_raster",json!("host")),("renderer_mode",json!("custom"))] {
            let mut bad=good.clone();bad[key]=value;let settings:super::super::PresentationSettings=serde_json::from_value(bad).unwrap();
            assert!(settings.validate_renderer().is_err());
        }
    }
}
