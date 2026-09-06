//! What the game asked to be heard, and the rules between those sounds.
//!
//! The engine owns which sound starts, which one survives a switch, and the
//! exact frame a fading source leaves — all of it deterministic and part of the
//! observation. It does not own decoding, mixing, output devices or the
//! player's volume: those are the host's. A game that plays a different sound
//! is in a different state whether or not anything is audible, which is why
//! this is world state and not a host-side side effect.
//!
//! One-shots and loops are published differently, and that split is what keeps
//! the engine out of clip durations. A one-shot is an event that exists for the
//! frame it was fired, exactly like a contact. A loop is state with a handle
//! that lasts until something stops it, exactly like an effect. Knowing when a
//! one-shot finished would need a decoder or a duration constant the engine
//! cannot verify, so it never claims to know.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::world::Vec2;

/// A game leaking loops should fail loudly rather than grow without bound.
pub const MAX_LIVE_AUDIO_LOOPS: usize = 64;

/// Rules this build acts on. Named here so an error can list them.
pub const IMPLEMENTED_AUDIO_RULES: [&str; 4] =
    ["exclusive", "fade_in_frames", "fade_out_frames", "volume"];

fn default_volume() -> f64 {
    1.0
}

/// How a game groups its sounds, and what the engine does about the grouping.
///
/// The engine does not name `bgm` or `sfx`: the taxonomy is the game's. It owns
/// only the rules, because they decide which source survives a switch, and that
/// is world state a test asserts.
///
/// The reserved fields exist so the declaration shape does not have to change
/// when they are implemented. Declaring one is an **error**, never a silent
/// no-op: a game believing it configured something it did not is the hardest
/// kind of audio bug to find.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AudioCategory {
    /// Only one loop in this category plays at a time; starting another begins
    /// stopping the previous one.
    #[serde(default)]
    pub exclusive: bool,
    #[serde(default)]
    pub fade_in_frames: u32,
    #[serde(default)]
    pub fade_out_frames: u32,
    /// The bus level this category starts at, the way a mixer group has a
    /// volume before anything plays. A settings screen changes it at runtime.
    #[serde(default = "default_volume")]
    pub volume: f64,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_concurrent: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_limit: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ducking: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclusive_group: Option<serde_json::Value>,
}

impl Default for AudioCategory {
    fn default() -> Self {
        Self {
            exclusive: false,
            fade_in_frames: 0,
            fade_out_frames: 0,
            volume: 1.0,
            max_concurrent: None,
            on_limit: None,
            ducking: None,
            priority: None,
            exclusive_group: None,
        }
    }
}

impl AudioCategory {
    fn reserved_rule(&self) -> Option<&'static str> {
        [
            ("max_concurrent", self.max_concurrent.is_some()),
            ("on_limit", self.on_limit.is_some()),
            ("ducking", self.ducking.is_some()),
            ("priority", self.priority.is_some()),
            ("exclusive_group", self.exclusive_group.is_some()),
        ]
        .into_iter()
        .find_map(|(name, declared)| declared.then_some(name))
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AudioConfig {
    #[serde(default)]
    pub categories: BTreeMap<String, AudioCategory>,
}

impl AudioConfig {
    /// Refuse a declaration this build cannot honour.
    pub fn validate(&self) -> Result<(), String> {
        for (name, rules) in &self.categories {
            if let Some(reserved) = rules.reserved_rule() {
                return Err(format!(
                    "audio category '{name}' 宣告了 '{reserved}'：這個規則已保留名稱，但本 build 沒有實作，\
                     宣告它不會有任何效果，因此視為設定錯誤。本 build 實作的規則：{}。",
                    IMPLEMENTED_AUDIO_RULES.join("、")
                ));
            }
        }
        Ok(())
    }

