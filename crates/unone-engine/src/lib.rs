mod api;
mod asset;
mod bundle;
mod diagnostics;
mod platform;
mod project;
mod runtime;
mod ui;
mod world;

pub use api::{
    ApiDescriptor, ApiParameter, ApiSearchReport, describe as api_describe, search as api_search,
};
pub use asset::{
    AssetInitReport, AssetInspectBlocker, AssetInspectReport, AssetManifest, AssetReference,
    AssetReadReport, AssetSpec, StaticReferenceScope, init_asset_manifest,
    inspect as inspect_assets, inspect_strict as inspect_assets_strict, read as read_asset,
};
pub use bundle::{
    ASSET_ARCHIVE_VERSION, AssetArchiveEntry, BundleFetcher, BundleManager, BundleManifest,
    BundlePackReport, BundleReport, BundleSpec, BundleVerification, BundleVerifier, pack_project,
    read_asset_from_archive,
};
pub use diagnostics::{
    ActionSuggestion, Diagnostic, DiagnosticSeverity, EngineResult, SourceLocation,
};
pub use platform::{PlatformCapabilities, capabilities as platform_capabilities};
pub use project::{
    InputFrame, ObservationAssertion, PointerInput, ProjectConfig, ProjectFileStatus,
    ProjectInitReport, ProjectInspectReport, ProjectPaths, TestAssertion, TestSpec, UiAssertion,
    init as init_project, inspect as inspect_project,
};
pub use runtime::{
    CheckReport, EngineRuntime, RunReport, TestCaseReport, TestSuiteReport, TypeCheckReport,
};
pub use ui::{UI_DESIGN_HEIGHT, UI_DESIGN_WIDTH, UiNode, UiRect, UiTree};
pub use world::{
    Camera2DData, Camera3DData, EntitySnapshot, Mesh3DData, PhysicsSettings, RigidBody2DData,
    RigidBodySnapshot, RigidBodyType, SceneFile, Transform3DData, Vec2, Vec3, WorldSnapshot,
};
