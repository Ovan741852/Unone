//! Development-only, bounded VM-safe-point sampling. Never exposes time to Lua.
use super::*;
use std::time::{Duration, Instant};

#[derive(Default)]
pub(super) struct Profile {
    pub id: u64,
    pub active: bool,
    pub first_frame: u64,
    pub last_frame: u64,
    pub sampling: bool,
    pub samples: u64,
    pub dropped: u64,
    pub truncated: u64,
    pub functions: BTreeMap<String, FunctionSamples>,
    pub stacks: BTreeMap<Vec<String>, u64>,
    last_sample: Option<Instant>,
    hooks: u64,
}
#[derive(Default, Serialize)]
pub(super) struct FunctionSamples {
    source: String,
    line: Option<usize>,
    name: String,
    self_samples: u64,
    inclusive_samples: u64,
}
impl Profile {
    pub fn report(&self) -> serde_json::Value {
        serde_json::json!({"id":self.id,"active":self.active,"first_frame":self.first_frame,"last_frame":self.last_frame,
            "sampling":self.sampling,"samples":self.samples,"dropped_samples":self.dropped,"truncated_stacks":self.truncated,
            "functions":self.functions,"stacks":self.stacks.iter().map(|(stack,count)|serde_json::json!({"leaf_first":stack,"samples":count})).collect::<Vec<_>>(),
            "limits":{"functions":1024,"stacks":4096,"depth":32,"minimum_interval_ms":1},
            "semantics":"VM-safe-point sample counts, not exact function milliseconds or call counts. Native calls and GC are not asynchronously sampled. Short functions, inlining and safe-point placement can bias attribution; compare with sampling disabled."})
    }
}
pub(super) fn state(lua: &Lua) -> Rc<RefCell<Profile>> {
    if let Some(p) = lua.app_data_ref::<Rc<RefCell<Profile>>>() {
        return Rc::clone(&p);
    }
    let p = Rc::new(RefCell::new(Profile::default()));
    lua.set_app_data(Rc::clone(&p));
    p
}
pub(super) fn start(lua: &Lua, frame: u64, sampling: bool) {
    lua.remove_interrupt();
    let shared = state(lua);
    let id = shared.borrow().id + 1;
    *shared.borrow_mut() = Profile {
        id,
        active: true,
        first_frame: frame,
        last_frame: frame,
        sampling,
        ..Profile::default()
    };
    if !sampling {
        return;
    }
    lua.set_interrupt(move |lua| {
        let mut p = shared.borrow_mut();
        p.hooks += 1;
        // Clock checks themselves have a cost, especially through WASM.
        if p.hooks % 64 != 0 {
            return Ok(mlua::VmState::Continue);
        }
        let now = Instant::now();
        if p.last_sample
            .is_some_and(|last| now.duration_since(last) < Duration::from_millis(1))
        {
            return Ok(mlua::VmState::Continue);
        }
        p.last_sample = Some(now);
        let mut stack = Vec::new();
        for level in 0..32 {
            let Some((source, line, name)) = lua.inspect_stack(level, |d| {
                let s = d.source();
                (
                    s.source
                        .as_deref()
                        .unwrap_or("[native]")
                        .chars()
                        .take(256)
                        .collect::<String>(),
                    s.line_defined,
                    d.names()
                        .name
                        .as_deref()
                        .unwrap_or("<anonymous>")
                        .chars()
                        .take(128)
                        .collect::<String>(),
                )
            }) else {
                break;
            };
            let key = format!("{source}:{}:{name}", line.unwrap_or(0));
            if !p.functions.contains_key(&key) && p.functions.len() >= 1024 {
                p.dropped += 1;
                return Ok(mlua::VmState::Continue);
            }
            p.functions.entry(key.clone()).or_insert(FunctionSamples {
                source,
                line,
                name,
                ..FunctionSamples::default()
            });
            stack.push(key);
        }
        if stack.len() == 32 {
            p.truncated += 1;
        }
        if stack.is_empty() {
            return Ok(mlua::VmState::Continue);
        }
        if !p.stacks.contains_key(&stack) && p.stacks.len() >= 4096 {
            p.dropped += 1;
            return Ok(mlua::VmState::Continue);
        }
        p.samples += 1;
        p.functions.get_mut(&stack[0]).unwrap().self_samples += 1;
        for key in stack.iter().collect::<std::collections::BTreeSet<_>>() {
            p.functions.get_mut(key).unwrap().inclusive_samples += 1;
        }
        *p.stacks.entry(stack).or_default() += 1;
        Ok(mlua::VmState::Continue)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn runtime() -> EngineRuntime {
        EngineRuntime::load_source(
            "profile",
            "cost.luau",
            r#"
local function hot() local sum=0;for i=1,300000 do sum+=math.sqrt(i) end;return sum end
return {start=function()end,update=function(api) api.observation.set('sum',hot()) end}
"#,
            None,
        )
        .unwrap()
    }
    #[test]
    fn sampling_finds_function_preserves_digest_and_freezes_window() {
        let mut baseline = runtime();
        let mut sampled = runtime();
        let before = sampled.observe();
        sampled
            .preview_request(PreviewRequest::ProfileStart { sampling: true })
            .unwrap();
        assert_eq!(
            observation_digest(&before).unwrap(),
            observation_digest(&sampled.observe()).unwrap()
        );
        assert!(
            sampled
                .preview_request(PreviewRequest::ProfileStart { sampling: true })
                .is_err()
        );
        for _ in 0..3 {
            baseline.tick().unwrap();
            sampled.tick().unwrap();
        }
        assert_eq!(
            observation_digest(&baseline.observe()).unwrap(),
            observation_digest(&sampled.observe()).unwrap()
        );
        let report = sampled
            .preview_request(PreviewRequest::ProfileStop {})
            .unwrap();
        assert_eq!(report["performance"]["frames"], 3);
        assert_eq!(report["window"]["first_frame"], 0);
        assert_eq!(report["window"]["last_frame"], 3);
        assert!(report["window"]["samples"].as_u64().unwrap() > 0);
        assert!(
            report["window"]["functions"]
                .as_object()
                .unwrap()
                .values()
                .any(|v| v["name"] == "hot" && v["inclusive_samples"].as_u64().unwrap() > 0)
        );
        assert!(report.get("observation").is_none());
        sampled.tick().unwrap();
        let stopped = sampled.preview_request(PreviewRequest::Profile {}).unwrap();
        assert_eq!(stopped["performance"]["frames"], 3);
        assert_eq!(stopped["window"], report["window"]);
        sampled
            .preview_request(PreviewRequest::ProfileStart { sampling: false })
            .unwrap();
        sampled.tick().unwrap();
        let next = sampled
            .preview_request(PreviewRequest::ProfileStop {})
            .unwrap();
        assert_eq!(next["window"]["id"], 2);
        assert_eq!(next["window"]["samples"], 0);
        assert_eq!(next["performance"]["frames"], 1);
    }
    #[test]
    fn errors_end_sampling_and_typo_is_rejected() {
        let mut r = EngineRuntime::load_source(
            "error",
            "bad.luau",
            "return {start=function()end,update=function()error('boom')end}",
            None,
        )
        .unwrap();
        r.preview_request(PreviewRequest::ProfileStart { sampling: true })
            .unwrap();
        assert!(r.tick().is_err());
        assert_eq!(
            r.preview_request(PreviewRequest::Profile {}).unwrap()["window"]["active"],
            false
        );
        assert!(
            serde_json::from_str::<PreviewRequest>(r#"{"method":"profile_start","samplng":true}"#)
                .is_err()
        );
    }
}
