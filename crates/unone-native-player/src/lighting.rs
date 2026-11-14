//! Scene lighting on the native GPU path (ADR 0054, docs/lighting.md): the
//! mesh shader's Light uniform, the sun's shadow map and the depth-only pass
//! that fills it. The contract is Lambert diffuse with intensity 1 as full
//! light, colour = albedo * (ambient + sum(light * max(n.l, 0) * shadow *
//! falloff)), which the Web player reaches with Three's Lambert material and
//! pi-scaled light intensities.
use unone_engine::Lighting;
use wgpu::util::DeviceExt;

/// render.wgsl `Light`: four vec4s, a mat4, two vec4[8] arrays and a vec4.
pub const LIGHT_FLOATS: usize = 100;
const POINTS: usize = unone_engine::MAX_POINT_LIGHTS;

/// Area-weighted vertex normals as three.js BufferGeometry.computeVertexNormals
/// computes them for indexed geometry, so lit meshes shade alike on both hosts.
pub fn vertex_normals(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    let mut normals = vec![0f32; positions.len()];
    let point = |index: u32| {
        let at = index as usize * 3;
        [positions[at], positions[at + 1], positions[at + 2]]
    };
    for triangle in indices.chunks_exact(3) {
        let (a, b, c) = (point(triangle[0]), point(triangle[1]), point(triangle[2]));
        let cb = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
        let ab = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        let normal = [cb[1] * ab[2] - cb[2] * ab[1], cb[2] * ab[0] - cb[0] * ab[2], cb[0] * ab[1] - cb[1] * ab[0]];
        for &vertex in triangle {
            let at = vertex as usize * 3;
            for axis in 0..3 {
                normals[at + axis] += normal[axis];
            }
        }
    }
    for normal in normals.chunks_exact_mut(3) {
        let length = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if length > 0. {
            normal.iter_mut().for_each(|value| *value /= length);
        }
    }
    normals
}

/// Position, uv and normal interleaved: the mesh pipeline's 32-byte vertex.
pub fn mesh_vertices(positions: &[f32], uv: impl Fn(usize) -> [f32; 2], normals: &[f32]) -> Vec<f32> {
    let mut vertices = Vec::with_capacity(positions.len() / 3 * 8);
    for (index, position) in positions.chunks_exact(3).enumerate() {
        vertices.extend_from_slice(position);
        vertices.extend_from_slice(&uv(index));
        vertices.extend_from_slice(&normals[index * 3..index * 3 + 3]);
    }
    vertices
}

/// "#rrggbb" sRGB text to linear RGB.
fn linear(text: &str) -> [f32; 3] {
    let channel = |at: usize| {
        let value = u8::from_str_radix(&text[at..at + 2], 16).unwrap_or(255) as f32 / 255.;
        if value <= 0.04045 { value / 12.92 } else { ((value + 0.055) / 1.055).powf(2.4) }
    };
    if text.len() == 7 { [channel(1), channel(3), channel(5)] } else { [1.; 3] }
}

fn normalize(v: [f32; 3]) -> [f32; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-12);
    [v[0] / length, v[1] / length, v[2] / length]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// World to the sun's shadow clip space, column-major for WGSL. The shadow box
/// is a cube of half-width `distance` around the camera target, seen from two
/// box widths back along the light; depth runs 0..1 over four box widths. The
/// Web player places its shadow camera the same way.
pub fn shadow_view_proj(direction: [f32; 3], center: [f32; 3], distance: f32) -> [f32; 16] {
    let forward = normalize(direction);
    let eye = [center[0] - forward[0] * 2. * distance, center[1] - forward[1] * 2. * distance, center[2] - forward[2] * 2. * distance];
    let up = if forward[1].abs() > 0.99 { [0., 0., 1.] } else { [0., 1., 0.] };
    let right = normalize(cross(forward, up));
    let up = cross(right, forward);
    let rows = [
        [right[0] / distance, right[1] / distance, right[2] / distance, -dot(right, eye) / distance],
        [up[0] / distance, up[1] / distance, up[2] / distance, -dot(up, eye) / distance],
        [forward[0] / (4. * distance), forward[1] / (4. * distance), forward[2] / (4. * distance), -dot(forward, eye) / (4. * distance)],
        [0., 0., 0., 1.],
    ];
    std::array::from_fn(|at| rows[at % 4][at / 4])
}

