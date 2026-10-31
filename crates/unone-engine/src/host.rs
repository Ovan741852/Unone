//! Shared host ingestion contract. Platform adapters own transport and storage,
//! never a separate interpretation of game configuration or replay input.
use crate::{Diagnostic, EngineRuntime, InputFrame, ProjectConfig, SourceProject};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct HostProject {
    pub config: ProjectConfig,
    /// Entry script source; empty when `script_bytecode` declares a precompiled chunk.
    #[serde(default)]
    pub script: String,
    /// Precompiled entry script in place of `script`. Its bytes travel beside this
    /// JSON as staged data SCRIPT_BYTECODE_DATA_ID, never inside it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_bytecode: Option<crate::ScriptBytecodeDecl>,
    #[serde(default)]
    pub job_sources: BTreeMap<String,String>,
    // Preserve original JSON locations for the common scene validator.
    #[serde(default)]
    #[cfg_attr(feature = "dev-tools", schemars(with = "Option<crate::SceneFile>"))]
    pub scene: Option<Box<serde_json::value::RawValue>>,
    /// Restored state is available in Game.start, never injected after startup.
    #[serde(default)]
    pub restored_save: Option<serde_json::Value>,
    /// UI viewport aspect, supplied before Game.start; defaults to 16:9.
    /// Ignored when viewport_size is present: the physical size then defines
    /// the aspect exactly, so hosts may send a rounded CSS aspect alongside it.
    #[serde(default)]
    pub viewport_aspect: Option<f64>,
    /// Physical render-target pixels, supplied before Game.start when known.
    #[serde(default)]
    pub viewport_size: Option<[u32;2]>,
    /// Data assets the game reads with api.assets.load. The host delivers their
    /// bytes beside this JSON (into_runtime_with_data), never inside it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data_assets: Vec<crate::DataAssetDecl>,
}

impl HostProject {
    pub fn parse(bytes: &[u8]) -> Result<Self, Box<Diagnostic>> {
        serde_json::from_slice(bytes).map_err(|error| {
            Box::new(Diagnostic::error(
                "HOST_PROJECT_INVALID",
                "Invalid host project payload",
                error.to_string(),
            ))
        })
    }

    pub fn into_runtime(self, seed: u64) -> Result<EngineRuntime, Box<Diagnostic>> {
        self.into_runtime_with_data(seed, BTreeMap::new())
    }

    /// Start the runtime with the bytes of every declared data asset, keyed by id.
    pub fn into_runtime_with_data(
        self,
        seed: u64,
        mut data: BTreeMap<String, Vec<u8>>,
    ) -> Result<EngineRuntime, Box<Diagnostic>> {
        let invalid = |message: String| Box::new(Diagnostic::error("HOST_PROJECT_INVALID", "Invalid host project payload", message));
        let script_bytecode = match &self.script_bytecode {
            Some(decl) => {
                if !self.script.is_empty() {
                    return Err(invalid("SCRIPT_BYTECODE_INVALID: declare either script or script_bytecode".into()));
                }
                let bytes = data.remove(crate::SCRIPT_BYTECODE_DATA_ID)
                    .ok_or_else(|| invalid(format!("SCRIPT_BYTECODE_MISSING: stage {} as {}", decl.source, crate::SCRIPT_BYTECODE_DATA_ID)))?;
                crate::script_bytecode::admit(decl, &bytes).map_err(invalid)?;
                Some(bytes)
            }
            None if data.contains_key(crate::SCRIPT_BYTECODE_DATA_ID) =>
                return Err(invalid("SCRIPT_BYTECODE_UNDECLARED: staged bytecode needs a script_bytecode declaration".into())),
            None => None,
        };
        let scene = self
            .scene
            .as_deref()
            .map(|raw| crate::parse_scene_fragment(raw.get()))
            .transpose()?;
        EngineRuntime::load_source_project(SourceProject {
            config: self.config,
            source: self.script,
            script_bytecode,
            job_sources: self.job_sources,
            scene,
            seed,
            restored_save: self.restored_save,
            viewport_aspect: self.viewport_aspect,
            viewport_size: self.viewport_size,
            data_assets: self.data_assets,
            data,
        })
    }
}

pub fn parse_input_frame(bytes: &[u8]) -> Result<InputFrame, Box<Diagnostic>> {
    let frame: InputFrame = serde_json::from_slice(bytes).map_err(|error| {
        Box::new(Diagnostic::error(
            "INPUT_FRAME_INVALID",
            "Invalid normalized input frame",
            error.to_string(),
        ))
    })?;
    frame.validate()?;
    Ok(frame)
}

/// Canonical EngineResult diagnostic fields, with legacy aliases during migration.
pub fn host_error(kind: &str, diagnostic: &Diagnostic) -> serde_json::Value {
    serde_json::json!({"ok": false, "value": null, "diagnostics": [diagnostic], "effects": [],
        "kind": kind, "diagnostic": diagnostic, "error": diagnostic.explanation,
        "message": diagnostic.explanation})
}

/// Scalar device events are held until released; explicit normalized frames
/// are consumed once. Mixing the two never resurrects an old pressed pointer.
#[derive(Default)]
pub struct HostInputState {
    pointer: Option<crate::PointerInput>,
    actions: BTreeMap<String, bool>,
    queued: Option<InputFrame>,
}