    fn category(&self, name: &str) -> AudioCategory {
        self.categories.get(name).cloned().unwrap_or_default()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioEventKind {
    Play,
    Stop,
}

/// Something the game asked for on this frame. Rebuilt every frame, like a
/// contact.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AudioEvent {
    pub kind: AudioEventKind,
    pub handle: String,
    pub asset: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub volume: f64,
    pub speed: f64,
    /// `None` means the sound is not positional. The engine never computes
    /// attenuation; a host may pan on this or ignore it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<Vec2>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
    #[serde(rename = "loop")]
    pub looping: bool,
    pub frame: u64,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Bus levels a settings screen changes at runtime.
///
/// Published so a replay reproduces the same mix and a test can assert it.
/// The host multiplies a source's own volume by its category's level and the
/// master level, exactly as a mixer group does.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AudioMix {
    pub master: f64,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub categories: BTreeMap<String, f64>,
}

impl AudioMix {
    /// Whether anything has moved off the declared defaults.
    ///
    /// A game that never touches the mix keeps the observation it had, so
    /// existing digests do not change.
    pub fn is_default(&self, config: &AudioConfig) -> bool {
        self.master == 1.0
            && self
                .categories
                .iter()
                .all(|(name, level)| *level == config.category(name).volume)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioPhase {
    FadingIn,
    Playing,
    FadingOut,
}

/// A loop the host should currently be playing.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AudioLoop {
    pub handle: String,
    pub asset: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub volume: f64,
    pub speed: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<Vec2>,
    /// The entity this source is attached to, if any. The engine keeps
    /// `position` on that entity every frame and stops the loop when the
    /// entity is gone, the way a source attached to an object does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
    /// A paused loop still exists and still holds its place in a fade; it just
    /// makes no sound. This is the pause menu, not a stop.
    #[serde(skip_serializing_if = "is_false")]
    pub paused: bool,
    pub started_frame: u64,
    pub phase: AudioPhase,
    /// Frame the current phase began, and how long it lasts. A fade is frame
    /// arithmetic the engine can own exactly; the host does the gain ramp and
    /// never reports back, so a replay hears the same thing.
    pub phase_started_frame: u64,
    pub phase_frames: u32,
}

/// Options a game passes when starting a sound.
#[derive(Debug, Clone, Default)]
pub struct AudioOptions {
    pub volume: Option<f64>,
    pub speed: Option<f64>,
    pub category: Option<String>,
    pub position: Option<Vec2>,
    /// Attach the sound to an entity instead of a fixed point.
    pub entity: Option<String>,
}

impl AudioOptions {
    fn resolve(&self) -> Result<(f64, f64), String> {
        let volume = self.volume.unwrap_or(1.0);
        let speed = self.speed.unwrap_or(1.0);
        if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
            return Err(format!("audio volume 必須介於 0 與 1 之間，收到 {volume}。"));
        }
        if !speed.is_finite() || speed <= 0.0 {
            return Err(format!("audio speed 必須是大於 0 的有限數字，收到 {speed}。"));
        }
        if let Some(position) = self.position
            && (!position.x.is_finite() || !position.y.is_finite())
        {
            return Err("audio position 必須是有限數字。".to_string());
        }
        Ok((volume, speed))
    }
}

/// Everything the engine knows about sound.
#[derive(Debug, Default)]
pub struct AudioBus {
    pub config: AudioConfig,
    pub events: Vec<AudioEvent>,
    pub loops: Vec<AudioLoop>,
    master_volume: Option<f64>,
    category_volumes: BTreeMap<String, f64>,
    next_handle: u64,
}

impl AudioBus {
    /// Open a frame: the events of earlier frames have been observed and go.
    ///
    /// Events are dropped here rather than at the end of the frame that made
    /// them, so the last frame of a run is still readable afterwards — that is
    /// the frame a test asserts on. It also means a sound fired in
    /// `Game.start`, which has no tick of its own, is heard on frame 0 like any
    /// other. An event still appears in exactly one observation.
    pub fn begin_frame(&mut self, frame: u64) {
        self.events.retain(|event| event.frame >= frame);
    }

    /// Close a frame: any fade whose last frame this was is over.
    ///
    /// Retirement is frame arithmetic, so the engine decides it alone.
    pub fn end_frame(&mut self, frame: u64) {
        // A paused source does not advance through its fade; the deadline moves
        // with it, so resuming continues from where it stopped.
        for source in &mut self.loops {
            if source.paused {
                source.phase_started_frame = source.phase_started_frame.saturating_add(1);
            }
        }
        self.loops.retain(|source| {
            source.phase != AudioPhase::FadingOut
                || frame < source.phase_started_frame + u64::from(source.phase_frames)
        });
        for source in &mut self.loops {
            if source.phase == AudioPhase::FadingIn
                && frame >= source.phase_started_frame + u64::from(source.phase_frames)
            {
                source.phase = AudioPhase::Playing;
                source.phase_started_frame = frame;
                source.phase_frames = 0;
            }
        }
    }

