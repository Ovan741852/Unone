//! Export-host identities. Game Luau and declared assets stay project-owned;
//! each host only says which presentation it can draw and how it is packaged.
use anyhow::{Result, bail, ensure};
use serde_json::{Value, json};
use std::path::Path;

#[derive(Clone, Copy, Debug)]
pub struct Host {
    pub id: &'static str,
    /// `supported`, `not_implemented`, or `wraps_web`.
    pub status: &'static str,
    /// `web-wasm`, `native-wgpu`, or `webview-wraps-web`.
    pub family: &'static str,
    pub packager: &'static str,
    pub exportable: bool,
    pub renderer: Option<&'static str>,
    pub presentation: &'static [&'static str],
    pub decoders: &'static [&'static str],
    /// Systems that `export platform` rejects for this host.
    pub export_blocked_systems: &'static [&'static str],
    /// Systems the player fails if the snapshot actually publishes them.
    pub runtime_blocked_systems: &'static [&'static str],
    pub presentation_overlay_keys: &'static [&'static str],
    pub toolchain: &'static str,
    pub requires: &'static [&'static str],
    pub device_evidence: &'static str,
    pub note: &'static str,
}

const NATIVE_PRESENTATION: &[&str] = &["mesh3d", "instances3d", "particle", "ui"];
const NATIVE_DECODERS: &[&str] = &["unone-mesh-json", "png-rgb-rgba"];
const NATIVE_EXPORT_BLOCKED: &[&str] = &["spine", "effekseer"];
const NATIVE_RUNTIME_BLOCKED: &[&str] = &["audio", "spine", "effekseer"];
const WEB_PRESENTATION_KEYS: &[&str] = &[
    "ui",
    "bloom",
    "show_performance",
    "runtime_backend",
    "job_policy",
    "interpolation",
    "interpolate_instances",
];
const ANDROID_NATIVE_REQUIRES: &[&str] = &["Android SDK", "JDK", "local test signing"];

