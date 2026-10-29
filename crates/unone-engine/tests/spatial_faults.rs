//! Synthetic failures through the public host boundary. These tests verify
//! lifecycle contracts; they do not claim to reproduce a hardware device loss.
use serde_json::json;
use std::{cell::Cell, rc::Rc};
use unone_engine::{EngineRuntime, HostProject, observation_digest};
use unone_engine::spatial::{
    SpatialBatch, SpatialBatchResult, SpatialExecutionProfile, SpatialExecutor, execute_cpu,
};

fn runtime(source: &str) -> EngineRuntime {
    HostProject::parse(&serde_json::to_vec(&json!({
        "config": {
            "name": "spatial-fault-injection", "entry_script": "main.luau",
            "systems": {
                "physics2d": false, "physics3d": false, "camera2d": false,
                "camera3d": false, "random": false, "ui": false, "save": false,
                "audio": false, "spine": false, "particle": false,
                "effekseer": false, "jobs": false
            }
        },
        "script": source, "scene": {"entities": []}
    })).unwrap()).unwrap().into_runtime(42).unwrap()
}

const ONE_BATCH: &str = r#"
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
            ticket = api.spatial.submit(index, {{kind='nearest',point={0,0,0},max_distance=10}})
        elseif phase == 2 then
            api.observation.set('result', api.spatial.take(ticket))
            api.observation.set('next_index', api.spatial.create({}))
        end
    end,
}
"#;

struct FailSecondBatch(Rc<Cell<usize>>);

impl SpatialExecutor for FailSecondBatch {
    fn name(&self) -> &str { "injected-device" }

    fn execute(&mut self, batch: &SpatialBatch) -> Result<SpatialBatchResult, String> {
        let call = self.0.get() + 1;
        self.0.set(call);
        if call == 2 {
            Err("synthetic device lost on second batch".into())
        } else {
            execute_cpu(batch)
        }
    }
}

#[test]
fn terminal_executor_failure_does_not_partially_commit_a_multi_batch_tick() {
    let source = ONE_BATCH.replace(
        "elseif phase == 2 then",
        "api.spatial.submit(index, {})\n        elseif phase == 2 then",
    );
    let calls = Rc::new(Cell::new(0));
    let mut runtime = runtime(&source);
    runtime.set_spatial_executor(Box::new(FailSecondBatch(Rc::clone(&calls)))).unwrap();
    assert!(runtime.tick().unwrap_err().explanation.contains("synthetic device lost"));
    assert_eq!(calls.get(), 2);
    assert_eq!(runtime.current_frame(), 0);
    let info = runtime.spatial_report();
    assert_eq!(info["backend"], "injected-device");
    assert_eq!(info["indices"], 1);
    assert_eq!(info["tickets"], 0);
    assert_eq!(info["pending"], 0);
    assert!(info["fault"].as_str().unwrap().contains("synthetic device lost"));
    let profile = runtime.spatial_profile();
    assert_eq!(profile["totals"]["submitted_batches"], 2);
    assert_eq!(profile["totals"]["completed_batches"], 0);
    assert_eq!(profile["totals"]["failed_batches"], 2);
    assert!(profile["last"].is_null());
    assert!(runtime.drain_spatial_tasks().is_empty());
    assert!(runtime.tick().unwrap_err().explanation.contains("SPATIAL_FAILED"));
    assert!(runtime.set_spatial_external_backend("replacement".into()).unwrap_err().contains("SPATIAL_FAILED"));
    assert_eq!(runtime.spatial_profile(), profile);
    assert_eq!(calls.get(), 2, "a terminal fault must not silently retry or use CPU");
}

