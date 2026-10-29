//! Real wgpu compute implementation of the engine's generic spatial batch protocol.
//!
//! This first version scans bodies once per query (O(bodies * queries)). It does
//! not promise a speedup over the CPU reference and deliberately reads results
//! back before returning. It owns no gameplay policy or renderer state.

use std::time::{Duration, Instant};
use unone_engine::spatial::{
    SpatialBatch, SpatialBatchResult, SpatialExecutor, SpatialHit, SpatialQuery,
    SpatialQueryResult, SpatialExecutionProfile, SpatialExecutionPhases, validate_batch,
};
use wgpu::util::DeviceExt;

pub const SHADER_SOURCE: &str = include_str!("../../../web/shared/spatial.wgsl");
const BODY_WORDS: usize = 12;
const QUERY_WORDS: usize = 16;
const HIT_WORDS: usize = 12;
const RESULT_WORDS: usize = 4 + 64 * HIT_WORDS;

/// An engine-owned compute executor. `execute` performs a real GPU dispatch and
/// returns an error on device loss, invalid input, or overlap result overflow.
pub struct SpatialGpuExecutor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    adapter_name: String,
    last_profile: Option<SpatialExecutionProfile>,
}

impl SpatialGpuExecutor {
    pub fn new() -> Result<Self, String> {
        pollster::block_on(Self::new_async())
    }

    pub async fn new_async() -> Result<Self, String> {
        let instance = wgpu::Instance::default();
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .map_err(|error| format!("spatial GPU adapter unavailable: {error}"))?;
        let info = adapter.get_info();
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|error| format!("spatial GPU device unavailable: {error}"))?;
        let mut executor = Self::from_device(device, queue)?;
        executor.adapter_name = format!("{} ({:?}, {:?})", info.name, info.backend, info.device_type);
        Ok(executor)
    }

    /// Reuses a host-owned device/queue without creating a renderer or surface.
    pub fn from_device(device: wgpu::Device, queue: wgpu::Queue) -> Result<Self, String> {
        let limits = device.limits();
        if limits.max_storage_buffers_per_shader_stage < 3
            || limits.max_storage_buffer_binding_size < (1024 * RESULT_WORDS * 4) as u64
            || limits.max_compute_invocations_per_workgroup < 64
        {
            return Err("spatial GPU device limits do not support the v1 batch capacity".into());
        }
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Unone spatial compute"),
            source: wgpu::ShaderSource::Wgsl(SHADER_SOURCE.into()),
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Unone spatial batch"),
            layout: None,
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        if let Some(error) = pollster::block_on(scope.pop()) {
            return Err(format!("spatial GPU pipeline: {error}"));
        }
        Ok(Self { device, queue, pipeline, adapter_name: "host device".into(), last_profile: None })
    }

    pub fn adapter_name(&self) -> &str { &self.adapter_name }

    fn execute_gpu(&self, batch: &SpatialBatch, profile: &mut SpatialExecutionProfile) -> Result<SpatialBatchResult, String> {
        let started = Instant::now();
        validate_batch(batch)?;
        profile.phases_ms.validation = Some(ms(started));
        if batch.queries.is_empty() {
            profile.gpu_kernel_unavailable_reason = Some("No GPU dispatch for empty query batch".into());
            profile.phases_ms.packing = Some(0.0);
            profile.phases_ms.upload = Some(0.0);
            profile.phases_ms.encode_submit = Some(0.0);
            profile.phases_ms.readback_wait = Some(0.0);
            profile.phases_ms.decode = Some(0.0);
            return Ok(SpatialBatchResult { version: batch.version, results: Vec::new() });
        }
        let memory_scope = self.device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
        let validation_scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let result = (|| {
        let started = Instant::now();
        let body_data = pack_bodies(batch);
        let query_data = pack_queries(batch);
        profile.phases_ms.packing = Some(ms(started));
        profile.upload_bytes = ((body_data.len() + query_data.len() + 4) * 4) as u64;
        let started = Instant::now();
        let input = |label, words: &[u32]| self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(label), contents: bytemuck::cast_slice(words), usage: wgpu::BufferUsages::STORAGE,
        });
        let bodies = input("Spatial bodies", &body_data);
        let queries = input("Spatial queries", &query_data);
        let params = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Spatial counts"),
            contents: bytemuck::cast_slice(&[batch.bodies.len() as u32, batch.queries.len() as u32, 0, 0]),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let result_size = (batch.queries.len() * RESULT_WORDS * 4) as u64;
        let output = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Spatial results"), size: result_size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false,
        });
        let readback = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Spatial readback"), size: result_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false,
        });
        profile.phases_ms.upload = Some(ms(started));
        profile.readback_bytes = result_size;
        let started = Instant::now();
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Spatial batch buffers"), layout: &self.pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: bodies.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: queries.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: output.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: params.as_entire_binding() },
            ],
        });
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("Spatial dispatch") });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("Spatial queries"), timestamp_writes: None });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups((batch.queries.len() as u32).div_ceil(64), 1, 1);
        }
        encoder.copy_buffer_to_buffer(&output, 0, &readback, 0, result_size);
        let submission = self.queue.submit([encoder.finish()]);
        profile.phases_ms.encode_submit = Some(ms(started));
        let started = Instant::now();
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        readback.slice(..).map_async(wgpu::MapMode::Read, move |value| { let _ = sender.send(value); });
        self.device.poll(wgpu::PollType::Wait {
            submission_index: Some(submission), timeout: Some(Duration::from_secs(30)),
        }).map_err(|error| format!("spatial GPU wait: {error}"))?;
        receiver.recv_timeout(Duration::from_secs(1))
            .map_err(|error| format!("spatial GPU readback: {error}"))?
            .map_err(|error| format!("spatial GPU map: {error}"))?;
        profile.phases_ms.readback_wait = Some(ms(started));
        let started = Instant::now();
        let mapped = readback.slice(..).get_mapped_range().map_err(|error| error.to_string())?;
        let decoded = decode_results(batch.version, batch.queries.len(), bytemuck::cast_slice(&mapped));
        drop(mapped);
        readback.unmap();
        profile.phases_ms.decode = Some(ms(started));
        decoded
        })();
        let validation_error = pollster::block_on(validation_scope.pop());
        let memory_error = pollster::block_on(memory_scope.pop());
        if let Some(error) = validation_error.or(memory_error) {
            return Err(format!("spatial GPU execution: {error}"));
        }
        result
    }
}

