use anyhow::{Result,ensure};
use serde::{Deserialize,Serialize};

#[derive(Debug,Clone,Copy,PartialEq,Eq,Deserialize,Serialize)]
#[serde(rename_all="snake_case")]
pub enum ProjectedRasterPolicy { Host, UpperLeftChecked }

pub fn declared<'de,D:serde::Deserializer<'de>>(deserializer:D)->Result<Option<ProjectedRasterPolicy>,D::Error> {
    ProjectedRasterPolicy::deserialize(deserializer).map(Some)
}

pub fn validate(policy:Option<ProjectedRasterPolicy>,antialias:Option<bool>,bloom:bool,official:bool)->Result<()> {
    if policy.is_none(){return Ok(());}
    ensure!(official,"PROJECTED_RASTER_OFFICIAL_WEBGL_ONLY: omit projected_raster for a custom renderer");
    if policy==Some(ProjectedRasterPolicy::UpperLeftChecked) {
        ensure!(antialias==Some(false)&&!bloom,
            "PROJECTED_RASTER_PROFILE_UNSUPPORTED: upper_left_checked requires explicit antialias false and Bloom off; actual WebGL2/AA/target capability is checked by the player");
    }
    Ok(())
}

pub fn native_gate(policy:Option<ProjectedRasterPolicy>)->Result<()> {
    ensure!(policy.is_none(),"HOST_PROJECTED_RASTER_UNSUPPORTED: projected_raster is an official WebGL2 declaration; omit it for native host raster");
    Ok(())
}

pub fn capability(web:bool)->serde_json::Value {
    serde_json::json!({"omitted":"host","explicit":if web {"official_webgl2_only"}else{"unsupported"},
        "policies":if web {vec!["host","upper_left_checked"]}else{vec![]},
        "checked_profile":"opaque_cutout/worldhidden/AAfalse/BloomAOoff/isolated_depth",
        "runtime_validation_required":web,"preflight":"configuration_eligibility_only","constructor_only":true})
}
