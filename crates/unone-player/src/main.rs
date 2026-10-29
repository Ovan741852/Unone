// Both hosts use the same bridge. The player cannot enable developer tooling.
#[cfg(feature = "dev-tools")]
compile_error!("unone-player cannot include dev-tools; build the development host instead");
const _: () = assert!(
    !unone_engine::DEV_TOOLS_ENABLED,
    "player dependency enabled dev-tools"
);
include!("../../unone-web-live-smoke/src/main.rs");

// Read-only presentation sampling has its own buffers and never loads or advances
// the gameplay runtime. The engine owns all particle validation and semantics.
#[cfg(feature = "particle")]
mod particle_sampler {
    use serde::Deserialize;
    use std::cell::RefCell;
    use unone_engine::{ParticleDefinition, Vec3};

    const MAX_REQUEST_BYTES: usize = 65_536;
    const MAX_JS_INTEGER: u64 = 9_007_199_254_740_991;

    thread_local! {
        static REQUEST: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
        static RESPONSE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct SampleRequest {
        definition: ParticleDefinition,
        seed: u64,
        frame: u64,
        position: [f64; 3],
    }

    fn fail(message: impl Into<String>) -> i32 {
        RESPONSE.with(|response| {
            *response.borrow_mut() = serde_json::to_vec(
                &serde_json::json!({"ok": false, "error": message.into()}),
            )
            .expect("particle error contains only a JSON string");
        });
        -1
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn unone_web_particle_alloc(length: usize) -> *mut u8 {
        if length == 0 || length > MAX_REQUEST_BYTES {
            fail("PARTICLE_REQUEST_INVALID: request must contain 1..65536 bytes");
            return std::ptr::null_mut();
        }
        REQUEST.with(|request| {
            let mut request = request.borrow_mut();
            request.resize(length, 0);
            request.as_mut_ptr()
        })
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn unone_web_particle_sample(pointer: *const u8, length: usize) -> i32 {
        // Read only the owned allocation, even when a caller supplies a bad ABI
        // pointer. This request cannot alias the gameplay host's input buffer.
        let request = REQUEST.with(|request| {
            let request = request.borrow();
            if pointer.is_null()
                || pointer != request.as_ptr()
                || length != request.len()
                || length == 0
                || length > MAX_REQUEST_BYTES
            {
                return Err("PARTICLE_REQUEST_INVALID: use particle_alloc for this request".into());
            }
            serde_json::from_slice::<SampleRequest>(&request)
                .map_err(|error| format!("PARTICLE_REQUEST_INVALID: {error}"))
        });
        let request = match request {
            Ok(request) => request,
            Err(error) => return fail(error),
        };
        if request.seed > MAX_JS_INTEGER || request.frame > MAX_JS_INTEGER {
            return fail("PARTICLE_REQUEST_INVALID: seed and frame must be safe nonnegative integers");
        }
        if request
            .definition
            .emitters
            .iter()
            .any(|emitter| emitter.id.len() > 256)
        {
            return fail("PARTICLE_REQUEST_INVALID: emitter IDs must not exceed 256 bytes");
        }
        let [x, y, z] = request.position;
        let particles = match request
            .definition
            .sample(request.seed, request.frame, Vec3 { x, y, z })
        {
            Ok(particles) => particles,
            Err(error) => return fail(error),
        };
        match serde_json::to_vec(&serde_json::json!({"ok": true, "particles": particles})) {
            Ok(bytes) => {
                RESPONSE.with(|response| *response.borrow_mut() = bytes);
                0
            }
            Err(error) => fail(format!("PARTICLE_SAMPLE_FAILED: {error}")),
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn unone_web_particle_output_ptr() -> *const u8 {
        RESPONSE.with(|response| response.borrow().as_ptr())
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn unone_web_particle_output_len() -> usize {
        RESPONSE.with(|response| response.borrow().len())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn request() -> serde_json::Value {
            serde_json::json!({
                "definition": serde_json::from_str::<serde_json::Value>(include_str!(
                    "../../../tests/fixtures/spark.particle.json"
                )).unwrap(),
                "seed": 42, "frame": 12, "position": [1, 2, 3]
            })
        }

        fn sample(value: &serde_json::Value) -> (i32, serde_json::Value) {
            let bytes = serde_json::to_vec(value).unwrap();
            let pointer = unone_web_particle_alloc(bytes.len());
            assert!(!pointer.is_null());
            REQUEST.with(|request| request.borrow_mut().copy_from_slice(&bytes));
            let status = unone_web_particle_sample(pointer, bytes.len());
            let response =
                RESPONSE.with(|response| serde_json::from_slice(&response.borrow()).unwrap());
            (status, response)
        }

        #[test]
        fn pure_sampler_matches_native_without_gameplay_publication() {
            super::super::OUTPUT.with(|output| *output.borrow_mut() = b"gameplay sentinel".to_vec());
            let request = request();
            let first = sample(&request);
            assert_eq!(first.0, 0);
            assert_eq!(first, sample(&request));
            let definition: ParticleDefinition =
                serde_json::from_value(request["definition"].clone()).unwrap();
            let expected = definition
                .sample(42, 12, Vec3 { x: 1., y: 2., z: 3. })
                .unwrap();
            assert_eq!(first.1["particles"], serde_json::to_value(expected).unwrap());
            super::super::OUTPUT
                .with(|output| assert_eq!(&*output.borrow(), b"gameplay sentinel"));
            assert!(super::super::RUNTIME.with(|runtime| runtime.borrow().is_none()));
            let mut different = request;
            different["seed"] = 43.into();
            assert_ne!(first.1["particles"], sample(&different).1["particles"]);
        }

        #[test]
        fn invalid_requests_recover_without_poisoning_sampler() {
            assert_eq!(unone_web_particle_sample(std::ptr::null(), 0), -1);
            assert!(unone_web_particle_alloc(MAX_REQUEST_BYTES + 1).is_null());
            for invalid in [
                serde_json::json!({"unknown": true}),
                {
                    let mut value = request();
                    value["position"] = serde_json::json!([1e10, 0, 0]);
                    value
                },
                {
                    let mut value = request();
                    value["frame"] = serde_json::json!(MAX_JS_INTEGER + 1);
                    value
                },
                {
                    let mut value = request();
                    value["definition"]["emitters"][0]["count"] = 10000.into();
                    value
                },
                {
                    let mut value = request();
                    value["definition"]["emitters"][0]["id"] = "x".repeat(257).into();
                    value
                },
            ] {
                assert_eq!(sample(&invalid).0, -1);
                assert_eq!(sample(&request()).0, 0);
            }
            let length = REQUEST.with(|request| request.borrow().len());
            let foreign = vec![0u8; length];
            assert_eq!(unone_web_particle_sample(foreign.as_ptr(), length), -1);
            assert_eq!(sample(&request()).0, 0);
        }
    }
}
