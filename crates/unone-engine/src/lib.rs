mod api;
mod asset;
mod bundle;
mod diagnostics;
mod layout;
mod platform;
mod project;
mod runtime;
mod systems;
mod ui;
mod world;

pub use api::{
    ApiDescriptor, ApiParameter, ApiSearchReport, describe as api_describe, search as api_search,
    typings as api_typings,
};
pub use asset::{
    AssetInitReport, AssetInspectBlocker, AssetInspectReport, AssetManifest, AssetReadReport,
    AssetReference, AssetSpec, StaticReferenceScope, init_asset_manifest,
    inspect as inspect_assets, inspect_strict as inspect_assets_strict,
    manifest as load_asset_manifest, read as read_asset,
};
pub use bundle::{
    ASSET_ARCHIVE_VERSION, AssetArchiveEntry, BundleFetcher, BundleManager, BundleManifest,
    BundlePackReport, BundleReport, BundleSpec, BundleVerification, BundleVerifier, pack_project,
    read_asset_from_archive,
};
pub use diagnostics::{
    ActionSuggestion, Diagnostic, DiagnosticSeverity, EngineResult, SourceLocation,
};
pub use layout::{
    DEFAULT_LAYOUT_COLS, DEFAULT_LAYOUT_ROWS, LayoutFinding, LayoutNode, LayoutReport,
    draw as draw_layout, inspect as inspect_layout, to_markdown as layout_markdown,
};
pub use platform::{PlatformCapabilities, capabilities as platform_capabilities};
pub use project::{
    AnimationAssertion, EffectsAssertion, InputFrame, ObservationAssertion, PointerInput,
    ProjectConfig, ProjectFileStatus, ProjectInitReport, ProjectInspectReport, ProjectPaths,
    TestAssertion, TestSpec, UiAssertion, init as init_project, inspect as inspect_project,
};
pub use runtime::{
    CheckReport, EngineRuntime, RunReport, TestCaseReport, TestSuiteReport, TypeCheckReport,
};
pub use systems::{
    SystemDescriptor, SystemReport, SystemSearchReport, SystemSetReport, SystemSettings,
    SystemState, SystemStatus, describe as describe_system, inspect as inspect_systems,
    search as search_systems, set as set_system,
};
pub use ui::{UI_DESIGN_HEIGHT, UI_DESIGN_WIDTH, UiNode, UiRect, UiTree};
pub use world::{
    AnimationData, AnimationSnapshot, Camera2DData, Camera3DData, EffectInstance, EntitySnapshot,
    Mesh3DData, PhysicsSettings, RigidBody2DData, RigidBodySnapshot, RigidBodyType, SceneFile,
    Transform3DData, Vec2, Vec3, WorldSnapshot,
};
