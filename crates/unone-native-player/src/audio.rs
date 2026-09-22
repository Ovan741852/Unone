//! Native audio adapter.
//!
//! The engine decides which sounds exist. This module only decodes the
//! verified asset bytes and drives the host output device.

use std::{
    collections::{BTreeMap, BTreeSet},
    io::Cursor,
};

use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};
use serde_json::Value;
use unone_engine::{AudioPhase, WorldSnapshot};

use crate::Package;

pub struct NativeAudio {
    stream: Option<MixerDeviceSink>,
    assets: BTreeMap<String, Vec<u8>>,
    declared_levels: BTreeMap<String, f32>,
    loops: BTreeMap<String, Player>,
    one_shots: Vec<Player>,
    failures: Vec<String>,
    unavailable: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::NativeAudio;
    use std::collections::BTreeMap;
    use unone_engine::AudioPhase;

    #[test]
    fn fade_gain_is_frame_deterministic() {
        let snapshot = unone_engine::WorldSnapshot {
            jobs: None,
            instances3d: Default::default(),
            physics3d: None,
            particle_effects: Default::default(),
            particles: Vec::new(),
            frame: 5,
            time_seconds: 0.0,
            camera: Default::default(),
            camera3d: None,
            entities: Default::default(),
            observations: Default::default(),
            ui: None,
            effects: Vec::new(),
            contacts: Vec::new(),
            ground_contacts: Vec::new(),
            audio_events: Vec::new(),
            audio_loops: Vec::new(),
            audio_mix: None,
        };
        assert_eq!(
            NativeAudio::phase_gain(&snapshot, AudioPhase::FadingIn, 0, 10),
            0.5
        );
        assert_eq!(
            NativeAudio::phase_gain(&snapshot, AudioPhase::FadingOut, 0, 10),
            0.5
        );
        assert_eq!(
            NativeAudio::phase_gain(&snapshot, AudioPhase::Playing, 0, 0),
            1.0
        );
    }

    #[test]
    fn verified_pcm_wav_decodes_without_an_output_device() {
        // A decoder test must not depend on the CI machine having speakers.
        let mut wav = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00".to_vec();
        wav.extend_from_slice(&[]);
        let mut audio = NativeAudio {
            stream: None,
            assets: BTreeMap::from([(String::from("audio://tone"), wav)]),
            declared_levels: BTreeMap::new(),
            loops: BTreeMap::new(),
            one_shots: Vec::new(),
            failures: Vec::new(),
            unavailable: None,
        };
        assert!(audio.decode("audio://tone", false).is_ok());
        let error = match audio.decode("audio://missing", false) {
            Ok(_) => panic!("missing asset must fail closed"),
            Err(error) => error,
        };
        assert!(error.contains("NATIVE_AUDIO_ASSET_MISSING"));
    }
}

impl NativeAudio {
    pub fn new(package: &Package) -> Self {
        let mut audio = Self {
            stream: None,
            assets: BTreeMap::new(),
            declared_levels: BTreeMap::new(),
            loops: BTreeMap::new(),
            one_shots: Vec::new(),
            failures: Vec::new(),
            unavailable: None,
        };
        if let Err(error) = audio.load_assets(package) {
            audio.failures.push(error);
        }
        audio.load_declared_levels(package);
        if audio.assets.is_empty() {
            return audio;
        }
        match DeviceSinkBuilder::open_default_sink() {
            Ok(stream) => audio.stream = Some(stream),
            Err(error) => {
                audio.unavailable = Some(format!("native output device unavailable: {error}"))
            }
        }
        audio
    }

    fn load_assets(&mut self, package: &Package) -> Result<(), String> {
        let bytes = package
            .get("content/assets.json")
            .map_err(|_| "NATIVE_AUDIO_ASSET_MANIFEST_MISSING".to_string())?;
        let manifest: Value = serde_json::from_slice(bytes)
            .map_err(|error| format!("NATIVE_AUDIO_ASSET_MANIFEST_INVALID: {error}"))?;
        for asset in manifest["assets"].as_array().into_iter().flatten() {
            if asset["kind"].as_str() != Some("audio") {
                continue;
            }
            let id = asset["id"]
                .as_str()
                .ok_or("NATIVE_AUDIO_ASSET_ID_MISSING")?;
            let source = asset["source"]
                .as_str()
                .ok_or("NATIVE_AUDIO_ASSET_SOURCE_MISSING")?;
            self.assets.insert(
                id.to_string(),
                package.get(&format!("content/{source}"))?.to_vec(),
            );
        }
        Ok(())
    }

    fn load_declared_levels(&mut self, package: &Package) {
        let Ok(bytes) = package.get("content/project.json") else {
            return;
        };
        let Ok(project) = serde_json::from_slice::<Value>(bytes) else {
            return;
        };
        let Some(categories) = project["config"]["audio"]["categories"].as_object() else {
            return;
        };
        for (name, value) in categories {
            if let Some(level) = value["volume"].as_f64().filter(|level| level.is_finite()) {
                self.declared_levels
                    .insert(name.clone(), level.clamp(0.0, 1.0) as f32);
            }
        }
    }

    fn sink(&self) -> Option<Player> {
        self.stream
            .as_ref()
            .map(|stream| Player::connect_new(stream.mixer()))
    }