impl SpatialExecutor for SpatialGpuExecutor {
    fn name(&self) -> &str { "wgpu" }
    fn execute(&mut self, batch: &SpatialBatch) -> Result<SpatialBatchResult, String> {
        let started = Instant::now();
        let mut profile = SpatialExecutionProfile {
            clock: "host_monotonic".into(), total_ms: 0.0,
            phases_ms: SpatialExecutionPhases::default(),
            gpu_kernel_unavailable_reason: Some("GPU timestamp queries are not enabled; host timings do not measure kernel duration".into()),
            upload_bytes: 0, readback_bytes: 0,
        };
        let result = self.execute_gpu(batch, &mut profile);
        profile.total_ms = ms(started);
        self.last_profile = Some(profile);
        result
    }
    fn take_profile(&mut self) -> Option<SpatialExecutionProfile> { self.last_profile.take() }
}

fn ms(started: Instant) -> f64 { started.elapsed().as_secs_f64() * 1000.0 }

fn write_vector(words: &mut [u32], index: usize, value: [f32; 3]) {
    for axis in 0..3 { words[index + axis] = value[axis].to_bits(); }
}

fn pack_bodies(batch: &SpatialBatch) -> Vec<u32> {
    // WebGPU storage bindings may not be empty, even for a zero-body query.
    let mut data = vec![0; batch.bodies.len().max(1) * BODY_WORDS];
    for (index, body) in batch.bodies.iter().enumerate() {
        let base = index * BODY_WORDS;
        data[base] = body.id;
        data[base + 1] = body.category;
        data[base + 2] = body.radius.to_bits();
        write_vector(&mut data, base + 4, body.position);
        write_vector(&mut data, base + 8, body.previous_position.unwrap_or(body.position));
    }
    data
}

fn pack_queries(batch: &SpatialBatch) -> Vec<u32> {
    let mut data = vec![0; batch.queries.len() * QUERY_WORDS];
    for (index, query) in batch.queries.iter().enumerate() {
        let base = index * QUERY_WORDS;
        let (kind, from, to, radius, max_distance, mask, exclude_id) = match query {
            SpatialQuery::Nearest { point, max_distance, mask, exclude_id } => (0, *point, [0.; 3], 0., *max_distance, *mask, *exclude_id),
            SpatialQuery::OverlapSphere { center, radius, mask, exclude_id } => (1, *center, [0.; 3], *radius, 0., *mask, *exclude_id),
            SpatialQuery::SweepSphere { from, to, radius, mask, exclude_id } => (2, *from, *to, *radius, 0., *mask, *exclude_id),
        };
        data[base] = kind;
        data[base + 1] = mask;
        data[base + 2] = exclude_id.unwrap_or(0);
        data[base + 3] = u32::from(exclude_id.is_some());
        write_vector(&mut data, base + 4, from);
        data[base + 7] = radius.to_bits();
        write_vector(&mut data, base + 8, to);
        data[base + 11] = max_distance.to_bits();
    }
    data
}

fn decode_results(version: u32, count: usize, words: &[u32]) -> Result<SpatialBatchResult, String> {
    let mut results = Vec::with_capacity(count);
    for index in 0..count {
        let base = index * RESULT_WORDS;
        if words[base + 1] != 0 { return Err(format!("spatial overlap query {index} exceeds 64 hits")); }
        let mut hits = Vec::with_capacity(words[base] as usize);
        for slot in 0..words[base] as usize {
            let offset = base + 4 + slot * HIT_WORDS;
            let f = |index| f32::from_bits(words[offset + index]);
            hits.push(SpatialHit { id: words[offset], distance: f(1), fraction: f(2), point: [f(4), f(5), f(6)], normal: [f(8), f(9), f(10)] });
        }
        results.push(SpatialQueryResult { hits });
    }
    Ok(SpatialBatchResult { version, results })
}

#[cfg(test)]
mod tests {
    #[test]
    fn canonical_shader_validates_without_a_device() {
        let module = naga::front::wgsl::parse_str(super::SHADER_SOURCE).unwrap();
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty()).validate(&module).unwrap();
    }
}