const CATALOG: &[Host] = &[
    Host {
        id: "web",
        status: "supported",
        family: "web-wasm",
        packager: "web-directory",
        exportable: true,
        renderer: Some("three-webgl"),
        presentation: &[
            "mesh3d",
            "instances3d",
            "sprite",
            "ui",
            "audio",
            "particle",
            "spine",
            "effekseer",
            "bloom",
        ],
        decoders: &[
            "unone-mesh-json",
            "png-rgb-rgba",
            "image",
            "audio",
            "skfe-1500",
        ],
        export_blocked_systems: &[],
        runtime_blocked_systems: &[],
        presentation_overlay_keys: WEB_PRESENTATION_KEYS,
        toolchain: "none",
        requires: &[],
        device_evidence: "browser-export",
        note: "WASM plus JS player. player.presentation.json is this host's overlay.",
    },
    Host {
        id: "windows",
        status: "supported",
        family: "native-wgpu",
        packager: "native-directory",
        exportable: true,
        renderer: Some("wgpu-native-instanced"),
        presentation: NATIVE_PRESENTATION,
        decoders: NATIVE_DECODERS,
        export_blocked_systems: NATIVE_EXPORT_BLOCKED,
        runtime_blocked_systems: NATIVE_RUNTIME_BLOCKED,
        presentation_overlay_keys: WEB_PRESENTATION_KEYS,
        toolchain: "none",
        requires: &[],
        device_evidence: "windows-vulkan",
        note: "Same Luau/assets as web. Current native host supports UI; inspect the selected runtime descriptor for UI/SVG availability. Export rejects spine/effekseer; audio fails if published at runtime.",
    },
    Host {
        id: "android-x86_64",
        status: "supported",
        family: "native-wgpu",
        packager: "native-activity-apk",
        exportable: true,
        renderer: Some("wgpu-native-instanced"),
        presentation: NATIVE_PRESENTATION,
        decoders: NATIVE_DECODERS,
        export_blocked_systems: NATIVE_EXPORT_BLOCKED,
        runtime_blocked_systems: NATIVE_RUNTIME_BLOCKED,
        presentation_overlay_keys: WEB_PRESENTATION_KEYS,
        toolchain: "Android SDK, JDK",
        requires: ANDROID_NATIVE_REQUIRES,
        device_evidence: "bluestacks-x86_64",
        note: "wgpu NativeActivity. Not the WebView APK. Native UI code exists, but Android UI device validation has not been performed. Inspect the selected runtime descriptor; arm64 evidence is separate.",
    },
    Host {
        id: "android-arm64",
        status: "supported",
        family: "native-wgpu",
        packager: "native-activity-apk",
        exportable: true,
        renderer: Some("wgpu-native-instanced"),
        presentation: NATIVE_PRESENTATION,
        decoders: NATIVE_DECODERS,
        export_blocked_systems: NATIVE_EXPORT_BLOCKED,
        runtime_blocked_systems: NATIVE_RUNTIME_BLOCKED,
        presentation_overlay_keys: WEB_PRESENTATION_KEYS,
        toolchain: "Android SDK, JDK",
        requires: ANDROID_NATIVE_REQUIRES,
        device_evidence: "none",
        note: "Packager exists. No physical arm64 or Android UI device evidence. Inspect the selected runtime descriptor for UI/SVG availability.",
    },
    Host {
        id: "android-webview",
        status: "wraps_web",
        family: "webview-wraps-web",
        packager: "scripts/build-android-player.ps1",
        exportable: false,
        renderer: Some("system-webview"),
        presentation: &[
            "mesh3d",
            "instances3d",
            "sprite",
            "ui",
            "audio",
            "particle",
            "spine",
            "effekseer",
            "bloom",
        ],
        decoders: &[
            "unone-mesh-json",
            "png-rgb-rgba",
            "image",
            "audio",
            "skfe-1500",
        ],
        export_blocked_systems: &[],
        runtime_blocked_systems: &[],
        presentation_overlay_keys: WEB_PRESENTATION_KEYS,
        toolchain: "Android SDK, JDK",
        requires: &["Android SDK", "JDK", "web export directory"],
        device_evidence: "android-14-webview-137",
        note: "Embeds a web export in System WebView. Not wgpu native. Export --target web first.",
    },
    Host {
        id: "ios",
        status: "not_implemented",
        family: "native-wgpu",
        packager: "none",
        exportable: false,
        renderer: None,
        presentation: &[],
        decoders: &[],
        export_blocked_systems: NATIVE_EXPORT_BLOCKED,
        runtime_blocked_systems: NATIVE_RUNTIME_BLOCKED,
        presentation_overlay_keys: WEB_PRESENTATION_KEYS,
        toolchain: "Xcode/macOS",
        requires: &["iOS runtime", "Xcode/macOS", "signing"],
        device_evidence: "none",
        note: "ABI exists. No host, packager, or device evidence.",
    },
];

#[derive(serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct JobPolicy {
    pub mode: JobMode,
    pub max_workers: u8,
    pub memory_budget_mb: u16,
}
impl Default for JobPolicy {
    fn default() -> Self {
        Self {
            mode: JobMode::Auto,
            max_workers: 2,
            memory_budget_mb: 128,
        }
    }
}
#[derive(serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobMode {
    Auto,
    Inline,
    Workers,
}
#[derive(Default, serde::Deserialize, serde::Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct PresentationSettings {
    pub ui: PresentationUi,
    pub bloom: bool,
    pub show_performance: bool,
    pub runtime_backend: RuntimeBackend,
    pub job_policy: JobPolicy,
    pub interpolation: bool,
    pub interpolate_instances: Vec<String>,
}
#[derive(Default, serde::Deserialize, serde::Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct PresentationUi {
    pub font_source: Option<String>,
    pub font_family: Option<String>,
}
#[derive(Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeBackend {
    #[default]
    Main,
    Worker,
}

