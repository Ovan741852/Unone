use serde_json::json;
use unone_engine::{EngineRuntime, HostProject};

#[test]
fn exponentially_shared_save_is_rejected_without_replacing_previous_payload() {
    let runtime = EngineRuntime::load_source(
        "save-expansion-budget", "main.luau", r#"
return {start=function(api)
    api.save.set({preserved=true})
    local graph={1}
    for _=1,40 do graph={graph,graph} end
    local ok,message=pcall(api.save.set,graph)
    assert(not ok and string.find(tostring(message),'maximum serialized node count',1,true))
    api.observation.set('previous',api.save.get())
end,update=function()end}
"#, None).unwrap();
    assert_eq!(runtime.save_payload().unwrap(), json!({"preserved":true}));
    assert_eq!(runtime.semantic_observations()["previous"], json!({"preserved":true}));
}

#[test]
fn generic_array_helper_and_save_roundtrip_preserve_empty_array_identity() {
    let runtime = EngineRuntime::load_source(
        "observation-array-contract", "main.luau", r#"
return {start=function(api)
    local values = {}
    assert(api.observation.array(values) == values)
    api.observation.set('created', api.observation.array())
    api.observation.setArray('directEmpty')
    local typedNumbers = {1,2,3}
    api.observation.setArray('directNumbers', typedNumbers)
    table.clear(typedNumbers)
    api.observation.set('directCleared', typedNumbers)
    api.observation.setArray('directNested', {{id=7,point={1,2,3}}, api.observation.array()})
    api.observation.set('atomic', 'preserved')
    for _, invalid in ipairs({{[2]=1}, {extra=2}, {function()end}, {0/0}}) do
        assert(not pcall(api.observation.setArray, 'atomic', invalid))
    end
    assert(not pcall(api.observation.setArray, '', {}))
    api.observation.set('empty', values)
    values[1] = 'one'
    api.observation.set('filled', values)
    table.clear(values)
    api.observation.set('cleared', values)
    api.observation.set('plain', {})
    api.observation.set('nested', {items=api.observation.array({api.observation.array(), {}})})
    values.extra = true
    assert(not pcall(api.observation.set, 'invalid', values))
    assert(not pcall(api.observation.array, {[2]=1}))
    values.extra = nil
    api.save.set({items=values, plain={}})
    local payload = api.save.get()
    api.observation.set('saved', payload)
    api.save.set(payload)
    assert(not pcall(api.save.set, {wide=2147483648}))
end, update=function()end}
"#, None).unwrap();
    let observations = runtime.semantic_observations();
    assert_eq!(observations["created"], json!([]));
    assert_eq!(observations["directEmpty"], json!([]));
    assert_eq!(observations["directNumbers"], json!([1,2,3]));
    assert_eq!(observations["directCleared"], json!([]));
    assert_eq!(observations["directNested"], json!([{"id":7,"point":[1,2,3]},[]]));
    assert_eq!(observations["atomic"], json!("preserved"));
    assert_eq!(observations["empty"], json!([]));
    assert_eq!(observations["filled"], json!(["one"]));
    assert_eq!(observations["cleared"], json!([]));
    assert_eq!(observations["plain"], json!({}));
    assert_eq!(observations["nested"], json!({"items":[[],{}]}));
    assert_eq!(observations["saved"], json!({"items":[],"plain":{}}));
    assert!(!observations.contains_key("invalid"));
}

#[test]
fn spatial_empty_batch_and_empty_hits_publish_as_arrays_without_author_adapters() {
    let mut runtime = HostProject::parse(&serde_json::to_vec(&json!({
        "config": {"name":"empty-spatial-arrays", "entry_script":"main.luau"},
        "script": r#"
local index, noQueries, noHits
local phase = 0
return {start=function(api)
    index = api.spatial.create({})
end, update=function(api)
    phase += 1
    if phase == 1 then
        noQueries = api.spatial.submit(index, {})
        noHits = api.spatial.submit(index, {{kind='nearest',point={0,0,0},max_distance=1}})
    elseif phase == 2 then
        api.observation.set('emptyBatch', api.spatial.take(noQueries))
        api.observation.set('noHits', api.spatial.take(noHits))
        noQueries = nil
    end
end}
"#,
        "scene":{"entities":[]}
    })).unwrap()).unwrap().into_runtime(42).unwrap();
    runtime.tick().unwrap();
    runtime.tick().unwrap();
    let observations = runtime.semantic_observations();
    assert_eq!(observations["emptyBatch"]["results"], json!([]));
    assert_eq!(observations["noHits"]["results"][0]["hits"], json!([]));
    assert_eq!(observations["noHits"]["results"].as_array().unwrap().len(), 1);
    assert_eq!(observations["noHits"]["version"], 1);
}
