use unone_engine::{EngineRuntime, HostProject};

fn host(pipeline: serde_json::Value, start: &str) -> Result<EngineRuntime, String> {
    let mut config = serde_json::json!({"name": "render-pipeline", "entry_script": "main.luau"});
    if !pipeline.is_null() {
        config["render_pipeline"] = pipeline;
    }
    let payload = serde_json::json!({
        "config": config,
        "script": format!("return {{start=function(api)\n{start}\nend, update=function() end}}"),
    });
    HostProject::parse(payload.to_string().as_bytes())
        .and_then(|project| project.into_runtime(42))
        .map_err(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.explanation))
}

fn declared() -> serde_json::Value {
    serde_json::json!({"version": 1, "passes": [
        {"id": "world", "kind": "scene"},
        {"id": "glow", "kind": "bloom", "params": {"threshold": 0.8}},
        {"id": "tone", "kind": "tonemap", "enabled": false},
        {"id": "vignette", "kind": "studio.vignette", "params": {"radius": 0.7}},
        {"id": "hud", "kind": "ui"}
    ]})
}

#[test]
fn the_declared_pipeline_is_published_and_adjusted_through_the_snapshot() {
    let runtime = host(declared(), r#"
    api.render.setPass("glow", {params = {strength = 1.5}})
    api.render.setPass("tone", {enabled = true, params = {mode = "aces", exposure = 1.2}})
    api.render.setPass("vignette", {params = {radius = 0.5, tint = "warm", on = true}})
    local glow = api.render.getPass("glow")
    api.observation.set("glow", glow.kind .. ":" .. tostring(glow.enabled) .. ":" .. glow.params.threshold .. ":" .. glow.params.strength)
    "#).unwrap();
    let snapshot = serde_json::to_value(runtime.observe()).unwrap();
    let passes = &snapshot["render_pipeline"]["passes"];
    assert_eq!(passes[1]["params"], serde_json::json!({"threshold": 0.8, "strength": 1.5}));
    assert_eq!((passes[2]["enabled"].clone(), passes[2]["params"]["mode"].clone()), (serde_json::json!(true), serde_json::json!("aces")));
    assert_eq!(passes[3]["params"], serde_json::json!({"radius": 0.5, "tint": "warm", "on": true}));
    assert_eq!(runtime.semantic_observations()["glow"], "bloom:true:0.8:1.5");
}

#[test]
fn an_undeclared_pipeline_is_absent_and_cannot_be_adjusted() {
    let runtime = host(serde_json::Value::Null, r#"
    local ok, err = pcall(api.render.setPass, "glow", {enabled = false})
    assert(not ok)
    api.observation.set("error", tostring(err))
    "#).unwrap();
    assert!(serde_json::to_value(runtime.observe()).unwrap().get("render_pipeline").is_none(), "games without a pipeline keep their snapshot bytes");
    assert!(runtime.semantic_observations()["error"].as_str().unwrap().contains("RENDER_PIPELINE_UNDECLARED"));
}

#[test]
fn invalid_declarations_and_changes_fail_with_the_reason() {
    let error = host(serde_json::json!({"version": 1, "passes": [{"id": "glow", "kind": "bloom"}]}), "").err().unwrap();
    assert!(error.starts_with("RENDER_PIPELINE_INVALID") && error.contains("first pass"), "{error}");
    let runtime = host(declared(), r#"
    local errors = {}
    for _, call in {
        function() api.render.setPass("missing", {enabled = true}) end,
        function() api.render.setPass("glow", {params = {strength = 99}}) end,
        function() api.render.setPass("glow", {params = {radius = 1}}) end,
        function() api.render.setPass("glow", {enable = true}) end,
        function() api.render.setPass("glow", {params = {strength = {}}}) end,
        function() api.render.getPass("missing") end,
    } do
        local ok, err = pcall(call)
        assert(not ok)
        table.insert(errors, tostring(err))
    end
    api.observation.set("errors", table.concat(errors, "\n"))
    "#).unwrap();
    let errors = runtime.semantic_observations()["errors"].as_str().unwrap().to_string();
    for expected in ["RENDER_PASS_UNKNOWN", "strength must be a number", "has no param 'radius'", "OPTION_UNKNOWN_FIELD", "must be a number, boolean or string"] {
        assert!(errors.contains(expected), "expected {expected} in {errors}");
    }
    let pass = serde_json::to_value(runtime.observe()).unwrap()["render_pipeline"]["passes"][1].clone();
    assert_eq!(pass["params"], serde_json::json!({"threshold": 0.8}), "a rejected change leaves the pass as it was");
}
