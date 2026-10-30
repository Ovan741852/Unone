//! Fixed-tick ownership and delivery for reusable batched geometry work.
use crate::spatial::{
    CpuSpatialExecutor, SpatialBatch, SpatialBatchResult, SpatialBody, SpatialExecutor, SpatialQuery,
    SpatialExecutionProfile, SpatialExecutionPhases,
    validate_batch_detailed, validate_bodies_detailed, validate_result_detailed,
};
use serde::Serialize;
use crate::diagnostics::{EngineDiagnostic, InputDiagnostic};
use super::spatial_metrics::{SpatialBindingProfile, SpatialBindingSample};
use std::{cell::{Cell, RefCell}, collections::BTreeMap, rc::Rc, time::Instant};

const MAX_INDICES: usize = 8;
const MAX_BODIES: usize = 131_072;
const MAX_TICK_SUBMISSIONS: usize = 4;
const MAX_TICKETS: usize = 16;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone)]
struct Index {
    version: u32,
    bodies: Vec<SpatialBody>,
    /// Content digest for world snapshots, computed once per version.
    digest: std::cell::OnceCell<String>,
}

impl Index {
    fn new(version: u32, bodies: Vec<SpatialBody>) -> Self {
        Self { version, bodies, digest: std::cell::OnceCell::new() }
    }

    fn digest(&self) -> &str {
        self.digest.get_or_init(|| crate::spatial::bodies_digest(&self.bodies))
    }
}

struct Ticket {
    submitted: u64,
    batch: SpatialBatch,
    /// Digest of the frozen batch (index content digest, version, queries).
    batch_digest: String,
    dispatched: bool,
    drained: bool,
    delivered: bool,
    result: Option<SpatialBatchResult>,
    manager_ms: ManagerTimings,
}

#[derive(Clone, Default, Serialize)]
struct ManagerTimings {
    snapshot: f64,
    validation: f64,
    result_validation: f64,
    result_apply: f64,
}

#[derive(Default, Serialize)]
struct ProfileTotals {
    submitted_batches: u64,
    completed_batches: u64,
    cancelled_tickets: u64,
    failed_batches: u64,
    bodies: u64,
    queries: u64,
    pair_tests_upper_bound: u64,
    returned_hits: u64,
    input_body_bytes: u64,
    upload_bytes: u64,
    readback_bytes: u64,
    manager_ms: ManagerTimings,
    executor_ms: f64,
    executor_phases_ms: SpatialExecutionPhases,
    executor_samples: u64,
    executor_wall_samples: u64,
}

#[derive(Default)]
struct Profile {
    totals: ProfileTotals,
    last: Option<serde_json::Value>,
    bindings: SpatialBindingProfile,
}

fn elapsed_ms(started: Instant) -> f64 { started.elapsed().as_secs_f64() * 1000.0 }
fn add_count(total: &mut u64, value: u64) { *total = total.saturating_add(value).min(MAX_SAFE_INTEGER); }
fn add_time(total: &mut f64, value: f64) { *total = (*total + value).min(MAX_SAFE_INTEGER as f64); }
fn add_phase(total: &mut Option<f64>, value: Option<f64>) {
    if let Some(value) = value { *total = Some((total.unwrap_or(0.0) + value).min(MAX_SAFE_INTEGER as f64)); }
}

#[derive(Clone)]
enum Backend {
    Local(Rc<RefCell<Box<dyn SpatialExecutor>>>),
    External(String),
}

/// One immutable, validated batch for an official host's compute backend.
#[derive(Debug, Clone, Serialize)]
pub struct SpatialTask {
    pub id: u64,
    pub batch: SpatialBatch,
}

pub struct SpatialJobs {
    indices: BTreeMap<u64, Index>,
    tickets: BTreeMap<u64, Ticket>,
    outbound: Vec<u64>,
    sequence: Rc<Cell<u64>>,
    used: bool,
    backend: Backend,
    frame: u64,
    begun: bool,
    startup: bool,
    active: bool,
    submitted: usize,
    fault: Option<String>,
    profile: Profile,
    last_diagnostic: RefCell<Option<EngineDiagnostic>>,
}

impl Default for SpatialJobs {
    fn default() -> Self {
        Self::new()
    }
}

impl SpatialJobs {
    pub(crate) fn record_binding(&mut self, sample: SpatialBindingSample) {
        self.profile.bindings.record(sample);
    }

    pub fn new() -> Self {
        Self {
            indices: BTreeMap::new(),
            tickets: BTreeMap::new(),
            outbound: Vec::new(),
            sequence: Rc::new(Cell::new(0)),
            used: false,
            backend: Backend::Local(Rc::new(RefCell::new(Box::new(CpuSpatialExecutor::default())))),
            frame: 0,
            begun: false,
            startup: true,
            active: false,
            submitted: 0,
            fault: None,
            profile: Profile::default(),
            last_diagnostic: RefCell::new(None),
        }
    }

    /// Reload is transactional: old indices survive, old tickets do not.
    /// Candidates cannot submit work during onReload; their allocator commits
    /// only with the candidate, so failed reloads preserve future live handles.
    #[cfg(any(feature = "dev-tools", test))]
    pub fn reload_candidate(&self) -> Self {
        Self {
            indices: self.indices.clone(),
            tickets: BTreeMap::new(),
            outbound: Vec::new(),
            sequence: Rc::new(Cell::new(self.sequence.get())),
            used: self.used,
            backend: self.backend.clone(),
            frame: self.frame,
            begun: false,
            startup: true,
            active: false,
            submitted: 0,
            fault: None,
            profile: Profile::default(),
            last_diagnostic: RefCell::new(None),
        }
    }

    /// Diagnostics are observer state: never part of a snapshot or replay digest.
    pub fn last_diagnostic(&self) -> Option<EngineDiagnostic> {
        self.last_diagnostic.borrow().clone()
    }

    pub(crate) fn record_input(&self, operation: &str, issue: InputDiagnostic, index: Option<u64>, ticket: Option<u64>) -> String {
        let message = issue.message.clone();
        self.record(EngineDiagnostic::input(operation, issue), index, ticket);
        message
    }

    fn validation_failure(&self, operation: &str, code: &str, issue: InputDiagnostic, terminal: bool, ticket: u64) -> String {
        let message=issue.message.clone();
        let mut diagnostic=EngineDiagnostic::input(operation,issue);
        diagnostic.code=code.into();
        if terminal {
            diagnostic.recovery.retry="new_session".into();
            diagnostic.recovery.action="Repair the executor contract and create a new runtime or successfully reload.".into();
            diagnostic.terminal=true;
            diagnostic.recoverable=false;
        } else {
            diagnostic.recovery.action="Correct the host completion and resubmit this pending ticket; its state is unchanged.".into();
        }
        self.record(diagnostic,None,Some(ticket));
        message
    }

