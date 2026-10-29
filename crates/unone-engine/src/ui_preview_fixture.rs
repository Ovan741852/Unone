//! Native authoring-only fixture loading; no player or gameplay shortcuts.
use std::path::Path;
use crate::{Diagnostic, EngineRuntime};

fn read_fixture(root: &Path, relative: &str) -> Result<serde_json::Value, Box<Diagnostic>> {
    let path = super::resolve_project_path(root, relative).map_err(|cause| {
        Box::new(Diagnostic::error("UI_SAVE_FIXTURE_PATH_INVALID",
            "UI preview save fixture must remain inside the project root", cause.explanation))
    })?;
    let bytes = std::fs::read(&path).map_err(|error| {
        Box::new(Diagnostic::error("UI_SAVE_FIXTURE_READ_FAILED",
            "Could not read the UI preview save fixture", format!("{relative}: {error}")))
    })?;
    serde_json::from_slice(&bytes).map_err(|error| {
        Box::new(Diagnostic::error("UI_SAVE_FIXTURE_INVALID_JSON",
            "UI preview save fixture is not valid JSON", format!("{relative}: {error}")))
    })
}

impl EngineRuntime {
    /// Start an authoring UI preview with an optional saved payload.
    /// Uses the ordinary save restoration contract before `Game.start`.
    /// Paths are portable project-relative paths, not working-directory paths.
    pub fn load_ui_preview(
        project_root: impl AsRef<Path>, seed: u64, save_fixture: Option<&str>,
    ) -> Result<Self, Box<Diagnostic>> {
        let root = project_root.as_ref();
        let payload = save_fixture.map(|path| read_fixture(root, path)).transpose()?;
        Self::load_with_seed_and_save(root, seed, payload)
    }
}