    fn allocate_handle(&mut self) -> String {
        self.next_handle += 1;
        format!("audio-{}", self.next_handle)
    }

    /// Fire a one-shot. It exists for this frame only.
    pub fn play(
        &mut self,
        asset: &str,
        options: &AudioOptions,
        frame: u64,
    ) -> Result<String, String> {
        let (volume, speed) = self.check(asset, options)?;
        let handle = self.allocate_handle();
        self.events.push(AudioEvent {
            kind: AudioEventKind::Play,
            handle: handle.clone(),
            asset: asset.to_string(),
            category: options.category.clone(),
            volume,
            speed,
            position: options.position,
            entity: options.entity.clone(),
            looping: false,
            frame,
        });
        Ok(handle)
    }

    /// Start a loop, applying the category's rules first.
    pub fn start_loop(
        &mut self,
        asset: &str,
        options: &AudioOptions,
        frame: u64,
    ) -> Result<String, String> {
        let (volume, speed) = self.check(asset, options)?;
        let rules = options
            .category
            .as_ref()
            .map(|name| self.config.category(name))
            .unwrap_or_default();
        if rules.exclusive
            && let Some(category) = options.category.clone()
        {
            let handles: Vec<String> = self
                .loops
                .iter()
                .filter(|source| source.category.as_deref() == Some(category.as_str()))
                .filter(|source| source.phase != AudioPhase::FadingOut)
                .map(|source| source.handle.clone())
                .collect();
            for handle in handles {
                self.stop(&handle, frame);
            }
        }
        let live = self
            .loops
            .iter()
            .filter(|source| source.phase != AudioPhase::FadingOut)
            .count();
        if live >= MAX_LIVE_AUDIO_LOOPS {
            return Err(format!(
                "同時播放的 loop 不可超過 {MAX_LIVE_AUDIO_LOOPS} 個；請先用 api.audio.stop 停掉不再需要的 loop。"
            ));
        }
        let handle = self.allocate_handle();
        let fade_in = rules.fade_in_frames;
        self.loops.push(AudioLoop {
            handle: handle.clone(),
            asset: asset.to_string(),
            category: options.category.clone(),
            volume,
            speed,
            position: options.position,
            entity: options.entity.clone(),
            paused: false,
            started_frame: frame,
            phase: if fade_in > 0 {
                AudioPhase::FadingIn
            } else {
                AudioPhase::Playing
            },
            phase_started_frame: frame,
            phase_frames: fade_in,
        });
        self.events.push(AudioEvent {
            kind: AudioEventKind::Play,
            handle: handle.clone(),
            asset: asset.to_string(),
            category: options.category.clone(),
            volume,
            speed,
            position: options.position,
            entity: options.entity.clone(),
            looping: true,
            frame,
        });
        Ok(handle)
    }

    /// Stop a loop, honouring its category's fade.
    ///
    /// Reports whether the handle was playing. With a fade the source stays in
    /// the list while it fades out, so "stopped" does not mean "already silent".
    pub fn stop(&mut self, handle: &str, frame: u64) -> bool {
        let Some(index) = self
            .loops
            .iter()
            .position(|source| source.handle == handle && source.phase != AudioPhase::FadingOut)
        else {
            return false;
        };
        let fade_out = self.loops[index]
            .category
            .as_ref()
            .map(|name| self.config.category(name).fade_out_frames)
            .unwrap_or(0);
        let source = &mut self.loops[index];
        let event = AudioEvent {
            kind: AudioEventKind::Stop,
            handle: handle.to_string(),
            asset: source.asset.clone(),
            category: source.category.clone(),
            volume: source.volume,
            speed: source.speed,
            position: source.position,
            entity: source.entity.clone(),
            looping: true,
            frame,
        };
        if fade_out == 0 {
            self.loops.remove(index);
        } else {
            source.phase = AudioPhase::FadingOut;
            source.phase_started_frame = frame;
            source.phase_frames = fade_out;
        }
        self.events.push(event);
        true
    }

    /// Stop every loop, reporting how many were playing.
    pub fn stop_all(&mut self, frame: u64) -> usize {
        let handles: Vec<String> = self
            .loops
            .iter()
            .filter(|source| source.phase != AudioPhase::FadingOut)
            .map(|source| source.handle.clone())
            .collect();
        let stopped = handles.len();
        for handle in handles {
            self.stop(&handle, frame);
        }
        stopped
    }

