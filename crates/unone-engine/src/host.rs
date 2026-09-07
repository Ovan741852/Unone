//! Shared host ingestion contract. Platform adapters own transport and storage,
//! never a separate interpretation of game configuration or replay input.
use crate::{AudioConfig, Diagnostic, EngineRuntime, InputFrame, SourceProject};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct HostProject {
    pub project: String,
    pub script: String,
    // Preserve original JSON locations for the common scene validator.
    #[serde(default)]
    #[cfg_attr(feature = "dev-tools", schemars(with = "Option<crate::SceneFile>"))]
    pub scene: Option<Box<serde_json::value::RawValue>>,
    #[serde(default)]
    pub systems: BTreeMap<String, bool>,
    #[serde(default)]
    pub audio: Option<AudioConfig>,
    /// Restored state is available in Game.start, never injected after startup.
    #[serde(default)]
    pub restored_save: Option<serde_json::Value>,
    /// UI viewport aspect, supplied before Game.start; defaults to 16:9.
    #[serde(default)]
    pub viewport_aspect: Option<f64>,
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
        let scene = self
            .scene
            .as_deref()
            .map(|raw| crate::parse_scene_fragment(raw.get()))
            .transpose()?;
        EngineRuntime::load_source_project(SourceProject {
            name: self.project,
            script_name: "main.luau".into(),
            source: self.script,
            scene,
            seed,
            systems: self.systems,
            audio: self.audio,
            restored_save: self.restored_save,
            viewport_aspect: self.viewport_aspect,
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
    pub fn queue_frame(&mut self, frame: InputFrame) {
        self.queued = Some(frame);
    }

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
        self.queued = None;
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
            HostProject::parse(br#"{"project":"p","script":"return {}","system":{}}"#).is_err()
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
        );
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
    fn startup_restores_save_and_tick_observation_has_completed_audio_lifecycle() {
        let bytes = serde_json::to_vec(&json!({"project":"contract", "restored_save":{"credits":9},
            "systems":{"physics2d":false},"audio":{"categories":{"music":{"fade_in_frames":1}}},
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
