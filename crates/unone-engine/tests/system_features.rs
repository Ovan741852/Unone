use serde_json::json;
use unone_engine::{HostProject, compiled_systems, search_systems};

fn project(script: &str) -> serde_json::Value {
    let systems: serde_json::Map<String, serde_json::Value> = search_systems("")
        .into_iter()
        .filter(|d| d.optional)
        .map(|d| (d.id, json!(false)))
        .collect();
    json!({"config":{"name":"optional", "entry_script":"main.luau", "systems":systems}, "script":script, "scene":null})
}
fn load(
    value: serde_json::Value,
) -> Result<unone_engine::EngineRuntime, Box<unone_engine::Diagnostic>> {
    HostProject::parse(&serde_json::to_vec(&value).unwrap())?.into_runtime(42)
}
#[test]
fn core_only_project_runs_with_every_optional_system_off() {
    let mut runtime=load(project("return {start=function(api) api.observation.set('ready', true) end, update=function() end}")).unwrap();
    runtime.tick().unwrap();
    assert_eq!(runtime.observe().observations["ready"], json!(true));
    assert!(runtime.observe().physics3d.is_none());
}
#[test]
fn compiled_capabilities_and_project_requirements_agree() {
    for descriptor in search_systems("") {
        assert_eq!(
            compiled_systems().contains(&descriptor.id),
            descriptor.compiled
        );
        if !descriptor.optional {
            assert!(descriptor.compiled);
            continue;
        }
        assert_eq!(
            descriptor.build_feature.as_deref(),
            Some(descriptor.id.as_str())
        );
        let mut value = project("return {start=function() end, update=function() end}");
        value["config"]["systems"][&descriptor.id] = json!(true);
        match load(value) {
            Ok(_) => assert!(descriptor.compiled, "{}", descriptor.id),
            Err(e) => {
                assert!(!descriptor.compiled, "{}: {:?}", descriptor.id, e);
                assert_eq!(e.code, "SYSTEM_NOT_COMPILED");
            }
        }
    }
}
#[test]
fn unavailable_physics_calls_are_explicit_errors() {
    for namespace in ["physics", "physics3d"] {
        let value = project(&format!(
            "return {{start=function(api) api.{namespace}.{}() end, update=function() end}}",
            if namespace == "physics" {
                "applyImpulse"
            } else {
                "raycast"
            }
        ));
        let error = load(value).err().expect("disabled call cannot succeed");
        let feature = if namespace == "physics" {
            "physics2d"
        } else {
            "physics3d"
        };
        let expected = if compiled_systems().iter().any(|s| s == feature) {
            "SYSTEM_DISABLED"
        } else {
            "SYSTEM_NOT_COMPILED"
        };
        assert!(error.explanation.contains(expected), "{:?}", error);
    }
}
#[cfg(not(feature = "physics3d"))]
#[test]
fn scene_cannot_smuggle_in_a_compiled_out_solver() {
    let mut value = project("return {start=function() end, update=function() end}");
    value["scene"] = json!({"entities":[], "physics3d":{"bodies":{}}});
    let error = load(value).err().expect("physics scene must be rejected");
    assert!(
        error.explanation.contains("SYSTEM_NOT_COMPILED"),
        "{:?}",
        error
    );
}

#[test]
fn cargo_feature_forwarding_matches_engine_descriptors() {
    let engine = include_str!("../Cargo.toml");
    let player = include_str!("../../unone-player/Cargo.toml");
    for descriptor in search_systems("").into_iter().filter(|d| d.optional) {
        let feature = descriptor.build_feature.unwrap();
        assert!(
            engine
                .lines()
                .any(|line| line.starts_with(&format!("{feature} = ")))
        );
        assert!(
            player
                .lines()
                .any(|line| line == format!("{feature} = [\"unone-engine/{feature}\"]"))
        );
    }
}

#[test]
fn configuration_ids_cannot_silently_miss_the_canonical_switch() {
    for id in ["Physics3D", "physics3d ", "physcis3d"] {
        let mut value = project("return {start=function() end, update=function() end}");
        value["config"]["systems"][id] = json!(false);
        assert_eq!(load(value).err().unwrap().code, "SYSTEM_UNKNOWN");
    }
}