pub fn catalog() -> &'static [Host] {
    CATALOG
}

pub fn lookup(id: &str) -> Option<&'static Host> {
    catalog().iter().find(|host| host.id == id)
}

pub fn require_exportable(id: &str) -> Result<&'static Host> {
    match lookup(id) {
        Some(host) if host.exportable => Ok(host),
        Some(host) if host.family == "webview-wraps-web" => bail!(
            "SDK_TARGET_UNSUPPORTED: {id} wraps a web export in System WebView, it is not wgpu native. Export --target web, then {}. Native Android is android-arm64 or android-x86_64.",
            host.packager
        ),
        Some(host) => bail!(
            "SDK_TARGET_UNSUPPORTED: {}; {}",
            host.id,
            host.note
        ),
        None => bail!(
            "SDK_TARGET_UNSUPPORTED: {id}; run game sdk inspect --json to list implemented packagers"
        ),
    }
}

pub fn inspect_targets() -> Vec<Value> {
    catalog()
        .iter()
        .map(|host| {
            json!({
                "id": host.id,
                "status": host.status,
                "family": host.family,
                "packager": host.packager,
                "exportable": host.exportable,
                "renderer": host.renderer,
                "presentation": host.presentation,
                "decoders": host.decoders,
                "export_blocked_systems": host.export_blocked_systems,
                "runtime_blocked_systems": host.runtime_blocked_systems,
                "presentation_overlay_keys": host.presentation_overlay_keys,
                "toolchain": host.toolchain,
                "requires": host.requires,
                "device_evidence": host.device_evidence,
                "note": host.note,
            })
        })
        .collect()
}

pub fn load_presentation(project: &Path) -> Result<Option<PresentationSettings>> {
    let path = project.join("player.presentation.json");
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_slice(&std::fs::read(&path)?)?))
}