#[test]
fn rejected_completion_attempts_preserve_state_and_allow_the_valid_retry() {
    let mut runtime = runtime(ONE_BATCH);
    runtime.set_spatial_external_backend("injected-external".into()).unwrap();
    runtime.tick().unwrap();
    let task = runtime.drain_spatial_tasks().pop().unwrap();
    let result = execute_cpu(&task.batch).unwrap();
    let digest = observation_digest(&runtime.observe()).unwrap();
    let profile = runtime.spatial_profile();
    let mut wrong_version = result.clone(); wrong_version.version += 1;
    let mut missing_query = result.clone(); missing_query.results.clear();
    let mut foreign_hit = result.clone(); foreign_hit.results[0].hits[0].id = 999;
    for invalid in [wrong_version, missing_query, foreign_hit] {
        assert!(runtime.complete_spatial_task(task.id, invalid).is_err());
        assert_eq!(observation_digest(&runtime.observe()).unwrap(), digest);
        assert_eq!(runtime.spatial_profile(), profile);
        assert!(runtime.spatial_report()["fault"].is_null());
    }
    assert!(runtime.complete_spatial_task(task.id + 1_000, result.clone()).is_err());
    let invalid_profile = SpatialExecutionProfile {
        clock: "host_monotonic".into(), total_ms: f64::NAN,
        phases_ms: Default::default(), upload_bytes: 0, readback_bytes: 0,
        gpu_kernel_unavailable_reason: Some("Synthetic external executor has no GPU timestamps".into()),
    };
    assert!(runtime.complete_spatial_task_with_profile(task.id, result.clone(), Some(invalid_profile)).is_err());
    assert_eq!(observation_digest(&runtime.observe()).unwrap(), digest);
    assert_eq!(runtime.spatial_profile(), profile);
    assert!(runtime.tick().unwrap_err().explanation.contains("SPATIAL_PENDING"));
    assert_eq!(runtime.current_frame(), 1);
    assert!(runtime.spatial_report()["fault"].is_null());
    runtime.complete_spatial_task(task.id, result.clone()).unwrap();
    let completed_profile = runtime.spatial_profile();
    assert!(runtime.complete_spatial_task(task.id, result.clone()).is_err());
    assert_eq!(runtime.spatial_profile(), completed_profile);
    assert_eq!(observation_digest(&runtime.observe()).unwrap(), digest);
    runtime.tick().unwrap();
    let observed: SpatialBatchResult = serde_json::from_value(runtime.semantic_observations()["result"].clone()).unwrap();
    assert_eq!(observed, result);
    assert_eq!(runtime.spatial_report()["tickets"], 0);
}

