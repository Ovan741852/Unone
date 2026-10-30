//! Export-host identities. Game Luau and declared assets stay project-owned;
//! each host only says which presentation it can draw and how it is packaged.
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::path::Path;
mod projected_raster;
mod projected_frame;
mod physical_input;
mod texture_cache;

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

const NATIVE_PRESENTATION: &[&str] = &[
    "mesh3d",
    "instances3d",
    "heightfield",
    "sprite2d",
    "particle",
    "ui",
    "audio",
    "bloom",
];
const NATIVE_DECODERS: &[&str] = &[
    "unone-mesh-json",
    "png-rgb-rgba",
    "jpeg-rgba",
    "webp-rgba",
    "svg-static",
    "audio-rodio",
];
const NATIVE_EXPORT_BLOCKED: &[&str] = &["spine", "effekseer"];
const NATIVE_RUNTIME_BLOCKED: &[&str] = &["spine", "effekseer"];
const WEB_PRESENTATION_KEYS: &[&str] = &[
    "texture_cache",
    "render_extensions",
    "renderer_mode",
    "renderer_module",
    "renderer_files",
    "ui",
    "bloom",
    "show_performance",
    "antialias",
    "projected_raster",
    "projected_material_profile",
    "physical_input",
    "runtime_backend",
    "job_policy",
    "spatial_backend",
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
            "shader_materials",
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
        note: "Same Luau/assets as web. Native WGPU draws meshes, instances, 2D sprites, particles, non-DOM UI, Bloom and rodio/cpal audio; inspect the selected runtime descriptor for device availability. Export rejects spine/effekseer.",
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
        note: "wgpu NativeActivity. Not the WebView APK. Native WGPU draws meshes, instances, 2D sprites, particles, non-DOM UI, Bloom and rodio/cpal audio; physical arm64 evidence is separate.",
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
        note: "Packager exists. No physical arm64 device evidence. Inspect the selected runtime descriptor for UI/SVG/audio device availability.",
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
    #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="texture_cache::declared")]
    pub texture_cache: Option<texture_cache::TextureCachePolicy>,
    pub spatial_backend: SpatialBackend,
    /// Official player is the default. Replacing its renderer is an explicit
    /// Web-host extension, never an implicit consequence of a shader/effect.
    pub renderer_mode: RendererMode,
    pub renderer_module: Option<String>,
    pub renderer_files: Vec<String>,
    pub ui: PresentationUi,
    pub bloom: bool,
    #[serde(default, skip_serializing_if="Option::is_none", deserialize_with="declared_antialias")]
    pub antialias: Option<bool>,
    #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="projected_raster::declared")]
    pub projected_raster: Option<projected_raster::ProjectedRasterPolicy>,
    #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="projected_frame::declared")]
    pub projected_material_profile: Option<projected_frame::ProjectedMaterialProfile>,
    #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="physical_input::declared")]
    pub physical_input: Option<physical_input::PhysicalInputProfile>,
    pub show_performance: bool,
    pub runtime_backend: RuntimeBackend,
    pub job_policy: JobPolicy,
    pub interpolation: bool,
    pub interpolate_instances: Vec<String>,
    /// Render pass kinds the official Web renderer loads for render_pipeline
    /// (ADR 0048). Each module exports createPass; TypeScript is compiled by
    /// the project's own build before export.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub render_extensions: Vec<RenderExtension>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RenderExtension {
    /// Namespaced pass kind, such as "studio.vignette".
    pub kind: String,
    /// Project-relative .js/.mjs ES module exporting createPass.
    pub module: String,
    /// Further project-relative files the module imports or loads.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
}
#[derive(Debug, Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpatialBackend {
    #[default]
    Cpu,
    Gpu,
    Auto,
}
#[derive(Debug, Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RendererMode {
    #[default]
    Official,
    Custom,
}

fn declared_antialias<'de,D:serde::Deserializer<'de>>(deserializer:D)->Result<Option<bool>,D::Error> {
    <bool as serde::Deserialize>::deserialize(deserializer).map(Some)
}

