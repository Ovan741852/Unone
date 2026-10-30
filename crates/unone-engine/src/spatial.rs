//! Portable, bounded batches of sphere geometry and spatial queries.
//!
//! This module owns geometry only: callers supply positions and optional previous
//! positions. It never integrates motion or interprets category bits. The CPU
//! executor is the deterministic reference implementation and deliberately scans
//! all bodies per query in this first version (O(bodies * queries)). Hosts can
//! implement [`SpatialExecutor`] without changing the batch or result format.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const MAX_BODIES: usize = 65_536;
pub const MAX_QUERIES: usize = 1_024;
pub const MAX_HITS: usize = 64;
pub const MAX_COORDINATE: f32 = 1_000_000.0;
pub const PACKED_BODY_BYTES: usize = 40;
const PACKED_HEADER_BYTES: usize = 8;
const PACKED_MAGIC: &[u8; 4] = b"USB1";

const fn default_category() -> u32 {
    1
}

const fn default_mask() -> u32 {
    u32::MAX
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SpatialBody {
    pub id: u32,
    pub position: [f32; 3],
    pub radius: f32,
    #[serde(default = "default_category")]
    pub category: u32,
    /// The start position of this batch's motion interval. If absent, the body
    /// is stationary for sweep queries. Other queries use `position` only.
    #[serde(default)]
    pub previous_position: Option<[f32; 3]>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SpatialQuery {
    /// Center distance, inclusive of max_distance. Returns at most one body;
    /// equal distances choose the smaller numeric ID. Body radius is ignored.
    Nearest {
        point: [f32; 3],
        max_distance: f32,
        #[serde(default = "default_mask")]
        mask: u32,
        #[serde(default)]
        exclude_id: Option<u32>,
    },
    /// Touching spheres overlap. Results are sorted by ID; exceeding MAX_HITS
    /// is an error for the entire batch, never a truncated result.
    OverlapSphere {
        center: [f32; 3],
        radius: f32,
        #[serde(default = "default_mask")]
        mask: u32,
        #[serde(default)]
        exclude_id: Option<u32>,
    },
    /// Linear relative motion over one normalized interval. Returns only the
    /// earliest contact, with smaller ID breaking equal-fraction ties.
    SweepSphere {
        from: [f32; 3],
        to: [f32; 3],
        radius: f32,
        #[serde(default = "default_mask")]
        mask: u32,
        #[serde(default)]
        exclude_id: Option<u32>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SpatialHit {
    pub id: u32,
    /// Center distance for nearest/overlap; query travel distance for sweep.
    pub distance: f32,
    /// Zero for nearest/overlap; normalized time in [0, 1] for sweep.
    pub fraction: f32,
    /// Point on the body's surface toward the query sphere/point.
    pub point: [f32; 3],
    /// From the body toward the query. Coincident centers and initially
    /// overlapping sweeps use the stable normal [0, 0, 1].
    pub normal: [f32; 3],
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SpatialQueryResult {
    pub hits: Vec<SpatialHit>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SpatialBatch {
    /// Opaque caller version, echoed unchanged in the result.
    pub version: u32,
    pub bodies: Vec<SpatialBody>,
    pub queries: Vec<SpatialQuery>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SpatialBatchResult {
    pub version: u32,
    pub results: Vec<SpatialQueryResult>,
}

/// Optional diagnostics from one executor invocation. These host wall-clock
/// measurements are never part of the geometry result or canonical state.
/// `encode_submit` measures command encoding/submission, not GPU execution.
/// Durations may overlap and must not be added to infer a GPU kernel duration.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SpatialExecutionProfile {
    pub clock: String,
    pub total_ms: f64,
    pub phases_ms: SpatialExecutionPhases,
    pub gpu_kernel_unavailable_reason: Option<String>,
    pub upload_bytes: u64,
    pub readback_bytes: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SpatialExecutionPhases {
    pub preparation: Option<f64>,
    pub queue_wait: Option<f64>,
    pub validation: Option<f64>,
    pub packing: Option<f64>,
    pub upload: Option<f64>,
    pub encode_submit: Option<f64>,
    pub readback_wait: Option<f64>,
    pub decode: Option<f64>,
    pub cpu_execute: Option<f64>,
    pub gpu_kernel: Option<f64>,
}

impl SpatialExecutionProfile {
    pub fn validate(&self) -> Result<(), String> {
        self.validate_detailed().map_err(|issue| issue.message)
    }

    pub(crate) fn validate_detailed(&self) -> Result<(), crate::diagnostics::InputDiagnostic> {
        use crate::diagnostics::InputDiagnostic;
        const MESSAGE: &str = "SPATIAL_PROFILE_INVALID: expected bounded finite host measurements and explicit GPU timing availability";
        let duration = |value:f64| value.is_finite() && (0.0..=3_600_000.0).contains(&value);
        let fact = |value:f64| if value.is_finite(){serde_json::json!(value)}else{serde_json::json!(value.to_string())};
        if self.clock != "host_monotonic" { return Err(InputDiagnostic::new(MESSAGE,"profile.clock",serde_json::json!(self.clock),serde_json::json!("host_monotonic"))); }
        if !duration(self.total_ms) { return Err(InputDiagnostic::new(MESSAGE,"profile.total_ms",fact(self.total_ms),serde_json::json!({"finite":true,"min":0,"max":3_600_000}))); }
        let p=&self.phases_ms;
        for (name,value) in [("preparation",p.preparation),("queue_wait",p.queue_wait),("validation",p.validation),("packing",p.packing),("upload",p.upload),("encode_submit",p.encode_submit),("readback_wait",p.readback_wait),("decode",p.decode),("cpu_execute",p.cpu_execute),("gpu_kernel",p.gpu_kernel)] {
            if let Some(value)=value { if !duration(value) { return Err(InputDiagnostic::new(MESSAGE,format!("profile.phases_ms.{name}"),fact(value),serde_json::json!({"finite":true,"min":0,"max":3_600_000}))); } }
        }
        for (name,value) in [("upload_bytes",self.upload_bytes),("readback_bytes",self.readback_bytes)] {
            if value>1_073_741_824 { return Err(InputDiagnostic::new(MESSAGE,format!("profile.{name}"),serde_json::json!(value),serde_json::json!({"max":1_073_741_824u64}))); }
        }
        if let Some(reason)=&self.gpu_kernel_unavailable_reason { if reason.is_empty()||reason.len()>256 {
            return Err(InputDiagnostic::new(MESSAGE,"profile.gpu_kernel_unavailable_reason",serde_json::json!({"byte_length":reason.len()}),serde_json::json!({"min_bytes":1,"max_bytes":256})));
        } }
        if p.gpu_kernel.is_some()==self.gpu_kernel_unavailable_reason.is_some() {
            return Err(InputDiagnostic::new(MESSAGE,"profile.gpu_kernel_unavailable_reason",serde_json::json!({"has_gpu_kernel":p.gpu_kernel.is_some(),"has_reason":self.gpu_kernel_unavailable_reason.is_some()}),serde_json::json!("exactly one of gpu_kernel measurement or unavailable reason")));
        }
        Ok(())
    }
}

pub trait SpatialExecutor {
    fn name(&self) -> &str;
    fn execute(&mut self, batch: &SpatialBatch) -> Result<SpatialBatchResult, String>;
    /// Consume only optional diagnostics for the last invocation. Existing
    /// embedders need not implement profiling to retain the geometry contract.
    fn take_profile(&mut self) -> Option<SpatialExecutionProfile> { None }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct CpuSpatialExecutor;

impl SpatialExecutor for CpuSpatialExecutor {
    fn name(&self) -> &str {
        "cpu"
    }

    fn execute(&mut self, batch: &SpatialBatch) -> Result<SpatialBatchResult, String> {
        execute_cpu(batch)
    }
}

fn validate_point(point: [f32; 3], label: &str) -> Result<(), String> {
    if point
        .iter()
        .any(|value| !value.is_finite() || value.abs() > MAX_COORDINATE)
    {
        return Err(format!(
            "{label} must have finite coordinates within +/-{MAX_COORDINATE}"
        ));
    }
    Ok(())
}

fn validate_radius(radius: f32, label: &str) -> Result<(), String> {
    if !radius.is_finite() || !(0.0..=MAX_COORDINATE).contains(&radius) {
        return Err(format!(
            "{label} must be finite and in 0..={MAX_COORDINATE}"
        ));
    }
    Ok(())
}

pub fn validate_bodies(bodies: &[SpatialBody]) -> Result<(), String> {
    validate_bodies_detailed(bodies).map_err(|issue| issue.message)
}

// Labels are built only on failure: validators run over up to MAX_BODIES
// records per batch, and eager path strings dominated their allocation cost.
fn point_detailed(point: [f32; 3], labels: impl FnOnce() -> (String, String)) -> Result<(), crate::diagnostics::InputDiagnostic> {
    if point.iter().all(|value| value.is_finite() && value.abs() <= MAX_COORDINATE) {
        return Ok(());
    }
    let (legacy, path) = labels();
    if let Err(message) = validate_point(point, &legacy) {
        let actual = point.iter().map(|value| finite_fact(*value)).collect::<Vec<_>>();
        return Err(crate::diagnostics::InputDiagnostic::new(message, path, serde_json::json!(actual),
            serde_json::json!({"type":"vector3","finite":true,"coordinate_abs_max":MAX_COORDINATE})));
    }
    Ok(())
}

pub(crate) fn finite_fact(value: f32) -> serde_json::Value {
    if value.is_finite() { serde_json::json!(value) } else { serde_json::json!(value.to_string()) }
}

fn radius_detailed(radius: f32, labels: impl FnOnce() -> (String, String)) -> Result<(), crate::diagnostics::InputDiagnostic> {
    if radius.is_finite() && (0.0..=MAX_COORDINATE).contains(&radius) {
        return Ok(());
    }
    let (legacy, path) = labels();
    validate_radius(radius, &legacy).map_err(|message| crate::diagnostics::InputDiagnostic::new(message, path,
        finite_fact(radius), serde_json::json!({"finite":true,"min":0,"max":MAX_COORDINATE})))
}

pub(crate) fn validate_bodies_detailed(bodies: &[SpatialBody]) -> Result<(), crate::diagnostics::InputDiagnostic> {
    use crate::diagnostics::InputDiagnostic;
    if bodies.len() > MAX_BODIES {
        return Err(InputDiagnostic::new(format!("body count exceeds {MAX_BODIES}"), "bodies",
            serde_json::json!(bodies.len()), serde_json::json!({"max_count":MAX_BODIES})));
    }
    let mut ids = HashSet::with_capacity(bodies.len());
    for (index, body) in bodies.iter().enumerate() {
        let path = || format!("bodies[{}]", index + 1);
        if !ids.insert(body.id) {
            return Err(InputDiagnostic::new(format!("duplicate body ID {}", body.id), format!("{}.id", path()),
                serde_json::json!(body.id), serde_json::json!({"unique":true})));
        }
        point_detailed(body.position, || (format!("bodies[{index}].position"), format!("{}.position", path())))?;
        radius_detailed(body.radius, || (format!("bodies[{index}].radius"), format!("{}.radius", path())))?;
        if let Some(previous) = body.previous_position {
            point_detailed(previous, || (format!("bodies[{index}].previous_position"), format!("{}.previous_position", path())))?;
        }
    }
    Ok(())
}

pub fn validate_batch(batch: &SpatialBatch) -> Result<(), String> {
    validate_batch_detailed(batch).map_err(|issue| issue.message)
}

pub(crate) fn validate_batch_detailed(batch: &SpatialBatch) -> Result<(), crate::diagnostics::InputDiagnostic> {
    use crate::diagnostics::InputDiagnostic;
    validate_bodies_detailed(&batch.bodies)?;
    if batch.queries.len() > MAX_QUERIES {
        return Err(InputDiagnostic::new(format!("query count exceeds {MAX_QUERIES}"), "queries",
            serde_json::json!(batch.queries.len()), serde_json::json!({"max_count":MAX_QUERIES})));
    }
    for (index, query) in batch.queries.iter().enumerate() {
        let path = || format!("queries[{}]", index + 1);
        match query {
            SpatialQuery::Nearest { point, max_distance, .. } => {
                point_detailed(*point, || (format!("queries[{index}].point"), format!("{}.point", path())))?;
                if !max_distance.is_finite() || *max_distance < 0.0 {
                    return Err(InputDiagnostic::new(format!("queries[{index}].max_distance must be finite and nonnegative"),
                        format!("{}.max_distance", path()), finite_fact(*max_distance), serde_json::json!({"finite":true,"min":0})));
                }
            }
            SpatialQuery::OverlapSphere { center, radius, .. } => {
                point_detailed(*center, || (format!("queries[{index}].center"), format!("{}.center", path())))?;
                radius_detailed(*radius, || (format!("queries[{index}].radius"), format!("{}.radius", path())))?;
            }
            SpatialQuery::SweepSphere { from, to, radius, .. } => {
                point_detailed(*from, || (format!("queries[{index}].from"), format!("{}.from", path())))?;
                point_detailed(*to, || (format!("queries[{index}].to"), format!("{}.to", path())))?;
                radius_detailed(*radius, || (format!("queries[{index}].radius"), format!("{}.radius", path())))?;
            }
        }
    }
    Ok(())
}

/// Validate an executor's result envelope before exposing it to a caller. This
/// checks structure, IDs, filters, ordering and finite geometry, not geometric
/// completeness or whether a backend selected the correct closest contact.
pub fn validate_result(batch: &SpatialBatch, result: &SpatialBatchResult) -> Result<(), String> {
    validate_result_detailed(batch, result).map_err(|issue| issue.message)
}

pub(crate) fn validate_result_detailed(batch: &SpatialBatch, result: &SpatialBatchResult) -> Result<(), crate::diagnostics::InputDiagnostic> {
    use crate::diagnostics::InputDiagnostic;
    validate_batch_detailed(batch)?;
    if result.version != batch.version {
        return Err(InputDiagnostic::new("spatial result version does not match the batch", "result.version", serde_json::json!(result.version), serde_json::json!(batch.version)));
    }
    if result.results.len() != batch.queries.len() {
        return Err(InputDiagnostic::new("spatial result count does not match the query count", "result.results", serde_json::json!(result.results.len()), serde_json::json!({"count":batch.queries.len()})));
    }
    let bodies: HashMap<_, _> = batch.bodies.iter().map(|body| (body.id, body)).collect();
    for (index, (query, output)) in batch.queries.iter().zip(&result.results).enumerate() {
        let path = || format!("result.results[{}].hits",index+1);
        let (mask, exclude_id, max_hits, is_sweep) = match query {
            SpatialQuery::Nearest { mask, exclude_id, .. } => (*mask, *exclude_id, 1, false),
            SpatialQuery::OverlapSphere { mask, exclude_id, .. } => (*mask, *exclude_id, MAX_HITS, false),
            SpatialQuery::SweepSphere { mask, exclude_id, .. } => (*mask, *exclude_id, 1, true),
        };
        if output.hits.len() > max_hits {
            return Err(InputDiagnostic::new(format!("spatial result[{index}] exceeds {max_hits} hits"),path(),serde_json::json!(output.hits.len()),serde_json::json!({"max_count":max_hits})));
        }
        let mut previous_id = None;
        for (hit_index,hit) in output.hits.iter().enumerate() {
            let path = || format!("{}[{}]",path(),hit_index+1);
            let Some(body) = bodies.get(&hit.id) else {
                return Err(InputDiagnostic::new(format!("spatial result[{index}] contains an unknown body ID"),format!("{}.id",path()),serde_json::json!(hit.id),serde_json::json!("an ID present in the submitted batch")));
            };
            if !eligible(body, mask, exclude_id) {
                return Err(InputDiagnostic::new(format!("spatial result[{index}] violates its body filter"),format!("{}.id",path()),serde_json::json!(hit.id),serde_json::json!({"mask":mask,"exclude_id":exclude_id})));
            }
            if previous_id.is_some_and(|previous| hit.id <= previous) {
                return Err(InputDiagnostic::new(format!("spatial result[{index}] IDs must be unique and ascending"),format!("{}.id",path()),serde_json::json!(hit.id),serde_json::json!({"greater_than":previous_id})));
            }
            previous_id = Some(hit.id);
            if !hit.distance.is_finite() || hit.distance < 0.0 {
                return Err(InputDiagnostic::new(format!("spatial result[{index}] distance must be finite and nonnegative"),format!("{}.distance",path()),finite_fact(hit.distance),serde_json::json!({"finite":true,"min":0})));
            }
            if !hit.fraction.is_finite() || !(0.0..=1.0).contains(&hit.fraction) || (!is_sweep && hit.fraction != 0.0) {
                return Err(InputDiagnostic::new(format!("spatial result[{index}] contains an invalid fraction"),format!("{}.fraction",path()),finite_fact(hit.fraction),serde_json::json!({"finite":true,"min":0,"max":if is_sweep{1}else{0}})));
            }
            if hit.point.iter().any(|value| !value.is_finite() || value.abs() > MAX_COORDINATE * 2.0)
                || hit.normal.iter().any(|value| !value.is_finite()) || (dot(hit.normal, hit.normal) - 1.0).abs() > 0.002 {
                return Err(InputDiagnostic::new(format!("spatial result[{index}] contains invalid contact geometry"),path(),
                    serde_json::json!({"point":hit.point.map(finite_fact),"normal":hit.normal.map(finite_fact)}),serde_json::json!({"finite":true,"point_abs_max":MAX_COORDINATE*2.0,"unit_normal_tolerance":0.002})));
            }
        }
    }
    Ok(())
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    (a[0] * b[0] + a[1] * b[1]) + a[2] * b[2]
}

fn normal_or_z(delta: [f32; 3]) -> [f32; 3] {
    // Squaring tiny, otherwise valid coordinates can underflow (or retain an
    // inaccurate subnormal length). Normalize a vector with a largest component
    // of one instead, including when every original component is subnormal.
    let scale = delta[0].abs().max(delta[1].abs()).max(delta[2].abs());
    if scale > 0.0 {
        let scaled = [delta[0] / scale, delta[1] / scale, delta[2] / scale];
        let length = dot(scaled, scaled).sqrt();
        [scaled[0] / length, scaled[1] / length, scaled[2] / length]
    } else {
        [0.0, 0.0, 1.0]
    }
}

fn surface_point(center: [f32; 3], normal: [f32; 3], radius: f32) -> [f32; 3] {
    [
        center[0] + normal[0] * radius,
        center[1] + normal[1] * radius,
        center[2] + normal[2] * radius,
    ]
}

fn eligible(body: &SpatialBody, mask: u32, exclude_id: Option<u32>) -> bool {
    body.category & mask != 0 && Some(body.id) != exclude_id
}

fn static_hit(body: &SpatialBody, point: [f32; 3], distance: f32) -> SpatialHit {
    let normal = normal_or_z(sub(point, body.position));
    SpatialHit {
        id: body.id,
        distance,
        fraction: 0.0,
        point: surface_point(body.position, normal, body.radius),
        normal,
    }
}

fn sweep_hit(
    body: &SpatialBody,
    from: [f32; 3],
    to: [f32; 3],
    radius: f32,
) -> Option<SpatialHit> {
    let start = body.previous_position.unwrap_or(body.position);
    let body_travel = sub(body.position, start);
    let query_travel = sub(to, from);
    let relative_start = sub(from, start);
    let relative_travel = sub(query_travel, body_travel);
    let expanded_radius = radius + body.radius;
    let c = dot(relative_start, relative_start) - expanded_radius * expanded_radius;
    let initial_overlap = c <= 0.0;
    let fraction = if initial_overlap {
        0.0
    } else {
        let a = dot(relative_travel, relative_travel);
        if a == 0.0 {
            return None;
        }
        // Solve around the closest point on the infinite relative-motion line.
        // The expanded quadratic discriminant b*b-a*c catastrophically cancels
        // small radii at otherwise valid million-unit coordinates.
        let closest_fraction = -dot(relative_start, relative_travel) / a;
        let closest = [
            relative_start[0] + relative_travel[0] * closest_fraction,
            relative_start[1] + relative_travel[1] * closest_fraction,
            relative_start[2] + relative_travel[2] * closest_fraction,
        ];
        let remaining_radius_squared =
            expanded_radius * expanded_radius - dot(closest, closest);
        if remaining_radius_squared < 0.0 {
            return None;
        }
        let fraction = closest_fraction - (remaining_radius_squared / a).sqrt();
        if !(0.0..=1.0).contains(&fraction) {
            return None;
        }
        fraction
    };
    let normal = if initial_overlap {
        [0.0, 0.0, 1.0]
    } else {
        normal_or_z([
            relative_start[0] + relative_travel[0] * fraction,
            relative_start[1] + relative_travel[1] * fraction,
            relative_start[2] + relative_travel[2] * fraction,
        ])
    };
    let center = [
        start[0] + body_travel[0] * fraction,
        start[1] + body_travel[1] * fraction,
        start[2] + body_travel[2] * fraction,
    ];
    Some(SpatialHit {
        id: body.id,
        distance: dot(query_travel, query_travel).sqrt() * fraction,
        fraction,
        point: surface_point(center, normal, body.radius),
        normal,
    })
}

/// Execute synchronously against a frozen batch. Invalid input or any overlap
/// overflow returns an error; no partial batch results are returned.
pub fn execute_cpu(batch: &SpatialBatch) -> Result<SpatialBatchResult, String> {
    validate_batch(batch)?;
    let mut results = Vec::with_capacity(batch.queries.len());
    for (query_index, query) in batch.queries.iter().enumerate() {
        let hits = match query {
            SpatialQuery::Nearest {
                point,
                max_distance,
                mask,
                exclude_id,
            } => {
                let mut best: Option<(f32, &SpatialBody)> = None;
                for body in &batch.bodies {
                    if !eligible(body, *mask, *exclude_id) {
                        continue;
                    }
                    let delta = sub(*point, body.position);
                    let distance_squared = dot(delta, delta);
                    // Compare distance itself so a very large finite max_distance
                    // need not be squared, which could overflow to infinity.
                    if distance_squared.sqrt() > *max_distance {
                        continue;
                    }
                    if best.is_none_or(|(best_distance, best_body)| {
                        distance_squared < best_distance
                            || (distance_squared == best_distance && body.id < best_body.id)
                    }) {
                        best = Some((distance_squared, body));
                    }
                }
                best.map(|(distance_squared, body)| {
                    vec![static_hit(body, *point, distance_squared.sqrt())]
                })
                .unwrap_or_default()
            }
            SpatialQuery::OverlapSphere {
                center,
                radius,
                mask,
                exclude_id,
            } => {
                let mut hits = Vec::new();
                for body in &batch.bodies {
                    if !eligible(body, *mask, *exclude_id) {
                        continue;
                    }
                    let delta = sub(*center, body.position);
                    let distance_squared = dot(delta, delta);
                    let expanded_radius = radius + body.radius;
                    if distance_squared <= expanded_radius * expanded_radius {
                        if hits.len() == MAX_HITS {
                            return Err(format!(
                                "queries[{query_index}] overlap exceeds {MAX_HITS} hits"
                            ));
                        }
                        hits.push(static_hit(body, *center, distance_squared.sqrt()));
                    }
                }
                hits.sort_unstable_by_key(|hit| hit.id);
                hits
            }
            SpatialQuery::SweepSphere {
                from,
                to,
                radius,
                mask,
                exclude_id,
            } => {
                let mut best: Option<SpatialHit> = None;
                for body in &batch.bodies {
                    if !eligible(body, *mask, *exclude_id) {
                        continue;
                    }
                    if let Some(hit) = sweep_hit(body, *from, *to, *radius) {
                        if best.as_ref().is_none_or(|current| {
                            hit.fraction < current.fraction
                                || (hit.fraction == current.fraction && hit.id < current.id)
                        }) {
                            best = Some(hit);
                        }
                    }
                }
                best.into_iter().collect()
            }
        };
        results.push(SpatialQueryResult { hits });
    }
    Ok(SpatialBatchResult {
        version: batch.version,
        results,
    })
}

/// Encode `USB1`, a little-endian u32 body count, then 40 bytes per body:
/// id:u32, category:u32, position:3xf32, radius:f32, previous:3xf32,
/// has_previous:u32 (0 or 1). Caller order is preserved.
pub fn pack_bodies(bodies: &[SpatialBody]) -> Result<Vec<u8>, String> {
    validate_bodies(bodies)?;
    let mut bytes = Vec::with_capacity(PACKED_HEADER_BYTES + bodies.len() * PACKED_BODY_BYTES);
    bytes.extend_from_slice(PACKED_MAGIC);
    bytes.extend_from_slice(&(bodies.len() as u32).to_le_bytes());
    for body in bodies {
        bytes.extend_from_slice(&body.id.to_le_bytes());
        bytes.extend_from_slice(&body.category.to_le_bytes());
        for value in body.position {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes.extend_from_slice(&body.radius.to_le_bytes());
        for value in body.previous_position.unwrap_or(body.position) {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes.extend_from_slice(&u32::from(body.previous_position.is_some()).to_le_bytes());
    }
    Ok(bytes)
}

/// SHA-256 of the canonical USB1 encoding produced by [`pack_bodies`], streamed
/// without building the packed buffer. World snapshots carry this instead of
/// every body so per-tick observation stays O(indices), not O(bodies).
pub(crate) fn bodies_digest(bodies: &[SpatialBody]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(PACKED_MAGIC);
    hasher.update((bodies.len() as u32).to_le_bytes());
    for body in bodies {
        hasher.update(body.id.to_le_bytes());
        hasher.update(body.category.to_le_bytes());
        for value in body.position {
            hasher.update(value.to_le_bytes());
        }
        hasher.update(body.radius.to_le_bytes());
        for value in body.previous_position.unwrap_or(body.position) {
            hasher.update(value.to_le_bytes());
        }
        hasher.update(u32::from(body.previous_position.is_some()).to_le_bytes());
    }
    format!("{:x}", hasher.finalize())
}

pub fn unpack_bodies(bytes: &[u8]) -> Result<Vec<SpatialBody>, String> {
    unpack_bodies_detailed(bytes).map_err(|issue| issue.message)
}

pub(crate) fn unpack_bodies_detailed(bytes: &[u8]) -> Result<Vec<SpatialBody>, crate::diagnostics::InputDiagnostic> {
    use crate::diagnostics::InputDiagnostic;
    if bytes.len() < PACKED_HEADER_BYTES || &bytes[..4] != PACKED_MAGIC {
        return Err(InputDiagnostic::new("packed spatial bodies require a USB1 header", "bodies.header",
            serde_json::json!({"byte_length":bytes.len(),"magic":bytes.iter().take(4).copied().collect::<Vec<_>>()}), serde_json::json!("USB1")));
    }
    let count = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if count > MAX_BODIES {
        return Err(InputDiagnostic::new(format!("packed body count exceeds {MAX_BODIES}"), "bodies.count",
            serde_json::json!(count), serde_json::json!({"max":MAX_BODIES})));
    }
    let expected = count.checked_mul(PACKED_BODY_BYTES).and_then(|length| length.checked_add(PACKED_HEADER_BYTES))
        .ok_or_else(|| InputDiagnostic::new("packed spatial body length overflow", "bodies.byte_length", serde_json::json!(bytes.len()), serde_json::json!("USB1 size within platform bounds")))?;
    if bytes.len() != expected {
        return Err(InputDiagnostic::new(format!("packed spatial bodies length must be {expected}, got {}", bytes.len()),
            "bodies.byte_length", serde_json::json!(bytes.len()), serde_json::json!(expected)));
    }
    let mut bodies = Vec::with_capacity(count);
    for (index, record) in bytes[PACKED_HEADER_BYTES..].chunks_exact(PACKED_BODY_BYTES).enumerate() {
        let uint = |offset| u32::from_le_bytes(record[offset..offset + 4].try_into().unwrap());
        let float = |offset| f32::from_bits(uint(offset));
        let previous = [float(24), float(28), float(32)];
        point_detailed(previous, || (format!("packed bodies[{index}].previous_position"), format!("bodies[{}].previous_position", index + 1)))?;
        let previous_position = match uint(36) {
            0 => None, 1 => Some(previous),
            other => return Err(InputDiagnostic::new(format!("packed bodies[{index}].has_previous must be 0 or 1"),
                format!("bodies[{}].has_previous", index + 1), serde_json::json!(other), serde_json::json!([0,1]))),
        };
        bodies.push(SpatialBody { id:uint(0), category:uint(4), position:[float(8),float(12),float(16)], radius:float(20), previous_position });
    }
    validate_bodies_detailed(&bodies)?;
    Ok(bodies)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_digest_matches_the_packed_usb1_encoding() {
        use sha2::{Digest, Sha256};
        let bodies = vec![
            SpatialBody { id: 3, category: 2, position: [1.0, -2.0, 0.5], radius: 0.25, previous_position: None },
            SpatialBody { id: 9, category: 1, position: [4.0, 0.0, 0.0], radius: 1.0, previous_position: Some([3.0, 0.0, 0.0]) },
        ];
        let packed = pack_bodies(&bodies).unwrap();
        assert_eq!(bodies_digest(&bodies), format!("{:x}", Sha256::digest(&packed)));
        let mut moved = bodies.clone();
        moved[1].position[0] = 4.5;
        assert_ne!(bodies_digest(&bodies), bodies_digest(&moved));
    }
}
