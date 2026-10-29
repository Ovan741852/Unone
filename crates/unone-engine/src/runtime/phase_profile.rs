//! Coarse opt-in Core spans. No per-node clocks, VM hooks or gameplay timing API.
use super::{Lua, Rc, RefCell, profiling};
use std::{collections::VecDeque, time::{Duration, Instant}};

const LIMIT: usize = 1024;
const N: usize = 14;

#[derive(Clone, Copy)]
pub(super) enum Phase {
    Script, Physics, Observe, UiConvert, UiValidate, UiCommitDrop,
    ImageBatchConvert, ImageBatchValidateCommit, ImageBatchRemove,
    WorldSnapshot, ObservationsClone, UiClone, ObserveHostState, TickTotal,
}
const NAMES: [&str; N] = [
    "script_total_ms", "physics_ms", "observe_total_ms", "ui_convert_ms",
    "ui_parse_validate_ms", "ui_commit_drop_ms", "image_batch_convert_ms",
    "image_batch_validate_commit_ms", "image_batch_remove_ms",
    "world_snapshot_ms", "observations_clone_ms", "ui_clone_ms",
    "observe_host_state_ms", "tick_total_ms",
];

#[derive(Clone)]
struct Frame {
    frame: u64,
    completed: bool,
    spans: [Duration; N],
    calls: [u64; N],
}
impl Frame {
    fn new(frame: u64) -> Self {
        Self { frame, completed: false, spans: [Duration::ZERO; N], calls: [0; N] }
    }
    fn record(&mut self, phase: Phase, duration: Duration) {
        let i=phase as usize;
        self.spans[i]=self.spans[i].saturating_add(duration);
        self.calls[i]=self.calls[i].saturating_add(1);
    }
    fn outside_ui(&self) -> Duration {
        let ui=self.spans[Phase::UiConvert as usize..=Phase::ImageBatchRemove as usize]
            .iter().copied().fold(Duration::ZERO, Duration::saturating_add);
        self.spans[Phase::Script as usize].saturating_sub(ui)
    }
}

pub(super) struct Profile {
    current: Option<Frame>,
    frames: VecDeque<Frame>,
    totals: [Duration; N],
    calls: [u64; N],
    attempted: u64,
    completed: u64,
}
impl Default for Profile {
    fn default() -> Self {
        Self { current: None, frames: VecDeque::with_capacity(LIMIT),
            totals: [Duration::ZERO; N], calls: [0; N], attempted: 0, completed: 0 }
    }
}
fn ms(value: Duration) -> f64 { value.as_secs_f64()*1000.0 }
impl Profile {
    fn finish(&mut self, completed: bool, total: Duration) {
        let Some(mut frame)=self.current.take() else { return; };
        frame.completed=completed;
        frame.record(Phase::TickTotal,total);
        self.attempted=self.attempted.saturating_add(1);
        self.completed=self.completed.saturating_add(u64::from(completed));
        for i in 0..N {
            self.totals[i]=self.totals[i].saturating_add(frame.spans[i]);
            self.calls[i]=self.calls[i].saturating_add(frame.calls[i]);
        }
        if self.frames.len()==LIMIT { self.frames.pop_front(); }
        self.frames.push_back(frame);
    }
    pub fn report(&self) -> serde_json::Value {
        let summary: serde_json::Map<String,serde_json::Value>=NAMES.iter().enumerate().map(|(i,name)| {
            let mut values: Vec<f64>=self.frames.iter().map(|f|ms(f.spans[i])).collect();
            values.sort_by(f64::total_cmp);
            let percentile=|p:usize| if values.is_empty() { None } else { Some(values[(values.len()*p).div_ceil(100)-1]) };
            ((*name).into(),serde_json::json!({"total_ms":ms(self.totals[i]),"mean_ms":if self.attempted==0 {0.} else {ms(self.totals[i])/self.attempted as f64},"calls":self.calls[i],"p50_ms":percentile(50),"p95_ms":percentile(95),"p99_ms":percentile(99)}))
        }).collect();
        let frames: Vec<_>=self.frames.iter().map(|f| {
            let spans: serde_json::Map<String,_>=NAMES.iter().enumerate().map(|(i,n)|((*n).into(),serde_json::json!(ms(f.spans[i])))).collect();
            let calls: serde_json::Map<String,_>=NAMES.iter().enumerate().map(|(i,n)|((*n).into(),serde_json::json!(f.calls[i]))).collect();
            serde_json::json!({"frame":f.frame,"completed":f.completed,"phases_ms":spans,"calls":calls,"script_outside_measured_ui_ms":ms(f.outside_ui())})
        }).collect();
        serde_json::json!({"schema_version":1,"mode":"phase-only","attempted_frames":self.attempted,"completed_frames":self.completed,
            "failed_frames":self.attempted-self.completed,"retained":self.frames.len(),"limit":LIMIT,"phases":summary,"frames":frames,
            "scope":"Active profiling window, accepted tick attempt through observation and input commit. Manual tools, load/start and standalone observe are excluded. Phase calls count attempts, including caught validation failures.",
            "frame_join":"Attempted next world frame; completed=true joins the returned host world frame. Failed attempts may repeat a frame number.",
            "nesting":"UI conversion/parse/commit and imageBatch calls are inside script_total. World snapshot, host state, observations and UI clones are inside observe_total. Do not add parents and children.",
            "script_outside_measured_ui":"Script total minus measured raw UI binding spans; includes Luau wrappers, gameplay and other engine bindings. It is not pure Luau time.",
            "measurement_overhead":"Coarse host clock reads and bounded per-frame storage only; no function sampler or VM allocation/GC callbacks. Compare active and stopped windows on the same artifact. Percentiles use retained attempts; totals span the window."})
    }
}

