use serde::Serialize;

use crate::diagnostics::EngineResult;

#[derive(Debug, Clone, Serialize)]
pub struct PlatformCapabilities {
    pub target_family: String,
    pub target_os: String,
    pub target_arch: String,
    pub project_loaders: Vec<String>,
    pub hot_reload_modes: Vec<String>,
    pub verified_runtime: Vec<String>,
    pub pending_host_work: Vec<String>,
}

pub fn capabilities() -> EngineResult<PlatformCapabilities> {
    let is_wasm = cfg!(target_arch = "wasm32");
    let mut project_loaders = vec!["memory_source".to_string()];
    let mut hot_reload_modes = vec!["reload_source".to_string()];
    let mut verified_runtime = vec![
        "luau_runtime".to_string(),
        "deterministic_fixed_step".to_string(),
        "semantic_observation".to_string(),
    ];
    let pending_host_work = if is_wasm {
        vec![
            "browser_fetch_and_storage_adapter".to_string(),
            "browser_webgpu_host".to_string(),
            "browser_input_adapter".to_string(),
        ]
    } else {
        project_loaders.push("native_filesystem_project".to_string());
        hot_reload_modes.push("filesystem_stamp".to_string());
        verified_runtime.push("native_wgpu_preview".to_string());
        vec![
            "ios_platform_wrapper".to_string(),
            "android_platform_wrapper".to_string(),
        ]
    };

    EngineResult::success(PlatformCapabilities {
        target_family: if is_wasm { "wasm" } else { "native" }.to_string(),
        target_os: std::env::consts::OS.to_string(),
        target_arch: std::env::consts::ARCH.to_string(),
        project_loaders,
        hot_reload_modes,
        verified_runtime,
        pending_host_work,
    })
}