/// The Light uniform for this frame, and the shadow map size when the sun casts
/// shadows. `target` is the camera target the shadow box follows.
pub fn light_values(lighting: Option<&Lighting>, target: [f32; 3]) -> ([f32; LIGHT_FLOATS], Option<u32>) {
    let mut values = [0f32; LIGHT_FLOATS];
    let Some(lighting) = lighting else { return (values, None) };
    let ambient = linear(&lighting.ambient.color);
    let intensity = lighting.ambient.intensity as f32;
    values[0..4].copy_from_slice(&[ambient[0] * intensity, ambient[1] * intensity, ambient[2] * intensity, 1.]);
    let mut shadow_size = None;
    if let Some(sun) = &lighting.sun {
        let direction = normalize([sun.direction.x as f32, sun.direction.y as f32, sun.direction.z as f32]);
        // The shader wants the way towards the light.
        values[4..8].copy_from_slice(&[-direction[0], -direction[1], -direction[2], 1.]);
        let color = linear(&sun.color);
        let intensity = sun.intensity as f32;
        values[8..11].copy_from_slice(&[color[0] * intensity, color[1] * intensity, color[2] * intensity]);
        if let Some(shadows) = &sun.shadows {
            values[11] = 1.;
            values[12] = shadows.bias as f32;
            values[13] = 1. / shadows.size as f32;
            values[16..32].copy_from_slice(&shadow_view_proj(direction, target, shadows.distance as f32));
            shadow_size = Some(shadows.size);
        }
    }
    for (index, point) in lighting.points.iter().take(POINTS).enumerate() {
        let at = 32 + index * 4;
        values[at..at + 4].copy_from_slice(&[point.position.x as f32, point.position.y as f32, point.position.z as f32, point.range as f32]);
        let color = linear(&point.color);
        let intensity = point.intensity as f32;
        let at = 64 + index * 4;
        values[at..at + 3].copy_from_slice(&[color[0] * intensity, color[1] * intensity, color[2] * intensity]);
    }
    values[96] = lighting.points.len().min(POINTS) as f32;
    (values, shadow_size)
}

/// GPU state for lighting: group 2 of the mesh pipeline and the shadow pass.
pub struct LightingGpu {
    uniform: wgpu::Buffer,
    pub layout: wgpu::BindGroupLayout,
    pub group: wgpu::BindGroup,
    sampler: wgpu::Sampler,
    shadow_view: wgpu::TextureView,
    shadow_size: u32,
    shadow_camera: wgpu::Buffer,
    shadow_camera_group: wgpu::BindGroup,
    shadow_pipeline: wgpu::RenderPipeline,
    values: Option<[f32; LIGHT_FLOATS]>,
    /// Whether this frame renders the shadow pass.
    pub shadows: bool,
}

fn shadow_texture(device: &wgpu::Device, size: u32) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("native-shadow-map"),
            size: wgpu::Extent3d { width: size, height: size, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
        .create_view(&Default::default())
}

