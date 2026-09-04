use unone_engine::EngineRuntime;

fn main() {
    let source = r#"
local Game = {}
function Game.start(api)
    api.entity.spawn("web_probe")
end
function Game.update(api, _dt)
    local position = api.entity.getPosition("web_probe")
    position.x += api.random.nextFloat()
    api.entity.setPosition("web_probe", position)
end
return Game
"#;
    let mut runtime =
        EngineRuntime::load_source_with_seed("WebSmoke", "main.luau", source, None, 42)
            .expect("memory-backed Web smoke runtime should initialize");
    let report = runtime
        .run(60, 42)
        .value
        .expect("Web smoke runtime should complete");
    assert!(report.world.entities.contains_key("web_probe"));
    println!("unone_web_smoke completed: {}", report.observation_digest);
}
