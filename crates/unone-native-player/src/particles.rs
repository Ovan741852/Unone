use std::collections::BTreeMap;
use std::sync::Arc;
use unone_engine::{Camera3DData, ParticleSnapshot, ParticleSpriteShape};

/// 64-byte instance: position+size, colour, rotation/shape/aspect/textured, flipbook cell.
const STRIDE: usize = 16;

/// A run of instances drawn with one pipeline and one texture.
#[derive(Debug, Clone, PartialEq)]
pub struct Batch {
    pub texture: Option<String>,
    pub additive: bool,
    pub start: u32,
    pub count: u32,
}

/// Order instances and cut them into draws. Alpha particles keep their back-to-front order, so only adjacent ones
/// with the same image share a draw; additive ones are order-free and group by image. An image that is not resident
/// yet draws its emitter's `sprite_shape` instead.
pub fn plan<'a>(
    samples: &'a [ParticleSnapshot],
    forward: [f64; 3],
    resident: impl Fn(&str) -> bool,
) -> (Vec<(&'a ParticleSnapshot, bool)>, Vec<Batch>) {
    let depth = |p: &ParticleSnapshot| p.position.x * forward[0] + p.position.y * forward[1] + p.position.z * forward[2];
    let image = |p: &ParticleSnapshot| -> Option<String> { p.texture.clone().filter(|id| resident(id)) };
    let mut normal: Vec<_> = samples.iter().filter(|p| !p.additive).collect();
    normal.sort_by(|a, b| depth(b).total_cmp(&depth(a)));
    let mut additive: Vec<_> = samples.iter().filter(|p| p.additive).collect();
    additive.sort_by_key(|p| image(p));
    let mut ordered = Vec::with_capacity(samples.len());
    let mut batches: Vec<Batch> = Vec::new();
    for (list, blend) in [(normal, false), (additive, true)] {
        for p in list {
            let texture = image(p);
            let start = ordered.len() as u32;
            match batches.last_mut() {
                Some(b) if b.additive == blend && b.texture == texture => b.count += 1,
                _ => batches.push(Batch { texture: texture.clone(), additive: blend, start, count: 1 }),
            }
            ordered.push((p, texture.is_some()));
        }
    }
    (ordered, batches)
}

pub struct Particles {
    pipelines: [wgpu::RenderPipeline; 2],
    buffers: [wgpu::Buffer; 3],
    slot: usize,
    capacity: usize,
    batches: Vec<Batch>,
    white: Arc<wgpu::BindGroup>,
    images: BTreeMap<String, Arc<wgpu::BindGroup>>,
    pub uploaded: usize,
}
impl Particles {
    pub fn draw_calls(&self) -> u64 {
        self.batches.iter().filter(|b| b.count > 0).count() as u64
    }
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        camera: &wgpu::BindGroupLayout,
        texture_layout: &wgpu::BindGroupLayout,
        white: Arc<wgpu::BindGroup>,
        samples: u32,
    ) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("native-particles"),
            source: wgpu::ShaderSource::Wgsl(include_str!("particles.wgsl").into()),
        });
        let pipelines = std::array::from_fn(|i| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("native-particle-batch"),
                layout: Some(
                    &device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                        label: None,
                        bind_group_layouts: &[Some(camera), Some(texture_layout)],
                        immediate_size: 0,
                    }),
                ),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs"),
                    buffers: &[Some(wgpu::VertexBufferLayout {
                        array_stride: (STRIDE * 4) as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &wgpu::vertex_attr_array![0=>Float32x4,1=>Float32x4,2=>Float32x4,3=>Float32x4],
                    })],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some("fs"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(if i == 0 {
                            wgpu::BlendState::ALPHA_BLENDING
                        } else {
                            wgpu::BlendState {
                                color: wgpu::BlendComponent {
                                    src_factor: wgpu::BlendFactor::SrcAlpha,
                                    dst_factor: wgpu::BlendFactor::One,
                                    operation: wgpu::BlendOperation::Add,
                                },
                                alpha: wgpu::BlendComponent::OVER,
                            }
                        }),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: Default::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth32Float,
                    depth_write_enabled: Some(false),
                    depth_compare: Some(wgpu::CompareFunction::LessEqual),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: wgpu::MultisampleState { count: samples, ..Default::default() },
                multiview_mask: None,
                cache: None,
            })
        });
        Self {
            pipelines,
            buffers: std::array::from_fn(|_| {
                device.create_buffer(&wgpu::BufferDescriptor {
                    label: None,
                    size: (STRIDE * 4) as u64,
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                })
            }),
            slot: 0,
            capacity: STRIDE * 4,
            batches: Vec::new(),
            white,
            images: BTreeMap::new(),
            uploaded: 0,
        }
    }
    pub fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        samples: &[ParticleSnapshot],
        camera: &Camera3DData,
        textures: &BTreeMap<String, Arc<wgpu::BindGroup>>,
        dims: &BTreeMap<String, (u32, u32)>,
    ) {
        let forward = [
            camera.target.x - camera.position.x,
            camera.target.y - camera.position.y,
            camera.target.z - camera.position.z,
        ];
        let (ordered, batches) = plan(samples, forward, |id| textures.contains_key(id));
        self.images = batches
            .iter()
            .filter_map(|b| b.texture.as_ref())
            .filter_map(|id| textures.get(id).map(|t| (id.clone(), t.clone())))
            .collect();
        self.batches = batches;
        let mut data = Vec::with_capacity(samples.len() * STRIDE);
        for (p, textured) in ordered {
            let cell = p.uv.unwrap_or([0.0, 0.0, 1.0, 1.0]);
            let aspect = if textured {
                let (w, h) = p.texture.as_ref().and_then(|id| dims.get(id)).copied().unwrap_or((1, 1));
                (f64::from(w) * cell[2]) / (f64::from(h.max(1)) * cell[3]).max(f64::EPSILON)
            } else {
                1.0
            };
            data.extend([
                p.position.x as f32,
                p.position.y as f32,
                p.position.z as f32,
                p.size as f32,
            ]);
            data.extend(p.color.map(|v| v as f32));
            data.extend([
                p.rotation as f32,
                match p.sprite_shape {
                    ParticleSpriteShape::SoftCircle => 0.0,
                    ParticleSpriteShape::Diamond => 1.0,
                    ParticleSpriteShape::Ring => 2.0,
                    ParticleSpriteShape::Streak => 3.0,
                },
                aspect as f32,
                if textured { 1.0 } else { 0.0 },
            ]);
            data.extend(cell.map(|v| v as f32));
        }
        self.uploaded = data.len() * 4;
        if self.uploaded > self.capacity {
            self.capacity = self.uploaded.next_power_of_two();
            self.buffers = std::array::from_fn(|_| {
                device.create_buffer(&wgpu::BufferDescriptor {
                    label: None,
                    size: self.capacity as u64,
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                })
            });
        }
        self.slot = (self.slot + 1) % 3;
        if !data.is_empty() {
            queue.write_buffer(&self.buffers[self.slot], 0, bytemuck::cast_slice(&data));
        }
    }
    pub fn draw(&self, pass: &mut wgpu::RenderPass<'_>) {
        if self.batches.is_empty() {
            return;
        }
        pass.set_vertex_buffer(0, self.buffers[self.slot].slice(..));
        for b in self.batches.iter().filter(|b| b.count > 0) {
            pass.set_pipeline(&self.pipelines[usize::from(b.additive)]);
            let texture = b.texture.as_ref().and_then(|id| self.images.get(id)).unwrap_or(&self.white);
            pass.set_bind_group(1, &**texture, &[]);
            pass.draw(0..6, b.start..b.start + b.count);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use unone_engine::Vec3;
    fn particle(z: f64, texture: Option<&str>, additive: bool) -> ParticleSnapshot {
        ParticleSnapshot {
            id: format!("p{z}"),
            instance: "i".into(),
            emitter: "e".into(),
            position: Vec3 { x: 0.0, y: 0.0, z },
            size: 1.0,
            color: [1.0; 4],
            rotation: 0.0,
            sprite_shape: ParticleSpriteShape::Diamond,
            texture: texture.map(str::to_owned),
            uv: None,
            additive,
        }
    }
    #[test]
    fn alpha_draws_keep_depth_order_and_join_only_adjacent_images() {
        let samples = vec![
            particle(1.0, Some("heart"), false),
            particle(3.0, Some("heart"), false),
            particle(2.0, None, false),
            particle(4.0, Some("heart"), true),
            particle(5.0, None, true),
            particle(6.0, Some("heart"), true),
            particle(7.0, Some("missing"), false),
        ];
        let (ordered, batches) = plan(&samples, [0.0, 0.0, 1.0], |id| id == "heart");
        let zs: Vec<f64> = ordered.iter().map(|(p, _)| p.position.z).collect();
        assert_eq!(&zs[..4], &[7.0, 3.0, 2.0, 1.0], "alpha particles draw back to front");
        let shape = |start, count| Batch { texture: None, additive: false, start, count };
        assert_eq!(batches[0], shape(0, 1), "an image that is not resident draws its silhouette");
        assert_eq!(batches[1], Batch { texture: Some("heart".into()), additive: false, start: 1, count: 1 });
        assert_eq!(batches[2], shape(2, 1));
        assert_eq!(batches[3], Batch { texture: Some("heart".into()), additive: false, start: 3, count: 1 });
        assert_eq!(batches[4], Batch { texture: None, additive: true, start: 4, count: 1 });
        assert_eq!(batches[5], Batch { texture: Some("heart".into()), additive: true, start: 5, count: 2 }, "additive images group");
        assert!(ordered.iter().filter(|(_, textured)| *textured).count() == 4);
    }
    #[test]
    fn particle_shader_parses_and_validates() {
        let source = include_str!("particles.wgsl");
        let module = naga::front::wgsl::parse_str(source)
            .unwrap_or_else(|error| panic!("{}", error.emit_to_string(source)));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::all(),
        )
        .validate(&module)
        .expect("particle WGSL should validate before pipeline creation");
    }
}