impl PresentationSettings {
    pub fn validate_renderer(&self) -> Result<()> {
        if let Some(policy)=self.texture_cache {
            ensure!(self.renderer_mode==RendererMode::Official,"TEXTURE_CACHE_OFFICIAL_ONLY");
            policy.validate()?;
        }
        physical_input::validate(self.physical_input,self.renderer_mode==RendererMode::Official)?;
        projected_frame::validate(self.projected_material_profile,self.projected_raster,self.antialias,self.bloom,self.renderer_mode==RendererMode::Official)?;
        projected_raster::validate(self.projected_raster,self.antialias,self.bloom,self.renderer_mode==RendererMode::Official)?;
        match self.renderer_mode {
            RendererMode::Official => ensure!(
                self.renderer_module.is_none() && self.renderer_files.is_empty(),
                "RENDERER_REPLACEMENT_NOT_DECLARED: renderer_module/renderer_files require explicit renderer_mode: custom; use engine particle and shader APIs with the official renderer by default"
            ),
            RendererMode::Custom => {
                ensure!(self.render_extensions.is_empty(), "RENDER_EXTENSIONS_OFFICIAL_ONLY: render_extensions add passes to the official renderer; a custom renderer owns its own passes");
                ensure!(self.antialias.is_none(), "ANTIALIAS_OFFICIAL_ONLY: antialias is an official renderer construction option; omit it for a custom renderer");
                let module = self.renderer_module.as_deref().filter(|v| !v.trim().is_empty())
                    .context("RENDERER_MODULE_REQUIRED: renderer_mode custom requires a project-relative .js/.mjs renderer_module")?;
                ensure!(module.ends_with(".js") || module.ends_with(".mjs"),
                    "RENDERER_MODULE_INVALID: renderer_module must be a .js/.mjs ES module exporting createRenderer");
                ensure!(self.renderer_files.iter().any(|path| path == module),
                    "RENDERER_FILES_INCOMPLETE: renderer_files must explicitly include renderer_module and all its local imports/assets");
                let unique: std::collections::BTreeSet<_> = self.renderer_files.iter().collect();
                ensure!(unique.len() == self.renderer_files.len(), "RENDERER_FILES_DUPLICATE: renderer_files must contain unique project-relative paths");
            }
        }
        let mut kinds = std::collections::BTreeSet::new();
        for extension in &self.render_extensions {
            let kind_ok = (1..=64).contains(&extension.kind.len()) && extension.kind.contains('.')
                && extension.kind.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-'));
            ensure!(kind_ok, "RENDER_EXTENSION_INVALID: kind '{}' must be namespaced (such as studio.vignette) with a-z, 0-9, '.', '_' or '-'", extension.kind);
            ensure!(!unone_engine::BUILTIN_RENDER_PASSES.contains(&extension.kind.as_str()), "RENDER_EXTENSION_INVALID: '{}' is a built-in pass kind", extension.kind);
            ensure!(kinds.insert(extension.kind.as_str()), "RENDER_EXTENSION_DUPLICATE: kind '{}' is declared twice", extension.kind);
            ensure!(extension.module.ends_with(".js") || extension.module.ends_with(".mjs"),
                "RENDER_EXTENSION_INVALID: module '{}' must be a .js/.mjs ES module exporting createPass", extension.module);
        }
        Ok(())
    }
}
#[derive(Default, serde::Deserialize, serde::Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct PresentationUi {
    pub font_source: Option<String>,
    pub font_family: Option<String>,
    pub fonts: Vec<PresentationFontFace>,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationFontFace {
    pub family: String,
    pub source: String,
    #[serde(default = "default_font_weight")]
    pub weight: u16,
}

fn default_font_weight() -> u16 { 400 }