    /// The bus levels as they stand right now.
    pub fn mix(&self) -> AudioMix {
        let mut categories: BTreeMap<String, f64> = self
            .config
            .categories
            .iter()
            .map(|(name, rules)| (name.clone(), rules.volume))
            .collect();
        for (name, level) in &self.category_volumes {
            categories.insert(name.clone(), *level);
        }
        AudioMix {
            master: self.master_volume.unwrap_or(1.0),
            categories,
        }
    }

    pub fn master_volume(&self) -> f64 {
        self.master_volume.unwrap_or(1.0)
    }

    pub fn set_master_volume(&mut self, volume: f64) -> Result<(), String> {
        self.master_volume = Some(check_volume(volume, "master")?);
        Ok(())
    }

    /// A category's current bus level.
    ///
    /// An undeclared category answers 1.0 rather than failing: a game may group
    /// sounds without declaring rules for the group, and reading a level is not
    /// where that should be caught.
    pub fn category_volume(&self, category: &str) -> f64 {
        self.category_volumes
            .get(category)
            .copied()
            .unwrap_or_else(|| self.config.category(category).volume)
    }

    pub fn set_category_volume(&mut self, category: &str, volume: f64) -> Result<(), String> {
        if category.trim().is_empty() {
            return Err("audio category 名稱不可為空。".to_string());
        }
        let volume = check_volume(volume, category)?;
        self.category_volumes.insert(category.to_string(), volume);
        Ok(())
    }

    /// Pause or resume one loop. Reports whether it changed.
    pub fn set_paused(&mut self, handle: &str, paused: bool) -> bool {
        let Some(source) = self.loops.iter_mut().find(|source| source.handle == handle) else {
            return false;
        };
        if source.paused == paused {
            return false;
        }
        source.paused = paused;
        true
    }

    /// Pause or resume every loop, reporting how many changed.
    ///
    /// This is the pause menu: the music is still there and still where it was
    /// in its fade, it just makes no sound.
    pub fn set_all_paused(&mut self, paused: bool) -> usize {
        let mut changed = 0;
        for source in &mut self.loops {
            if source.paused != paused {
                source.paused = paused;
                changed += 1;
            }
        }
        changed
    }

    /// Keep entity-attached sources on their entity, and stop the ones whose
    /// entity is gone.
    ///
    /// A source attached to something that no longer exists has no position to
    /// be at. Leaving it playing at the last place the entity stood is the
    /// behaviour nobody wants and everybody has to write around.
    pub fn follow_entities(
        &mut self,
        frame: u64,
        position_of: impl Fn(&str) -> Option<Vec2>,
    ) {
        let mut orphaned = Vec::new();
        for source in &mut self.loops {
            let Some(entity) = source.entity.clone() else {
                continue;
            };
            match position_of(&entity) {
                Some(position) => source.position = Some(position),
                None if source.phase != AudioPhase::FadingOut => orphaned.push(source.handle.clone()),
                None => {}
            }
        }
        for handle in orphaned {
            self.stop(&handle, frame);
        }
    }

    fn check(&self, asset: &str, options: &AudioOptions) -> Result<(f64, f64), String> {
        if asset.trim().is_empty() {
            return Err("audio asset 不可為空。".to_string());
        }
        options.resolve()
    }
}

fn check_volume(volume: f64, what: &str) -> Result<f64, String> {
    if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
        return Err(format!(
            "audio '{what}' 的音量必須介於 0 與 1 之間，收到 {volume}。"
        ));
    }
    Ok(volume)
}

#[cfg(test)]
mod tests {
    use super::{AudioBus, AudioConfig, AudioOptions, AudioPhase, Vec2};

    fn bus(json: serde_json::Value) -> AudioBus {
        let config: AudioConfig = serde_json::from_value(json).unwrap();
        config.validate().unwrap();
        AudioBus {
            config,
            ..AudioBus::default()
        }
    }

    fn in_category(name: &str) -> AudioOptions {
        AudioOptions {
            category: Some(name.to_string()),
            ..AudioOptions::default()
        }
    }

    #[test]
    fn a_one_shot_exists_only_for_the_frame_it_fired() {
        let mut audio = AudioBus::default();
        audio
            .play("sfx://click", &AudioOptions::default(), 1)
            .unwrap();
        assert_eq!(audio.events.len(), 1);
        assert!(audio.loops.is_empty(), "a one-shot is never a live source");

        audio.end_frame(1);
        audio.begin_frame(2);
        assert!(audio.events.is_empty(), "events do not survive their frame");
    }

