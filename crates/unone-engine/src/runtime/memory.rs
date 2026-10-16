//! Opt-in VM retention evidence, not a retaining-path or cross-host leak detector.
use super::*;
use serde_json::{Value as Json, json};
use std::{collections::VecDeque, time::Instant};

const LIMIT: usize = 128;
#[derive(Default)]
pub(super) struct History {
    samples: VecDeque<Json>,
    sequence: u64,
    dropped: u64,
    sampled_peak: usize,
}
impl EngineRuntime {
    pub fn memory_sample(
        &mut self,
        label: &str,
        collect: bool,
        warmup: bool,
    ) -> Result<Json, Box<Diagnostic>> {
        if label.is_empty() || label.len() > 160 {
            return Err(Box::new(Diagnostic::error(
                "MEMORY_LABEL_INVALID",
                "Use a 1..160 byte phase label",
                "Compare the same workload phase, for example idle_after_round; set warmup=true during asset/cache warmup.",
            )));
        }
        let started = Instant::now();
        let before = self.lua.used_memory();
        let gc_ms = if collect {
            let start = Instant::now();
            self.lua.gc_collect().map_err(|e| {
                Box::new(Diagnostic::error(
                    "MEMORY_GC_FAILED",
                    "Explicit Luau full collection failed",
                    e.to_string(),
                ))
            })?;
            Some(start.elapsed().as_secs_f64() * 1000.0)
        } else {
            None
        };
        let after = self.lua.used_memory();
        if self.lua.app_data_ref::<History>().is_none() {
            self.lua.set_app_data(History::default());
        }
        {
            let mut h = self.lua.app_data_mut::<History>().unwrap();
            h.sequence += 1;
            h.sampled_peak = h.sampled_peak.max(before).max(after);
            let sequence = h.sequence;
            h.samples.push_back(json!({"sequence":sequence,"tick":self.world.borrow().frame,
                "label":label,"warmup":warmup,"collected":collect,
                "lua_used_before_bytes":before,"lua_used_after_bytes":after,
                "reclaimed_bytes":if collect {Some(before.saturating_sub(after))} else {None},
                "full_gc_wall_ms":gc_ms,"measurement_wall_ms":started.elapsed().as_secs_f64()*1000.0}));
            if h.samples.len() > LIMIT {
                h.samples.pop_front();
                h.dropped += 1;
            }
        }
        Ok(self.memory_report())
    }

    pub fn memory_report(&self) -> Json {
        let h = self.lua.app_data_ref::<History>();
        let Some(h) = h else {
            return report(&History::default());
        };
        report(&h)
    }
}
fn report(h: &History) -> Json {
    let mut groups: BTreeMap<String, Vec<&Json>> = BTreeMap::new();
    for s in &h.samples {
        if s["collected"] == true && s["warmup"] == false {
            groups
                .entry(s["label"].as_str().unwrap().into())
                .or_default()
                .push(s);
        }
    }
    let trends: Vec<Json> = groups.into_iter().map(|(label, samples)| {
        let first = samples[0]["lua_used_after_bytes"].as_u64().unwrap();
        let last = samples.last().unwrap()["lua_used_after_bytes"].as_u64().unwrap();
        let rising = samples.len() >= 3 && samples.windows(2).all(|w| w[1]["lua_used_after_bytes"].as_u64() > w[0]["lua_used_after_bytes"].as_u64());
        json!({"label":label,"samples":samples.len(),"retained_delta_bytes":last as i128-first as i128,
            "assessment":if rising {"growing_retained_heap_investigate"} else if samples.len()<3 {"insufficient_samples"} else {"no_monotonic_growth_in_window"},
            "leak_proven":false})
    }).collect();
    json!({"schema_version":1,"scope":"main Luau VM only; excludes worker VMs, Rust, JS, WASM allocator and GPU",
        "sample_limit":LIMIT,"dropped_samples":h.dropped,"sampled_peak_bytes":if h.sequence>0 {Some(h.sampled_peak)} else {None},
        "samples":h.samples,"trends":trends,
        "unavailable":{"retaining_paths":null,"allocation_callsites":null,"rust_heap_bytes":null,"js_heap_bytes":null,"wasm_allocator_bytes":null,"gpu_bytes":null},
        "limitations":["Explicit full GC changes collection scheduling and weak references; run on a diagnostic session, not an unmodified timing baseline.",
            "Sampled peak is not a continuous high-water mark. Full GC wall time includes instrumentation; it is not CPU time.",
            "Use identical phase labels only for comparable seed/input/workloads; warmup samples are excluded. Cache growth is not proof of a leak.",
            "History is VM-local and reset by hot reload; export reports with project/build/asset fingerprints before comparing runs."]})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn collecting_idle_vm_does_not_retain_history_in_lua() {
        let mut r = EngineRuntime::load_source(
            "idle",
            "main.luau",
            "return {start=function()end,update=function()end}",
            None,
        )
        .unwrap();
        for _ in 0..16 {
            r.memory_sample("idle", true, false).unwrap();
        }
        let report = r.memory_report();
        let samples = report["samples"].as_array().unwrap();
        assert!(
            samples
                .windows(2)
                .all(|w| w[0]["lua_used_after_bytes"] == w[1]["lua_used_after_bytes"])
        );
        assert_eq!(report["trends"][0]["retained_delta_bytes"], 0);
    }
    #[test]
    fn retained_release_warmup_and_bounded_history() {
        let mut r = EngineRuntime::load_source("memory", "main.luau", "local held={} return {start=function()end,update=function(api) if api.input.isDown('release') then table.clear(held) else table.insert(held,table.create(20000,42)) end end}", None).unwrap();
        r.memory_sample("idle", true, true).unwrap();
        for _ in 0..3 {
            r.tick().unwrap();
            r.memory_sample("idle", true, false).unwrap();
        }
        assert_eq!(
            r.memory_report()["trends"][0]["assessment"],
            "growing_retained_heap_investigate"
        );
        let before = r.memory_report()["samples"][3]["lua_used_after_bytes"]
            .as_u64()
            .unwrap();
        r.tick_with_input(&InputFrame {
            actions: BTreeMap::from([("release".into(), true)]),
            pointer: None,
            ..InputFrame::default()
        })
        .unwrap();
        let result = r.memory_sample("released", true, false).unwrap();
        assert!(
            result["samples"][4]["lua_used_after_bytes"]
                .as_u64()
                .unwrap()
                < before
        );
        for _ in 0..130 {
            r.memory_sample("idle", false, false).unwrap();
        }
        let result = r.memory_report();
        assert_eq!(result["samples"].as_array().unwrap().len(), 128);
        assert_eq!(result["dropped_samples"], 7);
        assert!(result["samples"][127]["full_gc_wall_ms"].is_null());
        assert!(result["unavailable"]["rust_heap_bytes"].is_null());
    }
}