    fn record(&self, mut diagnostic: EngineDiagnostic, index: Option<u64>, ticket: Option<u64>) {
        diagnostic.context.frame = self.frame;
        diagnostic.context.index = index;
        diagnostic.context.ticket = ticket;
        *self.last_diagnostic.borrow_mut() = Some(diagnostic);
    }

    fn reject(&self, operation: &str, code: &str, message: &str, retry: &str,
        action: &str, index: Option<u64>, ticket: Option<u64>) -> String {
        let mut diagnostic = EngineDiagnostic::new(code, operation, message, retry, action);
        if code == "SPATIAL_INDEX_UNKNOWN" || code == "SPATIAL_TICKET_UNKNOWN" {
            diagnostic.path = Some(if index.is_some() { "index" } else { "ticket" }.into());
            diagnostic.actual = Some(serde_json::json!(index.or(ticket)));
            diagnostic.expected = Some(serde_json::json!("a currently live handle owned by this runtime"));
        }
        self.record(diagnostic, index, ticket);
        message.into()
    }

    fn alive(&self, operation: &str, index: Option<u64>, ticket: Option<u64>) -> Result<(), String> {
        match &self.fault {
            Some(error) => Err(self.reject(operation, "SPATIAL_FAILED", &format!("SPATIAL_FAILED: {error}"),
                "new_session", "Create a new runtime or successfully reload before issuing spatial work.", index, ticket)),
            None => Ok(()),
        }
    }

    fn write_phase(&self, operation: &str, index: Option<u64>) -> Result<(), String> {
        self.alive(operation, index, None)?;
        if !self.startup && !self.active {
            return Err(self.reject(operation, "SPATIAL_WRITE_OUTSIDE_START_OR_UPDATE", "SPATIAL_WRITE_OUTSIDE_START_OR_UPDATE",
                "next_tick", "Call this operation in start/onReload or a later update callback.", index, None));
        }
        Ok(())
    }

    fn update_phase(&self, operation: &str, ticket: Option<u64>) -> Result<(), String> {
        self.alive(operation, None, ticket)?;
        if !self.active {
            return Err(self.reject(operation, "SPATIAL_OUTSIDE_UPDATE", "SPATIAL_OUTSIDE_UPDATE",
                "next_tick", "Call this operation from a later update callback.", None, ticket));
        }
        Ok(())
    }

    fn allocate(&self, operation: &str) -> Result<u64, String> {
        let next = self.sequence.get().checked_add(1)
            .filter(|id| *id <= MAX_SAFE_INTEGER)
            .ok_or_else(|| self.reject(operation, "SPATIAL_HANDLE_EXHAUSTED", "SPATIAL_HANDLE_EXHAUSTED", "new_session", "Create a new runtime; handle identifiers cannot wrap or be reused.", None, None))?;
        self.sequence.set(next);
        Ok(next)
    }

    pub fn create(&mut self, bodies: Vec<SpatialBody>) -> Result<u64, String> {
        self.write_phase("spatial.create", None)?;
        validate_bodies_detailed(&bodies).map_err(|issue| self.record_input("spatial.create", issue, None, None))?;
        if self.indices.len() >= MAX_INDICES || self.body_count() + bodies.len() > MAX_BODIES {
            return Err(self.reject("spatial.create", "SPATIAL_INDEX_LIMIT", "SPATIAL_INDEX_LIMIT", "after_release", "Destroy an unused index or reduce the total body count, then retry.", None, None));
        }
        let id = self.allocate("spatial.create")?;
        self.used = true;
        self.indices.insert(id, Index::new(1, bodies));
        Ok(id)
    }

    pub fn update(&mut self, id: u64, bodies: Vec<SpatialBody>) -> Result<u64, String> {
        self.write_phase("spatial.update", Some(id))?;
        let index = self.indices.get(&id).ok_or_else(|| self.reject("spatial.update", "SPATIAL_INDEX_UNKNOWN", "SPATIAL_INDEX_UNKNOWN", "after_correction", "Use a live index from spatial.create.", Some(id), None))?;
        validate_bodies_detailed(&bodies).map_err(|issue| self.record_input("spatial.update", issue, Some(id), None))?;
        if self.body_count() - index.bodies.len() + bodies.len() > MAX_BODIES {
            return Err(self.reject("spatial.update", "SPATIAL_INDEX_LIMIT", "SPATIAL_INDEX_LIMIT", "after_release", "Destroy an unused index or reduce the total body count, then retry.", Some(id), None));
        }
        let version = index.version.checked_add(1)
            .ok_or_else(|| self.reject("spatial.update", "SPATIAL_VERSION_EXHAUSTED", "SPATIAL_VERSION_EXHAUSTED", "after_release", "Destroy and recreate the index; versions cannot wrap.", Some(id), None))?;
        self.indices.insert(id, Index::new(version, bodies));
        Ok(u64::from(version))
    }

    pub fn destroy(&mut self, id: u64) -> Result<(), String> {
        self.write_phase("spatial.destroy", Some(id))?;
        if !self.indices.contains_key(&id) { return Err(self.reject("spatial.destroy", "SPATIAL_INDEX_UNKNOWN", "SPATIAL_INDEX_UNKNOWN", "after_correction", "Use a live index from spatial.create.", Some(id), None)); }
        self.indices.remove(&id);
        Ok(())
    }

    pub fn submit(&mut self, id: u64, queries: Vec<SpatialQuery>) -> Result<u64, String> {
        self.update_phase("spatial.submit", None)?;
        if self.submitted >= MAX_TICK_SUBMISSIONS {
            return Err(self.reject("spatial.submit", "SPATIAL_TICKET_LIMIT", "SPATIAL_TICKET_LIMIT", "next_tick", "Submit in the next update; cancelling tickets does not restore this tick's submission budget.", Some(id), None));
        }
        if self.tickets.len() >= MAX_TICKETS {
            return Err(self.reject("spatial.submit", "SPATIAL_TICKET_LIMIT", "SPATIAL_TICKET_LIMIT", "after_release", "Take or cancel retained tickets before submitting more work.", Some(id), None));
        }
        let index = self.indices.get(&id).ok_or_else(|| self.reject("spatial.submit", "SPATIAL_INDEX_UNKNOWN", "SPATIAL_INDEX_UNKNOWN", "after_correction", "Use a live index from spatial.create.", Some(id), None))?;
        let started = Instant::now();
        let batch = SpatialBatch { version: index.version, bodies: index.bodies.clone(), queries };
        let snapshot_ms = elapsed_ms(started);
        let started = Instant::now();
        validate_batch_detailed(&batch).map_err(|issue| self.record_input("spatial.submit", issue, Some(id), None))?;
        let validation_ms = elapsed_ms(started);
        let batch_digest = {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(index.digest().as_bytes());
            hasher.update(batch.version.to_le_bytes());
            hasher.update(serde_json::to_vec(&batch.queries).map_err(|error| error.to_string())?);
            format!("{:x}", hasher.finalize())
        };
        let ticket = self.allocate("spatial.submit")?;
        self.used = true;
        let totals = &mut self.profile.totals;
        add_count(&mut totals.submitted_batches, 1);
        add_count(&mut totals.bodies, batch.bodies.len() as u64);
        add_count(&mut totals.queries, batch.queries.len() as u64);
        add_count(&mut totals.pair_tests_upper_bound, (batch.bodies.len() * batch.queries.len()) as u64);
        add_count(&mut totals.input_body_bytes, (8 + crate::spatial::PACKED_BODY_BYTES * batch.bodies.len()) as u64);
        add_time(&mut totals.manager_ms.snapshot, snapshot_ms);
        add_time(&mut totals.manager_ms.validation, validation_ms);
        self.tickets.insert(ticket, Ticket {
            submitted: self.frame,
            batch,
            batch_digest,
            dispatched: false,
            drained: false,
            delivered: false,
            result: None,
            manager_ms: ManagerTimings { snapshot: snapshot_ms, validation: validation_ms, ..Default::default() },
        });
        self.submitted += 1;
        Ok(ticket)
    }