    /// The rule the slot machine needs: a new track replaces the old one, and
    /// the old one leaves on an exact frame with no host reporting back.
    #[test]
    fn an_exclusive_category_fades_the_previous_track_out_on_an_exact_frame() {
        let mut audio = bus(serde_json::json!({
            "categories": { "bgm": { "exclusive": true, "fade_out_frames": 30 } }
        }));
        let first = audio
            .start_loop("music://lobby", &in_category("bgm"), 0)
            .unwrap();
        audio.end_frame(0);

        let second = audio
            .start_loop("music://game", &in_category("bgm"), 100)
            .unwrap();
        assert_ne!(first, second);
        let fading = audio
            .loops
            .iter()
            .find(|source| source.handle == first)
            .expect("the previous track is still fading, not gone");
        assert_eq!(fading.phase, AudioPhase::FadingOut);
        assert_eq!(fading.phase_started_frame, 100);
        assert_eq!(fading.phase_frames, 30);

        for frame in 100..=129 {
            audio.end_frame(frame);
        }
        assert!(
            audio.loops.iter().any(|source| source.handle == first),
            "a fade must last its full length: 30 frames from 100 means through 130"
        );
        audio.end_frame(130);
        assert!(
            !audio.loops.iter().any(|source| source.handle == first),
            "the fade ends on the exact frame the engine decided"
        );
        assert!(audio.loops.iter().any(|source| source.handle == second));
    }

    #[test]
    fn a_fade_in_becomes_playing_on_its_own() {
        let mut audio = bus(serde_json::json!({
            "categories": { "bgm": { "fade_in_frames": 10 } }
        }));
        audio
            .start_loop("music://lobby", &in_category("bgm"), 0)
            .unwrap();
        assert_eq!(audio.loops[0].phase, AudioPhase::FadingIn);
        for frame in 0..=9 {
            audio.end_frame(frame);
        }
        assert_eq!(audio.loops[0].phase, AudioPhase::FadingIn);
        audio.end_frame(10);
        assert_eq!(audio.loops[0].phase, AudioPhase::Playing);
        assert_eq!(audio.loops[0].phase_frames, 0);
    }

    #[test]
    fn handles_are_ordered_so_the_same_input_reads_the_same() {
        let mut audio = AudioBus::default();
        assert_eq!(
            audio.play("sfx://a", &AudioOptions::default(), 0).unwrap(),
            "audio-1"
        );
        assert_eq!(
            audio
                .start_loop("music://b", &AudioOptions::default(), 0)
                .unwrap(),
            "audio-2"
        );
        assert!(audio.stop("audio-2", 0));
        assert!(!audio.stop("audio-2", 0), "stopping twice reports false");
        assert_eq!(audio.stop_all(0), 0);
    }

    #[test]
    fn bad_values_are_refused_and_change_nothing() {
        let mut audio = AudioBus::default();
        for options in [
            AudioOptions {
                volume: Some(1.5),
                ..AudioOptions::default()
            },
            AudioOptions {
                speed: Some(0.0),
                ..AudioOptions::default()
            },
        ] {
            assert!(audio.play("sfx://x", &options, 0).is_err());
        }
        assert!(audio.play("  ", &AudioOptions::default(), 0).is_err());
        assert!(
            audio.events.is_empty() && audio.loops.is_empty(),
            "a refused call must leave no trace"
        );
        assert!(
            audio
                .start_loop("music://x", &AudioOptions::default(), 0)
                .is_ok()
        );
    }

    #[test]
    fn the_loop_limit_is_refused_rather_than_grown_past() {
        let mut audio = AudioBus::default();
        for _ in 0..super::MAX_LIVE_AUDIO_LOOPS {
            audio
                .start_loop("music://x", &AudioOptions::default(), 0)
                .unwrap();
        }
        let error = audio
            .start_loop("music://x", &AudioOptions::default(), 0)
            .unwrap_err();
        assert!(error.contains("api.audio.stop"), "{error}");
    }

