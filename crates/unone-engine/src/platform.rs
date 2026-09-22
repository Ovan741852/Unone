use serde::Serialize;

use crate::diagnostics::EngineResult;

#[derive(Debug, Clone, Serialize)]
pub struct PlatformCapabilities {
    pub compiled_systems: Vec<String>,
    pub target_family: String,
    pub target_os: String,
    pub target_arch: String,
    pub project_loaders: Vec<String>,
    pub hot_reload_modes: Vec<String>,
    pub verified_runtime: Vec<String>,
    pub pending_host_work: Vec<String>,
    /// Core discovery never establishes what a separately running renderer can decode.
    pub renderer_probe: &'static str,
    pub execution: crate::ExecutionMode,
}

pub fn capabilities() -> EngineResult<PlatformCapabilities> {
    let is_wasm = cfg!(target_arch = "wasm32");
    let mut project_loaders = vec!["memory_source".to_string()];
    let mut hot_reload_modes = vec!["reload_source".to_string()];
    let verified_runtime = vec![
        "luau_runtime".to_string(),
        "deterministic_fixed_step".to_string(),
        "semantic_observation".to_string(),
    ];
    let pending_host_work = if is_wasm {
        vec![
            "device_and_renderer_capability_probe".to_string(),
            "cross_device_render_validation".to_string(),
            "native_mobile_presentation_parity".to_string(),
        ]
    } else {
        project_loaders.push("native_filesystem_project".to_string());
        hot_reload_modes.push("filesystem_stamp".to_string());
        vec![
            "ios_platform_wrapper".to_string(),
            "android_3d_renderer_and_audio".to_string(),
        ]
    };

    EngineResult::success(PlatformCapabilities {
        compiled_systems: crate::systems::compiled_systems().to_vec(),
        target_family: if is_wasm { "wasm" } else { "native" }.to_string(),
        target_os: std::env::consts::OS.to_string(),
        target_arch: std::env::consts::ARCH.to_string(),
        project_loaders,
        hot_reload_modes,
        verified_runtime,
        pending_host_work,
        renderer_probe: "not_probed",
        execution: crate::execution_mode(),
    })
}
