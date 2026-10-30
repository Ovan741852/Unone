mod application;
pub use application::{ApplicationState, EscapeBehavior};
mod shader;
/// Backend-independent packed geometry batches and reference query semantics.
pub mod spatial;
pub use shader::{ShaderMaterialDefinition, ShaderUniform};
mod mesh;
pub use mesh::{MeshAsset, MeshLod, validate_mesh_geometry};
mod heightfield;
pub use heightfield::{Heightfield, HeightfieldDefinition, HeightfieldPatch};
mod projected;
pub use projected::{ProjectedBatch,ProjectedViewport,ProjectedScissor,ProjectedColorMode,ProjectedFilter,ProjectedSamplingSpace,ProjectedAddressMode,ProjectedAlphaCompare,ProjectedBlend,PROJECTED_FORMAT};
mod projected_frame;
mod physical_input;
mod physical_input_validation;
mod physical_input_session;
pub use physical_input::{PhysicalBatch,PhysicalEvent,PhysicalReceipt};
pub use projected_frame::{ProjectedFrame,ProjectedFrameDraw,PROJECTED_FRAME_PROFILE,PROJECTED_FRAME_GOURAUD_PROFILE};
mod projected_frame_material;
pub use projected_frame_material::*;
mod projected_frame_validation;
#[cfg(feature = "dev-tools")]
mod api;
#[cfg(feature = "dev-tools")]
mod api_typing_authoring;
#[cfg(feature = "dev-tools")]
mod asset;
#[cfg(feature = "dev-tools")]
mod asset_workflow;
#[cfg(feature = "dev-tools")]
mod asset_usage;
mod audio;
mod data_assets;
pub use data_assets::{BUILTIN_DATA_LOADERS, DataAssetDecl};
#[cfg(feature = "dev-tools")]
pub use data_assets::decl_for as data_asset_decl;
#[cfg(feature = "physics2d")]
mod broadphase;
#[cfg(feature = "dev-tools")]
mod bundle;
#[cfg(feature = "dev-tools")]
mod developer;
mod diagnostics;
mod execution;
pub use execution::{ExecutionMode, execution_mode};
#[cfg(feature = "dev-tools")]
mod diff;
mod host;
mod instances3d;
#[cfg(feature = "dev-tools")]
mod layout;
mod performance;
#[cfg(feature = "physics3d")]
mod physics3d;
mod platform;
mod project;
mod rigid3d;
mod runtime;
mod runtime_packages;
pub use runtime_packages::compiled_runtime_packages;
#[cfg(feature = "dev-tools")]
pub use runtime_packages::runtime_package_files;
#[cfg(feature = "preview-tools")]
pub use runtime::{DebugControl, DebugTab, PreviewRequest};
mod scene;
#[cfg(feature = "dev-tools")]
mod schema;
mod systems;
mod ui;
mod ui_cursor;
pub use ui_cursor::{UiCursor,CursorFilter};
pub use ui::{UiImageBatchDefinition,UiImageBatchResource,UiImageTransform};
#[cfg(feature = "dev-tools")]
mod verify;
mod world;

