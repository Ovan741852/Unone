//! Bounded diagnostics for Lua/Rust conversion, detached from canonical state.
use serde::Serialize;
const MAX: f64 = 9_007_199_254_740_991.0;

#[derive(Clone, Serialize)]
pub(crate) struct SpatialBindingSample {
    pub operation: &'static str,
    pub success: bool,
    pub input_decode_ms: f64,
    pub output_encode_ms: f64,
    pub index: Option<u64>,
    pub ticket: Option<u64>,
}

#[derive(Serialize)]
pub(crate) struct SpatialBindingProfile {
    clock: &'static str,
    scope: &'static str,
    calls: u64,
    failed_calls: u64,
    input_decode_ms: f64,
    output_encode_ms: f64,
    last: Option<SpatialBindingSample>,
}

impl Default for SpatialBindingProfile {
    fn default() -> Self {
        Self { clock: "host_monotonic", scope: "Since backend selection or successful reload. pack/create/update/destroy/submit/take/cancel attempts only. Input conversion includes schema checks and failed-input diagnostic construction; output conversion includes packed buffer creation or result JSON-to-Lua conversion. Excludes manager/executor, observation publication and lastDiagnostic/info/profile serialization. Latest operation is independent of latest completed batch.", calls: 0, failed_calls: 0, input_decode_ms: 0.0, output_encode_ms: 0.0, last: None }
    }
}

impl SpatialBindingProfile {
    pub fn record(&mut self, sample: SpatialBindingSample) {
        self.calls = self.calls.saturating_add(1).min(MAX as u64);
        if !sample.success { self.failed_calls = self.failed_calls.saturating_add(1).min(MAX as u64); }
        self.input_decode_ms = (self.input_decode_ms + sample.input_decode_ms).min(MAX);
        self.output_encode_ms = (self.output_encode_ms + sample.output_encode_ms).min(MAX);
        self.last = Some(sample);
    }
}