/// Every exit after admission, including errors, closes the attempted frame.
pub(super) struct TickScope {
    shared: Rc<RefCell<profiling::Profile>>,
    id: u64,
    started: Instant,
    completed: bool,
}
impl TickScope {
    pub fn begin(lua: &Lua, frame: u64) -> Option<Self> {
        let shared=profiling::state(lua);
        let id={let mut p=shared.borrow_mut();
            if !p.active { return None; }
            debug_assert!(p.phases.current.is_none());
            p.phases.current=Some(Frame::new(frame));p.id};
        Some(Self {shared,id,started:Instant::now(),completed:false})
    }
    pub fn record(&self, phase: Phase, duration: Duration) {
        let mut p=self.shared.borrow_mut();
        if p.id==self.id { if let Some(frame)=&mut p.phases.current { frame.record(phase,duration); } }
    }
    pub fn complete(mut self) { self.completed=true; }
}
impl Drop for TickScope {
    fn drop(&mut self) {
        let mut p=self.shared.borrow_mut();
        if p.id==self.id {
            p.phases.finish(self.completed,self.started.elapsed());
            if !self.completed { p.active=false; }
        }
    }
}

struct Span { shared: Rc<RefCell<profiling::Profile>>, id: u64, phase: Phase, started: Instant }
impl Drop for Span {
    fn drop(&mut self) {
        let duration=self.started.elapsed();
        let mut p=self.shared.borrow_mut();
        if p.id==self.id { if let Some(frame)=&mut p.phases.current { frame.record(self.phase,duration); } }
    }
}
pub(super) fn measure<T>(lua: &Lua, phase: Phase, work: impl FnOnce()->T) -> T {
    let shared=profiling::state(lua);
    let id={let p=shared.borrow();if p.active&&p.phases.current.is_some() {Some(p.id)} else {None}};
    let _span=id.map(|id|Span {shared,id,phase,started:Instant::now()});
    work()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attempted_frames_are_bounded_and_parent_children_are_not_added() {
        let mut p=Profile::default();
        for frame in 1..=1030 {
            let mut current=Frame::new(frame);
            current.record(Phase::Script,Duration::from_millis(10));
            current.record(Phase::UiConvert,Duration::from_millis(2));
            current.record(Phase::UiValidate,Duration::from_millis(3));
            p.current=Some(current);p.finish(frame!=1030,Duration::from_millis(12));
        }
        let report=p.report();
        assert_eq!(report["attempted_frames"],1030);
        assert_eq!(report["completed_frames"],1029);
        assert_eq!(report["failed_frames"],1);
        assert_eq!(report["frames"].as_array().unwrap().len(),LIMIT);
        assert_eq!(report["frames"][0]["frame"],7);
        assert_eq!(report["frames"][1023]["completed"],false);
        assert_eq!(report["frames"][0]["script_outside_measured_ui_ms"],5.);
        assert_eq!(report["phases"]["script_total_ms"]["total_ms"],10300.);
        assert_eq!(report["phases"]["script_total_ms"]["p99_ms"],10.);
    }
    #[test]
    fn phase_only_update_never_installs_vm_allocation_or_interrupt_callbacks() {
        fn callbacks(lua: &Lua) -> (usize,usize) {
            let mut ids=(0,0);
            unsafe { lua.exec_raw::<()>((),|state| {
                let c=&*mlua::ffi::lua_callbacks(state);
                ids=(c.onallocate.map_or(0,|f|f as usize),c.interrupt.map_or(0,|f|f as usize));
            }).unwrap(); }
            ids
        }
        let mut r=crate::EngineRuntime::load_source("callbacks","main.luau",
            "return {start=function()end,update=function() check_callbacks();local t=table.create(500,1) end}",None).unwrap();
        r.preview_request(crate::PreviewRequest::ProfileStart {sampling:false}).unwrap();
        let expected=callbacks(&r.lua);
        r.lua.globals().set("check_callbacks",r.lua.create_function(move |lua,()| {
            assert_eq!(callbacks(lua),expected,"phase-profile must not replace VM callbacks during update");Ok(())
        }).unwrap()).unwrap();
        r.tick().unwrap();
        assert_eq!(callbacks(&r.lua),expected);
    }
}
