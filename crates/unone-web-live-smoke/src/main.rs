use std::cell::RefCell;
#[cfg(feature = "dev-tools")]
use unone_engine::{BundleSpec, BundleVerifier};

use serde::Serialize;
use unone_engine::{
    Diagnostic, EngineRuntime, HostInputState, HostProject, Vec2, WorldSnapshot, parse_input_frame,
};

#[cfg(all(test, feature = "dev-tools"))]
use unone_engine::SceneFile;

thread_local! {
    static RUNTIME: RefCell<Option<EngineRuntime>> = const { RefCell::new(None) };
    static INPUT: RefCell<HostInputState> = RefCell::new(HostInputState::default());
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static INPUT_BUFFER: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static PROJECT_NAME: RefCell<String> = const { RefCell::new(String::new()) };
    static CANONICAL_HASHER: RefCell<unone_engine::CanonicalHasher> = RefCell::new(unone_engine::CanonicalHasher::default());
    static INSTANCE_MEMORY: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    // Pointers remain valid until the next successful world publication.
    static INSTANCE_BUFFERS: RefCell<Vec<std::sync::Arc<[u8]>>> = const { RefCell::new(Vec::new()) };
    #[cfg(feature = "dev-tools")]
    static BUNDLE_VERIFIER: RefCell<Option<BundleVerifier>> = const { RefCell::new(None) };
}

#[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
#[derive(Default)]
struct PublicationProfile {
    active: bool,
    id: u64,
    count: u64,
    input_bytes: u64,
    reused_bytes: u64,
    hashed_bytes: u64,
    cache_hits: u64,
    cache_storage_bytes: usize,
    totals: [f64; 4],
    samples: std::collections::VecDeque<[f64; 4]>,
}
#[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
impl PublicationProfile {
    fn record(&mut self, sample: [f64; 4], work: unone_engine::CanonicalHashWork) {
        if !self.active {
            return;
        }
        self.count += 1;
        self.cache_storage_bytes = work.cache_storage_bytes;
        self.input_bytes += work.input_bytes as u64;
        self.reused_bytes += work.reused_bytes as u64;
        self.hashed_bytes += work.hashed_bytes as u64;
        if work.reused_bytes > 0 {
            self.cache_hits += 1;
        }
        for (total, value) in self.totals.iter_mut().zip(sample) {
            *total += value;
        }
        if self.samples.len() == 1024 {
            self.samples.pop_front();
        }
        self.samples.push_back(sample);
    }
    fn report(&self) -> serde_json::Value {
        let mut phases = serde_json::Map::new();
        for (i, name) in [
            "canonical_encode_ms",
            "canonical_hash_ms",
            "presentation_ms",
            "envelope_ms",
        ]
        .iter()
        .enumerate()
        {
            let mut values: Vec<f64> = self.samples.iter().map(|v| v[i]).collect();
            values.sort_by(f64::total_cmp);
            phases.insert(name.to_string(), serde_json::json!({"total_ms": self.totals[i],
                "mean_ms": if self.count == 0 { 0. } else { self.totals[i] / self.count as f64 },
                "p95_ms": if values.is_empty() { None } else { Some(values[(values.len()*95).div_ceil(100)-1]) }}));
        }
        serde_json::json!({"id":self.id,"active":self.active,"publications":self.count,"retained":self.samples.len(),"limit":1024,"phases":phases,"hash_work":{"input_bytes":self.input_bytes,"reused_bytes":self.reused_bytes,"hashed_bytes":self.hashed_bytes,"cache_hit_publications":self.cache_hits,"max_retained_prefix_bytes":unone_engine::CanonicalHasher::MAX_PREFIX_BYTES,"last_cache_storage_bytes":self.cache_storage_bytes},
            "note":"Disjoint successful world-publication CPU spans. Excludes simulation and initial world capture; includes extra timing/collection overhead. Totals span the window; p95 uses retained samples. Not GPU or browser decode time."})
    }
}
#[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
thread_local! { static PUBLICATION_PROFILE: RefCell<PublicationProfile> = RefCell::new(PublicationProfile::default()); }

fn create_runtime(project: HostProject, seed: u64) -> Result<EngineRuntime, Box<Diagnostic>> {
    project.into_runtime(seed)
}

#[derive(Debug, Serialize)]
struct ProjectObservation<'a> {
    compiled_systems: &'static [String],
    project: &'a str,
    world: &'a serde_json::value::RawValue,
    observation_digest: &'a str,
    save_payload: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    instance_transport: Option<&'static str>,
}