    /// Every settings screen has these sliders, and a replay has to reproduce
    /// them, so the mix is state rather than a host-side preference.
    #[test]
    fn bus_levels_are_engine_state_and_only_appear_once_changed() {
        let mut audio = bus(serde_json::json!({
            "categories": { "bgm": { "volume": 0.5 } }
        }));
        assert!(
            audio.mix().is_default(&audio.config),
            "a game that changed nothing must not change its observation"
        );
        assert_eq!(audio.category_volume("bgm"), 0.5, "the declared level");
        assert_eq!(audio.category_volume("sfx"), 1.0, "an undeclared category");

        audio.set_category_volume("bgm", 0.2).unwrap();
        audio.set_master_volume(0.8).unwrap();
        let mix = audio.mix();
        assert!(!mix.is_default(&audio.config));
        assert_eq!(mix.master, 0.8);
        assert_eq!(mix.categories.get("bgm").copied(), Some(0.2));

        assert!(audio.set_master_volume(1.5).is_err());
        assert!(audio.set_category_volume("", 0.5).is_err());
        assert_eq!(audio.mix().master, 0.8, "a refused change leaves the mix alone");
    }

    /// Pausing must not consume the fade, or leaving a pause menu jumps the
    /// music to wherever the fade would have got to on its own.
    #[test]
    fn a_paused_loop_holds_its_place_in_a_fade() {
        let mut audio = bus(serde_json::json!({
            "categories": { "bgm": { "fade_in_frames": 10 } }
        }));
        let handle = audio
            .start_loop("music://lobby", &in_category("bgm"), 0)
            .unwrap();
        for frame in 0..=4 {
            audio.end_frame(frame);
        }
        assert!(audio.set_paused(&handle, true));
        assert!(!audio.set_paused(&handle, true), "already paused");
        for frame in 5..=100 {
            audio.end_frame(frame);
        }
        assert_eq!(
            audio.loops[0].phase,
            AudioPhase::FadingIn,
            "a paused fade must not run out on its own"
        );
        assert!(audio.set_paused(&handle, false));
        for frame in 101..=105 {
            audio.end_frame(frame);
        }
        assert_eq!(
            audio.loops[0].phase,
            AudioPhase::FadingIn,
            "5 of the 6 remaining frames is still not the whole fade"
        );
        audio.end_frame(106);
        assert_eq!(
            audio.loops[0].phase,
            AudioPhase::Playing,
            "the fade finishes after exactly the frames it had left"
        );
        assert_eq!(audio.set_all_paused(true), 1);
        assert_eq!(audio.set_all_paused(true), 0);
    }

    /// A source attached to something that no longer exists has no position to
    /// be at, so the engine stops it instead of leaving it where the entity was.
    #[test]
    fn an_attached_loop_follows_its_entity_and_stops_when_it_is_gone() {
        let mut audio = AudioBus::default();
        audio
            .start_loop(
                "sfx://engine",
                &AudioOptions {
                    entity: Some("car".to_string()),
                    ..AudioOptions::default()
                },
                0,
            )
            .unwrap();
        audio.end_frame(0);
        audio.begin_frame(1);

        audio.follow_entities(1, |id| {
            (id == "car").then_some(Vec2 { x: 3.0, y: 1.0 })
        });
        assert_eq!(audio.loops[0].position, Some(Vec2 { x: 3.0, y: 1.0 }));
        assert!(audio.events.is_empty());

        audio.end_frame(1);
        audio.begin_frame(2);
        audio.follow_entities(2, |_| None);
        assert!(audio.loops.is_empty(), "the loop leaves with its entity");
        assert_eq!(audio.events.len(), 1, "and says so");
        assert_eq!(audio.events[0].kind, super::AudioEventKind::Stop);
    }

    /// A rule this build does not act on must be refused, never ignored.
    #[test]
    fn a_reserved_rule_is_refused_and_says_what_is_implemented() {
        let config: AudioConfig = serde_json::from_value(serde_json::json!({
            "categories": { "sfx": { "max_concurrent": 4 } }
        }))
        .unwrap();
        let error = config.validate().unwrap_err();
        assert!(error.contains("max_concurrent"), "{error}");
        assert!(error.contains("fade_out_frames"), "{error}");
    }

    /// An unknown rule is a typo, and a typo that silently does nothing is the
    /// same failure as a reserved one.
    #[test]
    fn an_unknown_rule_is_refused_at_parse_time() {
        let parsed: Result<AudioConfig, _> = serde_json::from_value(serde_json::json!({
            "categories": { "sfx": { "revrb": true } }
        }));
        assert!(parsed.is_err(), "unknown rules must not parse");
    }
}