impl HostInputState {
    pub fn try_queue_frame(&mut self,frame:InputFrame)->Result<(),String>{
        frame.validate().map_err(|e|e.explanation.clone())?;
        if self.queued.as_ref().is_some_and(|old|old.physical.is_some()) {
            return Err("INPUT_PHYSICAL_ALREADY_QUEUED: tick the accepted batch before another input frame".into());
        }
        self.queued=Some(frame);Ok(())
    }
    pub fn queue_frame(&mut self, frame: InputFrame)->Result<(),String> {self.try_queue_frame(frame)}

    pub fn set_pointer(
        &mut self,
        position: crate::Vec2,
        down: bool,
    ) -> Result<(), Box<Diagnostic>> {
        crate::world::validate_vec2(position, "Pointer position")?;
        self.pointer = Some(crate::PointerInput {
            position,
            down,
            screen_position: None,
        });
        Ok(())
    }

    pub fn set_screen_pointer(&mut self, position: crate::Vec2) -> Result<(), Box<Diagnostic>> {
        crate::world::validate_vec2(position, "Pointer screen position")?;
        self.pointer
            .get_or_insert(crate::PointerInput {
                position: crate::Vec2::default(),
                down: false,
                screen_position: None,
            })
            .screen_position = Some(position);
        Ok(())
    }

    pub fn set_action(&mut self, name: String, down: bool) {
        self.actions.insert(name, down);
    }

    pub fn release_all(&mut self) {
        self.actions.clear();
        // Held state is released, but an accepted physical batch is a sequenced
        // transaction: dropping it here would leave the producer's cursor ahead
        // of the receipt and fail every later batch with INPUT_PHYSICAL_CURSOR.
        // Semantic UI edits (text submit, slider end) are likewise one-shot.
        if let Some(frame) = &mut self.queued {
            frame.actions.clear();
            if let Some(pointer) = &mut frame.pointer {
                pointer.down = false;
            }
            if frame.physical.is_none() && frame.ui_sliders.is_empty() && frame.ui_text_inputs.is_empty() {
                self.queued = None;
            }
        }
        if let Some(pointer) = &mut self.pointer {
            pointer.down = false;
        }
    }

    pub fn consume_frame(&mut self) -> InputFrame {
        if let Some(frame) = self.queued.take() {
            self.actions.clear();
            if let Some(pointer) = &frame.pointer {
                self.pointer = Some(pointer.clone());
            }
            if let Some(pointer) = &mut self.pointer {
                pointer.down = false;
            }
            return frame;
        }
        InputFrame {
            actions: std::mem::take(&mut self.actions),
            pointer: self.pointer.clone(),
            ..InputFrame::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn typo_payloads_and_nested_input_fail_before_running() {
        assert!(
            HostProject::parse(br#"{"config":{"name":"p","system":{}},"script":"return {}"}"#)
                .is_err()
        );
        for input in [
            r#"{"action":{}}"#,
            r#"{"pointer":{"position":{"x":1,"y":2,"z":3}}}"#,
            r#"{"actions":{" ":true}}"#,
        ] {
            assert!(parse_input_frame(input.as_bytes()).is_err(), "{input}");
        }
    }

    #[test]
    fn queued_frames_never_resurrect_held_inputs() {
        let mut input = HostInputState::default();
        input
            .set_pointer(crate::Vec2 { x: 9.0, y: 8.0 }, true)
            .unwrap();
        input.set_action("old".into(), true);
        input.queue_frame(
            parse_input_frame(br#"{"pointer":{"position":{"x":1,"y":2},"down":true}}"#).unwrap(),
        ).unwrap();
        assert!(input.consume_frame().pointer.unwrap().down);
        let next = input.consume_frame();
        assert!(next.actions.is_empty());
        let pointer = next.pointer.unwrap();
        assert!(!pointer.down);
        assert_eq!(pointer.position.x, 1.0);
        input.set_action("tap".into(), true);
        input.release_all();
        assert!(input.consume_frame().actions.is_empty());
    }

    #[test]
    fn release_all_keeps_an_accepted_physical_batch_and_releases_held_state() {
        let mut input = HostInputState::default();
        input.queue_frame(parse_input_frame(br#"{"actions":{"Fire":true},"pointer":{"position":{"x":1,"y":2},"down":true},
            "physical":{"profile":"ordered_physical_v1","epoch":1,"after_sequence":0,"through_sequence":1,
            "events":[{"sequence":1,"received_us":5,"origin":"fixture","route":"control","kind":"reset","scope":"all","reason":"load"}]}}"#).unwrap()).unwrap();
        input.release_all();
        let frame = input.consume_frame();
        assert_eq!(frame.physical.unwrap().through_sequence, 1);
        assert!(frame.actions.is_empty());
        assert!(!frame.pointer.unwrap().down);
    }

    #[test]
    fn startup_restores_save_and_tick_observation_has_completed_audio_lifecycle() {
        let bytes = serde_json::to_vec(&json!({"config":{"name":"contract",
            "systems":{"physics2d":false},"audio":{"categories":{"music":{"fade_in_frames":1}}}},"restored_save":{"credits":9},
            "script": "local Game = {} function Game.start(api) api.observation.set('saved',api.save.get()) api.audio.loop('music://test',{category='music'}) end function Game.update(api,dt) end return Game"
        })).unwrap();
        let mut runtime = HostProject::parse(&bytes).unwrap().into_runtime(7).unwrap();
        assert_eq!(
            runtime.observe().observations["saved"],
            json!({"credits":9})
        );
        let tick = runtime.tick().unwrap();
        assert_eq!(
            serde_json::to_value(&tick).unwrap(),
            serde_json::to_value(runtime.observe()).unwrap()
        );
        assert_eq!(tick.audio_loops[0].phase, crate::audio::AudioPhase::Playing);
    }
}