    pub fn take(&mut self, id: u64) -> Result<SpatialBatchResult, String> {
        self.update_phase("spatial.take", Some(id))?;
        let entry = self.tickets.get(&id).ok_or_else(|| self.reject("spatial.take", "SPATIAL_TICKET_UNKNOWN", "SPATIAL_TICKET_UNKNOWN", "after_correction", "Use an unconsumed live ticket from spatial.submit.", None, Some(id)))?;
        if !entry.delivered {
            return Err(self.reject("spatial.take", "SPATIAL_RESULT_NEXT_TICK", "SPATIAL_RESULT_NEXT_TICK", "next_tick", "Take this ticket in the next update; do not branch gameplay on host readiness.", None, Some(id)));
        }
        Ok(self.tickets.remove(&id).expect("ticket checked above").result
            .expect("delivered ticket has a validated result"))
    }

    pub fn cancel(&mut self, id: u64) -> Result<(), String> {
        self.update_phase("spatial.cancel", Some(id))?;
        if !self.tickets.contains_key(&id) { return Err(self.reject("spatial.cancel", "SPATIAL_TICKET_UNKNOWN", "SPATIAL_TICKET_UNKNOWN", "after_correction", "Use an unconsumed live ticket from spatial.submit.", None, Some(id))); }
        self.tickets.remove(&id);
        add_count(&mut self.profile.totals.cancelled_tickets, 1);
        self.outbound.retain(|queued| *queued != id);
        Ok(())
    }

    pub fn begin(&mut self, frame: u64) -> Result<(), String> {
        self.alive("spatial.begin", None, None)?;
        if self.active || (self.begun && frame <= self.frame) {
            return Err(self.reject("spatial.begin", "SPATIAL_FRAME_INVALID", "SPATIAL_FRAME_INVALID", "after_correction", "Complete the active tick and provide a strictly increasing frame number.", None, None));
        }
        if self.tickets.values().any(|entry| entry.result.is_none()) {
            return Err(self.reject("spatial.begin", "SPATIAL_PENDING", "SPATIAL_PENDING: host must complete all previous batches before the next tick", "after_correction", "The host must complete all previous batches before advancing the fixed tick.", None, None));
        }
        for entry in self.tickets.values_mut() {
            if entry.submitted < frame {
                entry.delivered = true;
            }
        }
        self.frame = frame;
        self.begun = true;
        self.startup = false;
        self.active = true;
        self.submitted = 0;
        Ok(())
    }

    /// Close the initialization/onReload phase before the first update or view.
    pub fn loaded(&mut self) {
        self.startup = false;
    }

    pub fn finish(&mut self) -> Result<(), String> {
        self.update_phase("spatial.finish", None)?;
        self.active = false;
        let result = self.finish_inner();
        if let Err(error) = &result {
            self.fail_state(error.clone());
        }
        result
    }

    fn finish_inner(&mut self) -> Result<(), String> {
        let ids: Vec<u64> = self.tickets.iter().filter(|(_, entry)| !entry.dispatched)
            .map(|(id, _)| *id).collect();
        match &self.backend {
            Backend::Local(executor) => {
                let executor = Rc::clone(executor);
                let mut completed = Vec::with_capacity(ids.len());
                for id in &ids {
                    let batch = &self.tickets[id].batch;
                    let mut executor = executor.borrow_mut();
                    let started = Instant::now();
                    let execution = executor.execute(batch);
                    let executor_ms = elapsed_ms(started);
                    let measured = executor.take_profile();
                    let result = execution.map_err(|message| self.reject("spatial.finish", "SPATIAL_EXECUTOR_FAILED", &message, "new_session", "Inspect the executor failure and create a new runtime or successfully reload.", None, Some(*id)))?;
                    let measured = measured.or_else(|| (executor.name() == "cpu").then(|| SpatialExecutionProfile {
                        clock: "host_monotonic".into(), total_ms: executor_ms,
                        phases_ms: SpatialExecutionPhases { cpu_execute: Some(executor_ms), ..Default::default() },
                        gpu_kernel_unavailable_reason: Some("CPU backend does not dispatch GPU work".into()),
                        upload_bytes: 0, readback_bytes: 0,
                    }));
                    if let Some(profile) = &measured { profile.validate_detailed().map_err(|issue| self.validation_failure("spatial.finish", "SPATIAL_PROFILE_INVALID", issue, true, *id))?; }
                    let started = Instant::now();
                    validate_result_detailed(batch, &result).map_err(|issue| self.validation_failure("spatial.finish", "SPATIAL_RESULT_INVALID", issue, true, *id))?;
                    completed.push((*id, result, measured, executor_ms, elapsed_ms(started)));
                }
                for (id, result, measured, executor_ms, result_validation_ms) in completed {
                    let started = Instant::now();
                    let entry = self.tickets.get_mut(&id).expect("ticket cannot change during execution");
                    entry.dispatched = true;
                    entry.result = Some(result);
                    entry.manager_ms.result_validation = result_validation_ms;
                    entry.manager_ms.result_apply = elapsed_ms(started);
                    self.record_completion(id, measured, executor_ms);
                }
            }
            Backend::External(_) => {
                for id in ids {
                    self.tickets.get_mut(&id).expect("ticket checked above").dispatched = true;
                    self.outbound.push(id);
                }
            }
        }
        Ok(())
    }

    /// A generic failed game tick must not make an unused spatial subsystem
    /// terminal. Once spatial state has been authored, partial Lua/World state
    /// cannot be rolled back and the established fail-closed rule still applies.
    pub fn abort_tick(&mut self, error: String) {
        if self.used {
            self.fail(error);
        } else {
            self.active = false;
            self.begun = false;
        }
    }

    pub fn fail(&mut self, error: String) {
        self.record(EngineDiagnostic::new("SPATIAL_HOST_FAILED", "spatial.fail", &error, "new_session",
            "Inspect the host failure and create a new runtime or successfully reload."), None, None);
        self.fail_state(error);
    }

