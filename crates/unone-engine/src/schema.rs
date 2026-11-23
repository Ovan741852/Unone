//! Generated structural contracts. Runtime validators remain authoritative for
//! constraints involving values, file contents, cross-references and host capabilities.
use serde_json::Value;

/// Authoring shape for player.image-assets.json. Publisher/broker validation
/// additionally checks catalog kinds, UTF-8 byte bounds, scene references,
/// image encoding, startup-group membership and the total encoded size.
#[allow(dead_code)]
#[derive(schemars::JsonSchema, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ImageAssetsPlanSchema {
    version: u32,
    groups: std::collections::BTreeMap<String, Vec<String>>,
    startup: Vec<String>,
    budget: Option<ImageAssetsBudgetSchema>,
    dimensions: Option<std::collections::BTreeMap<String, ImageAssetsDimensionsSchema>>,
    defer_scene_assets: Option<Vec<String>>,
}
#[allow(dead_code)]
#[derive(schemars::JsonSchema, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ImageAssetsBudgetSchema { max_bytes: Option<u64>, max_entries: Option<u32> }
#[allow(dead_code)]
#[derive(schemars::JsonSchema, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ImageAssetsDimensionsSchema { format: String, width: u32, height: u32 }

pub const SCHEMA_NAMES: &[&str] = &[
    "ui",
    "project",
    "scene",
    "test",
    "asset",
    "image-assets",
    "bundle",
    "particle",
    "shader",
    "mesh",
    "heightfield",
    "heightfield-patch",
    "input",
    "host-project",
    "developer",
    "preview-request",
    "debug-control",
    "debug-tab",
    "body3d",
    "ray3d",
    "cast3d",
    "overlap3d",
    "joint3d",
];