impl LightingGpu {
    pub fn new(device: &wgpu::Device, texture_layout: &wgpu::BindGroupLayout) -> Self {
        let uniform_entry = |binding, visibility| wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("native-lighting"),
            entries: &[
                uniform_entry(0, wgpu::ShaderStages::FRAGMENT),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                    count: None,
                },
            ],
        });
        let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native-lighting-uniform"),
            contents: bytemuck::cast_slice(&[0f32; LIGHT_FLOATS]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("native-shadow-compare"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            compare: Some(wgpu::CompareFunction::LessEqual),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        // A 1x1 map stands in until a sun casts shadows.
        let shadow_view = shadow_texture(device, 1);
        let group = Self::group(device, &layout, &uniform, &shadow_view, &sampler);
        let shadow_camera_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("native-shadow-camera"),
            entries: &[uniform_entry(0, wgpu::ShaderStages::VERTEX)],
        });
        let shadow_camera = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("native-shadow-camera"),
            size: 64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let shadow_camera_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("native-shadow-camera"),
            layout: &shadow_camera_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: shadow_camera.as_entire_binding() }],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("native-shadow"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shadow.wgsl").into()),
        });
        let shadow_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("native-shadow"),
            layout: Some(&device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("native-shadow"),
                bind_group_layouts: &[Some(&shadow_camera_layout), Some(texture_layout)],
                immediate_size: 0,
            })),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                buffers: &[
                    Some(wgpu::VertexBufferLayout {
                        array_stride: 32,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x2],
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: 40,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &wgpu::vertex_attr_array![2 => Float32x3, 3 => Float32x4, 4 => Float32x3],
                    }),
                ],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some("fs"), targets: &[], compilation_options: Default::default() }),
            primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        Self { uniform, layout, group, sampler, shadow_view, shadow_size: 1, shadow_camera, shadow_camera_group, shadow_pipeline, values: None, shadows: false }
    }

    fn group(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        uniform: &wgpu::Buffer,
        shadow: &wgpu::TextureView,
        sampler: &wgpu::Sampler,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("native-lighting"),
            layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(shadow) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
            ],
        })
    }

    /// Upload this frame's lighting; unchanged values cost nothing.
    pub fn update(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, lighting: Option<&Lighting>, target: [f32; 3]) {
        let (values, shadow_size) = light_values(lighting, target);
        self.shadows = shadow_size.is_some();
        if let Some(size) = shadow_size
            && size != self.shadow_size
        {
            self.shadow_view = shadow_texture(device, size);
            self.shadow_size = size;
            self.group = Self::group(device, &self.layout, &self.uniform, &self.shadow_view, &self.sampler);
        }
        if self.values != Some(values) {
            queue.write_buffer(&self.uniform, 0, bytemuck::cast_slice(&values));
            queue.write_buffer(&self.shadow_camera, 0, bytemuck::cast_slice(&values[16..32]));
            self.values = Some(values);
        }
    }

    /// Begin the depth-only shadow pass; the caller draws each batch with
    /// its texture group (alpha-tested cutouts cast no shadow) and buffers.
    pub fn begin_shadow_pass<'a>(&'a self, encoder: &'a mut wgpu::CommandEncoder) -> wgpu::RenderPass<'a> {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("native-shadow"),
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &self.shadow_view,
                depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.), store: wgpu::StoreOp::Store }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.shadow_pipeline);
        pass.set_bind_group(0, &self.shadow_camera_group, &[]);
        pass
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_mesh_and_shadow_shaders_validate() {
        for (name, source) in [("render.wgsl", include_str!("render.wgsl")), ("shadow.wgsl", include_str!("shadow.wgsl")), ("depth_resolve.wgsl", include_str!("depth_resolve.wgsl"))] {
            let module = naga::front::wgsl::parse_str(source).unwrap_or_else(|error| panic!("{name}: {}", error.emit_to_string(source)));
            naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::all())
                .validate(&module)
                .unwrap_or_else(|error| panic!("{name}: {error:?}"));
        }
    }

    #[test]
    fn vertex_normals_match_three_compute_vertex_normals() {
        // One upward quad (three.js winding) and a shared edge.
        let positions = [0., 0., 0., 0., 0., 1., 1., 0., 0., 1., 0., 1.];
        let normals = vertex_normals(&positions, &[0, 1, 2, 2, 1, 3]);
        for normal in normals.chunks_exact(3) {
            assert_eq!(normal, [0., 1., 0.]);
        }
        // Unused vertices keep a zero normal, as Three leaves them.
        assert_eq!(vertex_normals(&[0., 0., 0., 1., 0., 0., 0., 1., 0., 5., 5., 5.], &[0, 1, 2])[9..12], [0., 0., 0.]);
        let interleaved = mesh_vertices(&positions[..3], |_| [0.25, 0.75], &normals[..3]);
        assert_eq!(interleaved, [0., 0., 0., 0.25, 0.75, 0., 1., 0.]);
    }

    fn transform(matrix: &[f32; 16], p: [f32; 3]) -> [f32; 3] {
        let row = |r: usize| matrix[r] * p[0] + matrix[4 + r] * p[1] + matrix[8 + r] * p[2] + matrix[12 + r];
        [row(0), row(1), row(2)]
    }

    #[test]
    fn the_shadow_box_frames_the_camera_target() {
        let matrix = shadow_view_proj([0., -1., 0.], [1., 0., 2.], 10.);
        let center = transform(&matrix, [1., 0., 2.]);
        assert!(center[0].abs() < 1e-5 && center[1].abs() < 1e-5 && (center[2] - 0.5).abs() < 1e-5, "{center:?}");
        let edge = transform(&matrix, [11., 0., 2.]);
        assert!((edge[0].abs() - 1.).abs() < 1e-5, "x spans the box half-width: {edge:?}");
        let near = transform(&matrix, [1., 20., 2.]);
        assert!(near[2].abs() < 1e-5, "depth 0 two box widths towards the sun: {near:?}");
    }

    #[test]
    fn light_values_fill_the_uniform_like_the_web_contract() {
        let lighting: Lighting = serde_json::from_value(serde_json::json!({
            "ambient": {"color": "#ffffff", "intensity": 0.5},
            "sun": {"direction": {"x": 0, "y": -2, "z": 0}, "intensity": 2, "shadows": {"size": 1024, "bias": 0.002}},
            "points": [{"position": {"x": 1, "y": 2, "z": 3}, "color": "#ff0000", "range": 4}]
        }))
        .unwrap();
        let (values, size) = light_values(Some(&lighting), [0., 0., 0.]);
        assert_eq!(size, Some(1024));
        assert_eq!(&values[0..4], &[0.5, 0.5, 0.5, 1.], "ambient colour times intensity, lit flag");
        assert_eq!(&values[4..8], &[0., 1., 0., 1.], "towards the sun");
        assert_eq!(&values[8..14], &[2., 2., 2., 1., 0.002, 1. / 1024.]);
        assert_eq!(&values[32..36], &[1., 2., 3., 4.]);
        assert_eq!(&values[64..68], &[1., 0., 0., 0.]);
        assert_eq!(values[96], 1.);
        assert_eq!(light_values(None, [0.; 3]), ([0.; LIGHT_FLOATS], None), "unlit: the shader keeps the albedo");
    }
}