    fn fail_state(&mut self, error: String) {
        add_count(&mut self.profile.totals.failed_batches, self.tickets.values().filter(|entry| entry.result.is_none()).count() as u64);
        self.active = false;
        self.fault = Some(error);
        self.tickets.clear();
        self.outbound.clear();
    }

    pub fn set_executor(&mut self, executor: Box<dyn SpatialExecutor>) -> Result<(), String> {
        self.can_switch_backend()?;
        if executor.name().is_empty() || executor.name().len() > 64 {
            return Err(self.reject("spatial.setBackend", "SPATIAL_BACKEND_INVALID", "SPATIAL_BACKEND_INVALID", "after_correction", "Supply a nonempty backend name of at most 64 bytes.", None, None));
        }
        self.backend = Backend::Local(Rc::new(RefCell::new(executor)));
        self.profile = Profile::default();
        Ok(())
    }

    pub fn set_external_backend(&mut self, name: String) -> Result<(), String> {
        self.can_switch_backend()?;
        if name.is_empty() || name.len() > 64 {
            return Err(self.reject("spatial.setBackend", "SPATIAL_BACKEND_INVALID", "SPATIAL_BACKEND_INVALID", "after_correction", "Supply a nonempty backend name of at most 64 bytes.", None, None));
        }
        self.backend = Backend::External(name);
        self.profile = Profile::default();
        Ok(())
    }

    fn can_switch_backend(&self) -> Result<(), String> {
        self.alive("spatial.setBackend", None, None)?;
        if self.active || !self.tickets.is_empty() {
            return Err(self.reject("spatial.setBackend", "SPATIAL_BACKEND_BUSY", "SPATIAL_BACKEND_BUSY", "after_release", "Take or cancel all tickets and finish the update before changing backends.", None, None));
        }
        Ok(())
    }

    pub fn drain_tasks(&mut self) -> Vec<SpatialTask> {
        self.outbound.drain(..).filter_map(|id| {
            let entry = self.tickets.get_mut(&id)?;
            entry.drained = true;
            Some(SpatialTask { id, batch: entry.batch.clone() })
        }).collect()
    }

    pub fn complete(&mut self, id: u64, result: SpatialBatchResult) -> Result<(), String> {
        self.complete_with_profile(id, result, None)
    }

    pub fn complete_with_profile(&mut self, id: u64, result: SpatialBatchResult, profile: Option<SpatialExecutionProfile>) -> Result<(), String> {
        self.alive("spatial.complete", None, Some(id))?;
        if !matches!(self.backend, Backend::External(_)) || self.active {
            return Err(self.reject("spatial.complete", "SPATIAL_COMPLETION_OUTSIDE_HOST_PHASE", "SPATIAL_COMPLETION_OUTSIDE_HOST_PHASE", "after_correction", "Complete external work after finish and before the next begin.", None, Some(id)));
        }
        let entry = self.tickets.get(&id).ok_or_else(|| self.reject("spatial.complete", "SPATIAL_TICKET_UNKNOWN", "SPATIAL_TICKET_UNKNOWN", "after_correction", "Complete only a drained, live external ticket; discard stale host replies.", None, Some(id)))?;
        if !entry.dispatched || !entry.drained || entry.result.is_some() {
            return Err(self.reject("spatial.complete", "SPATIAL_COMPLETION_INVALID", "SPATIAL_COMPLETION_INVALID", "after_correction", "Complete each drained external ticket exactly once.", None, Some(id)));
        }
        if let Some(profile) = &profile { profile.validate_detailed().map_err(|issue| self.validation_failure("spatial.complete", "SPATIAL_PROFILE_INVALID", issue, false, id))?; }
        let started = Instant::now();
        validate_result_detailed(&entry.batch, &result).map_err(|issue| self.validation_failure("spatial.complete", "SPATIAL_RESULT_INVALID", issue, false, id))?;
        let result_validation_ms = elapsed_ms(started);
        let started = Instant::now();
        let entry = self.tickets.get_mut(&id).expect("validated ticket remains live");
        entry.result = Some(result);
        entry.manager_ms.result_validation = result_validation_ms;
        entry.manager_ms.result_apply = elapsed_ms(started);
        let executor_ms = profile.as_ref().map_or(0.0, |profile| profile.total_ms);
        self.record_completion(id, profile, executor_ms);
        Ok(())
    }

    fn record_completion(&mut self, id: u64, executor: Option<SpatialExecutionProfile>, executor_ms: f64) {
        let entry = &self.tickets[&id];
        let hits = entry.result.as_ref().expect("completion owns a result").results.iter().map(|result| result.hits.len() as u64).sum();
        let totals = &mut self.profile.totals;
        add_count(&mut totals.completed_batches, 1);
        add_count(&mut totals.returned_hits, hits);
        add_time(&mut totals.manager_ms.result_validation, entry.manager_ms.result_validation);
        add_time(&mut totals.manager_ms.result_apply, entry.manager_ms.result_apply);
        add_time(&mut totals.executor_ms, executor_ms);
        if executor.is_some() || matches!(self.backend, Backend::Local(_)) {
            add_count(&mut totals.executor_wall_samples, 1);
        }
        if let Some(sample) = &executor {
            add_count(&mut totals.executor_samples, 1);
            add_count(&mut totals.upload_bytes, sample.upload_bytes);
            add_count(&mut totals.readback_bytes, sample.readback_bytes);
            let target = &mut totals.executor_phases_ms;
            let source = &sample.phases_ms;
            add_phase(&mut target.preparation, source.preparation);
            add_phase(&mut target.queue_wait, source.queue_wait);
            add_phase(&mut target.validation, source.validation);
            add_phase(&mut target.packing, source.packing);
            add_phase(&mut target.upload, source.upload);
            add_phase(&mut target.encode_submit, source.encode_submit);
            add_phase(&mut target.readback_wait, source.readback_wait);
            add_phase(&mut target.decode, source.decode);
            add_phase(&mut target.cpu_execute, source.cpu_execute);
            add_phase(&mut target.gpu_kernel, source.gpu_kernel);
        }
        self.profile.last = Some(serde_json::json!({
            "ticket": id, "version": entry.batch.version,
            "bodies": entry.batch.bodies.len(), "queries": entry.batch.queries.len(),
            "pair_tests_upper_bound": entry.batch.bodies.len() * entry.batch.queries.len(),
            "returned_hits": hits, "manager_ms": entry.manager_ms,
            "executor_ms": if executor.is_some() || matches!(self.backend, Backend::Local(_)) { Some(executor_ms) } else { None },
            "executor": executor,
            "executor_unavailable_reason": if executor.is_none() { Some("This executor did not provide phase diagnostics; local executor_ms remains measured when available") } else { None },
        }));
    }