pub fn contract_schema(name: &str) -> Option<Value> {
    let schema = match name {
        "ui" => schemars::schema_for!(crate::ui::RawUiTree),
        "project" => schemars::schema_for!(crate::ProjectConfig),
        "scene" => schemars::schema_for!(crate::SceneFile),
        "test" => schemars::schema_for!(crate::TestSpec),
        "mesh" => schemars::schema_for!(crate::MeshAsset),
        "heightfield" => schemars::schema_for!(crate::HeightfieldDefinition),
        "heightfield-patch" => schemars::schema_for!(crate::HeightfieldPatch),
        "particle" => schemars::schema_for!(crate::ParticleDefinition),
        "shader" => schemars::schema_for!(crate::ShaderMaterialDefinition),
        "bundle" => schemars::schema_for!(crate::BundleManifest),
        "asset" => schemars::schema_for!(crate::AssetManifest),
        "image-assets" => schemars::schema_for!(ImageAssetsPlanSchema),
        "input" => schemars::schema_for!(crate::InputFrame),
        "host-project" => schemars::schema_for!(crate::HostProject),
        "developer" => schemars::schema_for!(crate::DeveloperRequest),
        "preview-request" => schemars::schema_for!(crate::PreviewRequest),
        "debug-control" => schemars::schema_for!(crate::DebugControl),
        "debug-tab" => schemars::schema_for!(crate::DebugTab),
        "body3d" => schemars::schema_for!(crate::rigid3d::Body3D),
        "ray3d" => schemars::schema_for!(crate::rigid3d::Ray3D),
        "cast3d" => schemars::schema_for!(crate::rigid3d::Cast3D),
        "overlap3d" => schemars::schema_for!(crate::rigid3d::Overlap3D),
        "joint3d" => schemars::schema_for!(crate::rigid3d::Joint3D),
        _ => return None,
    };
    let mut value = serde_json::to_value(schema).expect("schema serializes");
    if name == "image-assets" {
        value["properties"]["version"]["const"] = serde_json::json!(1);
        value["properties"]["defer_scene_assets"]["maxItems"] = serde_json::json!(4096);
        value["properties"]["defer_scene_assets"]["type"] = serde_json::json!("array");
        value["properties"]["defer_scene_assets"]["uniqueItems"] = serde_json::json!(true);
        value["properties"]["dimensions"]["type"] = serde_json::json!("object");
        value["properties"]["budget"] = serde_json::json!({"$ref":"#/$defs/ImageAssetsBudgetSchema"});
        for (key,max) in [("max_bytes",1_073_741_824u64),("max_entries",65_536u64)] {
            let field = &mut value["$defs"]["ImageAssetsBudgetSchema"]["properties"][key];
            field["type"] = serde_json::json!("integer"); field["minimum"] = serde_json::json!(1); field["maximum"] = serde_json::json!(max);
        }
        for key in ["width","height"] {
            let field = &mut value["$defs"]["ImageAssetsDimensionsSchema"]["properties"][key];
            field["minimum"] = serde_json::json!(1); field["maximum"] = serde_json::json!(65_536);
        }
        value["$defs"]["ImageAssetsDimensionsSchema"]["properties"]["format"]["enum"] = serde_json::json!(["png","jpeg","webp"]);
        value["x-unone-validation"] = serde_json::json!("Publisher and Web broker validate declared texture IDs and scene-sprite usage; startup groups take precedence over deferral.");
    }
    if name == "developer" {
        value["type"] = serde_json::json!("object");
    }
    if name == "ui" {
        let contract = crate::ui::ui_contract();
        value["x-unone-ui-contract"] = serde_json::to_value(contract).unwrap();
        value["$defs"]["UiBudget"]["properties"]["max_nodes"]["minimum"] = serde_json::json!(1);
        value["$defs"]["UiBudget"]["properties"]["max_nodes"]["maximum"] =
            serde_json::json!(contract.host_max_nodes);
        value["properties"]["children"]["maxItems"] = serde_json::json!(contract.host_max_nodes);
        value["$defs"]["RawUiNode"]["properties"]["quads"]["minItems"] = serde_json::json!(1);
        value["$defs"]["RawUiNode"]["properties"]["quads"]["maxItems"] = serde_json::json!(contract.host_max_nodes - 1);
        value["$defs"]["RawUiNode"]["properties"]["pixel_snap"]["default"] = serde_json::json!(false);
        value["$defs"]["RawUiNode"]["properties"]["decorative_overlay"]["default"] = serde_json::json!(false);
        // Omission is permitted, explicit null is rejected by the parser.
        value["$defs"]["RawUiNode"]["properties"]["render_role"].as_object_mut().unwrap().remove("default");
        value["$defs"]["UiImageQuad"]["properties"]["asset"]["minLength"] = serde_json::json!(1);
        value["$defs"]["UiImageQuad"]["properties"]["opacity"]["minimum"] = serde_json::json!(0);
        value["$defs"]["UiImageQuad"]["properties"]["opacity"]["maximum"] = serde_json::json!(1);
        for field in ["font_size", "border_width", "border_radius"] {
            value["$defs"]["UiStyle"]["properties"][field]["maximum"] = serde_json::json!(100);
            let bound = if field == "font_size" { "exclusiveMinimum" } else { "minimum" };
            value["$defs"]["UiStyle"]["properties"][field][bound] = serde_json::json!(0);
        }
        for (field, minimum, maximum) in [("font_weight", 100.0, 900.0), ("line_height", 0.5, 4.0), ("letter_spacing", -10.0, 10.0), ("opacity", 0.0, 1.0)] {
            value["$defs"]["UiStyle"]["properties"][field]["minimum"] = serde_json::json!(minimum);
            value["$defs"]["UiStyle"]["properties"][field]["maximum"] = serde_json::json!(maximum);
        }
        for field in ["left", "top", "right", "bottom"] {
            value["$defs"]["UiInsets"]["properties"][field]["minimum"] = serde_json::json!(0);
            value["$defs"]["UiInsets"]["properties"][field]["maximum"] = serde_json::json!(100);
        }
        for field in ["color", "background", "border_color"] {
            value["$defs"]["UiStyle"]["properties"][field]["items"]["minimum"] = serde_json::json!(0);
            value["$defs"]["UiStyle"]["properties"][field]["items"]["maximum"] = serde_json::json!(1);
        }
        value["$defs"]["UiStyle"]["properties"]["font_family"]["minLength"] = serde_json::json!(1);
        value["$defs"]["UiStyle"]["properties"]["font_family"]["maxLength"] = serde_json::json!(256);
        for field in ["offset_x", "offset_y"] {
            value["$defs"]["UiTextShadow"]["properties"][field]["minimum"] = serde_json::json!(-100);
            value["$defs"]["UiTextShadow"]["properties"][field]["maximum"] = serde_json::json!(100);
        }
        value["$defs"]["UiTextShadow"]["properties"]["color"]["items"]["minimum"] = serde_json::json!(0);
        value["$defs"]["UiTextShadow"]["properties"]["color"]["items"]["maximum"] = serde_json::json!(1);
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
