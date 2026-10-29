#![cfg(feature = "dev-tools")]
use unone_engine::EngineRuntime;

#[test]
fn repeated_full_ui_publications_retain_only_the_current_lua_tree() {
    let mut runtime = EngineRuntime::load_source("ui-retention", "main.luau", r#"
return {start=function()end,update=function(api)
    local children={}
    for i=1,256 do
        children[i]={kind='panel',id='panel-'..i,rect={x=0,y=0,width=100,height=100}}
    end
    api.ui.setRoot({kind='screen',id='screen',node='screen',children=children})
end}
"#, None).unwrap();
    for _ in 0..120 { runtime.tick().unwrap(); }
    // mlua/Luau documents that a full cycle may only finish the in-flight GC;
    // a second cycle collects objects that became unreachable in that cycle.
    // Settle explicitly in this diagnostic test, never in the frame loop.
    runtime.memory_sample("settle", true, true).unwrap();
    let baseline = runtime.memory_sample("published", true, true).unwrap()["samples"]
        .as_array().unwrap().last().unwrap()["lua_used_after_bytes"].as_u64().unwrap();
    for _ in 0..4 {
        for _ in 0..120 { runtime.tick().unwrap(); }
        runtime.memory_sample("settle", true, true).unwrap();
        runtime.memory_sample("published", true, false).unwrap();
    }
    let report = runtime.memory_report();
    for sample in report["samples"].as_array().unwrap() {
        if sample["label"] != "published" { continue; }
        assert!(sample["lua_used_after_bytes"].as_u64().unwrap() <= baseline + 32 * 1024,
            "same-phase reachable UI heap grew beyond warmup: {report}");
    }
}