/// Native wgpu shares Luau/assets and UI fonts, but rejects Web-only overlay options.
pub fn native_wgpu_export_gate(
    settings: &unone_engine::SystemSettings,
    presentation: Option<&PresentationSettings>,
) -> Result<()> {
    let host = lookup("windows").expect("native-wgpu catalog");
    for id in host.export_blocked_systems {
        ensure!(
            !settings.is_enabled(id),
            "HOST_PRESENTATION_UNSUPPORTED: native wgpu does not render {id}; disable systems.{id} or export --target web. For a WebView APK, export web then run scripts/build-android-player.ps1."
        );
    }
    let Some(presentation) = presentation else {
        return Ok(());
    };
    let mut keys = Vec::new();
    if presentation.bloom {
        keys.push("bloom");
    }
    if presentation.show_performance {
        keys.push("show_performance");
    }
    if presentation.runtime_backend == RuntimeBackend::Worker {
        keys.push("runtime_backend");
    }
    if presentation.interpolation {
        keys.push("interpolation");
    }
    if !presentation.interpolate_instances.is_empty() {
        keys.push("interpolate_instances");
    }
    if presentation.job_policy != JobPolicy::default() {
        keys.push("job_policy");
    }
    ensure!(
        keys.is_empty(),
        "HOST_PRESENTATION_UNSUPPORTED: player.presentation.json fields {} are web-only; native wgpu does not honor that overlay. Export --target web or remove those keys.",
        keys.join(", ")
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique_and_inspect_shape_is_uniform() {
        let mut ids = std::collections::BTreeSet::new();
        let rows = inspect_targets();
        assert_eq!(rows.len(), catalog().len());
        for (host, row) in catalog().iter().zip(&rows) {
            assert!(ids.insert(host.id), "{}", host.id);
            assert_eq!(row["id"], host.id);
            for key in [
                "status",
                "family",
                "packager",
                "exportable",
                "renderer",
                "presentation",
                "decoders",
                "export_blocked_systems",
                "runtime_blocked_systems",
                "presentation_overlay_keys",
                "toolchain",
                "requires",
                "device_evidence",
                "note",
            ] {
                assert!(row.get(key).is_some(), "{id} missing {key}", id = host.id);
            }
        }
        assert!(lookup("web").unwrap().exportable);
        assert!(!lookup("android-webview").unwrap().exportable);
        assert!(!lookup("ios").unwrap().exportable);
        assert_eq!(lookup("android-webview").unwrap().family, "webview-wraps-web");
        assert_eq!(lookup("android-x86_64").unwrap().family, "native-wgpu");
        assert_ne!(
            lookup("android-webview").unwrap().renderer,
            lookup("android-x86_64").unwrap().renderer
        );
        let windows = rows.iter().find(|row| row["id"] == "windows").unwrap();
        assert_eq!(windows["toolchain"], "none");
        assert_eq!(windows["export_blocked_systems"], json!(["spine", "effekseer"]));
        assert_eq!(
            windows["runtime_blocked_systems"],
            json!(["audio", "spine", "effekseer"])
        );
        assert!(windows["presentation"].as_array().unwrap().iter().any(|item| item == "ui"));
        let webview = rows
            .iter()
            .find(|row| row["id"] == "android-webview")
            .unwrap();
        assert_eq!(webview["exportable"], false);
        assert_eq!(webview["family"], "webview-wraps-web");
    }

    #[test]
    fn exportable_lookup_keeps_webview_and_ios_out_of_platform_packagers() {
        assert_eq!(require_exportable("web").unwrap().id, "web");
        assert_eq!(require_exportable("windows").unwrap().family, "native-wgpu");
        let webview = require_exportable("android-webview").unwrap_err().to_string();
        assert!(webview.contains("SDK_TARGET_UNSUPPORTED"));
        assert!(webview.contains("WebView"));
        assert!(require_exportable("ios")
            .unwrap_err()
            .to_string()
            .contains("SDK_TARGET_UNSUPPORTED"));
        assert!(require_exportable("android")
            .unwrap_err()
            .to_string()
            .contains("SDK_TARGET_UNSUPPORTED"));
    }

    #[test]
    fn native_gate_rejects_web_only_overlay_and_skeletal_systems() {
        let quiet = unone_engine::SystemSettings::resolve(&std::collections::BTreeMap::from([
            ("spine".into(), false),
            ("effekseer".into(), false),
        ]))
        .unwrap();
        native_wgpu_export_gate(&quiet, None).unwrap();
        native_wgpu_export_gate(&quiet, Some(&PresentationSettings::default())).unwrap();
        let shared_ui: PresentationSettings = serde_json::from_value(json!({
            "ui": {"font_source": "fonts/ui.ttf", "font_family": "Fixture"}
        })).unwrap();
        native_wgpu_export_gate(&quiet, Some(&shared_ui)).unwrap();
        let worker = PresentationSettings {
            runtime_backend: RuntimeBackend::Worker,
            ..PresentationSettings::default()
        };
        assert!(
            native_wgpu_export_gate(&quiet, Some(&worker))
                .unwrap_err()
                .to_string()
                .contains("runtime_backend")
        );
        let workers = PresentationSettings {
            job_policy: JobPolicy {
                mode: JobMode::Workers,
                ..JobPolicy::default()
            },
            ..PresentationSettings::default()
        };
        assert!(
            native_wgpu_export_gate(&quiet, Some(&workers))
                .unwrap_err()
                .to_string()
                .contains("job_policy")
        );
        native_wgpu_export_gate(
            &quiet,
            Some(&PresentationSettings {
                job_policy: JobPolicy::default(),
                ..PresentationSettings::default()
            }),
        )
        .unwrap();
        let spine = unone_engine::SystemSettings::resolve(&std::collections::BTreeMap::from([
            ("spine".into(), true),
        ]))
        .unwrap();
        let err = native_wgpu_export_gate(&spine, None)
            .unwrap_err()
            .to_string();
        assert!(err.contains("spine"));
        assert!(!err.contains("export --target android-webview"));
    }
}
