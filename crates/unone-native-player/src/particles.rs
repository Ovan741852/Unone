use unone_engine::{Camera3DData, ParticleSnapshot, ParticleSpriteShape};
pub struct Particles {
    pipelines: [wgpu::RenderPipeline; 2],
    buffers: [wgpu::Buffer; 3],
    slot: usize,
    capacity: usize,
    counts: [u32; 2],
    pub uploaded: usize,
}
impl Particles {
    pub fn draw_calls(&self) -> u64 {
        self.counts.iter().filter(|n| **n > 0).count() as u64
    }
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        camera: &wgpu::BindGroupLayout,
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
                        bind_group_layouts: &[Some(camera)],
                        immediate_size: 0,
                    }),
                ),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs"),
                    buffers: &[Some(wgpu::VertexBufferLayout {
                        array_stride: 40,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &wgpu::vertex_attr_array![0=>Float32x4,1=>Float32x4,2=>Float32x2],
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
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        });
        Self {
            pipelines,
            buffers: std::array::from_fn(|_| {
                device.create_buffer(&wgpu::BufferDescriptor {
                    label: None,
                    size: 40,
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                })
            }),
            slot: 0,
            capacity: 40,
            counts: [0; 2],
            uploaded: 0,
        }
    }
    pub fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        samples: &[ParticleSnapshot],
        camera: &Camera3DData,
    ) {
        let mut normal: Vec<_> = samples.iter().filter(|p| !p.additive).collect();
        let forward = [
            camera.target.x - camera.position.x,
            camera.target.y - camera.position.y,
            camera.target.z - camera.position.z,
        ];
        let depth = |p: &&ParticleSnapshot| {
            p.position.x * forward[0] + p.position.y * forward[1] + p.position.z * forward[2]
        };
        normal.sort_by(|a, b| depth(b).total_cmp(&depth(a)));
        self.counts = [normal.len() as u32, (samples.len() - normal.len()) as u32];
        let mut data = Vec::with_capacity(samples.len() * 10);
        for p in normal
            .into_iter()
            .chain(samples.iter().filter(|p| p.additive))
        {
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
            ]);
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
        let mut start = 0;
        for i in 0..2 {
            if self.counts[i] > 0 {
                pass.set_pipeline(&self.pipelines[i]);
                pass.set_vertex_buffer(0, self.buffers[self.slot].slice(..));
                pass.draw(0..6, start..start + self.counts[i]);
            }
            start += self.counts[i];
        }
    }
}

#[cfg(test)]
mod tests {
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
