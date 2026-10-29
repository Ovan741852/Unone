use serde_json::json;
use std::{cell::Cell, rc::Rc};
use unone_engine::{EngineRuntime, HostProject, observation_digest};
use unone_engine::spatial::{SpatialBatch, SpatialBatchResult, SpatialExecutor, execute_cpu};

fn runtime(source: &str) -> EngineRuntime {
    HostProject::parse(&serde_json::to_vec(&json!({
        "config": {
            "name": "spatial-runtime-test",
            "entry_script": "main.luau",
            "systems": {
                "physics2d": false, "physics3d": false,
                "camera2d": false, "camera3d": false,
                "random": false, "ui": false, "save": false,
                "audio": false, "spine": false, "particle": false,
                "effekseer": false, "jobs": false
            }
        },
        "script": source,
        "scene": {"entities": []}
    })).unwrap()).unwrap().into_runtime(42).unwrap()
}

const BATCH_SCRIPT: &str = r#"
local index, ticket
local phase = 0
return {
    start = function(api)
        index = api.spatial.create({{id=17,position={2,0,0},radius=1}})
        api.observation.set('index', index)
    end,
    update = function(api)
        phase += 1
        if phase == 1 then
            ticket = api.spatial.submit(index, {
                {kind='nearest',point={0,0,0},max_distance=10},
                {kind='overlap_sphere',center={0,0,0},radius=1},
                {kind='sweep_sphere',from={-10,0,0},to={10,0,0},radius=1},
            })
            api.observation.set('ticket', ticket)
        elseif phase == 2 then
            local result = api.spatial.take(ticket)
            assert(result.version == 1 and #result.results == 3)
            for _,query in ipairs(result.results) do
                assert(#query.hits == 1 and query.hits[1].id == 17)
            end
            api.observation.set('result', result)
        end
    end,
}
"#;

#[test]
fn full_info_and_results_publish_without_adapters_including_unsigned_ids() {
    let mut runtime = runtime(r#"
local index, ticket
return {
    start = function(api)
        api.observation.set('info', api.spatial.info())
        index = api.spatial.create({{id=4294967295,position={2,0,0},radius=0}})
    end,
    update = function(api)
        if ticket then
            local result = api.spatial.take(ticket)
            api.observation.set('result', result)
            api.observation.set('query', result.results[1])
            api.observation.set('hit', result.results[1].hits[1])
            ticket = nil
        else
            ticket = api.spatial.submit(index, {{kind='nearest',point={0,0,0},max_distance=10}})
        end
    end,
}

"#);
    runtime.tick().unwrap();
    runtime.tick().unwrap();
    let observations = runtime.semantic_observations();
    assert_eq!(observations["info"]["limits"]["safe_integer"].as_f64(), Some(9_007_199_254_740_991.0));
    assert_eq!(observations["result"]["results"][0]["hits"][0]["id"].as_f64(), Some(u32::MAX as f64));
    assert_eq!(observations["query"]["hits"][0], observations["hit"]);
}

#[test]
fn reading_spatial_profiles_preserves_world_digests_and_exposes_measured_work() {
    let profiled = BATCH_SCRIPT.replace("phase += 1", "local diagnostics = api.spatial.profile(); assert(diagnostics.backend == 'cpu'); phase += 1");
    let mut control = runtime(BATCH_SCRIPT);
    let mut measured = runtime(&profiled);
    for _ in 0..2 {
        assert_eq!(observation_digest(&control.tick().unwrap()).unwrap(), observation_digest(&measured.tick().unwrap()).unwrap());
    }
    let profile = measured.spatial_profile();
    assert_eq!(profile["totals"]["submitted_batches"], 1);
    assert_eq!(profile["totals"]["completed_batches"], 1);
    assert_eq!(profile["last"]["bodies"], 1);
    assert_eq!(profile["last"]["queries"], 3);
    assert!(profile["last"]["executor"]["phases_ms"]["cpu_execute"].as_f64().unwrap() >= 0.0);
    assert!(profile["last"]["executor"]["phases_ms"]["gpu_kernel"].is_null());
    assert!(profile["last"]["executor"]["gpu_kernel_unavailable_reason"].is_string());
    assert_eq!(profile, measured.spatial_profile());
}

// An external tool is intentionally explicit rather than silently skipped.
// Run with UNONE_LUAU_ANALYZER pointing at the pinned official analyzer.
#[test]
#[ignore = "requires the official luau-analyze; run explicitly with --ignored"]
fn spatial_observation_records_pass_strict_types_without_casts_and_reject_bad_fields() {
    let directory = tempfile::tempdir().unwrap();
    let script = directory.path().join("main.luau");
    let source = format!(r#"--!strict
{}
local function publish(api: EngineApi, ticket: number)
    api.observation.set('info', api.spatial.info())
    local result = api.spatial.take(ticket)
    local id: number = result.results[1].hits[1].id
    local coordinate: number = result.results[1].hits[1].point[1]
    api.observation.set('result', result)
    api.observation.set('query', result.results[1])
    api.observation.set('hit', result.results[1].hits[1])
    api.observation.setArray('results_array', result.results)
    api.observation.setArray('hits_array', result.results[1].hits)
    api.observation.setArray('point_array', result.results[1].hits[1].point)
    local numbers: {{number}} = {{1,2}}
    local marked = api.observation.array(numbers)
    local typed: number = marked[1]
    api.observation.setArray('typed_array', marked)
    api.observation.set('empty_array', api.observation.array())
    api.observation.set('empty_nil', api.observation.array(nil))
    local profile: SpatialProfile = api.spatial.profile()
    local completed: number = profile.totals.completed_batches
    if profile.last and profile.last.executor then
        local elapsed: number = profile.last.executor.total_ms
        api.observation.set('elapsed', elapsed)
    end
    api.observation.set('profile', profile)
    return id + coordinate + typed + completed
end
return publish
"#, unone_engine::api_typings());
    let analyzer = std::env::var_os("UNONE_LUAU_ANALYZER").expect("set UNONE_LUAU_ANALYZER to official luau-analyze");
    std::fs::write(&script, &source).unwrap();
    let run = || std::process::Command::new(&analyzer).arg("--formatter=gnu").arg(&script).output().unwrap();
    let good = run();
    assert!(good.status.success(), "{}{}", String::from_utf8_lossy(&good.stdout), String::from_utf8_lossy(&good.stderr));
    for invalid in ["result.version = 'wrong'", "result.callback = function() end", "result.results[1].hits[1].point[1] = 'wrong'"] {
        std::fs::write(&script, source.replace("local id: number", &format!("{invalid}\n    local id: number"))).unwrap();
        let bad = run();
        assert!(!bad.status.success(), "accepted {invalid}");
        assert!(format!("{}{}", String::from_utf8_lossy(&bad.stdout), String::from_utf8_lossy(&bad.stderr)).contains("TypeError"));
    }
    std::fs::write(&script, source.replace("local typed: number", "marked[1] = 'wrong'\n    local typed: number")).unwrap();
    assert!(!run().status.success(), "array helper weakened numeric element writes");
}

#[test]
fn table_and_packed_buffer_api_freeze_submissions_and_deliver_once_next_tick() {
    let mut runtime = runtime(r#"
local first, second, empty, ticket, emptyTicket
local phase = 0
return {
    start = function(api)
        first = api.spatial.create({{id=17,position={2,0,0},radius=1}})
        local packed = api.spatial.pack({{id=23,position={4,0,0},radius=1,category=4294967295}})
        assert(typeof(packed) == 'buffer' and buffer.len(packed) == 48)
        assert(buffer.readu32(packed, 0) == 0x31425355)
        second = api.spatial.create(packed)
        empty = api.spatial.create({})
        assert(not pcall(api.spatial.submit, first, {}))
    end,
    update = function(api)
        phase += 1
        if phase == 1 then
            ticket = api.spatial.submit(first, {{kind='nearest',point={0,0,0},max_distance=10}})
            local sameTick, message = pcall(api.spatial.take, ticket)
            assert(not sameTick and string.find(tostring(message), 'SPATIAL_RESULT_NEXT_TICK'))
            local updated = api.spatial.pack({{id=31,position={9,0,0},radius=0}})
            assert(api.spatial.update(first, updated) == 2)
            api.spatial.destroy(first)
            assert(not pcall(api.spatial.submit, first, {}))
            local cancelled = api.spatial.submit(second, {})
            api.spatial.cancel(cancelled)
            assert(not pcall(api.spatial.cancel, cancelled))
            assert(not pcall(api.spatial.take, cancelled))
            api.spatial.destroy(second)
            emptyTicket = api.spatial.submit(empty, {})
        elseif phase == 2 then
            local result = api.spatial.take(ticket)
            assert(result.version == 1)
            assert(result.results[1].hits[1].id == 17)
            assert(not pcall(api.spatial.take, ticket))
            assert(#api.spatial.take(emptyTicket).results == 0)
            api.spatial.destroy(empty)
            api.observation.set('completed', true)
        end
    end,
}
"#);
    runtime.tick().unwrap();
    let pending = runtime.observe().spatial.unwrap();
    assert_eq!(pending["indices"].as_array().unwrap().len(), 1);
    assert_eq!(pending["tickets"].as_array().unwrap().len(), 2);
    assert_eq!(pending["tickets"][0]["batch"]["version"], 1);
    assert_eq!(pending["tickets"][0]["batch"]["bodies"][0]["id"], 17);
    runtime.tick().unwrap();
    assert_eq!(runtime.semantic_observations()["completed"], true);
    assert_eq!(runtime.spatial_report()["indices"], 0);
    assert_eq!(runtime.spatial_report()["tickets"], 0);
}

#[test]
fn external_results_share_cpu_snapshots_and_enforce_host_barrier_and_envelopes() {
    let mut cpu = runtime(BATCH_SCRIPT);
    let mut external = runtime(BATCH_SCRIPT);
    external.set_spatial_external_backend("test-webgpu".into()).unwrap();
    cpu.tick().unwrap();
    external.tick().unwrap();
    assert_eq!(serde_json::to_value(cpu.observe()).unwrap(), serde_json::to_value(external.observe()).unwrap());
    let before_completion = observation_digest(&external.observe()).unwrap();
    let task = external.drain_spatial_tasks().pop().unwrap();
    assert!(external.drain_spatial_tasks().is_empty());
    assert!(external.set_spatial_external_backend("replacement".into()).unwrap_err().contains("BUSY"));
    assert!(external.tick().unwrap_err().explanation.contains("SPATIAL_PENDING"));
    assert_eq!(external.current_frame(), 1);
    let result = execute_cpu(&task.batch).unwrap();
    let mut invalid = result.clone();
    invalid.version += 1;
    assert!(external.complete_spatial_task(task.id, invalid).is_err());
    let mut invalid = result.clone();
    invalid.results.pop();
    assert!(external.complete_spatial_task(task.id, invalid).is_err());
    let mut invalid = result.clone();
    invalid.results[0].hits[0].id = 999;
    assert!(external.complete_spatial_task(task.id, invalid).is_err());
    external.complete_spatial_task(task.id, result.clone()).unwrap();
    assert!(external.complete_spatial_task(task.id, result).is_err());
    assert_eq!(observation_digest(&external.observe()).unwrap(), before_completion);
    cpu.tick().unwrap();
    external.tick().unwrap();
    assert_eq!(cpu.semantic_observations()["result"], external.semantic_observations()["result"]);
    assert_eq!(observation_digest(&cpu.observe()).unwrap(), observation_digest(&external.observe()).unwrap());
}

struct CountingExecutor {
    calls: Rc<Cell<usize>>,
    corrupt_version: bool,
}

impl SpatialExecutor for CountingExecutor {
    fn name(&self) -> &str { "test-compute" }

    fn execute(&mut self, batch: &SpatialBatch) -> Result<SpatialBatchResult, String> {
        self.calls.set(self.calls.get() + 1);
        let mut result = execute_cpu(batch)?;
        if self.corrupt_version {
            result.version += 1;
        }
        Ok(result)
    }
}

#[test]
fn executors_dispatch_after_successful_script_update_and_fault_on_invalid_results() {
    let calls = Rc::new(Cell::new(0));
    let mut successful = runtime(BATCH_SCRIPT);
    successful.set_spatial_executor(Box::new(CountingExecutor { calls: Rc::clone(&calls), corrupt_version: false })).unwrap();
    assert_eq!(calls.get(), 0);
    successful.tick().unwrap();
    assert_eq!(calls.get(), 1);
    successful.tick().unwrap();
    assert_eq!(calls.get(), 1);

    let mut failed = runtime(&BATCH_SCRIPT.replace("api.observation.set('ticket', ticket)", "error('update failed after submitting')"));
    failed.set_spatial_executor(Box::new(CountingExecutor { calls: Rc::clone(&calls), corrupt_version: false })).unwrap();
    assert!(failed.tick().unwrap_err().explanation.contains("update failed after submitting"));
    assert_eq!(calls.get(), 1, "failed script update must never execute its batch");
    assert_eq!(failed.current_frame(), 0);
    assert!(failed.tick().unwrap_err().explanation.contains("SPATIAL_FAILED"));
    assert!(failed.drain_spatial_tasks().is_empty());

    let mut invalid = runtime(BATCH_SCRIPT);
    invalid.set_spatial_executor(Box::new(CountingExecutor { calls, corrupt_version: true })).unwrap();
    assert!(invalid.tick().unwrap_err().explanation.contains("result version"));
    assert_eq!(invalid.current_frame(), 0);
    assert!(invalid.spatial_report()["fault"].is_string());
    assert!(invalid.tick().unwrap_err().explanation.contains("SPATIAL_FAILED"));
}

#[test]
fn cancelled_external_work_is_not_dispatched_and_destroy_keeps_frozen_work_valid() {
    let mut runtime = runtime(r#"
local index, surviving
local phase = 0
return {
    start = function(api)
        index = api.spatial.create({{id=8,position={0,0,0},radius=1}})
    end,
    update = function(api)
        phase += 1
        if phase == 1 then
            local cancelled = api.spatial.submit(index, {})
            api.spatial.cancel(cancelled)
            surviving = api.spatial.submit(index, {{kind='nearest',point={0,0,0},max_distance=0}})
            api.spatial.destroy(index)
        elseif phase == 2 then
            assert(api.spatial.take(surviving).results[1].hits[1].id == 8)
        end
    end,
}
"#);
    runtime.set_spatial_external_backend("test-webgpu".into()).unwrap();
    runtime.tick().unwrap();
    let tasks = runtime.drain_spatial_tasks();
    assert_eq!(tasks.len(), 1);
    assert_eq!(runtime.spatial_report()["indices"], 0);
    let task = &tasks[0];
    runtime.complete_spatial_task(task.id, execute_cpu(&task.batch).unwrap()).unwrap();
    runtime.tick().unwrap();
    assert_eq!(runtime.spatial_report()["tickets"], 0);
}

#[test]
fn spatial_state_enters_canonical_snapshot_only_after_an_index_is_created() {
    let mut unused = runtime("return {start=function(api) api.spatial.info(); api.spatial.pack({}) end, update=function() end}");
    assert!(!serde_json::to_value(unused.observe()).unwrap().as_object().unwrap().contains_key("spatial"));
    unused.tick().unwrap();
    assert!(!serde_json::to_value(unused.observe()).unwrap().as_object().unwrap().contains_key("spatial"));
    let used = runtime("return {start=function(api) local id=api.spatial.create({}); api.spatial.destroy(id) end, update=function() end}");
    let state = serde_json::to_value(used.observe()).unwrap();
    assert_eq!(state["spatial"]["indices"], json!([]));
    assert_eq!(state["spatial"]["tickets"], json!([]));
    let first = runtime(BATCH_SCRIPT);
    let second = runtime(&BATCH_SCRIPT.replace("position={2,0,0}", "position={3,0,0}"));
    assert_ne!(observation_digest(&first.observe()).unwrap(), observation_digest(&second.observe()).unwrap());
}

#[cfg(feature = "dev-tools")]
#[test]
fn reload_preserves_indices_and_backend_while_invalidating_previous_tickets() {
    let mut runtime = runtime(BATCH_SCRIPT);
    runtime.set_spatial_external_backend("test-webgpu".into()).unwrap();
    runtime.tick().unwrap();
    let old_task = runtime.drain_spatial_tasks().pop().unwrap();
    let index = runtime.semantic_observations()["index"].as_u64().unwrap();
    let replacement = format!(r#"
local index = {index}
local oldTicket = {old_ticket}
local phase, ticket = 0, nil
return {{
    start = function() error('reload must not rerun start') end,
    onReload = function(api)
        assert(api.spatial.update(index, {{{{id=29,position={{1,0,0}},radius=1}}}}) == 2)
    end,
    update = function(api)
        phase += 1
        if phase == 1 then
            local ok, message = pcall(api.spatial.take, oldTicket)
            assert(not ok and string.find(tostring(message), 'SPATIAL_TICKET_UNKNOWN'))
            ticket = api.spatial.submit(index, {{{{kind='nearest',point={{0,0,0}},max_distance=5}}}})
        elseif phase == 2 then
            local result = api.spatial.take(ticket)
            assert(result.version == 2 and result.results[1].hits[1].id == 29)
            api.observation.set('reloaded', true)
        end
    end,
}}
"#, old_ticket = old_task.id);
    runtime.reload_source(replacement).unwrap();
    assert_eq!(runtime.spatial_report()["backend"], "test-webgpu");
    assert_eq!(runtime.spatial_report()["tickets"], 0);
    assert_eq!(runtime.spatial_report()["indices"], 1);
    assert!(runtime.complete_spatial_task(old_task.id, execute_cpu(&old_task.batch).unwrap()).unwrap_err().contains("UNKNOWN"));
    runtime.tick().unwrap();
    let task = runtime.drain_spatial_tasks().pop().unwrap();
    assert!(task.id > old_task.id);
    runtime.complete_spatial_task(task.id, execute_cpu(&task.batch).unwrap()).unwrap();
    runtime.tick().unwrap();
    assert_eq!(runtime.semantic_observations()["reloaded"], true);
}

#[cfg(feature = "dev-tools")]
#[test]
fn failed_reload_preserves_future_handle_sequence_and_canonical_state() {
    let source = "return {start=function(api) api.spatial.create({}) end, update=function(api) api.observation.set('next',api.spatial.create({})) end}";
    let mut tested=runtime(source);
    let mut control=runtime(source);
    let before=observation_digest(&tested.observe()).unwrap();
    let replacement="return {start=function() end, onReload=function(api) api.spatial.create({}); error('reject candidate') end, update=function() end}";
    assert!(tested.reload_source(replacement).is_err());
    assert_eq!(observation_digest(&tested.observe()).unwrap(),before);
    assert_eq!(observation_digest(&tested.tick().unwrap()).unwrap(),observation_digest(&control.tick().unwrap()).unwrap());
    assert_eq!(tested.semantic_observations()["next"],2);
}

#[cfg(feature = "jobs")]
#[test]
fn external_cpu_job_barrier_can_be_retried_without_poisoning_spatial() {
    let payload=json!({
        "config":{"name":"spatial-job-barrier","entry_script":"main.luau","systems":{"jobs":true}},
        "scene":{"entities":[]},
        "script":r#"local pending
        return {
         start=function(api) api.jobs.register('identity','return function(input) return input end') end,
         update=function(api)
          if pending then api.jobs.take(pending); pending=nil
          else pending=api.jobs.submit('identity',buffer.create(4)) end
         end,
        }"#
    });
    let mut tested=HostProject::parse(&serde_json::to_vec(&payload).unwrap()).unwrap().into_runtime(42).unwrap();
    tested.jobs_host_request(json!({"kind":"configure","workers":1})).unwrap();
    tested.tick().unwrap();
    let tasks=tested.jobs_host_request(json!({"kind":"drain"})).unwrap();
    assert!(tested.tick().unwrap_err().explanation.contains("JOB_BARRIER_NOT_READY"));
    assert!(tested.spatial_report()["fault"].is_null());
    for task in tasks["tasks"].as_array().unwrap() {
        let reply=EngineRuntime::execute_job_host(task.clone()).unwrap();
        tested.jobs_host_request(reply).unwrap();
    }
    tested.tick().unwrap();
    assert_eq!(tested.current_frame(),2);
}
