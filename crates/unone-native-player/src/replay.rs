//! File-backed normalized input replay for host tests. No game controls live here.
use serde::de::{Error, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fmt, fs::File, io::Read, path::Path};
use unone_engine::InputFrame;

const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_FRAMES: usize = 60_000;

pub(crate) fn declaration() -> Value {
    json!({"contract":"unone.native-input-replay.v1", "argument":"--input-sequence",
        "format":"JSON array of normalized unone_engine::InputFrame", "max_bytes":MAX_BYTES,
        "max_frames":MAX_FRAMES, "live_input":false,
        "initial_window_focus":"disabled_on_windows",
        "requires":["--fixed-tick","--warmup 0","--prewarm-ticks 0","--frames N>0"],
        "incompatible":["--freeze-simulation","nonzero --seconds"],
        "exhaustion":"empty input each subsequent simulation tick"})
}

pub(crate) fn validate_options(
    fixed_tick: bool, warmup: u64, prewarm_ticks: u64, freeze: bool,
    frames: u64, seconds: f64,
) -> Result<(), String> {
    if !fixed_tick || warmup != 0 || prewarm_ticks != 0 || freeze || frames == 0 || seconds != 0.0 {
        return Err("NATIVE_INPUT_SEQUENCE_OPTIONS: require --fixed-tick --warmup 0 --prewarm-ticks 0 --frames N>0; --freeze-simulation and nonzero --seconds are incompatible".into());
    }
    Ok(())
}

struct Frames(Vec<InputFrame>);
impl<'de> Deserialize<'de> for Frames {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct FrameVisitor;
        impl<'de> Visitor<'de> for FrameVisitor {
            type Value = Frames;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("an array of at most 60000 normalized InputFrame objects")
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Frames, A::Error> {
                let mut frames = Vec::new();
                while let Some(frame) = sequence.next_element::<InputFrame>()? {
                    if frames.len() >= MAX_FRAMES {
                        return Err(A::Error::custom("NATIVE_INPUT_SEQUENCE_LIMIT: at most 60000 frames"));
                    }
                    frame.validate().map_err(|error| A::Error::custom(format!(
                        "NATIVE_INPUT_SEQUENCE_FRAME_INVALID: frame {}: {}", frames.len(), error.explanation
                    )))?;
                    if frame.actions.len() > 256 || frame.actions.keys().any(|key| key.len() > 1024) {
                        return Err(A::Error::custom("NATIVE_INPUT_SEQUENCE_FRAME_LIMIT: at most 256 actions and 1024 UTF-8 bytes per action name"));
                    }
                    frames.push(frame);
                }
                Ok(Frames(frames))
            }
        }
        deserializer.deserialize_seq(FrameVisitor)
    }
}

pub(crate) struct InputSequence {
    frames: Vec<InputFrame>,
    sha256: String,
    applied_frames: usize,
    ticks: u64,
}

