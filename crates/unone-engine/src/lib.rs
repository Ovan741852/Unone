mod api;
mod audio;
mod asset;
mod asset_workflow;
mod bundle;
mod diagnostics;
mod diff;
mod layout;
mod performance;
mod platform;
mod project;
mod runtime;
mod scene;
mod systems;
mod ui;
mod verify;
mod world;

pub use api::{
    ApiDescriptor, ApiParameter, ApiSearchAction, ApiSearchReport, describe as api_describe,
    search as api_search, api_search_result, typings as api_typings,
};
pub use asset::{
    AssetInitReport, AssetInspectBlocker, AssetInspectReport, AssetManifest, AssetReadReport,
    AssetReference, AssetSpec, ResolvedAssetBytes, StaticReferenceScope, init_asset_manifest,
    inspect as inspect_assets, inspect_strict as inspect_assets_strict,
    manifest as load_asset_manifest, read as read_asset, resolve_asset_bytes,
};
pub use asset_workflow::{
    AssetActiveFileReport, AssetActiveReport, AssetAuthoringFileReport, AssetAuthoringReport,
    AssetDescribeReference, AssetDescribeReport, AssetPublicationReport, AssetReferenceScope,
    AssetWorkflowAction, describe_asset,
};
pub use audio::{
    AudioBus, AudioCategory, AudioConfig, AudioEvent, AudioEventKind, AudioLoop, AudioOptions,
    AudioPhase, IMPLEMENTED_AUDIO_RULES, MAX_LIVE_AUDIO_LOOPS,
};
pub use bundle::{
    ASSET_ARCHIVE_VERSION, AssetArchiveEntry, BundleFetcher, BundleManager, BundleManifest,
    BundlePackReport, BundleReport, BundleSpec, BundleVerification, BundleVerifier, pack_project,
    read_asset_from_archive,
};
pub use diagnostics::{
    ActionSuggestion, Diagnostic, DiagnosticSeverity, EngineResult, SourceLocation,
};
pub use diff::{
    DiffReport, FieldDifference, RecordedFrame, Recording, diff as diff_run,
    read_recording, record as record_run, to_markdown as diff_markdown,
};
pub use layout::{
    DEFAULT_LAYOUT_COLS, DEFAULT_LAYOUT_ROWS, LayoutFinding, LayoutNode, LayoutReport,
    draw as draw_layout, inspect as inspect_layout, to_markdown as layout_markdown,
};
pub use performance::{
    FrameCounts, PerformanceReport, PhaseCost, SlowestFrame, to_markdown as performance_markdown,
};
pub use platform::{PlatformCapabilities, capabilities as platform_capabilities};
pub use project::{
    AnimationAssertion, AudioAssertion, EffectsAssertion, InputFrame, UiPreviewSpec, ObservationAssertion, PointerInput,
    ProjectConfig, ProjectFileStatus, ProjectInitAction, ProjectInitFile, ProjectInitReport,
    ProjectInspectReport, ProjectPaths,
    TestAssertion, TestSpec, UiAssertion, init as init_project, inspect as inspect_project,
};
pub use runtime::{
    CheckReport, EngineRuntime, RunReport, SourceProject, TestCaseReport, TestSuiteReport,
    TypeCheckReport, observation_digest,
};
pub use scene::parse_scene_fragment;
pub use systems::{
    SystemDescriptor, SystemReport, SystemSearchReport, SystemSetReport, SystemSettings,
    SystemState, SystemStatus, describe as describe_system, inspect as inspect_systems,
    search as search_systems, set as set_system,
};
pub use verify::{DEFAULT_VERIFY_STEPS, StepStatus, VerifyReport, VerifyStep, verify};
pub use ui::{UI_DESIGN_HEIGHT, UI_DESIGN_WIDTH, UiNode, UiRect, UiTree};
pub use world::{
    AnimationData, AnimationSnapshot, Camera2DData, Contact, Camera3DData, EffectInstance, EntitySnapshot,
    Mesh3DData, PhysicsSettings, RigidBody2DData, RigidBodySnapshot, RigidBodyType, SceneFile,
    Transform2DData, Transform3DData, Vec2, Vec3, WorldSnapshot,
};
