//! api.bytes.yuv420ToRgba: the numbers a script gets, and what it refuses.
use unone_engine::EngineRuntime;

const SOURCE: &str = r#"
local Game = {}
function Game.start(api)
    local y, u, v = buffer.create(16), buffer.create(4), buffer.create(4)
    for i = 0, 15 do buffer.writeu8(y, i, 16 * i) end
    buffer.writeu8(u, 0, 128); buffer.writeu8(v, 0, 128)
    buffer.writeu8(u, 1, 255); buffer.writeu8(v, 1, 0)
    buffer.writeu8(u, 2, 0); buffer.writeu8(v, 2, 255)
    buffer.writeu8(u, 3, 128); buffer.writeu8(v, 3, 200)
    local out = buffer.create(4 * 4 * 4)
    api.bytes.yuv420ToRgba(y, 4, u, v, 2, 4, 4, out)
    local words = {}
    for i = 0, 15 do words[i + 1] = buffer.readu32(out, i * 4) end
    api.observation.set("words", words)
    api.observation.set("small", pcall(api.bytes.yuv420ToRgba, y, 4, u, v, 2, 4, 4, buffer.create(8)))
    api.observation.set("odd", pcall(api.bytes.yuv420ToRgba, y, 4, u, v, 2, 3, 4, buffer.create(48)))
    api.observation.set("plane", pcall(api.bytes.yuv420ToRgba, buffer.create(4), 4, u, v, 2, 4, 4, buffer.create(64)))
    api.observation.set("frozen", pcall(api.bytes.yuv420ToRgba, y, 4, u, v, 2, 4, 4, api.bytes.freeze(buffer.create(64))))
end
function Game.update(_api, _dt) end
return Game
"#;

#[test]
fn converts_as_the_formula_says_and_refuses_bad_sizes() {
    let runtime = EngineRuntime::load_source_with_seed("yuv", "main.luau", SOURCE, None, 42).unwrap();
    let observed = runtime.semantic_observations();
    let word = |i: usize| observed["words"][i].as_f64().unwrap() as u32;
    let pixel = |l: i32, u: i32, v: i32| -> u32 {
        let (u, v) = (u - 128, v - 128);
        let r = (l + ((359 * v) >> 8)).clamp(0, 255) as u32;
        let g = (l + ((-88 * u - 183 * v) >> 8)).clamp(0, 255) as u32;
        let b = (l + ((454 * u) >> 8)).clamp(0, 255) as u32;
        r | (g << 8) | (b << 16) | 0xFF00_0000
    };
    assert_eq!(word(0), pixel(0, 128, 128), "grey stays grey");
    assert_eq!(word(1), pixel(16, 128, 128));
    assert_eq!(word(2), pixel(32, 255, 0), "second chroma sample");
    assert_eq!(word(4), pixel(64, 128, 128), "second row shares the first chroma row");
    assert_eq!(word(8), pixel(128, 0, 255), "third row reads the second chroma row");
    assert_eq!(word(15), pixel(240, 128, 200));
    for refused in ["small", "odd", "plane", "frozen"] {
        assert_eq!(observed[refused], serde_json::json!(false), "{refused}");
    }
}