#[cfg(feature = "dev-tools")]
#[test]
fn host_fault_retires_late_work_and_successful_reload_restores_the_existing_backend() {
    let mut runtime = runtime(ONE_BATCH);
    runtime.set_spatial_external_backend("injected-external".into()).unwrap();
    runtime.tick().unwrap();
    let old = runtime.drain_spatial_tasks().pop().unwrap();
    let index = runtime.semantic_observations()["index"].as_u64().unwrap();
    runtime.fail_spatial("synthetic host device loss".into());
    let fault_profile = runtime.spatial_profile();
    assert_eq!(fault_profile["totals"]["failed_batches"], 1);
    assert_eq!(runtime.spatial_report()["tickets"], 0);
    assert!(runtime.complete_spatial_task(old.id, execute_cpu(&old.batch).unwrap()).unwrap_err().contains("SPATIAL_FAILED"));
    assert!(runtime.tick().unwrap_err().explanation.contains("SPATIAL_FAILED"));
    assert_eq!(runtime.current_frame(), 1);
    assert_eq!(runtime.spatial_profile(), fault_profile);
    let replacement = format!(r#"
local index, ticket, phase = {index}, nil, 0
return {{
    start = function() error('reload must not rerun start') end,
    onReload = function(api)
        assert(api.spatial.update(index, {{{{id=29,position={{1,0,0}},radius=1}}}}) == 2)
    end,
    update = function(api)
        phase += 1
        if phase == 1 then
            ticket = api.spatial.submit(index, {{{{kind='nearest',point={{0,0,0}},max_distance=5}}}})
        elseif phase == 2 then
            local result = api.spatial.take(ticket)
            assert(result.version == 2 and result.results[1].hits[1].id == 29)
            api.observation.set('recovered', true)
        end
    end,
}}
"#);
    runtime.reload_source(replacement).unwrap();
    assert_eq!(runtime.spatial_report()["backend"], "injected-external");
    assert_eq!(runtime.spatial_report()["indices"], 1);
    assert!(runtime.spatial_report()["fault"].is_null());
    assert_eq!(runtime.spatial_profile()["totals"]["submitted_batches"], 0);
    assert!(runtime.spatial_profile()["last"].is_null());
    let reset_profile = runtime.spatial_profile();
    assert!(runtime.complete_spatial_task(old.id, execute_cpu(&old.batch).unwrap()).unwrap_err().contains("UNKNOWN"));
    assert_eq!(runtime.spatial_profile(), reset_profile);
    runtime.tick().unwrap();
    let fresh = runtime.drain_spatial_tasks().pop().unwrap();
    assert!(fresh.id > old.id);
    runtime.complete_spatial_task(fresh.id, execute_cpu(&fresh.batch).unwrap()).unwrap();
    runtime.tick().unwrap();
    assert_eq!(runtime.semantic_observations()["recovered"], true);
    assert_eq!(runtime.spatial_profile()["totals"]["completed_batches"], 1);
    assert_eq!(runtime.spatial_profile()["totals"]["failed_batches"], 0);
}

#[cfg(feature = "dev-tools")]
#[test]
fn failed_reload_preserves_pending_work_profiles_and_future_handles() {
    let mut tested = runtime(ONE_BATCH);
    let mut control = runtime(ONE_BATCH);
    for runtime in [&mut tested, &mut control] {
        runtime.set_spatial_external_backend("injected-external".into()).unwrap();
        runtime.tick().unwrap();
    }
    let original = tested.drain_spatial_tasks().pop().unwrap();
    let control_task = control.drain_spatial_tasks().pop().unwrap();
    let index = tested.semantic_observations()["index"].as_u64().unwrap();
    let before_digest = observation_digest(&tested.observe()).unwrap();
    let before_profile = tested.spatial_profile();
    let before_report = tested.spatial_report();
    let rejected = format!(r#"return {{
        start = function() end,
        onReload = function(api)
            api.spatial.update({index}, {{{{id=99,position={{99,0,0}},radius=1}}}})
            api.spatial.create({{}})
            error('synthetic candidate rejection')
        end,
        update = function() end,
    }}"#);
    assert!(tested.reload_source(rejected).unwrap_err().explanation.contains("synthetic candidate rejection"));
    assert_eq!(observation_digest(&tested.observe()).unwrap(), before_digest);
    assert_eq!(tested.spatial_profile(), before_profile);
    assert_eq!(tested.spatial_report(), before_report);
    assert!(tested.tick().unwrap_err().explanation.contains("SPATIAL_PENDING"));
    assert_eq!(tested.spatial_profile(), before_profile);
    assert!(tested.spatial_report()["fault"].is_null());
    tested.complete_spatial_task(original.id, execute_cpu(&original.batch).unwrap()).unwrap();
    control.complete_spatial_task(control_task.id, execute_cpu(&control_task.batch).unwrap()).unwrap();
    assert_eq!(observation_digest(&tested.tick().unwrap()).unwrap(), observation_digest(&control.tick().unwrap()).unwrap());
    assert_eq!(tested.semantic_observations()["next_index"], control.semantic_observations()["next_index"]);
    assert_eq!(tested.semantic_observations()["result"]["results"][0]["hits"][0]["id"], 17);
}

#[test]
fn cancelling_completed_unconsumed_work_rejects_its_late_duplicate_without_a_fault() {
    let source = ONE_BATCH.replace(
        "api.observation.set('result', api.spatial.take(ticket))",
        "api.spatial.cancel(ticket); api.observation.set('cancelled', true)",
    );
    let mut runtime = runtime(&source);
    runtime.set_spatial_external_backend("injected-external".into()).unwrap();
    runtime.tick().unwrap();
    let task = runtime.drain_spatial_tasks().pop().unwrap();
    let result = execute_cpu(&task.batch).unwrap();
    runtime.complete_spatial_task(task.id, result.clone()).unwrap();
    runtime.tick().unwrap();
    assert_eq!(runtime.semantic_observations()["cancelled"], true);
    let digest = observation_digest(&runtime.observe()).unwrap();
    let profile = runtime.spatial_profile();
    assert_eq!(profile["totals"]["completed_batches"], 1);
    assert_eq!(profile["totals"]["cancelled_tickets"], 1);
    assert!(runtime.complete_spatial_task(task.id, result).unwrap_err().contains("UNKNOWN"));
    assert_eq!(observation_digest(&runtime.observe()).unwrap(), digest);
    assert_eq!(runtime.spatial_profile(), profile);
    assert!(runtime.spatial_report()["fault"].is_null());
    runtime.tick().unwrap();
}
