//! Optional, game-owned Luau buffer jobs. Timing never enters gameplay state.
use mlua::{Buffer, Function};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};

pub const MAX_JOBS: usize = 16;
pub const PER_TICK: usize = 4;
pub const MAX_BYTES: usize = 256 * 1024;
const MAX_SOURCE: usize = 16 * 1024;
const MAX_OPERATIONS: usize = 8;
const MAX_RESERVED: usize = 4 * 1024 * 1024;
const VM_BYTES: usize = 16 * 1024 * 1024;
const SAFE_POINTS: u64 = 2_000_000;
fn err(code: &str) -> String {
    format!("{code}: inspect the jobs contract with game api search jobs --json")
}
fn hash(b: &[u8]) -> String {
    super::hex_digest(b)
}

#[derive(Clone)]
struct Operation {
    source: Arc<str>,
    hash: String,
}
struct Work {
    id: String,
    source: Arc<str>,
    input: Vec<u8>,
    cancelled: Arc<AtomicBool>,
}
struct Reply {
    id: String,
    output: Result<Vec<u8>, String>,
    run_ms: f64,
}
struct Entry {
    operation: String,
    source_hash: String,
    input_hash: String,
    input_len: usize,
    submitted: u64,
    work: Option<Work>,
    reply: Option<Reply>,
    delivered: bool,
    cancelled: Arc<AtomicBool>,
}