    fn decode(
        &mut self,
        asset: &str,
        looping: bool,
    ) -> Result<Box<dyn Source<Item = f32> + Send>, String> {
        let bytes = self
            .assets
            .get(asset)
            .cloned()
            .ok_or_else(|| format!("NATIVE_AUDIO_ASSET_MISSING: {asset}"))?;
        let decoder = Decoder::try_from(Cursor::new(bytes))
            .map_err(|error| format!("NATIVE_AUDIO_DECODE_FAILED: {asset}: {error}"))?;
        if looping {
            Ok(Box::new(decoder.repeat_infinite()))
        } else {
            Ok(Box::new(decoder))
        }
    }

    fn bus_gain(
        snapshot: &WorldSnapshot,
        category: Option<&str>,
        declared_levels: &BTreeMap<String, f32>,
    ) -> f32 {
        let Some(mix) = snapshot.audio_mix.as_ref() else {
            return category
                .and_then(|name| declared_levels.get(name).copied())
                .unwrap_or(1.0);
        };
        let category_gain = category
            .and_then(|name| mix.categories.get(name))
            .copied()
            .or_else(|| {
                category.and_then(|name| declared_levels.get(name).map(|value| *value as f64))
            })
            .unwrap_or(1.0);
        (mix.master * category_gain).clamp(0.0, 1.0) as f32
    }

    fn phase_gain(snapshot: &WorldSnapshot, phase: AudioPhase, started: u64, frames: u32) -> f32 {
        if frames == 0 {
            return 1.0;
        }
        let elapsed = snapshot
            .frame
            .saturating_sub(started)
            .min(u64::from(frames)) as f32;
        let progress = elapsed / frames as f32;
        match phase {
            AudioPhase::FadingIn => progress,
            AudioPhase::FadingOut => 1.0 - progress,
            AudioPhase::Playing => 1.0,
        }
    }

    fn update_loop(&mut self, source: &unone_engine::AudioLoop, snapshot: &WorldSnapshot) {
        let Some(sink) = self.loops.get(&source.handle) else {
            return;
        };
        let gain = source.volume as f32
            * Self::bus_gain(snapshot, source.category.as_deref(), &self.declared_levels)
            * Self::phase_gain(
                snapshot,
                source.phase,
                source.phase_started_frame,
                source.phase_frames,
            );
        sink.set_volume(gain.clamp(0.0, 1.0));
        sink.set_speed(source.speed as f32);
        if source.paused {
            sink.pause();
        } else {
            sink.play();
        }
    }

    fn start_loop(&mut self, source: &unone_engine::AudioLoop, snapshot: &WorldSnapshot) {
        if self.loops.contains_key(&source.handle) || self.stream.is_none() {
            return;
        }
        let Some(sink) = self.sink() else {
            return;
        };
        match self.decode(&source.asset, true) {
            Ok(decoded) => {
                sink.append(decoded);
                sink.set_speed(source.speed as f32);
                self.loops.insert(source.handle.clone(), sink);
                self.update_loop(source, snapshot);
            }
            Err(error) => self.failures.push(error),
        }
    }

    pub fn sync(&mut self, snapshot: &WorldSnapshot) {
        self.one_shots.retain(|sink| !sink.empty());
        if self.stream.is_none() {
            return;
        }
        for event in &snapshot.audio_events {
            match event.kind {
                unone_engine::AudioEventKind::Stop => {
                    if let Some(sink) = self.loops.remove(&event.handle) {
                        sink.stop();
                    }
                }
                unone_engine::AudioEventKind::Play if !event.looping => {
                    let Some(sink) = self.sink() else {
                        continue;
                    };
                    match self.decode(&event.asset, false) {
                        Ok(decoded) => {
                            sink.append(decoded);
                            sink.set_volume(
                                (event.volume as f32
                                    * Self::bus_gain(
                                        snapshot,
                                        event.category.as_deref(),
                                        &self.declared_levels,
                                    ))
                                .clamp(0.0, 1.0),
                            );
                            sink.set_speed(event.speed as f32);
                            self.one_shots.push(sink);
                        }
                        Err(error) => self.failures.push(error),
                    }
                }
                unone_engine::AudioEventKind::Play => {}
            }
        }
        let live: BTreeSet<_> = snapshot
            .audio_loops
            .iter()
            .map(|source| source.handle.clone())
            .collect();
        let old: Vec<_> = self
            .loops
            .keys()
            .filter(|handle| !live.contains(*handle))
            .cloned()
            .collect();
        for handle in old {
            if let Some(sink) = self.loops.remove(&handle) {
                sink.stop();
            }
        }
        for source in &snapshot.audio_loops {
            self.start_loop(source, snapshot);
            self.update_loop(source, snapshot);
        }
    }

    pub fn pause(&self) {
        for sink in self.loops.values() {
            sink.pause();
        }
    }

    pub fn resume(&self) {
        for sink in self.loops.values() {
            sink.play();
        }
    }

    pub fn report(&self) -> Value {
        serde_json::json!({
            "available": self.stream.is_some(),
            "declared_assets": self.assets.len(),
            "live": self.loops.keys().collect::<Vec<_>>(),
            "failures": self.failures,
            "unavailable": self.unavailable,
        })
    }
}
