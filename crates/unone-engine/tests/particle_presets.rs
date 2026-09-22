use std::{fs, path::PathBuf};

use serde::Deserialize;
use unone_engine::ParticleDefinition;

#[derive(Deserialize)]
struct PresetIndex {
    presets: Vec<Preset>,
}

#[derive(Deserialize)]
struct Preset {
    file: String,
}

#[test]
fn particle_lab_presets_are_registered_and_valid_particle_definitions() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/particle-lab/presets");
    let index: PresetIndex =
        serde_json::from_slice(&fs::read(root.join("index.json")).unwrap()).unwrap();
    assert!(!index.presets.is_empty());
    for preset in index.presets {
        assert!(!preset.file.contains('/') && !preset.file.contains('\\'));
        let definition: ParticleDefinition =
            serde_json::from_slice(&fs::read(root.join(preset.file)).unwrap()).unwrap();
        definition.validate().unwrap();
    }
}