fn write_snapshot(
    project: &str,
    snapshot: &WorldSnapshot,
    save_payload: Option<serde_json::Value>,
) -> Result<(), String> {
    #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
    let measuring = PUBLICATION_PROFILE.with(|p| p.borrow().active);
    #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
    let encode_started = measuring.then(std::time::Instant::now);
    let world = serde_json::value::to_raw_value(snapshot).map_err(|e| e.to_string())?;
    #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
    let encode_ms = encode_started
        .map(|s| s.elapsed().as_secs_f64() * 1000.)
        .unwrap_or(0.);
    #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
    let hash_started = measuring.then(std::time::Instant::now);
    let (observation_digest, _hash_work) =
        CANONICAL_HASHER.with(|h| h.borrow_mut().hash(world.get().as_bytes()));
    #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
    let encoding_times = [
        encode_ms,
        hash_started
            .map(|s| s.elapsed().as_secs_f64() * 1000.)
            .unwrap_or(0.),
    ];
    #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
    let presentation_started = measuring.then(std::time::Instant::now);
    let mut retained = Vec::new();
    let world = if INSTANCE_MEMORY.with(|m| m.get()) {
        let mut value = serde_json::to_value(snapshot).map_err(|e| e.to_string())?;
        for (id, batch) in &snapshot.instances3d {
            value["instances3d"][id] = serde_json::json!({"asset":batch.asset,"count":batch.count,"format":batch.format,
                "memory":{"offset":batch.packed.as_ptr() as usize,"byte_length":batch.packed.len(),"revision":batch.revision.to_string()}});
            retained.push(batch.packed.clone());
        }
        serde_json::value::to_raw_value(&value).map_err(|e| e.to_string())?
    } else {
        world
    };
    #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
    let presentation_ms = presentation_started
        .map(|s| s.elapsed().as_secs_f64() * 1000.)
        .unwrap_or(0.);
    #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
    let envelope_started = measuring.then(std::time::Instant::now);
    let observation = ProjectObservation {
        compiled_systems: unone_engine::compiled_systems(),
        project,
        world: &world,
        observation_digest: &observation_digest,
        save_payload,
        instance_transport: INSTANCE_MEMORY.with(|m| {
            if m.get() {
                Some("wasm-memory-v1")
            } else {
                None
            }
        }),
    };
    let bytes = serde_json::to_vec(&observation)
        .map_err(|error| format!("snapshot serialization failed: {error}"))?;
    OUTPUT.with(|output| *output.borrow_mut() = bytes);
    INSTANCE_BUFFERS.with(|buffers| *buffers.borrow_mut() = retained);
    #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
    if let Some(start) = envelope_started {
        PUBLICATION_PROFILE.with(|p| {
            p.borrow_mut().record(
                [
                    encoding_times[0],
                    encoding_times[1],
                    presentation_ms,
                    start.elapsed().as_secs_f64() * 1000.,
                ],
                _hash_work,
            )
        });
    }
    Ok(())
}

/// Opt in to presentation-only instance pointers. Canonical digest stays unchanged.
#[unsafe(no_mangle)]
pub extern "C" fn unone_web_set_instance_transport(mode: i32) -> i32 {
    if mode != 0 && mode != 1 {
        write_error("INSTANCE_TRANSPORT_INVALID: use 0 (JSON) or 1 (wasm-memory-v1)");
        return -1;
    }
    RUNTIME.with(|runtime| {
        let runtime = runtime.borrow();
        let Some(runtime) = runtime.as_ref() else {
            write_error("runtime is not initialized");
            return -1;
        };
        INSTANCE_MEMORY.with(|m| m.set(mode == 1));
        write_runtime_snapshot(runtime)
    })
}

fn publish_snapshot(
    project: &str,
    snapshot: &WorldSnapshot,
    save_payload: Option<serde_json::Value>,
) -> i32 {
    match write_snapshot(project, snapshot, save_payload) {
        Ok(()) => 0,
        Err(error) => {
            write_error(error);
            -1
        }
    }
}

fn write_runtime_observation(runtime: &EngineRuntime, snapshot: &WorldSnapshot) -> i32 {
    let save_payload = runtime.save_payload();
    PROJECT_NAME.with(|project| publish_snapshot(project.borrow().as_str(), snapshot, save_payload))
}

fn write_runtime_snapshot(runtime: &EngineRuntime) -> i32 {
    let snapshot = runtime.observe();
    write_runtime_observation(runtime, &snapshot)
}

fn write_error(message: impl Into<String>) {
    write_diagnostic(&Diagnostic::error(
        "HOST_REQUEST_INVALID",
        "Invalid host request",
        message.into(),
    ));
}