#[cfg(not(target_arch = "wasm32"))]
struct Pool {
    send: Option<std::sync::mpsc::SyncSender<(Work, std::sync::mpsc::Sender<Reply>)>>,
    threads: Vec<std::thread::JoinHandle<()>>,
}
#[cfg(not(target_arch = "wasm32"))]
impl Pool {
    fn new() -> Result<Self, String> {
        let (send, receive) =
            std::sync::mpsc::sync_channel::<(Work, std::sync::mpsc::Sender<Reply>)>(MAX_JOBS);
        let receive = Arc::new(std::sync::Mutex::new(receive));
        let mut pool = Self {
            send: Some(send),
            threads: Vec::new(),
        };
        for _ in 0..2 {
            let receive = Arc::clone(&receive);
            pool.threads.push(
                std::thread::Builder::new()
                    .name("unone-job".into())
                    .spawn(move || {
                        loop {
                            let next = receive.lock().expect("job receiver mutex").recv();
                            let Ok((work, reply)) = next else { break };
                            let id = work.id.clone();
                            let result =
                                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                    execute(work)
                                }));
                            // A native panic is an executor failure, never a substituted result.
                            let result = result.unwrap_or(Reply {
                                id,
                                output: Err(err("JOB_EXECUTOR_PANIC")),
                                run_ms: 0.,
                            });
                            let _ = reply.send(result);
                        }
                    })
                    .map_err(|e| format!("JOB_EXECUTOR_UNAVAILABLE: {e}"))?,
            );
        }
        Ok(pool)
    }
}
#[cfg(not(target_arch = "wasm32"))]
impl Drop for Pool {
    fn drop(&mut self) {
        self.send.take();
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

fn execute(work: Work) -> Reply {
    let started = Instant::now();
    let result = (|| -> Result<Vec<u8>, String> {
        if work.cancelled.load(Ordering::Relaxed) {
            return Err(err("JOB_CANCELLED"));
        }
        let lua = super::determinism::new_job_vm().map_err(|e| e.explanation)?;
        lua.set_memory_limit(VM_BYTES).map_err(|e| e.to_string())?;
        let counter = std::cell::Cell::new(0u64);
        let cancelled = Arc::clone(&work.cancelled);
        lua.set_interrupt(move |_| {
            counter.set(counter.get() + 1);
            if cancelled.load(Ordering::Relaxed) || counter.get() > SAFE_POINTS {
                return Err(mlua::Error::RuntimeError(
                    "JOB_BUDGET_EXCEEDED_OR_CANCELLED".into(),
                ));
            }
            Ok(mlua::VmState::Continue)
        });
        let function: Function = lua
            .load(&*work.source)
            .set_name("job.luau")
            .eval()
            .map_err(|e| e.to_string())?;
        let input = lua.create_buffer(&work.input).map_err(|e| e.to_string())?;
        let output: Buffer = function.call(input).map_err(|e| e.to_string())?;
        if output.len() > MAX_BYTES {
            return Err(err("JOB_OUTPUT_TOO_LARGE"));
        }
        Ok(output.to_vec())
    })();
    Reply {
        id: work.id,
        output: result.map_err(|e| {
            format!(
                "JOB_EXECUTION_FAILED: {}",
                e.chars().take(2048).collect::<String>()
            )
        }),
        run_ms: started.elapsed().as_secs_f64() * 1000.0,
    }
}

#[derive(Default, Serialize)]
struct Metrics {
    completed: u64,
    input_bytes: u64,
    output_bytes: u64,
    execution_ms: f64,
    barrier_ms: f64,
    #[serde(skip)]
    recent: std::collections::VecDeque<serde_json::Value>,
}
pub(super) struct Jobs {
    inline: bool,
    operations: BTreeMap<String, Operation>,
    entries: BTreeMap<String, Entry>,
    epoch: u64,
    sequence: u64,
    frame: u64,
    updating: bool,
    loading: bool,
    submitted: usize,
    fault: Option<String>,
    metrics: Metrics,
    profile_id: u64,
    profile_active: bool,
    #[cfg(not(target_arch = "wasm32"))]
    pool: Option<Arc<Pool>>,
    #[cfg(not(target_arch = "wasm32"))]
    send: std::sync::mpsc::Sender<Reply>,
    #[cfg(not(target_arch = "wasm32"))]
    receive: std::sync::mpsc::Receiver<Reply>,
}
impl Default for Jobs {
    fn default() -> Self {
        #[cfg(not(target_arch = "wasm32"))]
        let (send, receive) = std::sync::mpsc::channel();
        Self {
            inline: cfg!(target_arch = "wasm32"),
            operations: BTreeMap::new(),
            entries: BTreeMap::new(),
            epoch: 1,
            sequence: 0,
            frame: 0,
            updating: false,
            loading: true,
            submitted: 0,
            fault: None,
            metrics: Metrics::default(),
            profile_id: 0,
            profile_active: false,
            #[cfg(not(target_arch = "wasm32"))]
            pool: None,
            #[cfg(not(target_arch = "wasm32"))]
            send,
            #[cfg(not(target_arch = "wasm32"))]
            receive,
        }
    }
}
impl Drop for Jobs {
    fn drop(&mut self) {
        self.invalidate();
    }
}
impl Jobs {
    fn alive(&self) -> Result<(), String> {
        self.fault.as_ref().map_or(Ok(()), |e| Err(e.clone()))
    }
    fn invalidate(&mut self) {
        for entry in self.entries.values() {
            entry.cancelled.store(true, Ordering::Relaxed);
        }
        self.entries.clear();
    }
    pub fn loaded(&mut self) {
        self.loading = false;
    }
    #[cfg(feature = "preview-tools")]
    pub fn profile_start(&mut self) {
        self.profile_id += 1;
        self.profile_active = true;
        self.metrics = Metrics::default();
    }
    #[cfg(feature = "preview-tools")]
    pub fn profile_stop(&mut self) {
        self.profile_active = false;
    }
    #[cfg(feature = "dev-tools")]
    pub fn reload_candidate(&self) -> Self {
        let mut candidate = Self::default();
        candidate.operations = self.operations.clone();
        candidate.epoch = self.epoch + 1;
        #[cfg(not(target_arch = "wasm32"))]
        {
            candidate.pool = self.pool.clone();
        }
        candidate
    }
    pub fn register(&mut self, id: String, source: String) -> Result<(), String> {
        self.alive()?;
        if !self.loading {
            return Err(err("JOB_REGISTER_DURING_PLAY"));
        }
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err(err("JOB_OPERATION_INVALID"));
        }
        if source.is_empty() || source.len() > MAX_SOURCE {
            return Err(err("JOB_SOURCE_LIMIT"));
        }
        if !self.operations.contains_key(&id) && self.operations.len() >= MAX_OPERATIONS {
            return Err(err("JOB_OPERATION_LIMIT"));
        }
        self.operations.insert(
            id,
            Operation {
                hash: hash(source.as_bytes()),
                source: source.into(),
            },
        );
        Ok(())
    }
    pub fn submit(&mut self, operation: String, input: Vec<u8>) -> Result<String, String> {
        self.alive()?;
        if !self.updating {
            return Err(err("JOB_SUBMIT_OUTSIDE_UPDATE"));
        }
        let op = self
            .operations
            .get(&operation)
            .ok_or_else(|| err("JOB_OPERATION_UNKNOWN"))?;
        if input.len() > MAX_BYTES {
            return Err(err("JOB_INPUT_TOO_LARGE"));
        }
        if self.entries.len() >= MAX_JOBS || self.submitted >= PER_TICK {
            return Err(err("JOB_LIMIT"));
        }
        if self.reserved() + input.len() + MAX_BYTES > MAX_RESERVED {
            return Err(err("JOB_TOTAL_BYTES_LIMIT"));
        }
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or_else(|| err("JOB_HANDLE_EXHAUSTED"))?;
        let id = format!("{}:{:020}", self.epoch, self.sequence);
        let cancelled = Arc::new(AtomicBool::new(false));
        let entry = Entry {
            operation,
            source_hash: op.hash.clone(),
            input_hash: hash(&input),
            input_len: input.len(),
            submitted: self.frame + 1,
            work: Some(Work {
                id: id.clone(),
                source: Arc::clone(&op.source),
                input,
                cancelled: Arc::clone(&cancelled),
            }),
            reply: None,
            delivered: false,
            cancelled,
        };
        self.entries.insert(id.clone(), entry);
        self.submitted += 1;
        Ok(id)
    }
    fn validate_id(&self, id: &str) -> Result<(), String> {
        let (epoch, _) = id
            .split_once(':')
            .ok_or_else(|| err("JOB_HANDLE_INVALID"))?;
        if epoch.parse::<u64>().ok() != Some(self.epoch) {
            return Err(err("JOB_HANDLE_STALE"));
        }
        if !self.entries.contains_key(id) {
            return Err(err("JOB_HANDLE_EXPIRED_OR_UNKNOWN"));
        }
        Ok(())
    }
    pub fn take(&mut self, id: String) -> Result<Vec<u8>, String> {
        self.alive()?;
        if !self.updating {
            return Err(err("JOB_TAKE_OUTSIDE_UPDATE"));
        }
        self.validate_id(&id)?;
        if !self.entries[&id].delivered {
            return Err(err("JOB_RESULT_NEXT_TICK"));
        }
        self.entries.remove(&id).unwrap().reply.unwrap().output
    }
    pub fn cancel(&mut self, id: String) -> Result<(), String> {
        self.alive()?;
        self.validate_id(&id)?;
        self.entries
            .remove(&id)
            .unwrap()
            .cancelled
            .store(true, Ordering::Relaxed);
        Ok(())
    }
    pub fn reset(&mut self) -> Result<(), String> {
        self.alive()?;
        self.epoch = self
            .epoch
            .checked_add(1)
            .ok_or_else(|| err("JOB_HANDLE_EXHAUSTED"))?;
        self.invalidate();
        self.sequence = 0;
        Ok(())
    }
    fn accept(&mut self, reply: Reply) {
        if let Some(entry) = self.entries.get_mut(&reply.id) {
            entry.reply = Some(reply);
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    fn drain(&mut self) {
        while let Ok(reply) = self.receive.try_recv() {
            self.accept(reply);
        }
    }
    pub fn begin(&mut self, frame: u64) -> Result<(), String> {
        self.alive()?;
        let started = Instant::now();
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.drain();
            while self
                .entries
                .values()
                .any(|e| !e.delivered && e.reply.is_none())
            {
                let reply = self
                    .receive
                    .recv()
                    .map_err(|_| err("JOB_EXECUTOR_DISCONNECTED"))?;
                self.accept(reply);
            }
        }
        let recording = self.profile_id == 0 || self.profile_active;
        if recording {
            self.metrics.barrier_ms += started.elapsed().as_secs_f64() * 1000.;
        }
        if let Some(error) = self
            .entries
            .values()
            .filter_map(|e| e.reply.as_ref())
            .find_map(|r| r.output.as_ref().err())
            .cloned()
        {
            self.fail(error.clone());
            return Err(error);
        }
        for (id, entry) in &mut self.entries {
            if !entry.delivered {
                let reply = entry
                    .reply
                    .as_ref()
                    .expect("committed job has a result at barrier");
                let output = reply.output.as_ref().unwrap();
                entry.delivered = true;
                if !recording {
                    continue;
                }
                self.metrics.completed += 1;
                self.metrics.input_bytes += entry.input_len as u64;
                self.metrics.output_bytes += output.len() as u64;
                self.metrics.execution_ms += reply.run_ms;
                if self.metrics.recent.len() == 64 {
                    self.metrics.recent.pop_front();
                }
                self.metrics.recent.push_back(serde_json::json!({"job":id,"operation":entry.operation,"submit_tick":entry.submitted,
                    "deliver_tick":frame+1,"input_bytes":entry.input_len,"output_bytes":output.len(),"execution_ms":reply.run_ms}));
            }
        }
        self.frame = frame;
        self.updating = true;
        self.submitted = 0;
        Ok(())
    }
    pub fn finish(&mut self) -> Result<(), String> {
        let result = self.finish_inner();
        if let Err(error) = &result {
            self.fail(error.clone());
        }
        result
    }
    fn finish_inner(&mut self) -> Result<(), String> {
        self.updating = false;
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.drain();
            if !self.inline
                && self.entries.values().any(|e| e.work.is_some())
                && self.pool.is_none()
            {
                self.pool = Some(Arc::new(Pool::new()?));
            }
        }
        let ids: Vec<_> = self
            .entries
            .iter()
            .filter(|(_, e)| e.work.is_some())
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            let work = self.entries.get_mut(&id).unwrap().work.take().unwrap();
            if self.inline {
                self.accept(execute(work));
                continue;
            }
            #[cfg(not(target_arch = "wasm32"))]
            self.pool
                .as_ref()
                .unwrap()
                .send
                .as_ref()
                .unwrap()
                .send((work, self.send.clone()))
                .map_err(|_| err("JOB_EXECUTOR_DISCONNECTED"))?;
        }
        Ok(())
    }
    pub fn fail(&mut self, error: String) {
        self.fault = Some(error);
        self.updating = false;
        self.profile_active = false;
        self.invalidate();
    }
    fn reserved(&self) -> usize {
        self.entries.values().map(|e| e.input_len + MAX_BYTES).sum()
    }
    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({"epoch":self.epoch,"sequence":self.sequence,
            "operations":self.operations.iter().map(|(id,op)|serde_json::json!({"id":id,"source_sha256":op.hash})).collect::<Vec<_>>(),
            "jobs":self.entries.iter().map(|(id,e)|serde_json::json!({"id":id,"operation":e.operation,"source_sha256":e.source_hash,
                "input_sha256":e.input_hash,"submit_tick":e.submitted,"delivered":e.delivered,
                "output_sha256":if e.delivered {e.reply.as_ref().and_then(|r|r.output.as_ref().ok()).map(|b|hash(b))} else {None}})).collect::<Vec<_>>()})
    }
    pub fn report(&self) -> serde_json::Value {
        serde_json::json!({"fault":self.fault,"profile_id":self.profile_id,"profile_active":self.profile_active,"scope":"Totals record jobs delivered within the measurement window; active counts are live. Without an explicit window, totals cover runtime lifetime.",
            "backend":if self.inline {if cfg!(target_arch="wasm32") {"wasm-inline"} else {"native-inline-test"}} else {"native-thread-pool"},
            "parallel":!self.inline,"workers":if self.inline {0} else {2},
            "active_jobs":self.entries.len(),"reserved_payload_bytes":self.reserved(),"totals":self.metrics,"recent":self.metrics.recent,
            "limits":{"active_jobs":MAX_JOBS,"submissions_per_tick":PER_TICK,"input_or_output_bytes":MAX_BYTES,"reserved_payload_bytes":MAX_RESERVED,
                "operation_source_bytes":MAX_SOURCE,"operations":MAX_OPERATIONS,"vm_bytes_per_worker":VM_BYTES,"safe_points_per_job":SAFE_POINTS},
            "note":"Native background jobs join before next update; WASM computes inline after update. Safe-point budget/cancellation is cooperative, not a hard native wall-time deadline. Timings include VM setup/compile/copy. Not an arbitrary WASM module executor."})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{observation_digest, EngineRuntime, HostProject};
    const SOURCE: &str = r#"
local id=nil
local n=0
return {start=function(api)
 api.jobs.register('twice', [[return function(input)
   local output=buffer.create(buffer.len(input))
   for i=0,buffer.len(input)/4-1 do buffer.writeu32(output,i*4,buffer.readu32(input,i*4)*2) end
   return output
 end]])
end, update=function(api)
 if id then local output=api.jobs.take(id);api.observation.set('value',buffer.readu32(output,0)) end
 n+=1;local input=buffer.create(4);buffer.writeu32(input,0,n)
 id=api.jobs.submit('twice',input);buffer.writeu32(input,0,999)
end}
"#;
    fn runtime(source: &str) -> EngineRuntime {
        HostProject::parse(&serde_json::to_vec(&serde_json::json!({"config":{"name":"jobs-test","systems":{"jobs":true}},"script":source})).unwrap()).unwrap().into_runtime(42).unwrap()
    }
    #[test]
    fn real_lua_jobs_copy_input_and_match_inline_replay_every_tick() {
        let mut threaded = runtime(SOURCE);
        let mut inline = runtime(SOURCE);
        inline.jobs.borrow_mut().inline = true;
        for frame in 1..=30 {
            let a = threaded.tick().unwrap();
            let b = inline.tick().unwrap();
            assert_eq!(
                observation_digest(&a).unwrap(),
                observation_digest(&b).unwrap()
            );
            if frame > 1 {
                assert_eq!(a.observations["value"], (frame - 1) * 2);
            }
            assert_eq!(a.jobs.as_ref().unwrap()["jobs"][0]["delivered"], false);
        }
        assert_eq!(threaded.jobs_report().unwrap()["totals"]["completed"], 29);
    }
    #[test]
    fn early_take_unknown_operation_and_wrong_phase_fail_without_silent_success() {
        let mut r=runtime("return {start=function(api) api.jobs.register('a','return function(b) return b end') end, update=function(api) local id=api.jobs.submit('a',buffer.create(0));api.jobs.take(id) end}");
        assert!(r
            .tick()
            .unwrap_err()
            .explanation
            .contains("JOB_RESULT_NEXT_TICK"));
        assert_eq!(r.observe().frame, 0);
        let mut r=runtime("return {start=function() end, update=function(api) api.jobs.submit('missing',buffer.create(0)) end}");
        assert!(r
            .tick()
            .unwrap_err()
            .explanation
            .contains("JOB_OPERATION_UNKNOWN"));
    }
    #[test]
    fn cancellation_and_game_reset_reject_late_handles() {
        let mut r = runtime(
            r#"local id=nil;return {start=function(api)api.jobs.register('a','return function(b) return b end')end,
          update=function(api)
            if id then api.jobs.reset();assert(not pcall(function() api.jobs.take(id) end)) end
            local cancelled=api.jobs.submit('a',buffer.create(4));api.jobs.cancel(cancelled)
            assert(not pcall(function()api.jobs.take(cancelled)end))
            id=api.jobs.submit('a',buffer.create(4))
          end}"#,
        );
        for _ in 0..10 {
            r.tick().unwrap();
        }
        assert_eq!(r.jobs.borrow().entries.len(), 1);
    }
    #[test]
    fn unconsumed_results_and_submission_limits_are_bounded() {
        let mut r = runtime(
            r#"return {start=function(api)api.jobs.register('a','return function(b) return b end')end,
          update=function(api) api.jobs.submit('a',buffer.create(4)) end}"#,
        );
        for _ in 0..15 {
            r.tick().unwrap();
        }
        assert!(r
            .tick()
            .unwrap_err()
            .explanation
            .contains("JOB_TOTAL_BYTES_LIMIT"));
        let mut jobs = Jobs::default();
        jobs.register("a".into(), "return function(b)return b end".into())
            .unwrap();
        jobs.loaded();
        jobs.begin(0).unwrap();
        for _ in 0..PER_TICK {
            jobs.submit("a".into(), vec![]).unwrap();
        }
        assert!(jobs
            .submit("a".into(), vec![])
            .unwrap_err()
            .contains("JOB_LIMIT"));
    }
    #[test]
    fn errors_and_memory_budget_fail_at_the_next_barrier() {
        for function in [
            "return function(b)error('test')end",
            "return function(b)return buffer.create(20000000)end",
            "while true do end",
        ] {
            let mut jobs = Jobs::default();
            jobs.register("a".into(), function.into()).unwrap();
            jobs.loaded();
            jobs.begin(0).unwrap();
            jobs.submit("a".into(), vec![]).unwrap();
            jobs.finish().unwrap();
            assert!(jobs.begin(1).unwrap_err().contains("JOB_EXECUTION_FAILED"));
            assert!(jobs.entries.is_empty());
            assert!(jobs.begin(1).is_err());
        }
    }
    #[test]
    fn worker_has_no_world_rng_clock_or_print_and_returns_buffer_only() {
        for source in [
            "return function(b)return api.entity end",
            "return function(b)return math.random()end",
            "return function(b)return os.clock()end",
            "return function(b)print('bad');return b end",
            "return function(b)return 4 end",
        ] {
            let reply = execute(Work {
                id: "test".into(),
                source: source.into(),
                input: vec![],
                cancelled: Arc::new(AtomicBool::new(false)),
            });
            assert!(reply.output.is_err(), "{source}");
        }
    }
    #[test]
    #[cfg(all(feature = "preview-tools", feature = "dev-tools"))]
    fn reload_is_transactional_and_profile_totals_freeze() {
        let mut r = runtime(SOURCE);
        r.tick().unwrap();
        let before = observation_digest(&r.observe()).unwrap();
        assert!(r.reload_source("return {start=function()end,update=function()end,onReload=function(api)api.jobs.reset();error('bad candidate')end}").is_err());
        assert_eq!(observation_digest(&r.observe()).unwrap(), before);
        r.tick().unwrap();
        assert_eq!(r.observe().observations["value"], 2);
        r.preview_request(crate::PreviewRequest::ProfileStart { sampling: false })
            .unwrap();
        r.tick().unwrap();
        let stopped = r
            .preview_request(crate::PreviewRequest::ProfileStop {})
            .unwrap();
        assert_eq!(stopped["jobs"]["totals"]["completed"], 1);
        r.tick().unwrap();
        let later = r
            .preview_request(crate::PreviewRequest::Profile {})
            .unwrap();
        assert_eq!(later["jobs"]["totals"], stopped["jobs"]["totals"]);
        assert_eq!(later["jobs"]["recent"], stopped["jobs"]["recent"]);
        let old = r.jobs.borrow().entries.keys().next().unwrap().clone();
        r.reload_source("return {start=function()end,update=function()end,onReload=function(api)api.jobs.register('twice','return function(b)return b end')end}").unwrap();
        assert!(r
            .jobs
            .borrow()
            .validate_id(&old)
            .unwrap_err()
            .contains("JOB_HANDLE_STALE"));
        assert!(r.jobs.borrow().entries.is_empty());
        r.tick().unwrap();
    }
    #[test]
    #[ignore = "manual release-only throughput experiment, not a timing assertion"]
    #[cfg(all(feature = "dev-tools", not(target_arch = "wasm32")))]
    fn native_pool_benchmark() {
        assert!(!cfg!(debug_assertions),"Run cargo test --release -p unone-engine native_pool_benchmark -- --ignored --nocapture");
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../_Games/jobs-lab");
        let source = std::fs::read_to_string(root.join("main.luau"))
            .unwrap()
            .replace("local verify=true", "local verify=false");
        let scene: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("scene.json")).unwrap()).unwrap();
        let config: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("project.unone.json")).unwrap())
                .unwrap();
        let payload =
            serde_json::to_vec(&serde_json::json!({"config":config,"script":source,"scene":scene}))
                .unwrap();
        let direct_payload=serde_json::to_vec(&serde_json::json!({"config":config,"script":source.replace("local useJobs=true","local useJobs=false"),"scene":scene})).unwrap();
        let mut direct_checks = Vec::new();
        let mut direct_raw = Vec::new();
        let mut direct = HostProject::parse(&direct_payload)
            .unwrap()
            .into_runtime(42)
            .unwrap();
        for _ in 0..20 {
            direct.tick().unwrap();
        }
        for _ in 0..120 {
            let at = Instant::now();
            let snapshot = direct.tick().unwrap();
            direct_raw.push(at.elapsed().as_secs_f64() * 1000.);
            direct_checks.push(snapshot.observations["checksum"].clone());
        }
        let mut direct_sorted = direct_raw.clone();
        direct_sorted.sort_by(f64::total_cmp);
        let mut pairs = Vec::new();
        for pair in 0..3 {
            let mut runs = BTreeMap::new();
            let mut checkpoints = BTreeMap::new();
            for inline in if pair % 2 == 0 {
                [true, false]
            } else {
                [false, true]
            } {
                let name = if inline { "inline" } else { "threads" };
                let mut r = HostProject::parse(&payload)
                    .unwrap()
                    .into_runtime(42)
                    .unwrap();
                r.jobs.borrow_mut().inline = inline;
                for _ in 0..20 {
                    r.tick().unwrap();
                }
                r.jobs.borrow_mut().metrics = Metrics::default();
                let mut raw = Vec::new();
                let mut digests = Vec::new();
                for _ in 0..120 {
                    let at = Instant::now();
                    let snapshot = r.tick().unwrap();
                    raw.push(at.elapsed().as_secs_f64() * 1000.);
                    assert_eq!(
                        snapshot.observations["checksum"],
                        direct_checks[digests.len()]
                    );
                    digests.push(observation_digest(&snapshot).unwrap());
                }
                let mut sorted = raw.clone();
                sorted.sort_by(f64::total_cmp);
                runs.insert(name,serde_json::json!({"mean_ms":raw.iter().sum::<f64>()/raw.len() as f64,
                    "p95_ms":sorted[(sorted.len()*95).div_ceil(100)-1],"raw_ms":raw,"jobs":r.jobs_report()}));
                checkpoints.insert(name, digests);
            }
            assert_eq!(checkpoints["inline"], checkpoints["threads"]);
            pairs.push(serde_json::json!({"order":if pair%2==0 {["inline","threads"]} else {["threads","inline"]},"runs":runs,"every_tick_digest_equal":true}));
        }
        println!(
            "JOBS_BENCH {}",
            serde_json::json!({"profile":"release","payload_sha256":hash(&payload),"seed":42,
            "warmup":20,"frames":120,"direct_main_lua":{"mean_ms":direct_raw.iter().sum::<f64>()/120.,"p95_ms":direct_sorted[113],"raw_ms":direct_raw,"note":"Single reference run before alternating pairs; gameplay checksum matches each tick, jobs state differs. Includes no isolated VM startup/compile/copy/interrupt overhead."},"pairs":pairs,"note":"Alternating native inline vs two-thread isolated Luau executor; reference validation off, renderer excluded. Steady-state tick throughput, not browser FPS or a benefit for every kernel. Game keeps four 1024-value batches per tick."})
        );
    }
}
