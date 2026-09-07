//! Generated structural contracts. Runtime validators remain authoritative for
//! constraints involving values, file contents, cross-references and host capabilities.
use serde_json::Value;

pub const SCHEMA_NAMES: &[&str] = &[
    "project",
    "scene",
    "test",
    "asset",
    "bundle",
    "particle",
    "input",
    "host-project",
    "developer",
];

pub fn contract_schema(name: &str) -> Option<Value> {
    let schema = match name {
        "project" => schemars::schema_for!(crate::ProjectConfig),
        "scene" => schemars::schema_for!(crate::SceneFile),
        "test" => schemars::schema_for!(crate::TestSpec),
        "particle" => schemars::schema_for!(crate::ParticleDefinition),
        "bundle" => schemars::schema_for!(crate::BundleManifest),
        "asset" => schemars::schema_for!(crate::AssetManifest),
        "input" => schemars::schema_for!(crate::InputFrame),
        "host-project" => schemars::schema_for!(crate::HostProject),
        "developer" => schemars::schema_for!(crate::DeveloperRequest),
        _ => return None,
    };
    let mut value = serde_json::to_value(schema).expect("schema serializes");
    if name == "developer" {
        value["type"] = serde_json::json!("object");
    }
    value["$id"] = serde_json::json!(format!("https://unone.dev/schema/{name}.schema.json"));
    value["$comment"] = serde_json::json!(
        "Generated from Rust deserialization types by game schema. Do not edit. Runtime semantic validators additionally check ranges, references, formats and capabilities."
    );
    Some(value)
}

#[cfg(test)]
mod tests {
    #[test]
    fn checked_in_schemas_match_runtime_types() {
        let docs = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs");
        for name in super::SCHEMA_NAMES {
            let path = docs.join(format!("{name}.schema.json"));
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|_| panic!("Generate {} with game schema", path.display()));
            let saved: serde_json::Value = serde_json::from_str(&text).unwrap();
            assert_eq!(
                saved,
                super::contract_schema(name).unwrap(),
                "Stale {name} schema; regenerate with game schema"
            );
        }
    }
}