    /// Detached, bounded diagnostics. Reading never consumes tickets or changes
    /// execution policy. Timings are intentionally excluded from `snapshot`.
    pub fn profile(&self) -> serde_json::Value {
        let backend = match &self.backend {
            Backend::Local(executor) => executor.borrow().name().to_string(),
            Backend::External(name) => name.clone(),
        };
        serde_json::json!({
            "api_version": 1, "backend": backend, "clock": "host_monotonic",
            "scope": "Successful submissions and completed batches since backend selection or successful reload; invalid API attempts excluded. Manager timings exclude Luau conversion. Executor phases are host wall time, may overlap, and are not GPU kernel time. Pair tests are an upper bound, not measured visits. input_body_bytes is equivalent USB1 payload size, not allocation traffic.",
            "limits": { "retained_completed_batches": 1, "counter_max": MAX_SAFE_INTEGER },
            "totals": self.profile.totals, "last": self.profile.last,
            "bindings": self.profile.bindings,
        })
    }

    fn body_count(&self) -> usize {
        self.indices.values().map(|index| index.bodies.len()).sum()
    }

    /// Canonical inputs describe future observable work without exposing host
    /// scheduling, backend identity, or the timing of an early completion.
    pub fn snapshot(&self) -> Option<serde_json::Value> {
        if !self.used {
            return None;
        }
        Some(serde_json::json!({
            "sequence": self.sequence.get(),
            // Content digests keep deterministic coverage of every body and
            // query without serializing up to 65,536 bodies on each observe.
            "indices": self.indices.iter().map(|(id, index)| serde_json::json!({
                "id": id, "version": index.version, "body_count": index.bodies.len(),
                "bodies_sha256": index.digest(),
            })).collect::<Vec<_>>(),
            "tickets": self.tickets.iter().map(|(id, entry)| serde_json::json!({
                "id": id, "submit_tick": entry.submitted, "delivered": entry.delivered,
                "version": entry.batch.version, "body_count": entry.batch.bodies.len(),
                "query_count": entry.batch.queries.len(), "batch_sha256": entry.batch_digest,
            })).collect::<Vec<_>>(),
        }))
    }