#[cfg(feature = "dev-tools")]
pub use api::{
    ApiDescriptor, ApiParameter, ApiSearchAction, ApiSearchReport, api_search_result,
    describe as api_describe, search as api_search, typings as api_typings,
};
#[cfg(feature = "dev-tools")]
pub use api_typing_authoring::{ApiTypingsUpdateReport, api_typings_block, update_api_typings};
#[cfg(feature = "dev-tools")]
pub use asset::{
    AssetCompanion, AssetEncoding, AssetInitReport, AssetInspectBlocker, AssetInspectReport,
    AssetManifest, AssetReadReport, AssetReference, AssetSpec, ResolvedAssetBytes,
    SUPPORTED_ASSET_KINDS, StaticReferenceScope, init_asset_manifest, inspect as inspect_assets,
    inspect_strict as inspect_assets_strict, manifest as load_asset_manifest, read as read_asset,
    resolve_asset_bytes,
};
#[cfg(feature = "dev-tools")]
pub use asset_workflow::{
    AssetActiveFileReport, AssetActiveReport, AssetAuthoringFileReport, AssetAuthoringReport,
    AssetDescribeReference, AssetDescribeReport, AssetPublicationReport, AssetReferenceScope,
    AssetWorkflowAction, describe_asset,
};
#[cfg(feature = "dev-tools")]
pub use asset_usage::{AssetUsageIndex, AssetUsageFile, AssetUsageReference, AssetUsageScope, asset_usages};
pub use audio::{
    AudioBus, AudioCategory, AudioConfig, AudioEvent, AudioEventKind, AudioLoop, AudioOptions,
    AudioPhase, IMPLEMENTED_AUDIO_RULES, MAX_LIVE_AUDIO_LOOPS,
};
#[cfg(feature = "dev-tools")]
pub use bundle::{
    ASSET_ARCHIVE_VERSION, AssetArchiveEntry, BundleFetcher, BundleManager, BundleManifest,
    BundlePackReport, BundleReport, BundleSpec, BundleVerification, BundleVerifier, pack_project,
    read_asset_from_archive,
};
#[cfg(feature = "dev-tools")]
pub use developer::{
    Change, DeveloperProtocol, DeveloperRequest, DeveloperSession, EnactOperation, Selector,
    developer_request_schema,
};
pub use diagnostics::{
    ActionSuggestion, Diagnostic, DiagnosticSeverity, EngineResult, SourceLocation,
    EngineDiagnostic, EngineDiagnosticContext, EngineDiagnosticRecovery,
};
#[cfg(feature = "dev-tools")]
pub use diff::{
    DiffReport, FieldDifference, RecordedFrame, Recording, diff as diff_run, read_recording,
    record as record_run, to_markdown as diff_markdown,
};
pub use host::{HostInputState, HostProject, host_error, parse_input_frame};
#[cfg(feature = "dev-tools")]
pub use layout::{
    apply_overlap_policy,
    DEFAULT_LAYOUT_COLS, DEFAULT_LAYOUT_ROWS, LayoutBackgroundEvidence, LayoutFinding, LayoutNode, LayoutReport,
    draw as draw_layout, inspect as inspect_layout, to_markdown as layout_markdown,
};
pub use performance::{
    FrameCounts, PerformanceReport, PhaseCost, SlowestFrame, to_markdown as performance_markdown,
};
pub use platform::{PlatformCapabilities, capabilities as platform_capabilities};
pub use project::{
    AnimationAssertion, AudioAssertion, EffectsAssertion, InputFrame, ObservationAssertion,
    PointerInput, SliderInteraction, SliderPhase, TextInputInteraction, TextInputPhase, ProjectConfig, ProjectFileStatus, ProjectInitAction, ProjectInitFile,
    ProjectInitReport, ProjectInspectReport, ProjectPaths, TestAssertion, TestSpec, UiAssertion,
    UiPreviewSpec,
};
pub use runtime::{
    CheckReport, EngineRuntime, RunReport, SourceProject, SpatialTask, TestCaseReport, TestSuiteReport,
    TypeCheckReport, encode_observation, observation_digest,
};
pub use scene::parse_scene_fragment;
#[cfg(feature = "dev-tools")]
pub use schema::{SCHEMA_NAMES, contract_schema};
pub use systems::{
    SystemDescriptor, SystemReport, SystemSearchReport, SystemSetReport, SystemSettings,
    SystemState, SystemStatus, compiled_systems, describe as describe_system,
    search as search_systems,
};
pub use ui::{UI_DESIGN_HEIGHT, UI_DESIGN_WIDTH, UiBackgroundScope, UiImageFit, UiImageQuad, UiNode, UiRect, UiTree, UiSlice, UiBudget, UiUsage, UiStyle, UiInsets, UiTextAlign, UiVerticalAlign, UiTextWrap, UiTextOverflow, UiTextShadow, UiSliderAxis, UiSliderDrag, ui_contract};
#[cfg(feature = "dev-tools")]
pub use verify::{DEFAULT_VERIFY_STEPS, StepStatus, VerifyReport, VerifyStep, verify};
pub use world::{
    AnimationData, AnimationSnapshot, Camera2DData, Camera3DData, Contact, EffectInstance,
    EntitySnapshot, Mesh3DData, PhysicsSettings, RigidBody2DData, RigidBodySnapshot, RigidBodyType,
    SceneFile, SpriteAnimationData, SpriteData, SpriteSheet, Transform2DData, Transform3DData, Vec2,
    Vec3, WorldSnapshot,
};

#[cfg(feature = "dev-tools")]
pub use project::{init as init_project, inspect as inspect_project};
#[cfg(feature = "dev-tools")]
pub use systems::{inspect as inspect_systems, set as set_system};

/// Player binaries assert this is false at compile time.
pub const DEV_TOOLS_ENABLED: bool = cfg!(feature = "dev-tools");

mod particle;
pub use particle::{
    ParticleDefinition, ParticleEmissionShape, ParticleEmitter, ParticleEasing,
    ParticleSnapshot, ParticleSpriteShape, ParticleVelocityMode,
};

mod canonical_hash;
pub use canonical_hash::{CanonicalHashWork, CanonicalHasher};
mod host_time;
pub use host_time::{HostTimeConfig, HostTimeSample, HostTimeTape, HostTimeTransaction};