impl PresentationUi {
    pub fn validate_fonts(&self) -> Result<()> {
        let mut faces = std::collections::BTreeSet::new();
        if self.font_source.is_some() {
            let family = self.font_family.as_deref().filter(|value| !value.trim().is_empty())
                .context("UI_FONT_FAMILY_REQUIRED: specify the packaged font's family name")?;
            faces.insert((family, 400));
        }
        ensure!(self.fonts.len() + usize::from(self.font_source.is_some()) <= 32,
            "UI_FONT_LIMIT: at most 32 font faces may be packaged, including font_source");
        for face in &self.fonts {
            ensure!(!face.family.trim().is_empty() && face.family.len() <= 128 && !face.family.chars().any(char::is_control),
                "UI_FONT_FAMILY_INVALID: family must contain 1..128 UTF-8 bytes without control characters");
            ensure!((100..=900).contains(&face.weight), "UI_FONT_WEIGHT_INVALID: weight must be an integer from 100 to 900");
            let extension = std::path::Path::new(&face.source).extension().and_then(|value| value.to_str()).unwrap_or_default();
            ensure!(extension.eq_ignore_ascii_case("ttf") || extension.eq_ignore_ascii_case("otf"),
                "UI_FONT_FORMAT_UNSUPPORTED: ui.fonts supports shared TTF/OTF faces");
            ensure!(faces.insert((&face.family, face.weight)), "UI_FONT_DUPLICATE: family and weight must identify a unique packaged face");
        }
        Ok(())
    }
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
                "projected_raster": projected_raster::capability(matches!(host.family,"web-wasm"|"webview-wraps-web")),
                "physical_input": physical_input::capability(matches!(host.family,"web-wasm"|"webview-wraps-web")),
                "projected_material_profile": projected_frame::capability(matches!(host.family,"web-wasm"|"webview-wraps-web")),
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
    let presentation: PresentationSettings = serde_json::from_slice(&std::fs::read(&path)?)?;
    presentation.validate_renderer()?;
    presentation.ui.validate_fonts()?;
    Ok(Some(presentation))
}

