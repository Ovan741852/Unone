use anyhow::{Result,ensure};
#[derive(Debug,Clone,Copy,serde::Serialize,serde::Deserialize)]
pub enum PhysicalInputProfile {#[serde(rename="ordered_physical_v1")]OrderedPhysicalV1}
pub fn declared<'de,D:serde::Deserializer<'de>>(d:D)->Result<Option<PhysicalInputProfile>,D::Error>{
    <PhysicalInputProfile as serde::Deserialize>::deserialize(d).map(Some)
}
pub fn validate(profile:Option<PhysicalInputProfile>,official:bool)->Result<()>{
    ensure!(profile.is_none()||official,"INPUT_PHYSICAL_OFFICIAL_ONLY: ordered physical ingress is an official Web host capability");Ok(())
}
pub fn native_gate(profile:Option<PhysicalInputProfile>)->Result<()>{
    ensure!(profile.is_none(),"HOST_PHYSICAL_INPUT_UNSUPPORTED: native live ordered physical input is not implemented; omit physical_input");Ok(())
}
pub fn capability(web:bool)->serde_json::Value{serde_json::json!({"omitted":"legacy_snapshot_input","ordered_physical_v1":if web{"official_web_main_worker"}else{"unsupported_live"},"core_normalized_replay":true,"text_ime":false,"presented_view_identity":false})}