fn write_diagnostic(diagnostic: &Diagnostic) {
    OUTPUT.with(|output| {
        *output.borrow_mut() =
            serde_json::to_vec(&unone_engine::host_error("web_error", diagnostic))
                .unwrap_or_default()
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_init() -> i32 {
    0
}

/// Structured development-only inspection and Lua tool invocation.
/// # Safety
/// `pointer` must reference `length` readable JSON bytes for this call.
#[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_web_developer_request(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() || length > 65536 {
        write_error("Invalid developer request buffer (maximum 65536 bytes)");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let request = match serde_json::from_slice::<unone_engine::PreviewRequest>(bytes) {
        Ok(request) => request,
        Err(error) => {
            write_error(error.to_string());
            return -1;
        }
    };
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let Some(runtime) = runtime.as_mut() else {
            write_error("Load a project before using developer tools");
            return -1;
        };
        let start_profile = matches!(&request, unone_engine::PreviewRequest::ProfileStart { .. });
        let stop_profile = matches!(&request, unone_engine::PreviewRequest::ProfileStop {});
        match runtime.preview_request(request) {
            Ok(mut value) => {
                if value.get("window").is_some() {
                    PUBLICATION_PROFILE.with(|p| {
                        let mut p = p.borrow_mut();
                        if start_profile {
                            *p = PublicationProfile {
                                active: true,
                                id: value["window"]["id"].as_u64().unwrap_or(0),
                                ..Default::default()
                            };
                        }
                        if stop_profile || value["window"]["active"] == false {
                            p.active = false;
                        }
                        value["publication"] = p.report();
                    });
                }
                OUTPUT.with(|output| {
                    *output.borrow_mut() = serde_json::to_vec(
                        &serde_json::json!({"ok":true,"value":value,"diagnostics":[],"effects":[]}),
                    )
                    .unwrap()
                });
                0
            }
            Err(error) => {
                write_diagnostic(&error);
                -1
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_alloc(length: usize) -> *mut u8 {
    INPUT_BUFFER.with(|buffer| {
        let mut buffer = buffer.borrow_mut();
        buffer.resize(length, 0);
        buffer.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `pointer` must reference `length` readable UTF-8 JSON bytes for the
/// duration of this call. The payload must contain `id`, `sha256` and
/// `size_bytes` fields describing the expected bundle content.
#[cfg(feature = "dev-tools")]
pub unsafe extern "C" fn unone_web_bundle_begin(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() {
        write_error("bundle spec pointer is null");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let spec: BundleSpec = match serde_json::from_slice(bytes) {
        Ok(spec) => spec,
        Err(error) => {
            write_error(format!("bundle spec is invalid JSON: {error}"));
            return -1;
        }
    };
    let bundle_id = spec.id.clone();
    BUNDLE_VERIFIER.with(|verifier| *verifier.borrow_mut() = Some(BundleVerifier::new(&spec)));
    let value = serde_json::json!({
        "ok": true,
        "kind": "bundle_verification",
        "status": "started",
        "bundle_id": bundle_id,
    });
    OUTPUT.with(|output| *output.borrow_mut() = serde_json::to_vec(&value).unwrap_or_default());
    0
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `pointer` must reference `length` readable bytes for the duration of this
/// call. A null pointer is only valid when `length` is zero.
#[cfg(feature = "dev-tools")]
pub unsafe extern "C" fn unone_web_bundle_write(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() && length != 0 {
        write_error("bundle chunk pointer is null for non-empty chunk");
        return -1;
    }
    let bytes = if length == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(pointer, length) }
    };
    BUNDLE_VERIFIER.with(|verifier| {
        let mut binding = verifier.borrow_mut();
        let Some(verifier) = binding.as_mut() else {
            write_error("bundle verifier has not started");
            return -1;
        };
        verifier.update(bytes);
        0
    })
}

#[unsafe(no_mangle)]
#[cfg(feature = "dev-tools")]
pub extern "C" fn unone_web_bundle_finish() -> i32 {
    let verifier = BUNDLE_VERIFIER.with(|verifier| verifier.borrow_mut().take());
    let Some(verifier) = verifier else {
        write_error("bundle verifier has not started");
        return -1;
    };
    match verifier.finish() {
        Ok(result) => {
            let value = serde_json::json!({
                "ok": true,
                "kind": "bundle_verification",
                "status": "verified",
                "value": result,
            });
            OUTPUT.with(|output| {
                *output.borrow_mut() = serde_json::to_vec(&value).unwrap_or_default()
            });
            0
        }
        Err(diagnostic) => {
            write_diagnostic(&diagnostic);
            -1
        }
    }
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `pointer` must reference `length` readable bytes for the duration of this
/// call. The bytes must contain a valid UTF-8 JSON host project payload.
pub unsafe extern "C" fn unone_web_load_project(
    pointer: *const u8,
    length: usize,
    seed: u64,
) -> i32 {
    if pointer.is_null() {
        write_error("project payload pointer is null");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let payload = match HostProject::parse(bytes) {
        Ok(payload) => payload,
        Err(error) => {
            write_diagnostic(&error);
            return -1;
        }
    };
    let project_name = payload.config.name.clone();
    match create_runtime(payload, seed) {
        Ok(runtime_value) => {
            CANONICAL_HASHER.with(|h| *h.borrow_mut() = unone_engine::CanonicalHasher::default());
            INSTANCE_MEMORY.with(|mode| mode.set(false));
            #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
            PUBLICATION_PROFILE.with(|p| *p.borrow_mut() = PublicationProfile::default());
            INPUT.with(|input| *input.borrow_mut() = HostInputState::default());
            let snapshot = runtime_value.observe();
            let save_payload = runtime_value.save_payload();
            RUNTIME.with(|runtime| *runtime.borrow_mut() = Some(runtime_value));
            PROJECT_NAME.with(|project| *project.borrow_mut() = project_name.clone());
            publish_snapshot(&project_name, &snapshot, save_payload)
        }
        Err(diagnostic) => {
            write_diagnostic(&diagnostic);
            -1
        }
    }
}

#[cfg(test)]
mod instance_memory_tests {
    use super::*;
    fn output() -> serde_json::Value {
        OUTPUT.with(|o| serde_json::from_slice(&o.borrow()).unwrap())
    }
    #[test]
    fn memory_transport_preserves_digest_and_owns_pointer_lifetime() {
        let payload = serde_json::to_vec(
            &serde_json::json!({"config":{"name":"binary","entry_script":"main.luau"},"script":r#"
local n=0
local function publish(api)
 local b=buffer.create(40);buffer.writef32(b,0,n);buffer.writef32(b,24,1)
 buffer.writef32(b,28,1);buffer.writef32(b,32,1);buffer.writef32(b,36,1)
 api.instances3d.set('crowd','mesh://unit',b)
end
return {start=publish,update=function(api)n+=1;publish(api)end}
"#}),
        )
        .unwrap();
        assert_eq!(
            unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) },
            0
        );
        let json = output();
        assert_eq!(unone_web_set_instance_transport(1), 0);
        let binary = output();
        assert_eq!(binary["observation_digest"], json["observation_digest"]);
        assert!(
            binary["world"]["instances3d"]["crowd"]
                .get("data")
                .is_none()
        );
        let old = INSTANCE_BUFFERS.with(|b| {
            let b = b.borrow();
            assert_eq!(b[0].len(), 40);
            assert_eq!(
                binary["world"]["instances3d"]["crowd"]["memory"]["offset"],
                b[0].as_ptr() as usize
            );
            std::sync::Arc::downgrade(&b[0])
        });
        assert_eq!(unone_web_tick(), 0);
        let updated = output();
        assert_ne!(
            binary["world"]["instances3d"]["crowd"]["memory"]["revision"],
            updated["world"]["instances3d"]["crowd"]["memory"]["revision"]
        );
        assert!(old.upgrade().is_none());
        assert_eq!(unone_web_set_instance_transport(0), 0);
        assert_eq!(
            updated["observation_digest"],
            output()["observation_digest"]
        );
        assert!(INSTANCE_BUFFERS.with(|b| b.borrow().is_empty()));
        assert_eq!(unone_web_set_instance_transport(7), -1);
    }
}

/// Inject a host-loaded JSON save payload before the next tick.
///
/// # Safety
///
/// `pointer` must reference `length` readable UTF-8 JSON bytes for the
/// duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_web_set_save_payload(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() {
        write_error("save payload pointer is null");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let payload: serde_json::Value = match serde_json::from_slice(bytes) {
        Ok(payload) => payload,
        Err(error) => {
            write_error(format!("save payload is invalid JSON: {error}"));
            return -1;
        }
    };
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let Some(runtime) = runtime.as_mut() else {
            write_error("web runtime is not initialized");
            return -1;
        };
        runtime.set_save_payload(Some(payload));
        write_runtime_snapshot(runtime)
    })
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `pointer` must reference `length` readable UTF-8 bytes for the duration of
/// this call.
#[cfg(feature = "dev-tools")]
pub unsafe extern "C" fn unone_web_reload_script(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() {
        write_error("script payload pointer is null");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let source = match std::str::from_utf8(bytes) {
        Ok(source) => source,
        Err(error) => {
            write_error(format!("script payload is not valid UTF-8: {error}"));
            return -1;
        }
    };
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let Some(runtime) = runtime.as_mut() else {
            write_error("web runtime is not loaded");
            return -1;
        };
        match runtime.reload_source(source) {
            Ok(()) => write_runtime_snapshot(runtime),
            Err(diagnostic) => {
                write_diagnostic(&diagnostic);
                -1
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_set_pointer(x: f64, y: f64, down: i32) {
    if let Err(diagnostic) =
        INPUT.with(|input| input.borrow_mut().set_pointer(Vec2 { x, y }, down != 0))
    {
        write_diagnostic(&diagnostic);
    }
}

/// Set the complete host-normalized input frame for the next tick.
///
/// This is the generic Web host path. The older scalar pointer setters remain
/// available for the focused pointer smoke and are used when no frame payload
/// has been supplied.
#[unsafe(no_mangle)]
/// # Safety
///
/// `pointer` must reference `length` readable UTF-8 JSON bytes for the
/// duration of this call. The payload must be an `InputFrame`.
pub unsafe extern "C" fn unone_web_set_input_frame(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() {
        write_error("input frame pointer is null");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let frame = match parse_input_frame(bytes) {
        Ok(frame) => frame,
        Err(error) => {
            write_diagnostic(&error);
            return -1;
        }
    };
    INPUT.with(|input| input.borrow_mut().queue_frame(frame));
    0
}

/// Tell the engine the shape of the canvas it is drawing into.
///
/// Anchored UI nodes resolve against this, so a phone-shaped viewport keeps the
/// same corners and proportions a 16:9 one has.
#[unsafe(no_mangle)]
pub extern "C" fn unone_web_set_viewport_aspect(aspect: f64) -> i32 {
    RUNTIME.with(|runtime| match runtime.borrow_mut().as_mut() {
        Some(runtime) => match runtime.set_viewport_aspect(aspect) {
            Ok(()) => 0,
            Err(diagnostic) => {
                write_diagnostic(&diagnostic);
                -1
            }
        },
        None => {
            write_error("no project is loaded");
            -1
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_set_screen_pointer(x: f64, y: f64) -> i32 {
    match INPUT.with(|input| input.borrow_mut().set_screen_pointer(Vec2 { x, y })) {
        Ok(()) => 0,
        Err(diagnostic) => {
            write_diagnostic(&diagnostic);
            -1
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_tick() -> i32 {
    if unone_web_init() != 0 {
        return -1;
    }
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let Some(runtime) = runtime.as_mut() else {
            write_error("web runtime is not initialized");
            return -1;
        };
        let frame = INPUT.with(|input| input.borrow_mut().consume_frame());
        match runtime.tick_with_input(&frame) {
            Ok(snapshot) => write_runtime_observation(runtime, &snapshot),
            Err(diagnostic) => {
                #[cfg(any(feature = "dev-tools", feature = "preview-tools"))]
                PUBLICATION_PROFILE.with(|p| p.borrow_mut().active = false);
                write_diagnostic(&diagnostic);
                -1
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_observation_ptr() -> *const u8 {
    OUTPUT.with(|output| output.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_observation_len() -> usize {
    OUTPUT.with(|output| output.borrow().len())
}

fn main() {}

#[cfg(all(test, feature = "dev-tools"))]
mod tests {
    use super::{
        EngineRuntime, OUTPUT, SceneFile, unone_web_bundle_begin, unone_web_bundle_finish,
        unone_web_bundle_write, unone_web_load_project, unone_web_reload_script,
        unone_web_set_input_frame, unone_web_set_pointer, unone_web_set_save_payload,
        unone_web_set_screen_pointer, unone_web_tick,
    };
    use serde_json::json;
    use unone_engine::InputFrame;

    #[test]
    fn web_normalized_3d_replay_matches_core_every_frame() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../unone-engine/tests/fixtures/host-parity.json"
        ))
        .unwrap();
        let payload = serde_json::to_vec(&fixture["project"]).unwrap();
        let mut core = unone_engine::HostProject::parse(&payload)
            .unwrap()
            .into_runtime(42)
            .unwrap();
        assert_eq!(
            unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) },
            0
        );
        let output = || {
            OUTPUT
                .with(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes.borrow()).unwrap())
        };
        assert_eq!(
            output()["world"],
            serde_json::to_value(core.observe()).unwrap()
        );
        for frame in fixture["frames"].as_array().unwrap() {
            let bytes = serde_json::to_vec(frame).unwrap();
            assert_eq!(
                unsafe { unone_web_set_input_frame(bytes.as_ptr(), bytes.len()) },
                0
            );
            assert_eq!(unone_web_tick(), 0);
            let expected = core
                .tick_with_input(&unone_engine::parse_input_frame(&bytes).unwrap())
                .unwrap();
            assert_eq!(output()["world"], serde_json::to_value(&expected).unwrap());
            assert_eq!(
                output()["observation_digest"],
                unone_engine::observation_digest(&expected).unwrap()
            );
        }
    }
    const PROJECT_SCRIPT: &str = r#"--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type ObservationValue = nil | boolean | number | string | {[string]: ObservationValue} | {ObservationValue}
type ObservationApi = { set: (key: string, value: ObservationValue) -> () }
type InputApi = { getPointerPosition: () -> Vec2, getScreenPointerPosition: () -> Vec2, isPointerDown: () -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi, observation: ObservationApi }
local Game = {}
function Game.start(_api: EngineApi) end
function Game.update(api: EngineApi, _dt: number)
    if api.input.isPointerDown() then
        api.entity.setPosition("web_probe", api.input.getPointerPosition())
    end
    api.observation.set("screen_pointer", api.input.getScreenPointerPosition() :: any)
end
return Game
"#;

    const RELOAD_SCRIPT: &str = r#"--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type InputApi = { getPointerPosition: () -> Vec2, isPointerDown: () -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi }
local Game = {}
function Game.start(_api: EngineApi) end
function Game.update(api: EngineApi, dt: number)
    local position = api.entity.getPosition("web_probe")
    position.x += dt
    api.entity.setPosition("web_probe", position)
end
return Game
"#;

    const SAVE_SCRIPT: &str = r#"
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    local payload = api.save.get()
    if payload ~= nil then
        api.observation.set("loaded_node", payload.node)
    end
end
return Game
"#;

    const INPUT_FRAME_SCRIPT: &str = r#"
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    api.observation.set("shoot_down", api.input.isDown("Shoot"))
end
return Game
"#;

    fn project_payload() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "config": {"name": "NativeAbiTest"},
            "script": PROJECT_SCRIPT,
            "scene": {"entities": [{
                "id": "web_probe",
                "transform": {"x": 0.0, "y": 0.0}
            }]}
        }))
        .unwrap()
    }

    fn save_project_payload() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "config": {"name": "WebSaveAbiTest"},
            "script": SAVE_SCRIPT,
        }))
        .unwrap()
    }

    fn output() -> serde_json::Value {
        OUTPUT.with(|output| serde_json::from_slice(output.borrow().as_slice()).unwrap())
    }

    fn observation_digest(value: &serde_json::Value) -> String {
        let digest = value["observation_digest"]
            .as_str()
            .expect("snapshot envelope should expose observation_digest");
        let hex = digest
            .strip_prefix("sha256:")
            .expect("observation_digest should use the sha256: prefix");
        assert_eq!(hex.len(), 64, "observation digest should be 32-byte hex");
        assert!(
            hex.chars()
                .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character)),
            "observation digest should use lowercase hex"
        );
        digest.to_string()
    }

    fn cli_runtime() -> EngineRuntime {
        let scene = serde_json::from_value::<SceneFile>(json!({
            "entities": [{
                "id": "web_probe",
                "transform": {"x": 0.0, "y": 0.0}
            }]
        }))
        .unwrap();
        EngineRuntime::load_source_with_seed(
            "NativeAbiTest",
            "main.luau",
            PROJECT_SCRIPT,
            Some(scene),
            42,
        )
        .unwrap()
    }

    #[test]
    fn c_abi_scene_fragment_uses_shared_diagnostic_context() {
        let payload = serde_json::to_vec(&json!({
            "config": {"name": "WebInvalidScene"},
            "script": PROJECT_SCRIPT,
            "scene": {"entities": [], "typo": true}
        }))
        .unwrap();

        assert_eq!(
            unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) },
            -1
        );
        let value = output();
        let diagnostic = &value["diagnostic"];
        assert_eq!(diagnostic["code"], json!("SCENE_INVALID"));
        assert_eq!(
            diagnostic["facts"]["source_kind"],
            json!("host_payload_scene")
        );
        assert_eq!(
            diagnostic["facts"]["location_scope"],
            json!("scene_fragment")
        );
        assert_eq!(diagnostic["facts"]["pointer_base"], json!("/scene"));
        assert!(diagnostic["facts"]["line"].is_number());
        assert!(diagnostic["facts"]["column"].is_number());
        assert!(diagnostic["source"].is_null());
    }

    #[test]
    fn c_abi_rejects_negative_scene_fixture_matrix() {
        let fixtures = [
            (
                "root-typo",
                r#"{"entities":[],"typo":true}"#,
                "SCENE_INVALID",
                None,
            ),
            (
                "deep-vector-typo",
                r#"{"entities":[{"id":"player","transform":{"x":0,"y":0,"z":0}}]}"#,
                "SCENE_INVALID",
                None,
            ),
            (
                "blank-id",
                r#"{"entities":[{"id":"  \t"}]}"#,
                "SCENE_ENTITY_ID_INVALID",
                Some("/entities/0/id"),
            ),
            (
                "duplicate-id",
                r#"{"entities":[{"id":"player"},{"id":"player"}]}"#,
                "SCENE_ENTITY_ID_DUPLICATE",
                Some("/entities/1/id"),
            ),
            (
                "invalid-geometry",
                r#"{"entities":[{"id":"player","sprite":{"asset":"asset://player","size":{"x":0,"y":1}}}]}"#,
                "SCENE_SPRITE_INVALID",
                None,
            ),
        ];

        for (name, scene, code, json_pointer) in fixtures {
            let valid_payload = project_payload();
            assert_eq!(
                unsafe { unone_web_load_project(valid_payload.as_ptr(), valid_payload.len(), 42) },
                0,
                "valid fixture setup"
            );
            let before_entities = output()["world"]["entities"].clone();
            unone_web_set_pointer(0.0, 0.0, 0);
            let scene: serde_json::Value = serde_json::from_str(scene).unwrap();
            let payload = serde_json::to_vec(&json!({
                "config": {"name": format!("WebInvalidScene-{name}")},
                "script": PROJECT_SCRIPT,
                "scene": scene,
            }))
            .unwrap();
            assert_eq!(
                unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) },
                -1,
                "fixture {name}"
            );
            let diagnostic = &output()["diagnostic"];
            assert_eq!(diagnostic["code"], json!(code), "fixture {name}");
            assert_eq!(
                diagnostic["facts"]["source_kind"],
                json!("host_payload_scene"),
                "fixture {name}"
            );
            assert_eq!(
                diagnostic["facts"]["location_scope"],
                json!("scene_fragment"),
                "fixture {name}"
            );
            assert_eq!(diagnostic["facts"]["pointer_base"], json!("/scene"));
            assert!(diagnostic["source"].is_null(), "fixture {name}");
            if code == "SCENE_INVALID" {
                assert!(diagnostic["facts"]["line"].is_number(), "fixture {name}");
                assert!(diagnostic["facts"]["column"].is_number(), "fixture {name}");
            } else {
                assert!(diagnostic["facts"]["line"].is_null(), "fixture {name}");
                assert!(diagnostic["facts"]["column"].is_null(), "fixture {name}");
            }
            match json_pointer {
                Some(pointer) => assert_eq!(diagnostic["facts"]["json_pointer"], json!(pointer)),
                None => assert!(diagnostic["facts"]["json_pointer"].is_null()),
            }
            assert_eq!(unone_web_tick(), 0, "fixture {name}");
            let after_failed_load = output();
            assert_eq!(
                after_failed_load["world"]["entities"], before_entities,
                "failed scene load replaced the web runtime: {name}"
            );
        }
    }

    #[test]
    fn c_abi_load_tick_and_reload_preserve_runtime_contract() {
        let bundle = b"bundle-content";
        let bundle_spec = serde_json::to_vec(&json!({
            "id": "test-bundle",
            "version": "1",
            "source": "memory",
            "sha256": "17cc744c34dd53bc69277fd7b622b0e1c99d9157e0714d1afffc8264893b2ea3",
            "size_bytes": bundle.len(),
            "dependencies": []
        }))
        .unwrap();
        assert_eq!(
            unsafe { unone_web_bundle_begin(bundle_spec.as_ptr(), bundle_spec.len()) },
            0
        );
        assert_eq!(unsafe { unone_web_bundle_write(bundle.as_ptr(), 6) }, 0);
        assert_eq!(
            unsafe { unone_web_bundle_write(bundle[6..].as_ptr(), bundle.len() - 6) },
            0
        );
        assert_eq!(unone_web_bundle_finish(), 0);
        assert_eq!(output()["status"], json!("verified"));

        let payload = project_payload();
        let loaded = unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) };
        assert_eq!(loaded, 0);
        let loaded_snapshot = output();
        assert_eq!(loaded_snapshot["world"]["frame"], json!(0));
        assert_eq!(loaded_snapshot["world"]["observations"], json!({}));
        let load_digest = observation_digest(&loaded_snapshot);

        unone_web_set_pointer(3.0, 4.0, 1);
        assert_eq!(unone_web_set_screen_pointer(20.0, 15.0), 0);
        assert_eq!(unone_web_tick(), 0);
        let tick_snapshot = output();
        assert_eq!(tick_snapshot["world"]["frame"], json!(1));
        assert_eq!(
            tick_snapshot["world"]["observations"]["screen_pointer"],
            json!({"x": 20, "y": 15})
        );
        let tick_digest = observation_digest(&tick_snapshot);
        assert_ne!(
            tick_digest, load_digest,
            "changed state should change digest"
        );

        // The CLI `run --input-sequence` report is produced by this same
        // public engine runtime; compare its report instead of calculating an
        // expected hash here.
        let cli_frame = serde_json::from_value::<InputFrame>(json!({
            "actions": {},
            "pointer": {
                "position": {"x": 3.0, "y": 4.0},
                "down": true,
                "screen_position": {"x": 20.0, "y": 15.0}
            }
        }))
        .unwrap();
        let cli_report = cli_runtime()
            .run_with_input_sequence(1, 42, &[cli_frame])
            .value
            .unwrap();
        assert_eq!(cli_report.world.frame, 1);
        assert_eq!(tick_digest, cli_report.observation_digest);

        let position = tick_snapshot["world"]["entities"]["web_probe"]["transform"].clone();
        assert_eq!(position, json!({"x": 3.0, "y": 4.0}));

        let reloaded =
            unsafe { unone_web_reload_script(RELOAD_SCRIPT.as_ptr(), RELOAD_SCRIPT.len()) };
        assert_eq!(reloaded, 0);
        let reloaded_snapshot = output();
        assert_eq!(reloaded_snapshot["world"]["frame"], json!(1));
        assert_eq!(
            reloaded_snapshot["world"]["observations"],
            tick_snapshot["world"]["observations"]
        );
        assert_eq!(observation_digest(&reloaded_snapshot), tick_digest);

        unone_web_set_pointer(3.0, 4.0, 0);
        assert_eq!(unone_web_tick(), 0);
        let post_reload_snapshot = output();
        assert_eq!(post_reload_snapshot["project"], json!("NativeAbiTest"));
        assert_eq!(post_reload_snapshot["world"]["frame"], json!(2));
        assert_ne!(
            observation_digest(&post_reload_snapshot),
            tick_digest,
            "post-reload state change should change digest"
        );
        assert!(
            post_reload_snapshot["world"]["entities"]["web_probe"]["transform"]["x"]
                .as_f64()
                .unwrap()
                > 3.0
        );
    }

    #[test]
    fn c_abi_reload_failure_preserves_semantic_diagnostic_and_previous_runtime() {
        let payload = project_payload();
        assert_eq!(
            unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) },
            0
        );
        let invalid_source = b"return {";
        assert_eq!(
            unsafe { unone_web_reload_script(invalid_source.as_ptr(), invalid_source.len()) },
            -1
        );
        let failure = output();
        assert_eq!(failure["ok"], json!(false));
        assert_eq!(failure["kind"], json!("web_error"));
        assert!(failure.get("observation_digest").is_none());
        assert!(failure["diagnostic"]["code"].as_str().is_some());
        assert!(failure["diagnostic"]["explanation"].as_str().is_some());

        unone_web_set_pointer(7.0, 8.0, 1);
        assert_eq!(unone_web_tick(), 0);
        let recovered = output();
        assert_eq!(recovered["world"]["frame"], json!(1));
        observation_digest(&recovered);
        assert_eq!(
            recovered["world"]["entities"]["web_probe"]["transform"],
            json!({"x": 7.0, "y": 8.0})
        );
    }

    #[test]
    fn c_abi_save_payload_reaches_luau_and_snapshot() {
        let payload = save_project_payload();
        assert_eq!(
            unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) },
            0
        );
        let save = serde_json::to_vec(&json!({"version": 1, "node": "brave"})).unwrap();
        assert_eq!(
            unsafe { unone_web_set_save_payload(save.as_ptr(), save.len()) },
            0
        );
        assert_eq!(unone_web_tick(), 0);
        let value = output();
        assert_eq!(value["project"], json!("WebSaveAbiTest"));
        assert_eq!(
            value["world"]["observations"]["loaded_node"],
            json!("brave")
        );
        assert_eq!(
            value["save_payload"],
            json!({"version": 1, "node": "brave"})
        );
    }

    #[test]
    fn c_abi_complete_input_frame_replaces_scalar_pointer_for_one_tick() {
        let payload = serde_json::to_vec(&json!({
            "config": {"name": "WebInputFrameTest"},
            "script": INPUT_FRAME_SCRIPT,
        }))
        .unwrap();
        assert_eq!(
            unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) },
            0
        );
        let frame = serde_json::to_vec(&json!({
            "actions": {"Shoot": true},
            "pointer": {"position": {"x": 1, "y": 2}, "down": false}
        }))
        .unwrap();
        assert_eq!(
            unsafe { unone_web_set_input_frame(frame.as_ptr(), frame.len()) },
            0
        );
        assert_eq!(unone_web_tick(), 0);
        assert_eq!(output()["world"]["observations"]["shoot_down"], json!(true));

        assert_eq!(unone_web_tick(), 0);
        assert_eq!(
            output()["world"]["observations"]["shoot_down"],
            json!(false)
        );
    }
}

#[cfg(all(test, any(feature = "dev-tools", feature = "preview-tools")))]
#[test]
fn publication_profile_is_bounded_and_frozen_outside_window() {
    let mut p = PublicationProfile {
        active: true,
        id: 7,
        ..Default::default()
    };
    for _ in 0..1100 {
        p.record([1., 2., 3., 4.], unone_engine::CanonicalHashWork::default());
    }
    assert_eq!(p.report()["publications"], 1100);
    assert_eq!(p.report()["retained"], 1024);
    assert_eq!(p.report()["phases"]["canonical_hash_ms"]["mean_ms"], 2.);
    p.active = false;
    let stopped = p.report();
    p.record([99.; 4], unone_engine::CanonicalHashWork::default());
    assert_eq!(p.report(), stopped);
}