/// Native wgpu shares Luau/assets and UI fonts. Bloom is a renderer primitive
/// implemented by the native post-process path; the remaining overlay options
/// are still Web-only.
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
    presentation.validate_renderer()?;
    ensure!(presentation.renderer_mode == RendererMode::Official,
        "HOST_RENDERER_UNSUPPORTED: renderer_mode custom is a Web-only extension; native wgpu requires the official renderer");
    ensure!(presentation.render_extensions.is_empty(),
        "HOST_RENDER_EXTENSIONS_UNSUPPORTED: render_extensions are JavaScript passes for the official Web renderer; native wgpu has no pass registry yet");
    projected_frame::native_gate(presentation.projected_material_profile)?;
    physical_input::native_gate(presentation.physical_input)?;
    projected_raster::native_gate(presentation.projected_raster)?;
    ensure!(presentation.antialias != Some(true),
        "HOST_ANTIALIAS_UNSUPPORTED: native wgpu is fixed single-sample; omit antialias or use false, or export official Web for an antialias request");
    let mut keys = Vec::new();
    if presentation.texture_cache.is_some() {
        keys.push("texture_cache");
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
        "HOST_PRESENTATION_UNSUPPORTED: player.presentation.json fields {} are not supported by native wgpu. Export --target web or remove those keys.",
        keys.join(", ")
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_extensions_are_namespaced_official_web_modules(){
        let declared=|value:serde_json::Value|serde_json::from_value::<PresentationSettings>(value).unwrap();
        let tint=declared(json!({"render_extensions":[{"kind":"studio.tint","module":"render/tint.js","files":["render/lut.png"]}]}));
        tint.validate_renderer().unwrap();
        assert!(serde_json::to_value(PresentationSettings::default()).unwrap().get("render_extensions").is_none(), "undeclared keeps presentation.json bytes");
        for (value,code) in [
            (json!({"render_extensions":[{"kind":"tint","module":"t.js"}]}),"RENDER_EXTENSION_INVALID"),
            (json!({"render_extensions":[{"kind":"Studio.Tint","module":"t.js"}]}),"RENDER_EXTENSION_INVALID"),
            (json!({"render_extensions":[{"kind":"a.b","module":"t.ts"}]}),"RENDER_EXTENSION_INVALID"),
            (json!({"render_extensions":[{"kind":"a.b","module":"t.js"},{"kind":"a.b","module":"u.js"}]}),"RENDER_EXTENSION_DUPLICATE"),
            (json!({"renderer_mode":"custom","renderer_module":"r.mjs","renderer_files":["r.mjs"],"render_extensions":[{"kind":"a.b","module":"t.js"}]}),"RENDER_EXTENSIONS_OFFICIAL_ONLY"),
        ] {
            let error=declared(value.clone()).validate_renderer().unwrap_err().to_string();
            assert!(error.contains(code),"{value}: {error}");
        }
        assert!(serde_json::from_value::<PresentationSettings>(json!({"render_extensions":[{"kind":"a.b","module":"t.js","entry":"x"}]})).is_err());
        let quiet=unone_engine::SystemSettings::resolve(&std::collections::BTreeMap::from([("spine".into(),false),("effekseer".into(),false)])).unwrap();
        assert!(native_wgpu_export_gate(&quiet,Some(&tint)).unwrap_err().to_string().contains("HOST_RENDER_EXTENSIONS_UNSUPPORTED"));
    }

    #[test]
    fn ordered_physical_input_is_optional_strict_and_official_web_only(){
        assert!(serde_json::to_value(PresentationSettings::default()).unwrap().get("physical_input").is_none());
        let settings:PresentationSettings=serde_json::from_value(json!({"physical_input":"ordered_physical_v1"})).unwrap();
        settings.validate_renderer().unwrap();
        assert_eq!(serde_json::to_value(&settings).unwrap()["physical_input"],"ordered_physical_v1");
        let quiet=unone_engine::SystemSettings::resolve(&std::collections::BTreeMap::from([("spine".into(),false),("effekseer".into(),false)])).unwrap();
        assert!(native_wgpu_export_gate(&quiet,Some(&settings)).unwrap_err().to_string().contains("HOST_PHYSICAL_INPUT_UNSUPPORTED"));
        for value in [json!(null),json!(false),json!("snapshot")] {assert!(serde_json::from_value::<PresentationSettings>(json!({"physical_input":value})).is_err());}
        let custom:PresentationSettings=serde_json::from_value(json!({"physical_input":"ordered_physical_v1","renderer_mode":"custom","renderer_module":"r.mjs","renderer_files":["r.mjs"]})).unwrap();
        assert!(custom.validate_renderer().unwrap_err().to_string().contains("INPUT_PHYSICAL_OFFICIAL_ONLY"));
    }

    #[test]
    fn projected_raster_declaration_is_strict_optional_and_webgl_only() {
        let omitted=serde_json::to_value(PresentationSettings::default()).unwrap();
        assert!(omitted.get("projected_raster").is_none());
        let quiet=unone_engine::SystemSettings::resolve(&std::collections::BTreeMap::from([
            ("spine".into(),false),("effekseer".into(),false)])).unwrap();
        for value in ["host","upper_left_checked"] {
            let settings:PresentationSettings=serde_json::from_value(json!({"projected_raster":value,"antialias":false})).unwrap();
            settings.validate_renderer().unwrap();
            assert_eq!(serde_json::to_value(&settings).unwrap()["projected_raster"],value);
            assert!(native_wgpu_export_gate(&quiet,Some(&settings)).unwrap_err().to_string().contains("HOST_PROJECTED_RASTER_UNSUPPORTED"));
            let custom:PresentationSettings=serde_json::from_value(json!({"projected_raster":value,"renderer_mode":"custom",
                "renderer_module":"r.mjs","renderer_files":["r.mjs"]})).unwrap();
            assert!(custom.validate_renderer().unwrap_err().to_string().contains("PROJECTED_RASTER_OFFICIAL_WEBGL_ONLY"));
        }
        for value in [json!(null),json!(true),json!(7),json!("upper_left"),json!({})] {
            assert!(serde_json::from_value::<PresentationSettings>(json!({"projected_raster":value})).is_err());
        }
    }

    #[test]
    fn checked_raster_requires_explicit_no_aa_and_no_bloom() {
        for json in [json!({"projected_raster":"upper_left_checked"}),
            json!({"projected_raster":"upper_left_checked","antialias":true}),
            json!({"projected_raster":"upper_left_checked","antialias":false,"bloom":true})] {
            let settings:PresentationSettings=serde_json::from_value(json).unwrap();
            assert!(settings.validate_renderer().unwrap_err().to_string().contains("PROJECTED_RASTER_PROFILE_UNSUPPORTED"));
        }
    }

    #[test]
    fn antialias_is_explicit_strict_official_and_host_bounded() {
        let quiet=unone_engine::SystemSettings::resolve(&std::collections::BTreeMap::from([
            ("spine".into(),false),("effekseer".into(),false)])).unwrap();
        let omitted=PresentationSettings::default();
        assert!(omitted.antialias.is_none());
        assert!(serde_json::to_value(&omitted).unwrap().get("antialias").is_none());
        native_wgpu_export_gate(&quiet,Some(&omitted)).unwrap();
        for value in [false,true] {
            let settings:PresentationSettings=serde_json::from_value(json!({"antialias":value})).unwrap();
            assert_eq!(settings.antialias,Some(value));settings.validate_renderer().unwrap();
            let native=native_wgpu_export_gate(&quiet,Some(&settings));
            if value {assert!(native.unwrap_err().to_string().contains("HOST_ANTIALIAS_UNSUPPORTED"));}
            else {native.unwrap();}
        }
        for value in [json!(null),json!(0),json!("false"),json!({})] {
            assert!(serde_json::from_value::<PresentationSettings>(json!({"antialias":value})).is_err());
        }
        let custom:PresentationSettings=serde_json::from_value(json!({"antialias":false,"renderer_mode":"custom",
            "renderer_module":"r.mjs","renderer_files":["r.mjs"]})).unwrap();
        assert!(custom.validate_renderer().unwrap_err().to_string().contains("ANTIALIAS_OFFICIAL_ONLY"));
    }

    #[test]
    fn spatial_execution_policy_is_strict_shared_and_defaults_to_cpu() {
        let defaults: PresentationSettings = serde_json::from_value(json!({})).unwrap();
        assert_eq!(defaults.spatial_backend, SpatialBackend::Cpu);
        let settings = unone_engine::SystemSettings::resolve(&std::collections::BTreeMap::from([
            ("spine".into(),false), ("effekseer".into(),false),
        ])).unwrap();
        for policy in ["cpu","gpu","auto"] {
            let presentation: PresentationSettings=serde_json::from_value(json!({"spatial_backend":policy})).unwrap();
            assert_eq!(serde_json::to_value(&presentation).unwrap()["spatial_backend"],policy);
            native_wgpu_export_gate(&settings,Some(&presentation)).unwrap();
        }
        assert!(serde_json::from_value::<PresentationSettings>(json!({"spatial_backend":"vulkan"})).is_err());
    }

    #[test]
    fn renderer_defaults_official_and_replacement_requires_explicit_declaration() {
        let default: PresentationSettings = serde_json::from_value(json!({})).unwrap();
        assert_eq!(default.renderer_mode, RendererMode::Official);
        default.validate_renderer().unwrap();
        for value in [
            json!({"renderer_module":"render.mjs"}),
            json!({"renderer_files":["render.mjs"]}),
            json!({"renderer_mode":"custom"}),
            json!({"renderer_mode":"custom","renderer_module":"render.mjs"}),
            json!({"renderer_mode":"custom","renderer_module":"render.html","renderer_files":["render.html"]}),
            json!({"renderer_mode":"custom","renderer_module":"render.mjs","renderer_files":["render.mjs","render.mjs"]}),
        ] {
            let presentation: PresentationSettings = serde_json::from_value(value).unwrap();
            assert!(presentation.validate_renderer().is_err());
        }
        assert!(serde_json::from_value::<PresentationSettings>(json!({"renderer_mode":"automatic"})).is_err());
        assert!(serde_json::from_value::<PresentationSettings>(json!({"renderer":"custom"})).is_err());
        let custom: PresentationSettings = serde_json::from_value(json!({
            "renderer_mode":"custom", "renderer_module":"render.mjs", "renderer_files":["render.mjs"]
        })).unwrap();
        custom.validate_renderer().unwrap();
        let settings = unone_engine::SystemSettings::resolve(&std::collections::BTreeMap::from([
            ("spine".into(), false), ("effekseer".into(), false),
        ])).unwrap();
        assert!(native_wgpu_export_gate(&settings, Some(&custom)).unwrap_err().to_string().contains("HOST_RENDERER_UNSUPPORTED"));
    }

    #[test]
    fn font_catalog_limit_counts_the_legacy_face() {
        let catalog: Vec<_> = (0..32).map(|index| json!({
            "family": format!("Fixture {index}"), "source": format!("fonts/{index}.ttf")
        })).collect();
        let mut ui: PresentationUi = serde_json::from_value(json!({"fonts":catalog})).unwrap();
        ui.validate_fonts().unwrap();
        ui.font_source = Some("legacy.ttf".into());
        ui.font_family = Some("Legacy".into());
        assert!(ui.validate_fonts().unwrap_err().to_string().contains("UI_FONT_LIMIT"));
        ui.fonts.pop();
        ui.validate_fonts().unwrap();
    }

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
        assert_eq!(windows["runtime_blocked_systems"], json!(["spine", "effekseer"]));
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
