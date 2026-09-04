mod api;
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
pub use bundle::{
    BundleFetcher, BundleManager, BundleManifest, BundleReport, BundleSpec, BundleVerification,
    BundleVerifier,
};
pub use diagnostics::{
    ActionSuggestion, Diagnostic, DiagnosticSeverity, EngineResult, SourceLocation,
};
pub use platform::{PlatformCapabilities, capabilities as platform_capabilities};
pub use project::{
    InputFrame, ObservationAssertion, PointerInput, ProjectConfig, ProjectFileStatus,
    ProjectInspectReport, ProjectPaths, TestAssertion, TestSpec, UiAssertion,
    inspect as inspect_project,
};
pub use runtime::{
    CheckReport, EngineRuntime, RunReport, TestCaseReport, TestSuiteReport, TypeCheckReport,
};
pub use ui::{UiNode, UiRect, UiTree};
pub use world::{
    Camera2DData, Camera3DData, EntitySnapshot, Mesh3DData, PhysicsSettings, RigidBody2DData,
    RigidBodySnapshot, RigidBodyType, SceneFile, Transform3DData, Vec2, Vec3, WorldSnapshot,
};
