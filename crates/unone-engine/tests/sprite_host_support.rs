use serde_json::json;
use unone_engine::{HostProject, InputFrame};
const SCRIPT: &str = r#"return {start=function(api) api.observation.set('start',api.sprite.hostSupport()) end,update=function(api) api.observation.set('support',api.sprite.hostSupport()) end}"#;
fn load(host: Option<serde_json::Value>) -> unone_engine::EngineRuntime {
 let mut payload=json!({"config":{"name":"capability","entry_script":"main.luau"},"script":SCRIPT});
 if let Some(host)=host {payload["sprite_resource_host"]=host;}
 HostProject::parse(&serde_json::to_vec(&payload).unwrap()).unwrap().into_runtime(42).unwrap()
}
#[test]
fn unknown_legacy_host_never_becomes_unsupported_by_absence() {
 for (value,expected) in [(None,"unknown"),(Some(json!("unknown")),"unknown"),(Some(json!("supported")),"supported"),(Some(json!("unsupported")),"unsupported")] {
  let mut r=load(value);assert_eq!(r.semantic_observations()["start"],expected);
  r.tick_with_input(&InputFrame::default()).unwrap();assert_eq!(r.semantic_observations()["support"],expected);
 }
}
#[test]
fn rejects_invalid_and_independent_image_group_claims() {
 for value in [json!(true),json!("ready"),json!(null),json!({})] {
  let payload=json!({"config":{"name":"capability"},"script":SCRIPT,"sprite_resource_host":value});
  assert!(HostProject::parse(&serde_json::to_vec(&payload).unwrap()).is_err());
 }
 let payload=json!({"config":{"name":"capability"},"script":SCRIPT,"image_group_host":true});
 let r=HostProject::parse(&serde_json::to_vec(&payload).unwrap()).unwrap().into_runtime(42).unwrap();
 assert_eq!(r.semantic_observations()["start"],"unknown");
}
#[test]
fn identical_recorded_capability_and_input_reproduce_observations() {
 let mut a=load(Some(json!("supported")));let mut b=load(Some(json!("supported")));
 for _ in 0..10 {a.tick_with_input(&InputFrame::default()).unwrap();b.tick_with_input(&InputFrame::default()).unwrap();assert_eq!(a.semantic_observations(),b.semantic_observations());}
}

#[test]
fn file_backed_authoring_is_explicitly_unsupported() {
 let dir=tempfile::tempdir().unwrap();
 std::fs::write(dir.path().join("project.unone.json"),json!({"name":"support","entry_script":"main.luau"}).to_string()).unwrap();
 std::fs::write(dir.path().join("main.luau"),SCRIPT).unwrap();
 let mut r=unone_engine::EngineRuntime::load_with_seed(dir.path(),42).unwrap();r.tick().unwrap();
 assert_eq!(r.semantic_observations()["support"],"unsupported");
}
#[test]
fn hot_reload_keeps_the_original_session_declaration() {
 let mut r=load(Some(json!("supported")));
 let replacement=r#"return {start=function(api) end,update=function(api) api.observation.set('support',api.sprite.hostSupport()) end}"#;
 r.reload_source(replacement).unwrap();r.tick().unwrap();assert_eq!(r.semantic_observations()["support"],"supported");
}
