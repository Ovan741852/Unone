pub(crate) fn validate(bytes:Option<&[u8]>)->Result<(),String> {
    let Some(bytes)=bytes else{return Ok(());};
    let value:serde_json::Value=serde_json::from_slice(bytes).map_err(|e|format!("NATIVE_PRESENTATION_INVALID: {e}"))?;
    if value.get("physical_input").is_some(){return Err("HOST_PHYSICAL_INPUT_UNSUPPORTED: native live ordered physical input is not implemented".into());}
    if value.get("projected_material_profile").is_some() {
        return Err("HOST_PROJECTED_FRAME_UNSUPPORTED: native does not implement declared projected_material_profile".into());
    }
    if value.get("projected_raster").is_some() {
        return Err("HOST_PROJECTED_RASTER_UNSUPPORTED: native does not implement declared projected_raster; omit the field for native host raster".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::{Value,json};
    fn package(presentation:Value,corrupt:bool)->Result<crate::Package,String> {
        let bytes=serde_json::to_vec(&presentation).unwrap();
        let manifest=serde_json::to_vec(&json!({"files":[{"path":"content/presentation.json",
            "bytes":bytes.len(),"sha256":if corrupt {"bad".into()}else{crate::hash(&bytes)}}]})).unwrap();
        crate::Package::load(|path|match path {
            "export.json"=>Ok(manifest.clone()),"content/presentation.json"=>Ok(bytes.clone()),_=>Err("unexpected read".into())})
    }
    #[test]
    fn direct_native_package_admission_rejects_declared_raster_before_any_runtime_or_gpu() {
        assert!(package(json!({}),false).is_ok());
        for value in [json!("host"),json!("upper_left_checked"),json!(null),json!(1)] {
            let error=package(json!({"projected_raster":value}),false).err().expect("native must reject explicit field");
            assert!(error.contains("HOST_PROJECTED_RASTER_UNSUPPORTED"));
        }
    }
    #[test]
    fn content_hash_validation_precedes_raster_admission() {
        let error=package(json!({"projected_raster":"upper_left_checked"}),true).err().unwrap();
        assert!(error.contains("NATIVE_HASH_MISMATCH"));
    }
    #[test]
    fn direct_native_rejects_explicit_physical_input_without_opening_runtime_or_gpu(){
        for value in [json!("ordered_physical_v1"),json!(null),json!(false)]{
            assert!(package(json!({"physical_input":value}),false).err().unwrap().contains("HOST_PHYSICAL_INPUT_UNSUPPORTED"));
        }
    }
    #[test]
    fn material_profile_and_runtime_snapshot_reject_before_gpu() {
        for value in [json!("rgb8_encoded_rebuild_v1"),json!(null),json!(false)] {
            let e=package(json!({"projected_material_profile":value}),false).err().unwrap();assert!(e.contains("HOST_PROJECTED_FRAME_UNSUPPORTED"));
        }
        let r=unone_engine::EngineRuntime::load_source("frame","main.luau","return {start=function(api) api.projected.setFrame({profile='rgb8_encoded_rebuild_v1',initial={rgb8={20,40,60},depth=1},draws={}}) end,update=function()end}",None).unwrap();
        assert!(crate::ensure_shader_backend(&r.observe()).unwrap_err().contains("HOST_PROJECTED_FRAME_UNSUPPORTED"));
    }
}
