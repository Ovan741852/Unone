use serde_json::json;
use unone_engine::{EngineRuntime, HostProject, observation_digest};

fn runtime(source: &str) -> EngineRuntime {
    HostProject::parse(&serde_json::to_vec(&json!({
        "config": {"name":"spatial-diagnostic-test", "entry_script":"main.luau", "systems":{
            "physics2d":false,"physics3d":false,"camera2d":false,"camera3d":false,
            "random":false,"ui":false,"save":false,"audio":false,"spine":false,
            "particle":false,"effekseer":false,"jobs":false
        }},
        "script":source, "scene":{"entities":[]}
    })).unwrap()).unwrap().into_runtime(42).unwrap()
}

#[test]
fn lua_and_buffer_failures_report_field_facts_and_allow_explicit_correction() {
    let mut runtime = runtime(r#"
local index, ticket
local phase=0
return {
 start=function(api)
    assert(api.spatial.lastDiagnostic()==nil)
    index=api.spatial.create({{id=9,position={2,0,0},radius=1}})
    local function rejected(operation, call, path, actual)
        local ok,message=pcall(call)
        assert(not ok)
        local diagnostic=api.spatial.lastDiagnostic()
        assert(diagnostic.api_version==1 and diagnostic.code=='SPATIAL_INPUT_INVALID')
        assert(diagnostic.operation==operation and diagnostic.path==path)
        assert(diagnostic.message~='' and string.find(tostring(message),diagnostic.message,1,true))
        assert(diagnostic.recoverable and not diagnostic.terminal)
        assert(diagnostic.recovery.retry=='after_correction')
        assert(diagnostic.context.frame==0)
        if actual~=nil then assert(diagnostic.actual==actual) end
        diagnostic.code='caller mutation'
        assert(api.spatial.lastDiagnostic().code=='SPATIAL_INPUT_INVALID')
        api.observation.set('latest_input',api.spatial.lastDiagnostic())
    end
    rejected('spatial.update',function() api.spatial.update(index,{{id=9,position={2,0,0},radius=-1}}) end,'bodies[1].radius',-1)
    rejected('spatial.create',function() api.spatial.create({{id=9,position={2,0,0},radius='bad'}}) end,'bodies[1].radius','bad')
    rejected('spatial.create',function() api.spatial.create({{id=-1,position={2,0,0},radius=1}}) end,'bodies[1].id',-1)
    rejected('spatial.create',function() api.spatial.create({{id=9,position={2,0,0},radius=1,extra=true}}) end,'bodies[1].extra',true)
    rejected('spatial.create',function() api.spatial.create({[2]={id=9,position={2,0,0},radius=1}}) end,'bodies')
    rejected('spatial.create',function() api.spatial.create({{id=9,position={2,0/0,0},radius=1}}) end,'bodies[1].position[2]','NaN')
    rejected('spatial.create',function() api.spatial.create(buffer.create(8)) end,'bodies.header')
    local bad=api.spatial.pack({{id=10,position={0,0,0},radius=1}})
    buffer.writeu32(bad,44,2)
    rejected('spatial.create',function() api.spatial.create(bad) end,'bodies[1].has_previous',2)
    rejected('spatial.take',function() api.spatial.take(1.5) end,'ticket',1.5)
    local diagnostic=api.spatial.lastDiagnostic()
    api.spatial.pack({})
    assert(api.spatial.lastDiagnostic().path==diagnostic.path)
    assert(api.spatial.info().indices==1 and api.spatial.info().bodies==1)
 end,
 update=function(api)
    phase+=1
    if phase==1 then
        assert(not pcall(api.spatial.submit,index,{{kind='nearest',point={0,0,0},max_distance=-1}}))
        local diagnostic=api.spatial.lastDiagnostic()
        assert(diagnostic.path=='queries[1].max_distance' and diagnostic.actual==-1)
        assert(diagnostic.context.index==index)
        ticket=api.spatial.submit(index,{{kind='nearest',point={0,0,0},max_distance=10}})
        assert(api.spatial.lastDiagnostic().path=='queries[1].max_distance')
    elseif phase==2 then
        local result=api.spatial.take(ticket)
        assert(result.version==1 and result.results[1].hits[1].id==9)
        assert(not pcall(api.spatial.take,ticket))
        api.observation.set('consumed',api.spatial.lastDiagnostic())
        api.observation.set('result',result)
    end
 end
}
"#);
    runtime.tick().unwrap();
    runtime.tick().unwrap();
    let observations = runtime.semantic_observations();
    assert_eq!(observations["consumed"]["code"], "SPATIAL_TICKET_UNKNOWN");
    assert_eq!(observations["consumed"]["path"], "ticket");
    assert_eq!(observations["consumed"]["context"]["frame"], 1);
    assert_eq!(observations["result"]["results"][0]["hits"][0]["id"], 9);
}

#[test]
fn recording_and_reading_diagnostics_do_not_change_canonical_world_digests() {
    let source = r#"
local enabled=false
local index,ticket,phase
return {
 start=function(api) index=api.spatial.create({{id=3,position={0,0,0},radius=0}});phase=0 end,
 update=function(api)
    phase+=1
    if enabled then
        assert(not pcall(api.spatial.update,index,{{id=3,position={0,0,0},radius=-1}}))
        local d=api.spatial.lastDiagnostic()
        assert(d.code=='SPATIAL_INPUT_INVALID' and d.path=='bodies[1].radius')
    end
    if phase==1 then ticket=api.spatial.submit(index,{})
    elseif phase==2 then api.spatial.take(ticket) end
 end
}
"#;
    let mut control = runtime(source);
    let mut diagnosed = runtime(&source.replace("local enabled=false", "local enabled=true"));
    for _ in 0..2 {
        assert_eq!(observation_digest(&control.tick().unwrap()).unwrap(), observation_digest(&diagnosed.tick().unwrap()).unwrap());
    }
}

#[cfg(feature = "dev-tools")]
#[test]
fn failed_reload_keeps_live_diagnostic_and_successful_reload_resets_it() {
    let mut runtime = runtime(r#"
local index
return {
 start=function(api)
    index=api.spatial.create({})
    assert(not pcall(api.spatial.update,index,{{id=1,position={0,0,0},radius=-1}}))
 end,
 update=function(api) api.observation.set('diagnostic',api.spatial.lastDiagnostic()) end
}
"#);
    let replacement = r#"return {start=function() end,onReload=function(api)
        assert(not pcall(api.spatial.create,{{id=1,position={0,0,0},radius=-2}}))
        error('candidate rejected')
    end}"#;
    assert!(runtime.reload_source(replacement).is_err());
    runtime.tick().unwrap();
    assert_eq!(runtime.semantic_observations()["diagnostic"]["actual"], -1);
    runtime.reload_source("return {start=function() end,onReload=function(api) assert(api.spatial.lastDiagnostic()==nil) end,update=function(api) api.observation.set('reset',api.spatial.lastDiagnostic()==nil) end}").unwrap();
    runtime.tick().unwrap();
    assert_eq!(runtime.semantic_observations()["reset"], true);
}
