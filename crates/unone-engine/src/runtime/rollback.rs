//! Rollback checkpoints (docs/rollback.md; proposal rollback-netcode-v1, phase
//! 1): a copy of everything the simulation needs to continue from one tick, so
//! a host can run ahead on predicted input, go back, and run again.
//!
//! Engine state is copied whole: World (entities, 2D and 3D physics,
//! particles, effects, audio, render, lighting and material state), input
//! edges, the random generator, observations, the published UI, the save
//! payload, host time and sprite resource feedback. Game Luau state is the
//! game's to give: `Game.saveState(api)` returns plain data and
//! `Game.loadState(api, state)` takes it back. Spatial batches and jobs carry
//! asynchronous work between ticks and are not checkpointed yet.
use std::{cell::RefCell, collections::BTreeMap, sync::Arc};

use super::{DeterministicRng, EngineRuntime, InputState, SaveState, bindings, script_diagnostic, sprite_resources};
use crate::{diagnostics::Diagnostic, ui::UiTree, world::World};

/// Everything the simulation needs to continue from one tick.
#[derive(Clone)]
pub struct Checkpoint {
    world: World,
    input: InputState,
    random: DeterministicRng,
    observations: BTreeMap<String, serde_json::Value>,
    ui: Option<Arc<UiTree>>,
    save_payload: SaveState,
    sprite_resources: sprite_resources::Registry,
    host_time: crate::host_time::HostTime,
    /// The unused spatial system still orders ticks by frame.
    spatial_frame: (u64, bool),
    /// What Game.saveState returned, when the game has the hooks.
    game: Option<serde_json::Value>,
}

impl Checkpoint {
    /// The simulation frame this checkpoint continues from.
    pub fn frame(&self) -> u64 {
        self.world.frame
    }

    /// The game's own state from Game.saveState, if the game has the hooks.
    pub fn game_state(&self) -> Option<&serde_json::Value> {
        self.game.as_ref()
    }
}

fn copy<T: Clone>(cell: &RefCell<T>) -> T {
    cell.borrow().clone()
}

impl EngineRuntime {
    /// Whether the game defines Game.saveState and Game.loadState.
    pub fn has_state_hooks(&self) -> bool {
        self.state_hooks.is_some()
    }

    /// Why this runtime cannot be checkpointed right now, if it cannot.
    fn rollback_blocker(&self) -> Option<&'static str> {
        if !self.data_assets.borrow().deferred.is_empty() {
            return Some("the project declares on-demand data, whose delivery and host requests cross ticks");
        }
        if self.spatial.borrow().rollback_blocked() {
            return Some("the game uses spatial batches (api.spatial), whose queries finish on later ticks");
        }
        #[cfg(feature = "jobs")]
        if self.jobs.borrow().rollback_blocked() {
            return Some("jobs are scheduled or in flight (api.jobs), and their results arrive on later ticks");
        }
        None
    }

    /// Copy everything needed to continue from the current tick.
    pub fn checkpoint(&self) -> Result<Checkpoint, Box<Diagnostic>> {
        if let Some(reason) = self.rollback_blocker() {
            return Err(Box::new(Diagnostic::error(
                "ROLLBACK_UNSUPPORTED",
                "This simulation cannot be checkpointed",
                format!("Rollback checkpoints are not available while {reason}."),
            )));
        }
        let game = match &self.state_hooks {
            None => None,
            Some((save, _)) => {
                #[cfg(feature = "dev-tools")]
                let _watch = super::script_watchdog::watch(&self.lua, "Game.saveState", super::script_watchdog::limit(&self.config));
                let value: mlua::Value = save
                    .call(self.api.clone())
                    .map_err(|error| Box::new(script_diagnostic(&self.paths, error.to_string())))?;
                Some(bindings::value::lua_value_to_json(value).map_err(|error| {
                    Box::new(Diagnostic::error(
                        "GAME_STATE_INVALID",
                        "Game.saveState returned something that is not plain data",
                        format!("Return tables of numbers, strings and booleans (no functions, buffers or cycles): {error}"),
                    ))
                })?)
            }
        };
        Ok(Checkpoint {
            world: copy(&self.world),
            input: copy(&self.input),
            random: copy(&self.random),
            observations: copy(&self.observations),
            ui: copy(&self.ui),
            save_payload: copy(&self.save_payload),
            sprite_resources: copy(&self.sprite_resources),
            host_time: copy(&self.host_time),
            spatial_frame: self.spatial.borrow().frame_mark(),
            game,
        })
    }

    /// Continue from a checkpoint, as if the ticks after it never happened.
    pub fn restore(&mut self, checkpoint: &Checkpoint) -> Result<(), Box<Diagnostic>> {
        if let Some(reason) = self.rollback_blocker() {
            return Err(Box::new(Diagnostic::error(
                "ROLLBACK_UNSUPPORTED",
                "This simulation cannot be restored",
                format!("Rollback checkpoints are not available while {reason}."),
            )));
        }
        *self.world.borrow_mut() = checkpoint.world.clone();
        *self.input.borrow_mut() = checkpoint.input.clone();
        *self.random.borrow_mut() = checkpoint.random.clone();
        *self.observations.borrow_mut() = checkpoint.observations.clone();
        *self.ui.borrow_mut() = checkpoint.ui.clone();
        *self.save_payload.borrow_mut() = checkpoint.save_payload.clone();
        *self.sprite_resources.borrow_mut() = checkpoint.sprite_resources.clone();
        *self.host_time.borrow_mut() = checkpoint.host_time.clone();
        self.spatial.borrow_mut().restore_frame_mark(checkpoint.spatial_frame);
        if let (Some((_, load)), Some(state)) = (&self.state_hooks, &checkpoint.game) {
            let state = bindings::value::json_to_lua(&self.lua, state.clone())
                .map_err(|error| Box::new(script_diagnostic(&self.paths, error.to_string())))?;
            #[cfg(feature = "dev-tools")]
            let _watch = super::script_watchdog::watch(&self.lua, "Game.loadState", super::script_watchdog::limit(&self.config));
            load.call::<()>((self.api.clone(), state))
                .map_err(|error| Box::new(script_diagnostic(&self.paths, error.to_string())))?;
        }
        Ok(())
    }
}