    pub fn info(&self) -> serde_json::Value {
        let (backend, external) = match &self.backend {
            Backend::Local(executor) => (executor.borrow().name().to_string(), false),
            Backend::External(name) => (name.clone(), true),
        };
        serde_json::json!({
            "api_version": 1,
            "backend": backend,
            "external": external,
            "delivery": "next_tick",
            "packed_format": "USB1",
            "operations": ["nearest", "overlap_sphere", "sweep_sphere"],
            "indices": self.indices.len(),
            "bodies": self.body_count(),
            "tickets": self.tickets.len(),
            "pending": self.tickets.values().filter(|entry| entry.result.is_none()).count(),
            "fault": self.fault,
            "limits": {
                "indices": MAX_INDICES,
                "bodies": MAX_BODIES,
                "bodies_per_index": crate::spatial::MAX_BODIES,
                "queries_per_batch": crate::spatial::MAX_QUERIES,
                "hits_per_query": crate::spatial::MAX_HITS,
                "coordinate_abs": crate::spatial::MAX_COORDINATE,
                "submissions_per_tick": MAX_TICK_SUBMISSIONS,
                "tickets": MAX_TICKETS,
                "safe_integer": MAX_SAFE_INTEGER,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(id: u32, x: f32) -> SpatialBody {
        SpatialBody { id, position: [x, 0.0, 0.0], radius: 1.0, category: 1, previous_position: None }
    }

    fn nearest() -> SpatialQuery {
        SpatialQuery::Nearest { point: [0.0; 3], max_distance: 100.0, mask: u32::MAX, exclude_id: None }
    }

    #[test]
    fn structured_input_facts_are_one_based_atomic_and_detached_from_state() {
        let mut jobs = SpatialJobs::new();
        let id = jobs.create(vec![body(3, 0.0)]).unwrap();
        let snapshot = jobs.snapshot();
        let profile = jobs.profile();
        let mut invalid = body(4, 0.0);
        invalid.radius = f32::NAN;
        assert_eq!(jobs.update(id, vec![invalid]).unwrap_err(), "bodies[0].radius must be finite and in 0..=1000000");
        let diagnostic = jobs.last_diagnostic().unwrap();
        assert_eq!(diagnostic.code, "SPATIAL_INPUT_INVALID");
        assert_eq!(diagnostic.operation, "spatial.update");
        assert_eq!(diagnostic.path.as_deref(), Some("bodies[1].radius"));
        assert_eq!(diagnostic.actual, Some(serde_json::json!("NaN")));
        assert_eq!(diagnostic.expected.as_ref().unwrap()["min"], 0);
        assert_eq!(diagnostic.context.index, Some(id));
        assert_eq!(diagnostic.recovery.retry, "after_correction");
        assert!(diagnostic.recoverable && !diagnostic.terminal);
        assert_eq!(snapshot, jobs.snapshot());
        assert_eq!(profile, jobs.profile());
        let mut detached = jobs.last_diagnostic().unwrap();
        detached.code = "caller mutation".into();
        assert_eq!(jobs.last_diagnostic().unwrap(), diagnostic);
        jobs.update(id, vec![body(5, 0.0)]).unwrap();
        assert_eq!(jobs.last_diagnostic().unwrap(), diagnostic);
    }

    #[test]
    fn lifecycle_diagnostics_distinguish_next_tick_and_unknown_ticket() {
        let mut jobs = SpatialJobs::new();
        let index = jobs.create(vec![body(3, 0.0)]).unwrap();
        jobs.begin(10).unwrap();
        let ticket = jobs.submit(index, vec![nearest()]).unwrap();
        assert_eq!(jobs.take(ticket).unwrap_err(), "SPATIAL_RESULT_NEXT_TICK");
        let early = jobs.last_diagnostic().unwrap();
        assert_eq!(early.context.frame, 10);
        assert_eq!(early.context.ticket, Some(ticket));
        assert_eq!(early.recovery.retry, "next_tick");
        jobs.finish().unwrap();
        jobs.begin(11).unwrap();
        jobs.take(ticket).unwrap();
        assert_eq!(jobs.last_diagnostic().unwrap(), early);
        assert_eq!(jobs.take(ticket).unwrap_err(), "SPATIAL_TICKET_UNKNOWN");
        let consumed = jobs.last_diagnostic().unwrap();
        assert_eq!(consumed.path.as_deref(), Some("ticket"));
        assert_eq!(consumed.actual, Some(serde_json::json!(ticket)));
        assert_eq!(consumed.context.frame, 11);
        assert_eq!(consumed.recovery.retry, "after_correction");
    }

    #[test]
    fn unrelated_tick_failure_keeps_unused_spatial_retryable_but_authored_state_is_terminal() {
        let mut jobs = SpatialJobs::new();
        jobs.loaded();
        jobs.begin(0).unwrap();
        jobs.abort_tick("unrelated script error".into());
        assert!(jobs.snapshot().is_none());
        assert!(jobs.last_diagnostic().is_none());
        jobs.begin(0).unwrap();
        jobs.finish().unwrap();
        jobs.begin(1).unwrap();
        jobs.abort_tick("later unrelated script error".into());
        jobs.begin(1).unwrap();
        jobs.create(Vec::new()).unwrap();
        jobs.abort_tick("error after spatial mutation".into());
        assert!(jobs.begin(1).unwrap_err().contains("SPATIAL_FAILED"));

        let mut host_failed = SpatialJobs::new();
        host_failed.fail("explicit host failure".into());
        assert!(host_failed.begin(0).unwrap_err().contains("SPATIAL_FAILED"));
    }

    #[test]
    fn host_result_and_profile_diagnostics_preserve_the_pending_completion() {
        let mut jobs = SpatialJobs::new();
        jobs.set_external_backend("test-gpu".into()).unwrap();
        let index = jobs.create(vec![body(3, 0.0)]).unwrap();
        jobs.begin(10).unwrap();
        let ticket = jobs.submit(index, vec![nearest()]).unwrap();
        jobs.finish().unwrap();
        let task = jobs.drain_tasks().pop().unwrap();
        let result = CpuSpatialExecutor.execute(&task.batch).unwrap();
        let before = jobs.snapshot();
        let profile_before = jobs.profile();
        let mut invalid = result.clone();
        invalid.version += 1;
        assert_eq!(jobs.complete(ticket, invalid).unwrap_err(), "spatial result version does not match the batch");
        let diagnostic = jobs.last_diagnostic().unwrap();
        assert_eq!(diagnostic.code, "SPATIAL_RESULT_INVALID");
        assert_eq!(diagnostic.path.as_deref(), Some("result.version"));
        assert_eq!(diagnostic.actual, Some(serde_json::json!(task.batch.version + 1)));
        assert_eq!(diagnostic.expected, Some(serde_json::json!(task.batch.version)));
        let profile = SpatialExecutionProfile {
            clock: "host_monotonic".into(), total_ms: f64::INFINITY,
            phases_ms: SpatialExecutionPhases::default(),
            gpu_kernel_unavailable_reason: Some("unavailable in fixture".into()),
            upload_bytes: 0, readback_bytes: 0,
        };
        assert!(jobs.complete_with_profile(ticket, result.clone(), Some(profile)).unwrap_err().starts_with("SPATIAL_PROFILE_INVALID:"));
        let diagnostic = jobs.last_diagnostic().unwrap();
        assert_eq!(diagnostic.path.as_deref(), Some("profile.total_ms"));
        assert_eq!(diagnostic.actual, Some(serde_json::json!("inf")));
        assert!(diagnostic.recoverable && !diagnostic.terminal);
        assert_eq!(before, jobs.snapshot());
        assert_eq!(profile_before, jobs.profile());
        jobs.complete(ticket, result).unwrap();
        assert_eq!(jobs.last_diagnostic().unwrap(), diagnostic);
    }

    #[test]
    fn terminal_failures_are_bounded_and_failed_reload_preserves_live_diagnostics() {
        struct Failing;
        impl SpatialExecutor for Failing {
            fn name(&self) -> &str { "failure-fixture" }
            fn execute(&mut self, _: &SpatialBatch) -> Result<SpatialBatchResult, String> { Err("測".repeat(10_000)) }
        }
        let mut jobs = SpatialJobs::new();
        jobs.set_executor(Box::new(Failing)).unwrap();
        let index = jobs.create(vec![body(3, 0.0)]).unwrap();
        jobs.begin(1).unwrap();
        let ticket = jobs.submit(index, vec![nearest()]).unwrap();
        assert_eq!(jobs.finish().unwrap_err(), "測".repeat(10_000));
        let diagnostic = jobs.last_diagnostic().unwrap();
        assert_eq!(diagnostic.code, "SPATIAL_EXECUTOR_FAILED");
        assert_eq!(diagnostic.context.ticket, Some(ticket));
        assert!(!diagnostic.recoverable && diagnostic.terminal);
        assert_eq!(diagnostic.recovery.retry, "new_session");
        assert!(serde_json::to_vec(&diagnostic).unwrap().len() < 4096);
        let candidate = jobs.reload_candidate();
        assert!(candidate.last_diagnostic().is_none());
        assert_eq!(jobs.last_diagnostic().unwrap(), diagnostic);
        let mut candidate = candidate;
        candidate.destroy(index + 100).unwrap_err();
        assert_eq!(jobs.last_diagnostic().unwrap(), diagnostic);
        // A successful reload replaces observer state, just like its profile.
        jobs = jobs.reload_candidate();
        assert!(jobs.last_diagnostic().is_none());
    }

    #[test]
    fn versions_are_frozen_and_tickets_deliver_once_on_next_tick() {
        let mut jobs = SpatialJobs::new();
        assert!(jobs.snapshot().is_none());
        let index = jobs.create(vec![body(5, 5.0)]).unwrap();
        assert!(jobs.submit(index, vec![nearest()]).unwrap_err().contains("OUTSIDE_UPDATE"));
        jobs.begin(0).unwrap();
        assert_eq!(jobs.update(index, vec![body(2, 2.0)]).unwrap(), 2);
        let ticket = jobs.submit(index, vec![nearest()]).unwrap();
        jobs.update(index, vec![body(8, 8.0)]).unwrap();
        jobs.destroy(index).unwrap();
        assert!(jobs.take(ticket).unwrap_err().contains("NEXT_TICK"));
        jobs.finish().unwrap();
        assert!(jobs.take(ticket).unwrap_err().contains("OUTSIDE_UPDATE"));
        assert!(jobs.create(Vec::new()).unwrap_err().contains("OUTSIDE_START_OR_UPDATE"));
        jobs.begin(1).unwrap();
        let result = jobs.take(ticket).unwrap();
        assert_eq!(result.version, 2);
        assert_eq!(result.results[0].hits[0].id, 2);
        assert!(jobs.take(ticket).unwrap_err().contains("UNKNOWN"));
        jobs.finish().unwrap();
    }

    #[test]
    fn external_barrier_rejects_missing_duplicate_and_invalid_completions() {
        let mut jobs = SpatialJobs::new();
        jobs.set_external_backend("test-gpu".into()).unwrap();
        let index = jobs.create(vec![body(3, 1.0)]).unwrap();
        jobs.begin(10).unwrap();
        let ticket = jobs.submit(index, vec![nearest()]).unwrap();
        assert!(jobs.drain_tasks().is_empty());
        jobs.finish().unwrap();
        assert!(jobs.begin(11).unwrap_err().contains("SPATIAL_PENDING"));
        let guessed = CpuSpatialExecutor.execute(&jobs.tickets[&ticket].batch).unwrap();
        assert!(jobs.complete(ticket, guessed).is_err());
        let task = jobs.drain_tasks().pop().unwrap();
        assert_eq!(task.id, ticket);
        assert!(jobs.drain_tasks().is_empty());
        let result = CpuSpatialExecutor.execute(&task.batch).unwrap();
        let mut invalid = result.clone();
        invalid.version += 1;
        assert!(jobs.complete(ticket, invalid).is_err());
        let mut invalid = result.clone();
        invalid.results[0].hits[0].id = 99;
        assert!(jobs.complete(ticket, invalid).is_err());
        assert!(jobs.complete(ticket + 1, result.clone()).is_err());
        jobs.complete(ticket, result.clone()).unwrap();
        assert!(jobs.complete(ticket, result.clone()).is_err());
        jobs.begin(11).unwrap();
        assert_eq!(jobs.take(ticket).unwrap(), result);
        jobs.finish().unwrap();
    }

    #[test]
    fn cancelled_and_failed_ticks_never_dispatch_work() {
        let mut jobs = SpatialJobs::new();
        jobs.set_external_backend("test-gpu".into()).unwrap();
        let index = jobs.create(Vec::new()).unwrap();
        jobs.begin(0).unwrap();
        let cancelled = jobs.submit(index, Vec::new()).unwrap();
        jobs.cancel(cancelled).unwrap();
        let failed = jobs.submit(index, Vec::new()).unwrap();
        assert!(failed > cancelled);
        jobs.fail("script failed".into());
        assert!(jobs.drain_tasks().is_empty());
        assert!(jobs.finish().is_err());
        assert!(jobs.begin(1).is_err());
        assert!(jobs.create(Vec::new()).is_err());
    }

    #[test]
    fn limits_and_invalid_updates_are_atomic() {
        let mut jobs = SpatialJobs::new();
        let first = jobs.create(vec![body(1, 0.0)]).unwrap();
        let snapshot = jobs.snapshot();
        assert!(jobs.update(first, vec![body(2, 0.0), body(2, 1.0)]).is_err());
        assert_eq!(jobs.snapshot(), snapshot);
        for _ in 1..MAX_INDICES { jobs.create(Vec::new()).unwrap(); }
        assert!(jobs.create(Vec::new()).is_err());
        jobs.begin(0).unwrap();
        for _ in 0..MAX_TICK_SUBMISSIONS {
            let ticket = jobs.submit(first, Vec::new()).unwrap();
            jobs.cancel(ticket).unwrap();
        }
        assert!(jobs.submit(first, Vec::new()).is_err());
        jobs.finish().unwrap();
    }

    #[test]
    fn startup_closes_before_first_update_and_outstanding_tickets_are_bounded() {
        let mut jobs = SpatialJobs::new();
        let index = jobs.create(Vec::new()).unwrap();
        jobs.loaded();
        assert!(jobs.create(Vec::new()).is_err());
        assert!(jobs.update(index, Vec::new()).is_err());
        assert!(jobs.destroy(index).is_err());
        let mut first_ticket = None;
        for frame in 0..4 {
            jobs.begin(frame).unwrap();
            for _ in 0..4 {
                let ticket = jobs.submit(index, Vec::new()).unwrap();
                first_ticket.get_or_insert(ticket);
            }
            jobs.finish().unwrap();
        }
        jobs.begin(4).unwrap();
        assert!(jobs.submit(index, Vec::new()).unwrap_err().contains("TICKET_LIMIT"));
        jobs.cancel(first_ticket.unwrap()).unwrap();
        jobs.submit(index, Vec::new()).unwrap();
        jobs.finish().unwrap();
    }

    #[test]
    fn reload_preserves_indices_and_isolates_uncommitted_candidate_ids() {
        let mut jobs = SpatialJobs::new();
        let index = jobs.create(vec![body(7, 1.0)]).unwrap();
        jobs.begin(0).unwrap();
        let old_ticket = jobs.submit(index, vec![nearest()]).unwrap();
        jobs.finish().unwrap();
        let mut candidate = jobs.reload_candidate();
        assert_eq!(candidate.update(index, vec![body(9, 1.0)]).unwrap(), 2);
        let candidate_index = candidate.create(Vec::new()).unwrap();
        candidate.begin(1).unwrap();
        assert!(candidate.take(old_ticket).is_err());
        let candidate_ticket = candidate.submit(index, vec![nearest()]).unwrap();
        candidate.finish().unwrap();
        jobs.begin(1).unwrap();
        assert_eq!(jobs.take(old_ticket).unwrap().results[0].hits[0].id, 7);
        assert_eq!(jobs.create(Vec::new()).unwrap(), old_ticket + 1);
        assert!(candidate_index > old_ticket);
        candidate.begin(2).unwrap();
        assert!(candidate.create(Vec::new()).unwrap() > candidate_ticket);
        candidate.finish().unwrap();
    }

    #[test]
    fn failed_reload_first_use_does_not_change_live_snapshot() {
        let jobs = SpatialJobs::new();
        let mut candidate = jobs.reload_candidate();
        candidate.create(Vec::new()).unwrap();
        assert!(jobs.snapshot().is_none());
        assert_eq!(jobs.sequence.get(), 0);
    }

    #[test]
    fn canonical_snapshot_captures_future_handle_sequence() {
        let mut first = SpatialJobs::new();
        let mut second = SpatialJobs::new();
        let id = first.create(Vec::new()).unwrap();first.destroy(id).unwrap();
        for _ in 0..2 { let id=second.create(Vec::new()).unwrap();second.destroy(id).unwrap(); }
        assert_ne!(first.snapshot(), second.snapshot());
    }

    #[test]
    fn handle_and_version_exhaustion_do_not_wrap_or_mutate_data() {
        let mut jobs = SpatialJobs::new();
        jobs.sequence.set(MAX_SAFE_INTEGER - 1);
        let index = jobs.create(vec![body(1, 1.0)]).unwrap();
        assert_eq!(index, MAX_SAFE_INTEGER);
        assert!(jobs.create(Vec::new()).unwrap_err().contains("HANDLE_EXHAUSTED"));
        jobs.indices.get_mut(&index).unwrap().version = u32::MAX;
        let before = jobs.snapshot();
        assert!(jobs.update(index, vec![body(2, 2.0)]).unwrap_err().contains("VERSION_EXHAUSTED"));
        assert_eq!(jobs.snapshot(), before);
    }

    #[test]
    fn snapshot_hides_host_completion_timing_and_backend() {
        let mut cpu = SpatialJobs::new();
        let mut external = SpatialJobs::new();
        external.set_external_backend("test-gpu".into()).unwrap();
        for jobs in [&mut cpu, &mut external] {
            let index = jobs.create(vec![body(1, 1.0)]).unwrap();
            jobs.begin(0).unwrap();
            jobs.submit(index, vec![nearest()]).unwrap();
            jobs.finish().unwrap();
        }
        assert_eq!(cpu.snapshot(), external.snapshot());
        let task = external.drain_tasks().pop().unwrap();
        external.complete(task.id, CpuSpatialExecutor.execute(&task.batch).unwrap()).unwrap();
        assert_eq!(cpu.snapshot(), external.snapshot());
        cpu.begin(1).unwrap();
        external.begin(1).unwrap();
        assert_eq!(cpu.snapshot(), external.snapshot());
    }

    #[test]
    fn profiling_is_non_consuming_bounded_and_excluded_from_canonical_state() {
        let mut first = SpatialJobs::new();
        let mut second = SpatialJobs::new();
        for jobs in [&mut first, &mut second] {
            let index = jobs.create(vec![body(1, 1.0), body(2, 5.0)]).unwrap();
            jobs.begin(0).unwrap();
            jobs.submit(index, vec![nearest()]).unwrap();
            jobs.finish().unwrap();
        }
        let snapshot = first.snapshot();
        let profile = first.profile();
        assert_eq!(first.profile(), profile);
        assert_eq!(first.snapshot(), snapshot);
        assert_eq!(first.snapshot(), second.snapshot());
        assert_eq!(profile["totals"]["submitted_batches"], 1);
        assert_eq!(profile["totals"]["completed_batches"], 1);
        assert_eq!(profile["totals"]["pair_tests_upper_bound"], 2);
        assert_eq!(profile["totals"]["returned_hits"], 1);
        assert_eq!(profile["totals"]["input_body_bytes"], 88);
        assert_eq!(profile["last"]["executor"]["phases_ms"]["gpu_kernel"], serde_json::Value::Null);
        assert!(profile["last"]["executor"]["gpu_kernel_unavailable_reason"].is_string());
        first.begin(1).unwrap(); second.begin(1).unwrap();
        assert_eq!(first.take(2).unwrap(), second.take(2).unwrap());
        assert_eq!(first.profile(), profile);
        first.finish().unwrap(); second.finish().unwrap();
        first.set_executor(Box::new(CpuSpatialExecutor)).unwrap();
        assert_eq!(first.profile()["totals"]["completed_batches"], 0);
        assert!(first.profile()["last"].is_null());
        assert_eq!(first.snapshot(), second.snapshot());
    }

    #[test]
    fn optional_external_profiles_are_validated_atomically_and_old_hosts_still_work() {
        let mut jobs = SpatialJobs::new();
        jobs.set_external_backend("old-host".into()).unwrap();
        let index = jobs.create(vec![body(1, 1.0)]).unwrap();
        jobs.begin(0).unwrap();
        let ticket = jobs.submit(index, vec![nearest()]).unwrap();
        jobs.finish().unwrap();
        let task = jobs.drain_tasks().pop().unwrap();
        let result = CpuSpatialExecutor.execute(&task.batch).unwrap();
        let mut sample = SpatialExecutionProfile {
            clock: "host_monotonic".into(), total_ms: 1.0, phases_ms: Default::default(),
            gpu_kernel_unavailable_reason: Some("No GPU timestamp support".into()),
            upload_bytes: 16, readback_bytes: 16,
        };
        let before = jobs.profile(); let snapshot = jobs.snapshot();
        for invalid in [f64::NAN, f64::INFINITY, -1.0, 3_600_001.0] {
            sample.total_ms = invalid;
            assert!(jobs.complete_with_profile(ticket, result.clone(), Some(sample.clone())).unwrap_err().contains("PROFILE_INVALID"));
            assert_eq!(jobs.profile(), before); assert_eq!(jobs.snapshot(), snapshot);
        }
        sample.total_ms = 1.0; sample.phases_ms.upload = Some(-1.0);
        assert!(jobs.complete_with_profile(ticket, result.clone(), Some(sample.clone())).is_err());
        sample.phases_ms.upload = None; sample.upload_bytes = 1_073_741_825;
        assert!(jobs.complete_with_profile(ticket, result.clone(), Some(sample)).is_err());
        jobs.complete(ticket, result.clone()).unwrap();
        let profile = jobs.profile();
        assert!(profile["last"]["executor"].is_null());
        assert!(profile["last"]["executor_ms"].is_null());
        assert!(profile["last"]["executor_unavailable_reason"].is_string());
        assert_eq!(profile["totals"]["executor_wall_samples"], 0);
        jobs.begin(1).unwrap(); assert_eq!(jobs.take(ticket).unwrap(), result);
        let ticket = jobs.submit(index, vec![nearest()]).unwrap(); jobs.finish().unwrap();
        let task = jobs.drain_tasks().pop().unwrap();
        let result = CpuSpatialExecutor.execute(&task.batch).unwrap();
        let sample = SpatialExecutionProfile {
            clock: "host_monotonic".into(), total_ms: 3.0,
            phases_ms: SpatialExecutionPhases { readback_wait: Some(2.0), ..Default::default() },
            gpu_kernel_unavailable_reason: Some("GPU timestamp queries unavailable".into()),
            upload_bytes: 128, readback_bytes: 4096,
        };
        let snapshot = jobs.snapshot();
        jobs.complete_with_profile(ticket, result, Some(sample.clone())).unwrap();
        assert_eq!(jobs.snapshot(), snapshot);
        let profile = jobs.profile();
        assert_eq!(profile["totals"]["executor_wall_samples"], 1);
        assert_eq!(profile["totals"]["executor_samples"], 1);
        assert_eq!(profile["totals"]["executor_ms"], 3.0);
        assert_eq!(profile["totals"]["readback_bytes"], 4096);
        assert_eq!(profile["last"]["executor"], serde_json::to_value(sample).unwrap());
    }

    #[test]
    fn diagnostic_counters_reset_on_committed_reload_and_failures_do_not_leak_from_candidates() {
        let mut jobs = SpatialJobs::new();
        let index = jobs.create(Vec::new()).unwrap();
        jobs.begin(0).unwrap();
        let ticket = jobs.submit(index, Vec::new()).unwrap();
        jobs.cancel(ticket).unwrap();
        jobs.finish().unwrap();
        let original = jobs.profile();
        let mut candidate = jobs.reload_candidate();
        assert_eq!(candidate.profile()["totals"]["submitted_batches"], 0);
        candidate.begin(1).unwrap(); candidate.submit(index, Vec::new()).unwrap();
        candidate.fail("candidate failure".into());
        assert_eq!(candidate.profile()["totals"]["failed_batches"], 1);
        assert_eq!(jobs.profile(), original);
        assert_eq!(original["totals"]["cancelled_tickets"], 1);
        assert_eq!(original["totals"]["completed_batches"], 0);
        let committed = jobs.reload_candidate();
        assert_eq!(committed.profile()["totals"]["submitted_batches"], 0);
        assert!(committed.profile()["last"].is_null());
        let mut total = MAX_SAFE_INTEGER - 1;
        add_count(&mut total, 10); assert_eq!(total, MAX_SAFE_INTEGER);
    }
}