impl InputSequence {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|error| format!("NATIVE_INPUT_SEQUENCE_READ: {error}"))?;
        let mut bytes = Vec::new();
        file.take(MAX_BYTES as u64 + 1).read_to_end(&mut bytes)
            .map_err(|error| format!("NATIVE_INPUT_SEQUENCE_READ: {error}"))?;
        Self::parse(&bytes)
    }

    fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_BYTES {
            return Err("NATIVE_INPUT_SEQUENCE_LIMIT: file exceeds 8 MiB".into());
        }
        let Frames(frames) = serde_json::from_slice(bytes)
            .map_err(|error| format!("NATIVE_INPUT_SEQUENCE_INVALID: {error}"))?;
        Ok(Self { frames, sha256: format!("{:x}", Sha256::digest(bytes)), applied_frames: 0, ticks: 0 })
    }

    /// Read without consuming. Commit only after the engine tick succeeds.
    pub(crate) fn frame(&self) -> InputFrame {
        self.frames.get(self.applied_frames).cloned().unwrap_or_default()
    }

    pub(crate) fn applied(&mut self) {
        self.applied_frames = (self.applied_frames + 1).min(self.frames.len());
        self.ticks += 1;
    }

    pub(crate) fn report(&self) -> Value {
        json!({
            "contract":"unone.native-input-replay.v1", "sha256":self.sha256,
            "frame_count":self.frames.len(), "applied_frames":self.applied_frames,
            "simulation_ticks":self.ticks,
            "empty_frames_after_sequence":self.ticks.saturating_sub(self.frames.len() as u64),
            "exhausted":self.applied_frames == self.frames.len(),
            "live_input":false, "sequence_index_0_simulation_frame":1,
            "evidence":"Normalized input replay is simulation evidence. Visual evidence also requires successful native GPU rendering and inspected captures; headless never emits readiness."
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_is_not_consumed_until_success_and_exhaustion_releases_held_state() {
        let mut sequence = InputSequence::parse(br#"[{"actions":{"Move":true}},{}]"#).unwrap();
        assert!(sequence.frame().actions["Move"]);
        assert!(sequence.frame().actions["Move"]);
        assert_eq!(sequence.report()["applied_frames"], 0);
        sequence.applied();
        assert!(sequence.frame().actions.is_empty());
        sequence.applied();
        assert!(sequence.frame().actions.is_empty());
        sequence.applied();
        assert_eq!(sequence.report()["applied_frames"], 2);
        assert_eq!(sequence.report()["simulation_ticks"], 3);
        assert_eq!(sequence.report()["empty_frames_after_sequence"], 1);
        assert_eq!(sequence.report()["exhausted"], true);
    }

    #[test]
    fn malformed_unknown_and_semantically_invalid_frames_fail() {
        for bytes in [
            br#"{}"#.as_slice(), br#"[{"typo":true}]"#, br#"[{"actions":{"A":1}}]"#,
            br#"[{"actions":{" ":true}}]"#, br#"[{"pointer":{"position":{"x":1e999,"y":0}}}]"#,
            br#"[{"ui_sliders":{"s":{"phase":"drag","ratio":2}}}]"#, br#"[{}] trailing"#,
        ] {
            assert!(InputSequence::parse(bytes).is_err());
        }
        let many = vec![json!({}); MAX_FRAMES + 1];
        assert!(InputSequence::parse(&serde_json::to_vec(&many).unwrap()).err().unwrap().contains("60000"));
    }

    #[test]
    fn byte_limit_and_exact_raw_file_digest_are_enforced() {
        assert!(InputSequence::parse(&vec![b' '; MAX_BYTES + 1]).is_err());
        let sequence = InputSequence::parse(b"[]\n").unwrap();
        assert_eq!(sequence.report()["sha256"], format!("{:x}", Sha256::digest(b"[]\n")));
        assert!(sequence.frame().actions.is_empty());
    }

    #[test]
    fn replay_options_cannot_silently_skip_or_prewarm_frames() {
        assert!(validate_options(true, 0, 0, false, 1, 0.0).is_ok());
        for options in [(false,0,0,false,1,0.), (true,1,0,false,1,0.),
            (true,0,1,false,1,0.), (true,0,0,true,1,0.),
            (true,0,0,false,0,0.), (true,0,0,false,1,1.)] {
            assert!(validate_options(options.0, options.1, options.2, options.3, options.4, options.5).is_err());
        }
    }

    #[test]
    fn headless_kernel_replay_preserves_press_hold_release_and_frame_numbering() {
        let project = json!({"config":{"name":"native-replay-test","entry_script":"main.luau",
            "systems":{"physics2d":false,"physics3d":false}},"scene":{"entities":[]},
            "script":r#"
local history={}
return {start=function(api)
    assert(not api.input.isDown('A'))
end,update=function(api)
    table.insert(history,{api.input.isDown('A'),api.input.wasPressed('A'),api.input.wasReleased('A')})
    api.observation.set('history',history)
end}
"#});
        let mut runtime = unone_engine::HostProject::parse(&serde_json::to_vec(&project).unwrap())
            .unwrap().into_runtime(42).unwrap();
        let mut sequence = InputSequence::parse(br#"[{"actions":{"A":true}},{"actions":{"A":true}},{}]"#).unwrap();
        for _ in 0..5 {
            runtime.tick_with_input(&sequence.frame()).unwrap();
            sequence.applied();
        }
        assert_eq!(runtime.observe().frame, 5);
        assert_eq!(runtime.observe().observations["history"], json!([
            [true,true,false], [true,false,false], [false,false,true],
            [false,false,false], [false,false,false]
        ]));
        assert_eq!(sequence.report()["applied_frames"], 3);
        assert_eq!(sequence.report()["empty_frames_after_sequence"], 2);
    }
}
