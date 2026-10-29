//! Lifecycle boundary for demand-sampled time, independent of World rollback.
use super::*;

pub(super) struct TimeScope {
    clock: Rc<RefCell<crate::host_time::HostTime>>,
    committed: bool,
}
impl TimeScope {
    pub(super) fn begin(clock: &Rc<RefCell<crate::host_time::HostTime>>, phase: &str, frame: u64) -> Result<Self, String> {
        clock.borrow_mut().begin(phase, frame)?;
        Ok(Self { clock: Rc::clone(clock), committed: false })
    }
    pub(super) fn commit(mut self) -> Result<(), String> {
        self.clock.borrow_mut().finish()?;
        self.committed = true;
        Ok(())
    }
}
impl Drop for TimeScope {
    fn drop(&mut self) {
        if !self.committed { self.clock.borrow_mut().abort("lifecycle transaction did not commit"); }
    }
}

impl EngineRuntime {
    #[cfg(feature = "dev-tools")]
    pub(crate) fn require_replayable_host_time(config: &crate::ProjectConfig) -> Result<(), Box<Diagnostic>> {
        if matches!(config.host_time, Some(crate::HostTimeConfig::Live | crate::HostTimeConfig::Record { .. })) {
            return Err(Box::new(Diagnostic::error("HOST_TIME_REPLAY_TAPE_MISSING",
                "Deterministic authoring requires recorded host-time inputs",
                "Set project.host_time to replay with a recorded tape for tests and UI preview; live resampling cannot verify deterministic behavior.")));
        }
        Ok(())
    }
    /// Detached diagnostics. Reading does not sample time or advance replay.
    pub fn host_time_report(&self) -> serde_json::Value { self.host_time.borrow().report() }
    pub fn host_time_tape(&self) -> Option<crate::HostTimeTape> { self.host_time.borrow().tape() }
    #[cfg(feature = "dev-tools")]
    pub(crate) fn host_time_recorded_prefix(&self) -> Option<crate::HostTimeTape> { self.host_time.borrow().recorded_prefix() }
    pub fn host_time_replay_complete(&self) -> Result<(), String> { self.host_time.borrow().replay_complete() }

    /// Recorder override is applied before Game.start, including file-backed scenes/jobs.
    #[cfg(feature = "dev-tools")]
    pub fn load_with_host_time(project_root: impl AsRef<Path>, seed: u64, policy: crate::HostTimeConfig) -> Result<Self, Box<Diagnostic>> {
        let (mut config, paths) = ProjectPaths::discover(project_root)?;
        config.host_time = Some(policy);
        let world = Rc::new(RefCell::new(World::default()));
        if let Some(scene) = &paths.main_scene { world.borrow_mut().load_scene(scene)?; }
        Self::with_world(config, paths, world, None, seed, None, None, None)
    }
}
