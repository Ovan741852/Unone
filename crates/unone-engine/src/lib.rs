mod api;
mod bundle;
mod diagnostics;
mod platform;
mod project;
mod runtime;
mod world;

pub use api::{
    ApiDescriptor, ApiParameter, ApiSearchReport, describe as api_describe, search as api_search,
};
pub use bundle::{BundleManager, BundleManifest, BundleReport, BundleSpec};
pub use diagnostics::{
    ActionSuggestion, Diagnostic, DiagnosticSeverity, EngineResult, SourceLocation,
};
pub use platform::{PlatformCapabilities, capabilities as platform_capabilities};
pub use project::{
    ProjectConfig, ProjectFileStatus, ProjectInspectReport, ProjectPaths, TestAssertion, TestSpec,
    inspect as inspect_project,
};
pub use runtime::{
    CheckReport, EngineRuntime, RunReport, TestCaseReport, TestSuiteReport, TypeCheckReport,
};
pub use world::{
    Camera2DData, EntitySnapshot, PhysicsSettings, RigidBody2DData, RigidBodySnapshot,
    RigidBodyType, SceneFile, Vec2, WorldSnapshot,
};
