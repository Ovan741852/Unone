use std::path::Path;

use serde::Serialize;
use unone_engine::{
    inspect_systems, platform_capabilities, EngineResult, PlatformCapabilities, SystemReport,
    SystemStatus,
};

use crate::plugins;

pub const CAPABILITY_SNAPSHOT_SCHEMA_VERSION: u32 = 1;

/// A conservative, AI-facing vocabulary for capability readiness.
///
/// The source_state field keeps the more specific existing vocabulary
/// (compiled, host_required, not_probed, and so on) instead of pretending all
/// evidence has the same strength.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Verified,
    Partial,
    Pending,
}

#[derive(Debug, Clone, Serialize)]
pub struct CapabilityRecord {
    pub id: String,
    pub category: String,
    pub status: CapabilityStatus,
    pub source_state: String,
    /// What the evidence is scoped to: this target, this project, or a host
    /// that still needs a separate probe.
    pub verification_scope: String,
    /// The existing command or manifest reader that produced the evidence.
    pub checked_by: String,
    pub summary: String,
    pub limitations: Vec<String>,
    pub evidence: Vec<String>,
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlatformRecord {
    pub family: String,
    pub os: String,
    pub arch: String,
    pub status: CapabilityStatus,
    pub source_state: String,
    pub verification_scope: String,
    pub checked_by: String,
    pub limitations: Vec<String>,
    pub other_target_gaps: Vec<String>,
    pub evidence: Vec<String>,
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginCapabilityRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub root: String,
    pub manifest_path: String,
    pub status: CapabilityStatus,
    pub source_state: String,
    pub verification_scope: String,
    pub checked_by: String,
    pub capabilities: Vec<String>,
    pub permissions: Vec<String>,
    pub tools: Vec<String>,
    pub limitations: Vec<String>,
    pub evidence: Vec<String>,
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CapabilitySnapshotReport {
    pub schema_version: u32,
    pub project_root: String,
    pub platform: PlatformRecord,
    /// The unmodified Core report remains available for clients that already
    /// consume `platform capabilities` fields.
    pub core: PlatformCapabilities,
    pub capabilities: Vec<CapabilityRecord>,
    pub project_systems: Option<SystemReport>,
    pub renderers: Vec<CapabilityRecord>,
    pub plugins: Vec<PluginCapabilityRecord>,
    pub plugin_search_roots: Vec<String>,
}

pub fn snapshot(project_root: &Path) -> EngineResult<CapabilitySnapshotReport> {
    let platform_result = platform_capabilities();
    let Some(platform) = platform_result.value.clone() else {
        return EngineResult {
            ok: false,
            value: None,
            diagnostics: platform_result.diagnostics,
            effects: platform_result.effects,
        };
    };

    let plugin_result = plugins::list(project_root);
    let plugin_list = plugin_result.value;
    let mut result = EngineResult::success(CapabilitySnapshotReport {
        schema_version: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
        project_root: project_root.display().to_string(),
        platform: platform_record(&platform),
        core: platform.clone(),
        capabilities: {
            let mut records = runtime_records(&platform);
            records.extend(diagnostic_records());
            records
        },
        project_systems: None,
        renderers: renderer_records(),
        plugins: Vec::new(),
        plugin_search_roots: plugin_list
            .as_ref()
            .map(|report| report.searched_roots.clone())
            .unwrap_or_default(),
    });
    result.diagnostics.extend(platform_result.diagnostics);
    result.effects.extend(platform_result.effects);
    result.diagnostics.extend(plugin_result.diagnostics);
    // `plugins::list` currently returns discovery warnings as a successful
    // result, but keep both signals so a future fatal discovery path cannot
    // silently turn into an empty inventory.
    if !plugin_result.ok || plugin_list.is_none() {
        result.ok = false;
    }

    let systems_result = inspect_systems(project_root);
    result.diagnostics.extend(systems_result.diagnostics);
    let systems_ok = systems_result.ok;
    if let Some(systems) = systems_result.value {
        let report = result
            .value
            .as_mut()
            .expect("snapshot report is initialized");
        report.capabilities.extend(system_records(&systems));
        report.project_systems = Some(systems);
    } else {
        if !systems_ok {
            result.ok = false;
        }
        result
            .value
            .as_mut()
            .expect("snapshot report is initialized")
            .capabilities
            .extend(compiled_system_records(&platform));
    }

    let Some(plugin_list) = plugin_list else {
        return result;
    };
    for summary in plugin_list.plugins {
        let inspected = plugins::inspect(project_root, &summary.id);
        result.diagnostics.extend(inspected.diagnostics);
        let Some(detail) = inspected.value else {
            result.ok = false;
            continue;
        };
        let manifest = detail.manifest;
        let manifest_path = detail.manifest_path.clone();
        let has_self_test = manifest.tools.iter().any(|tool| tool.name == "plugin.test");
        result
            .value
            .as_mut()
            .expect("snapshot report is initialized")
            .plugins
            .push(PluginCapabilityRecord {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                root: detail.root,
                manifest_path,
                status: if has_self_test {
                    CapabilityStatus::Partial
                } else {
                    CapabilityStatus::Pending
                },
                source_state: if has_self_test {
                    "manifest_discovered_self_test_not_run".to_string()
                } else {
                    "manifest_discovered_without_self_test".to_string()
                },
                verification_scope: "project_plugin_manifest".to_string(),
                checked_by: "plugin_inspect".to_string(),
                capabilities: manifest.capabilities,
                permissions: manifest.permissions,
                tools: manifest.tools.iter().map(|tool| tool.name.clone()).collect(),
                limitations: vec![
                    "Manifest discovery does not start the plugin or prove its external dependencies are available.".to_string(),
                    if has_self_test {
                        "Run the declared plugin.test before relying on a plugin capability.".to_string()
                    } else {
                        "The plugin does not declare plugin.test; its runtime readiness is pending.".to_string()
                    },
                ],
                evidence: vec![format!("manifest:{}", detail.manifest_path)],
                examples: {
                    let mut examples = vec![format!(
                        "game --project <game-root> --json plugin inspect --id {}",
                        summary.id
                    )];
                    if has_self_test {
                        examples.push(format!(
                            "game --project <game-root> --json plugin test --id {}",
                            summary.id
                        ));
                    }
                    examples
                },
            });
    }

    if let Some(report) = result.value.as_mut() {
        report.plugins.sort_by(|left, right| left.id.cmp(&right.id));
    }
    result
}

fn platform_record(platform: &PlatformCapabilities) -> PlatformRecord {
    let (current_target_gaps, other_target_gaps): (Vec<_>, Vec<_>) = platform
        .pending_host_work
        .iter()
        .cloned()
        .partition(|gap| is_current_target_gap(gap, platform));
    let partial = !current_target_gaps.is_empty();
    PlatformRecord {
        family: platform.target_family.clone(),
        os: platform.target_os.clone(),
        arch: platform.target_arch.clone(),
        status: if partial {
            CapabilityStatus::Partial
        } else {
            CapabilityStatus::Verified
        },
        source_state: if partial {
            "verified_core_with_current_target_host_work".to_string()
        } else if !other_target_gaps.is_empty() {
            "verified_core_with_other_target_host_work".to_string()
        } else {
            "verified_core".to_string()
        },
        verification_scope: "current_target_core".to_string(),
        checked_by: "platform_capabilities".to_string(),
        limitations: current_target_gaps,
        other_target_gaps,
        evidence: vec!["unone_platform_capabilities".to_string()],
        examples: vec![
            "game --project <game-root> --json platform capabilities".to_string(),
            "game --project <game-root> --json verify".to_string(),
        ],
    }
}

fn is_current_target_gap(gap: &str, platform: &PlatformCapabilities) -> bool {
    (platform.target_os == "ios" && gap.starts_with("ios_"))
        || (platform.target_os == "android" && gap.starts_with("android_"))
        || (platform.target_family == "wasm" && gap.contains("device"))
}

fn runtime_records(platform: &PlatformCapabilities) -> Vec<CapabilityRecord> {
    let mut records = Vec::new();
    for id in &platform.verified_runtime {
        records.push(CapabilityRecord {
            id: id.clone(),
            category: "runtime".to_string(),
            status: CapabilityStatus::Verified,
            source_state: "verified_runtime".to_string(),
            verification_scope: "current_target_core".to_string(),
            checked_by: "platform_capabilities".to_string(),
            summary: format!("Core reports {id} as verified for this target."),
            limitations: vec![
                "Runtime verification does not prove a separate renderer or device host."
                    .to_string(),
            ],
            evidence: vec!["unone_platform_capabilities.verified_runtime".to_string()],
            examples: runtime_examples(id),
        });
    }
    for id in &platform.pending_host_work {
        records.push(CapabilityRecord {
            id: id.clone(),
            category: "host".to_string(),
            status: CapabilityStatus::Pending,
            source_state: "pending_host_work".to_string(),
            verification_scope: if is_current_target_gap(id, platform) {
                "current_target_host".to_string()
            } else {
                "other_target_host".to_string()
            },
            checked_by: "platform_capabilities".to_string(),
            summary: format!("Host work {id} is not verified by this Core build."),
            limitations: vec![
                "No Core-only example can prove this host capability; use a target host probe."
                    .to_string(),
            ],
            evidence: vec!["unone_platform_capabilities.pending_host_work".to_string()],
            examples: vec!["game --project <game-root> --json platform capabilities".to_string()],
        });
    }
    records
}

fn runtime_examples(id: &str) -> Vec<String> {
    match id {
        "luau_runtime" => vec![
            "game --project <game-root> --json run --frames 60".to_string(),
            "game --project <game-root> --json verify".to_string(),
        ],
        "native_preview" => vec!["game --project <game-root> preview --watch".to_string()],
        "web_runner" => vec!["Open web/runner/ with a selected project payload.".to_string()],
        _ => vec!["game --project <game-root> --json platform capabilities".to_string()],
    }
}

fn diagnostic_records() -> Vec<CapabilityRecord> {
    [
        ("diagnostics.scenario_replay", "Versioned isolated headless start replay with independent regression verdicts", "game --project <game-root> --json replay fingerprint", "Checkpoint, capture/trace store, schema migrations and renderer replay are not implemented."),
        ("diagnostics.luau_memory", "Bounded Lua retained heap history and explicit full-GC wall time", "Developer API: memory.sample {label, collect:false, warmup:false}; memory.report", "Only main Luau VM. No retaining paths, JS GC, Rust allocator or GPU bytes; growth is not proof of a leak. Web hosts require rebuilding their development runtime."),
        ("diagnostics.luau_profiler", "Luau sampling, allocation growth and incremental GC plus Core phase timing", "Developer API: profile.start {sampling:true}; profile; profile.stop", "Wall-clock samples are not exact CPU time or allocation callsites. Host/GPU measurements require separate host evidence."),
    ].into_iter().map(|(id, summary, example, limitation)| CapabilityRecord {
        id:id.into(),category:"sdk_diagnostics".into(),status:CapabilityStatus::Partial,
        source_state:"implemented_scope_limited".into(),verification_scope:"compiled_sdk_not_live_project_probe".into(),checked_by:"CLI diagnostic inventory".into(),
        summary:summary.into(),limitations:vec![limitation.into()],evidence:vec!["docs/diagnostics-replay.md".into()],examples:vec![example.into()],
    }).collect()
}

fn compiled_system_records(platform: &PlatformCapabilities) -> Vec<CapabilityRecord> {
    platform
        .compiled_systems
        .iter()
        .map(|id| CapabilityRecord {
            id: id.clone(),
            category: "engine_system".to_string(),
            status: CapabilityStatus::Partial,
            source_state: "compiled_system_without_project".to_string(),
            verification_scope: "current_binary_without_project".to_string(),
            checked_by: "platform_capabilities".to_string(),
            summary: format!("System {id} is compiled into this binary."),
            limitations: vec![
                "Compile presence does not prove project enablement, host presentation, or optional dependency readiness.".to_string(),
            ],
            evidence: vec!["unone_platform_capabilities.compiled_systems".to_string()],
            examples: vec![
                "game --project <game-root> --json systems list".to_string(),
                "game --project <game-root> --json systems search <meaning>".to_string(),
            ],
        })
        .collect()
}

fn system_records(report: &SystemReport) -> Vec<CapabilityRecord> {
    report
        .systems
        .iter()
        .map(|system| {
            let (mut status, mut source_state, mut limitations) = match system.descriptor.status {
                SystemStatus::Available if system.descriptor.compiled => (
                    CapabilityStatus::Verified,
                    "system_available_compiled".to_string(),
                    Vec::new(),
                ),
                SystemStatus::Available => (
                    CapabilityStatus::Pending,
                    "system_available_not_compiled".to_string(),
                    vec!["Rebuild the selected player with this system's feature.".to_string()],
                ),
                SystemStatus::HostRequired => (
                    CapabilityStatus::Partial,
                    "system_host_required".to_string(),
                    vec!["The Core contract exists, but the selected host must provide the presentation/runtime adapter.".to_string()],
                ),
                SystemStatus::NotImplemented => (
                    CapabilityStatus::Pending,
                    "system_not_implemented".to_string(),
                    vec!["The system contract exists but no engine or host implementation is available.".to_string()],
                ),
            };
            if !system.enabled {
                if status == CapabilityStatus::Verified {
                    status = CapabilityStatus::Partial;
                    source_state = "system_available_disabled_in_project".to_string();
                }
                limitations.push(
                    "This project currently disables the system; enable it explicitly before using its API.".to_string(),
                );
            }
            limitations.push(
                "System readiness does not prove this project currently emits matching content or observations.".to_string(),
            );
            CapabilityRecord {
                id: system.descriptor.id.clone(),
                category: "engine_system".to_string(),
                status,
                source_state,
                verification_scope: if system.enabled {
                    "current_project".to_string()
                } else {
                    "current_project_disabled".to_string()
                },
                checked_by: "systems_list".to_string(),
                summary: format!(
                    "{} (project enabled: {}, source: {}).",
                    system.descriptor.summary, system.enabled, system.source
                ),
                limitations,
                evidence: vec!["unone_systems_list".to_string()],
                examples: vec![
                    "game --project <game-root> --json systems list".to_string(),
                    "game --project <game-root> --json systems search <meaning>".to_string(),
                ],
            }
        })
        .collect()
}

fn renderer_records() -> Vec<CapabilityRecord> {
    vec![
        renderer(
            "renderer.native.wgpu",
            "Native preview uses the wgpu presentation path when a window and GPU adapter initialize.",
            vec![
                "This snapshot does not open a native window or probe the GPU adapter.".to_string(),
                "Asset decoding and presentation remain host responsibilities.".to_string(),
            ],
            vec!["game --project <game-root> preview --watch".to_string()],
        ),
        renderer(
            "renderer.web.three",
            "The Web runner's Three.js adapter selects WebGPU when available and falls back to WebGL.",
            vec![
                "The browser/device was not probed by this Core snapshot.".to_string(),
                "WebGPU availability does not guarantee device initialization or asset parity.".to_string(),
            ],
            vec![
                "From a server root containing both Unone and the project, run `python -m http.server 8000`, then open `http://127.0.0.1:8000/Unone/web/runner/?project=/<project-relative-path>/`.".to_string(),
            ],
        ),
        renderer(
            "renderer.webgpu_raw",
            "The Web host includes a diagnostic raw WebGPU renderer adapter.",
            vec![
                "It requires a browser WebGPU adapter and is not a cross-platform release guarantee.".to_string(),
            ],
            vec![
                "From a server root containing both Unone and the project, run `python -m http.server 8000`, then open `http://127.0.0.1:8000/Unone/web/runner/?project=/<project-relative-path>/&renderer=webgpu-raw`.".to_string(),
            ],
        ),
        renderer(
            "renderer.web.presentation",
            "The Web presentation sample can exercise Spine/Effekseer WebGL hooks when their host runtimes are available.",
            vec![
                "Native preview and Android do not currently provide equivalent presentation evidence.".to_string(),
                "Spine licensing and host runtime availability remain external requirements.".to_string(),
            ],
            vec![
                "From the Unone repository root run `scripts/build-web-live.ps1`, serve a root containing Unone and a presentation-compatible project with `python -m http.server 8001`, then use the project URL documented in `web/presentation/README.md`.".to_string(),
            ],
        ),
    ]
}

fn renderer(
    id: &str,
    summary: &str,
    limitations: Vec<String>,
    examples: Vec<String>,
) -> CapabilityRecord {
    let source = match id {
        "renderer.native.wgpu" => "crates/unone-native-player/src/lib.rs",
        "renderer.web.three" => "web/renderer/index.js;web/renderer/three.js",
        "renderer.webgpu_raw" => "web/renderer/index.js;web/shared/webgpu-snapshot.js",
        "renderer.web.presentation" => {
            "web/presentation/main.js;web/renderer/effekseer.js;web/vendor/spine"
        }
        _ => "renderer host source",
    };
    CapabilityRecord {
        id: id.to_string(),
        category: "renderer".to_string(),
        status: CapabilityStatus::Partial,
        source_state: "host_declared_not_probed".to_string(),
        verification_scope: "host_not_probed".to_string(),
        checked_by: "renderer_declaration".to_string(),
        summary: summary.to_string(),
        limitations,
        evidence: vec![
            "unone_platform_capabilities.renderer_probe=not_probed".to_string(),
            format!("source:{source}"),
        ],
        examples,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        platform_record, renderer_records, runtime_records, snapshot, system_records,
        CapabilityStatus,
    };
    use std::fs;
    use tempfile::tempdir;
    use unone_engine::{
        PlatformCapabilities, SystemDescriptor, SystemReport, SystemState, SystemStatus,
    };

    #[test]
    fn compile_and_probe_evidence_never_becomes_verified_renderer_state() {
        let renderers = renderer_records();
        assert!(!renderers.is_empty());
        assert!(renderers
            .iter()
            .all(|renderer| renderer.status == CapabilityStatus::Partial));
        assert!(renderers
            .iter()
            .all(|renderer| renderer.source_state == "host_declared_not_probed"));
    }

    #[test]
    fn runtime_records_keep_verified_and_pending_states_separate() {
        let platform = PlatformCapabilities {
            compiled_systems: vec!["physics2d".to_string()],
            target_family: "native".to_string(),
            target_os: "windows".to_string(),
            target_arch: "x86_64".to_string(),
            project_loaders: vec!["native_filesystem_project".to_string()],
            hot_reload_modes: vec!["filesystem_stamp".to_string()],
            verified_runtime: vec!["luau_runtime".to_string()],
            pending_host_work: vec!["ios_platform_wrapper".to_string()],
            renderer_probe: "not_probed",
        };
        let records = runtime_records(&platform);
        assert_eq!(
            records
                .iter()
                .find(|record| record.id == "luau_runtime")
                .unwrap()
                .status,
            CapabilityStatus::Verified
        );
        assert_eq!(
            records
                .iter()
                .find(|record| record.id == "ios_platform_wrapper")
                .unwrap()
                .status,
            CapabilityStatus::Pending
        );
    }

    #[test]
    fn disabled_project_system_is_not_reported_as_currently_verified() {
        let report = SystemReport {
            project: "test".to_string(),
            systems: vec![SystemState {
                descriptor: SystemDescriptor {
                    id: "physics3d".to_string(),
                    summary: "3D physics".to_string(),
                    status: SystemStatus::Available,
                    default_enabled: false,
                    optional: true,
                    build_feature: Some("physics3d".to_string()),
                    compiled: true,
                    luau_api: Vec::new(),
                    observation: Vec::new(),
                    when_disabled: "disabled".to_string(),
                    disable_when: "optional".to_string(),
                },
                enabled: false,
                source: "project".to_string(),
            }],
        };
        let record = &system_records(&report)[0];
        assert_eq!(record.status, CapabilityStatus::Partial);
        assert_eq!(record.source_state, "system_available_disabled_in_project");
    }

    #[test]
    fn platform_record_separates_current_and_other_target_host_work() {
        let platform = PlatformCapabilities {
            compiled_systems: Vec::new(),
            target_family: "native".to_string(),
            target_os: "ios".to_string(),
            target_arch: "x86_64".to_string(),
            project_loaders: Vec::new(),
            hot_reload_modes: Vec::new(),
            verified_runtime: Vec::new(),
            pending_host_work: vec![
                "ios_platform_wrapper".to_string(),
                "android_3d_renderer_and_audio".to_string(),
            ],
            renderer_probe: "not_probed",
        };
        let record = platform_record(&platform);
        assert_eq!(record.status, CapabilityStatus::Partial);
        assert_eq!(record.limitations, vec!["ios_platform_wrapper"]);
        assert_eq!(
            record.other_target_gaps,
            vec!["android_3d_renderer_and_audio"]
        );
    }

    #[test]
    fn snapshot_fails_closed_when_project_systems_cannot_be_inspected() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("project.unone.json"),
            r#"{"name":"Broken","entry_script":"main.luau","systems":{"not_a_system":true}}"#,
        )
        .unwrap();
        fs::write(dir.path().join("main.luau"), "return {}\n").unwrap();

        let result = snapshot(dir.path());
        assert!(
            !result.ok,
            "a failed systems inspection must be visible to AI"
        );
        assert!(result.value.as_ref().unwrap().project_systems.is_none());
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "SYSTEM_UNKNOWN"));
    }
}
