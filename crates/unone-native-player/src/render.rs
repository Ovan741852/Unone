use crate::Package;
use std::{collections::BTreeMap, sync::Arc};
use unone_engine::WorldSnapshot;
use wgpu::util::DeviceExt;
use winit::window::Window;
type R<T> = Result<T, String>;
struct Mesh {
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    count: u32,
    radius: f32,
    texture: Arc<wgpu::BindGroup>,
}

struct Batch {
    buffers: [wgpu::Buffer; 3],
    slot: usize,
    last_zero: Vec<u8>,
    capacity: usize,
    count: u32,
    asset: String,
    revision: u64,
    lod: usize,
}
struct LodCache {
    revision: u64,
    asset: String,
    view: Option<crate::lod::View>,
    parts: Vec<Vec<u8>>,
    generation: u64,
}

/// Native equivalent of the Web renderer's quarter-resolution Bloom pass.
///
/// The effect is deliberately kept in the renderer: it consumes the rendered
/// scene only and has no knowledge of gameplay entities or Luau rules.
struct Bloom {
    scene: wgpu::Texture,
    scene_view: wgpu::TextureView,
    bright_a: wgpu::Texture,
    bright_a_view: wgpu::TextureView,
    bright_b: wgpu::Texture,
    bright_b_view: wgpu::TextureView,
    sampler: wgpu::Sampler,
    params_extract: wgpu::Buffer,
    params_blur_h: wgpu::Buffer,
    params_blur_v: wgpu::Buffer,
    params_composite: wgpu::Buffer,
    layout: wgpu::BindGroupLayout,
    extract_group: wgpu::BindGroup,
    blur_h_group: wgpu::BindGroup,
    blur_v_group: wgpu::BindGroup,
    composite_group: wgpu::BindGroup,
    extract_pipeline: wgpu::RenderPipeline,
    blur_pipeline: wgpu::RenderPipeline,
    composite_pipeline: wgpu::RenderPipeline,
    surface_format: wgpu::TextureFormat,
    width: u32,
    height: u32,
}

impl Bloom {
    const BLOOM_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

    fn texture(
        device: &wgpu::Device,
        label: &'static str,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        usage: wgpu::TextureUsages,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        (texture, view)
    }

    fn uniform(device: &wgpu::Device, label: &'static str, values: [f32; 4]) -> wgpu::Buffer {
        device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(label),
            contents: bytemuck::cast_slice(&values),
            usage: wgpu::BufferUsages::UNIFORM,
        })
    }

    fn pipeline(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        shader: &wgpu::ShaderModule,
        entry: &'static str,
        format: wgpu::TextureFormat,
        label: &'static str,
    ) -> wgpu::RenderPipeline {
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(label),
            bind_group_layouts: &[Some(layout)],
            immediate_size: 0,
        });
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(label),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: shader,
                entry_point: Some("vs"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: shader,
                entry_point: Some(entry),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        })
    }

    fn bind_group(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        image: &wgpu::TextureView,
        bloom: &wgpu::TextureView,
        sampler: &wgpu::Sampler,
        params: &wgpu::Buffer,
        label: &'static str,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(label),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(image),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(bloom),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: params.as_entire_binding(),
                },
            ],
        })
    }

    fn new(device: &wgpu::Device, surface_format: wgpu::TextureFormat, width: u32, height: u32) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("native-bloom"),
            source: wgpu::ShaderSource::Wgsl(include_str!("bloom.wgsl").into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("native-bloom-bindings"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("native-bloom-linear"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        let params_extract = Self::uniform(device, "native-bloom-extract-params", [0.55, 0.95, 0., 0.]);
        let params_blur_h = Self::uniform(device, "native-bloom-blur-h-params", [1., 0., 0., 0.]);
        let params_blur_v = Self::uniform(device, "native-bloom-blur-v-params", [0., 1., 0., 0.]);
        let params_composite = Self::uniform(device, "native-bloom-composite-params", [0.75, 0., 0., 0.]);
        let extract_pipeline = Self::pipeline(
            device,
            &layout,
            &shader,
            "extract",
            Self::BLOOM_FORMAT,
            "native-bloom-extract-pipeline",
        );
        let blur_pipeline = Self::pipeline(
            device,
            &layout,
            &shader,
            "blur",
            Self::BLOOM_FORMAT,
            "native-bloom-blur-pipeline",
        );
        let composite_pipeline = Self::pipeline(
            device,
            &layout,
            &shader,
            "composite",
            surface_format,
            "native-bloom-composite-pipeline",
        );
        let width = width.max(1);
        let height = height.max(1);
        let bright_width = width.div_ceil(4).max(1);
        let bright_height = height.div_ceil(4).max(1);
        let (scene, scene_view) = Self::texture(
            device,
            "native-bloom-scene",
            width,
            height,
            surface_format,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let (bright_a, bright_a_view) = Self::texture(
            device,
            "native-bloom-bright-a",
            bright_width,
            bright_height,
            Self::BLOOM_FORMAT,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let (bright_b, bright_b_view) = Self::texture(
            device,
            "native-bloom-bright-b",
            bright_width,
            bright_height,
            Self::BLOOM_FORMAT,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let extract_group = Self::bind_group(
            device,
            &layout,
            &scene_view,
            &scene_view,
            &sampler,
            &params_extract,
            "native-bloom-extract-bindings",
        );
        let blur_h_group = Self::bind_group(
            device,
            &layout,
            &bright_a_view,
            &bright_a_view,
            &sampler,
            &params_blur_h,
            "native-bloom-blur-h-bindings",
        );
        let blur_v_group = Self::bind_group(
            device,
            &layout,
            &bright_b_view,
            &bright_b_view,
            &sampler,
            &params_blur_v,
            "native-bloom-blur-v-bindings",
        );
        let composite_group = Self::bind_group(
            device,
            &layout,
            &scene_view,
            &bright_a_view,
            &sampler,
            &params_composite,
            "native-bloom-composite-bindings",
        );
        Self {
            scene,
            scene_view,
            bright_a,
            bright_a_view,
            bright_b,
            bright_b_view,
            sampler,
            params_extract,
            params_blur_h,
            params_blur_v,
            params_composite,
            layout,
            extract_group,
            blur_h_group,
            blur_v_group,
            composite_group,
            extract_pipeline,
            blur_pipeline,
            composite_pipeline,
            surface_format,
            width,
            height,
        }
    }

    fn resize(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        let width = width.max(1);
        let height = height.max(1);
        let bright_width = width.div_ceil(4).max(1);
        let bright_height = height.div_ceil(4).max(1);
        let (scene, scene_view) = Self::texture(
            device,
            "native-bloom-scene",
            width,
            height,
            self.surface_format,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let (bright_a, bright_a_view) = Self::texture(
            device,
            "native-bloom-bright-a",
            bright_width,
            bright_height,
            Self::BLOOM_FORMAT,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let (bright_b, bright_b_view) = Self::texture(
            device,
            "native-bloom-bright-b",
            bright_width,
            bright_height,
            Self::BLOOM_FORMAT,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        self.extract_group = Self::bind_group(
            device,
            &self.layout,
            &scene_view,
            &scene_view,
            &self.sampler,
            &self.params_extract,
            "native-bloom-extract-bindings",
        );
        self.blur_h_group = Self::bind_group(
            device,
            &self.layout,
            &bright_a_view,
            &bright_a_view,
            &self.sampler,
            &self.params_blur_h,
            "native-bloom-blur-h-bindings",
        );
        self.blur_v_group = Self::bind_group(
            device,
            &self.layout,
            &bright_b_view,
            &bright_b_view,
            &self.sampler,
            &self.params_blur_v,
            "native-bloom-blur-v-bindings",
        );
        self.composite_group = Self::bind_group(
            device,
            &self.layout,
            &scene_view,
            &bright_a_view,
            &self.sampler,
            &self.params_composite,
            "native-bloom-composite-bindings",
        );
        self.scene = scene;
        self.scene_view = scene_view;
        self.bright_a = bright_a;
        self.bright_a_view = bright_a_view;
        self.bright_b = bright_b;
        self.bright_b_view = bright_b_view;
        self.width = width;
        self.height = height;
    }

    fn encode(&self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("native-bloom-extract"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &self.bright_a_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.extract_pipeline);
        pass.set_bind_group(0, &self.extract_group, &[]);
        pass.draw(0..3, 0..1);
        drop(pass);

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("native-bloom-blur-horizontal"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &self.bright_b_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.blur_pipeline);
        pass.set_bind_group(0, &self.blur_h_group, &[]);
        pass.draw(0..3, 0..1);
        drop(pass);

        // A second blur direction reads the horizontal result and writes back
        // to bright_a, which is the source used by the final composite.
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("native-bloom-blur-vertical"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &self.bright_a_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.blur_pipeline);
        pass.set_bind_group(0, &self.blur_v_group, &[]);
        pass.draw(0..3, 0..1);
        drop(pass);

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("native-bloom-composite"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.composite_pipeline);
        pass.set_bind_group(0, &self.composite_group, &[]);
        pass.draw(0..3, 0..1);
    }
}
pub struct Renderer {
    ui:crate::ui::Surface,
    particles: crate::particles::Particles,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    sprite_pipeline: wgpu::RenderPipeline,
    camera: wgpu::Buffer,
    camera_group: wgpu::BindGroup,
    sprite_camera: wgpu::Buffer,
    sprite_camera_group: wgpu::BindGroup,
    sprite_vertices: wgpu::Buffer,
    sprite_indices: wgpu::Buffer,
    depth: wgpu::TextureView,
    bloom: Option<Bloom>,
    meshes: BTreeMap<String, Mesh>,
    textures: BTreeMap<String, Arc<wgpu::BindGroup>>,
    batches: BTreeMap<String, Batch>,
    sprites: crate::sprites::Frame,
    sprite_buffer: Option<wgpu::Buffer>,
    sprite_capacity: usize,
    last_sprite_data: Vec<[f32; 6]>,
    last_sprite_camera: Option<[f32; 4]>,
    is_2d: bool,
    pub lod_enabled: bool,
    pub presentation_batches: serde_json::Value,
    lods: BTreeMap<String, Vec<(f32, String)>>,
    lod_cache: BTreeMap<String, LodCache>,
    pub triangles: u64,
    pub lod_counts: [u64; 4],
    pub lod_ms: f64,
    pub classify_ms: f64,
    pub upload_ms: f64,
    acquire_ms: f64,
    submit_ms: f64,
    present_ms: f64,
    prepare_ms: f64,
    sprite_prepare_ms: f64,
    sprite_upload_ms: f64,
    last_view: Option<crate::lod::View>,
    last_particle: Option<(u64, crate::lod::View)>,
    pub adapter: String,
    pub submitted: u64,
    pub draws: u64,
    pub uploaded: u64,
}

#[cfg(test)]
mod tests {
    use super::decode_texture;

    #[test]
    fn bloom_shader_parses_and_validates() {
        let source = include_str!("bloom.wgsl");
        let module = naga::front::wgsl::parse_str(source)
            .unwrap_or_else(|error| panic!("{}", error.emit_to_string(source)));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::all(),
        )
        .validate(&module)
        .expect("bloom WGSL should validate before pipeline creation");
    }

    #[test]
    fn sprite_shader_parses_and_validates() {
        let source = include_str!("sprite.wgsl");
        let module = naga::front::wgsl::parse_str(source)
            .unwrap_or_else(|error| panic!("{}", error.emit_to_string(source)));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::all(),
        )
        .validate(&module)
            .expect("sprite WGSL should validate before pipeline creation");
    }

    #[test]
    fn native_texture_decoder_accepts_static_svg() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"><rect width="2" height="1" fill="#ff0000"/></svg>"##;
        let (width, height, pixels) = decode_texture(svg).expect("static SVG should decode");
        assert_eq!((width, height), (2, 1));
        assert_eq!(pixels.len(), 8);
        assert_eq!(&pixels[..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn native_texture_decoder_rejects_external_svg_resources() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/x.png"/></svg>"#;
        let error = decode_texture(svg).expect_err("external SVG must not be loaded");
        assert!(error.contains("NATIVE_TEXTURE_SVG_UNSUPPORTED"));
    }
}
fn depth(device: &wgpu::Device, c: &wgpu::SurfaceConfiguration) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("depth"),
            size: wgpu::Extent3d {
                width: c.width,
                height: c.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
        .create_view(&Default::default())
}

fn load_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    bytes: &[u8],
) -> R<Arc<wgpu::BindGroup>> {
    let (width, height, rgba) = decode_texture(bytes)?;
    let size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("native-texture"), size, mip_level_count: 1, sample_count: 1,
        dimension: wgpu::TextureDimension::D2, format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST, view_formats: &[],
    });
    queue.write_texture(tex.as_image_copy(), &rgba, wgpu::TexelCopyBufferLayout {
        offset: 0, bytes_per_row: Some(width * 4), rows_per_image: Some(height),
    }, size);
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        mag_filter: wgpu::FilterMode::Nearest, min_filter: wgpu::FilterMode::Nearest, ..Default::default()
    });
    let view = tex.create_view(&Default::default());
    Ok(Arc::new(device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("native-texture-bind-group"), layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&sampler) },
        ],
    })))
}

/// Built-in meshes are part of the host contract, not project assets.  Keep
/// them available even when `content/assets.json` is intentionally empty (for
/// example the jobs sample uses `mesh://primitive/box`).
fn solid_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    rgba: [u8; 4],
) -> Arc<wgpu::BindGroup> {
    let size = wgpu::Extent3d {
        width: 1,
        height: 1,
        depth_or_array_layers: 1,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("native-solid-texture"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        texture.as_image_copy(),
        &rgba,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(4),
            rows_per_image: Some(1),
        },
        size,
    );
    let view = texture.create_view(&Default::default());
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        mag_filter: wgpu::FilterMode::Nearest,
        min_filter: wgpu::FilterMode::Nearest,
        ..Default::default()
    });
    Arc::new(device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("native-solid-texture-bind-group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(&sampler),
            },
        ],
    }))
}

fn builtin_box(
    device: &wgpu::Device,
    texture: Arc<wgpu::BindGroup>,
) -> Mesh {
    // 24 vertices keep a separate UV seam for every cube face.
    let faces: [[[f32; 3]; 4]; 6] = [
        [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]],
        [[0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]],
        [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5]],
        [[0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]],
        [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
        [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]],
    ];
    let uv = [[0., 1.], [1., 1.], [1., 0.], [0., 0.]];
    let mut vertices = Vec::with_capacity(24 * 5);
    let mut indices = Vec::with_capacity(36);
    for (face, corners) in faces.into_iter().enumerate() {
        let base = (face * 4) as u32;
        for (corner, position) in corners.into_iter().enumerate() {
            vertices.extend_from_slice(&position);
            vertices.extend_from_slice(&uv[corner]);
        }
        indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    Mesh {
        vertices: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native-primitive-box-vertices"),
            contents: bytemuck::cast_slice(&vertices),
            usage: wgpu::BufferUsages::VERTEX,
        }),
        indices: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native-primitive-box-indices"),
            contents: bytemuck::cast_slice(&indices),
            usage: wgpu::BufferUsages::INDEX,
        }),
        count: indices.len() as u32,
        radius: 3f32.sqrt() * 0.5,
        texture,
    }
}

fn builtin_sphere(
    device: &wgpu::Device,
    texture: Arc<wgpu::BindGroup>,
) -> Mesh {
    const RINGS: u32 = 12;
    const SEGMENTS: u32 = 24;
    let mut vertices = Vec::with_capacity(((RINGS + 1) * (SEGMENTS + 1) * 5) as usize);
    for ring in 0..=RINGS {
        let v = ring as f32 / RINGS as f32;
        let phi = v * std::f32::consts::PI;
        for segment in 0..=SEGMENTS {
            let u = segment as f32 / SEGMENTS as f32;
            let theta = u * std::f32::consts::TAU;
            let sin_phi = phi.sin();
            vertices.extend_from_slice(&[
                sin_phi * theta.cos() * 0.5,
                phi.cos() * 0.5,
                sin_phi * theta.sin() * 0.5,
                u,
                1. - v,
            ]);
        }
    }
    let mut indices = Vec::with_capacity((RINGS * SEGMENTS * 6) as usize);
    for ring in 0..RINGS {
        for segment in 0..SEGMENTS {
            let row = SEGMENTS + 1;
            let a = ring * row + segment;
            let b = a + row;
            indices.extend_from_slice(&[a, b, a + 1, a + 1, b, b + 1]);
        }
    }
    Mesh {
        vertices: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native-primitive-sphere-vertices"),
            contents: bytemuck::cast_slice(&vertices),
            usage: wgpu::BufferUsages::VERTEX,
        }),
        indices: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native-primitive-sphere-indices"),
            contents: bytemuck::cast_slice(&indices),
            usage: wgpu::BufferUsages::INDEX,
        }),
        count: indices.len() as u32,
        radius: 0.5,
        texture,
    }
}

/// Decode a verified texture into the single RGBA8 route used by every native
/// world renderer.  Keeping PNG and static SVG here prevents sprites and mesh
/// materials from silently having different format support.
fn decode_texture(bytes: &[u8]) -> R<(u32, u32, Vec<u8>)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info().map_err(|e| format!("NATIVE_TEXTURE_DECODE_FAILED: {e}"))?;
        let mut pixels = vec![0; reader.output_buffer_size().ok_or("TEXTURE_TOO_LARGE")?];
        let info = reader.next_frame(&mut pixels).map_err(|e| format!("NATIVE_TEXTURE_DECODE_FAILED: {e}"))?;
        pixels.truncate(info.buffer_size());
        let rgba = match info.color_type {
            png::ColorType::Rgba => pixels,
            png::ColorType::Rgb => pixels
                .chunks_exact(3)
                .flat_map(|v| [v[0], v[1], v[2], 255])
                .collect(),
            _ => return Err("NATIVE_TEXTURE_FORMAT_UNSUPPORTED: use RGB/RGBA PNG or static SVG".into()),
        };
        return Ok((info.width, info.height, rgba));
    }

    // Keep the native route aligned with the Web texture contract for common
    // raster assets as well. `image` is only reached after the fast PNG path,
    // so the verified SVG policy below remains explicit and bounded.
    let source = match std::str::from_utf8(bytes) {
        Ok(source) if source.trim_start().starts_with('<') => source,
        _ => {
            let decoded = image::load_from_memory(bytes)
                .map_err(|_| "NATIVE_TEXTURE_FORMAT_UNSUPPORTED: use PNG, JPEG, WebP, or static SVG")?
                .to_rgba8();
            let (width, height) = decoded.dimensions();
            return Ok((width, height, decoded.into_raw()));
        }
    };
    let document = roxmltree::Document::parse(source)
        .map_err(|e| format!("NATIVE_TEXTURE_SVG_INVALID: {e}"))?;
    if document.root_element().tag_name().name() != "svg" {
        return Err("NATIVE_TEXTURE_SVG_INVALID: expected svg root".into());
    }
    if document.descendants().count() > 10_000 {
        return Err("NATIVE_TEXTURE_SVG_TOO_LARGE: maximum 10000 XML nodes".into());
    }
    for node in document.descendants().filter(|node| node.is_element()) {
        if matches!(node.tag_name().name(), "script" | "foreignObject" | "animate" | "animateMotion" | "animateTransform" | "set" | "image" | "style") {
            return Err(format!("NATIVE_TEXTURE_SVG_UNSUPPORTED: <{}>", node.tag_name().name()));
        }
        for attribute in node.attributes() {
            if attribute.name().starts_with("on") {
                return Err("NATIVE_TEXTURE_SVG_UNSUPPORTED: event attributes are not allowed".into());
            }
            if attribute.name() == "href" && !attribute.value().starts_with('#') {
                return Err("NATIVE_TEXTURE_SVG_EXTERNAL_RESOURCE: href must reference an internal id".into());
            }
            let value = attribute.value();
            if value.contains('\\') || value.to_ascii_lowercase().contains("@import") {
                return Err("NATIVE_TEXTURE_SVG_EXTERNAL_RESOURCE: CSS escapes/imports are not allowed".into());
            }
            let mut rest = value;
            while let Some(index) = rest.to_ascii_lowercase().find("url(") {
                rest = &rest[index + 4..];
                let end = rest
                    .find(')')
                    .ok_or("NATIVE_TEXTURE_SVG_INVALID: unterminated url()")?;
                let url = rest[..end].trim().trim_matches(['\'', '"']);
                if !url.starts_with('#') {
                    return Err("NATIVE_TEXTURE_SVG_EXTERNAL_RESOURCE: url() must reference an internal id".into());
                }
                rest = &rest[end + 1..];
            }
        }
    }
    let options = resvg::usvg::Options::default();
    let tree = resvg::usvg::Tree::from_data(bytes, &options)
        .map_err(|e| format!("NATIVE_TEXTURE_SVG_INVALID: {e}"))?;
    let size = tree.size().to_int_size();
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size.width(), size.height())
        .ok_or("NATIVE_TEXTURE_SVG_TOO_LARGE")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());
    Ok((size.width(), size.height(), pixmap.take()))
}
impl Renderer {
    pub fn bloom_enabled(&self) -> bool {
        self.bloom.is_some()
    }

    pub fn cpu_phases(&self) -> [(&'static str, f64); 9] {
        [
            ("ui_raster",self.ui.raster_ms),
            ("prepare", self.prepare_ms),
            ("classify", self.classify_ms),
            ("instance_upload", self.upload_ms),
            ("sprite_prepare", self.sprite_prepare_ms),
            ("sprite_upload", self.sprite_upload_ms),
            ("acquire", self.acquire_ms),
            ("encode_submit", self.submit_ms),
            ("present", self.present_ms),
        ]
    }
    pub fn resolution(&self) -> [u32; 2] {
        [self.config.width, self.config.height]
    }
    pub async fn new(window: Arc<Window>, package: &Package) -> R<Self> {
        let instance = wgpu::Instance::default();
        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| e.to_string())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
                apply_limit_buckets: false,
            })
            .await
            .map_err(|e| e.to_string())?;
        let name = format!("{:?}", adapter.get_info());
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Unone native player"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_defaults()
                    .using_resolution(adapter.limits()),
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .map_err(|e| e.to_string())?;
        let size = window.inner_size();
        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(wgpu::TextureFormat::is_srgb)
            .unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: wgpu::SurfaceColorSpace::Auto,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);
        let camera_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let camera = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let camera_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &camera_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera.as_entire_binding(),
            }],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: None,
            source: wgpu::ShaderSource::Wgsl(include_str!("render.wgsl").into()),
        });
        let pipeline=device.create_render_pipeline(&wgpu::RenderPipelineDescriptor{label:None,layout:Some(&device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor{label:None,bind_group_layouts:&[Some(&camera_layout),Some(&texture_layout)],immediate_size:0})),vertex:wgpu::VertexState{module:&shader,entry_point:Some("vs"),buffers:&[Some(wgpu::VertexBufferLayout{array_stride:20,step_mode:wgpu::VertexStepMode::Vertex,attributes:&wgpu::vertex_attr_array![0=>Float32x3,1=>Float32x2]}),Some(wgpu::VertexBufferLayout{array_stride:40,step_mode:wgpu::VertexStepMode::Instance,attributes:&wgpu::vertex_attr_array![2=>Float32x3,3=>Float32x4,4=>Float32x3]})],compilation_options:Default::default()},fragment:Some(wgpu::FragmentState{module:&shader,entry_point:Some("fs"),targets:&[Some(wgpu::ColorTargetState{format,blend:None,write_mask:wgpu::ColorWrites::ALL})],compilation_options:Default::default()}),primitive:wgpu::PrimitiveState{cull_mode:None,..Default::default()},depth_stencil:Some(wgpu::DepthStencilState{format:wgpu::TextureFormat::Depth32Float,depth_write_enabled:Some(true),depth_compare:Some(wgpu::CompareFunction::Less),stencil:Default::default(),bias:Default::default()}),multisample:Default::default(),multiview_mask:None,cache:None});
        let sprite_camera = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("native-sprite-camera"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let sprite_camera_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("native-sprite-camera-group"),
            layout: &camera_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: sprite_camera.as_entire_binding(),
            }],
        });
        let sprite_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("native-sprite"),
            source: wgpu::ShaderSource::Wgsl(include_str!("sprite.wgsl").into()),
        });
        let sprite_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("native-sprite-pipeline"),
            layout: Some(&device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("native-sprite-layout"),
                bind_group_layouts: &[Some(&camera_layout), Some(&texture_layout)],
                immediate_size: 0,
            })),
            vertex: wgpu::VertexState {
                module: &sprite_shader,
                entry_point: Some("vs"),
                buffers: &[
                    Some(wgpu::VertexBufferLayout {
                        array_stride: 16,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &wgpu::vertex_attr_array![0=>Float32x2,1=>Float32x2],
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: 24,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &wgpu::vertex_attr_array![2=>Float32x2,3=>Float32x2,4=>Float32,5=>Float32],
                    }),
                ],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &sprite_shader,
                entry_point: Some("fs"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let sprite_vertices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native-sprite-quad"),
            contents: bytemuck::cast_slice(&[
                -0.5f32, -0.5, 0., 1.,
                 0.5, -0.5, 1., 1.,
                 0.5,  0.5, 1., 0.,
                -0.5,  0.5, 0., 0.,
            ]),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let sprite_indices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native-sprite-indices"),
            contents: bytemuck::cast_slice(&[0u32, 1, 2, 0, 2, 3]),
            usage: wgpu::BufferUsages::INDEX,
        });
        let assets: serde_json::Value = serde_json::from_slice(package.get("content/assets.json")?)
            .map_err(|e| e.to_string())?;
        let assets = assets["assets"]
            .as_array()
            .ok_or("ASSET_MANIFEST_INVALID")?;
        let mut meshes = BTreeMap::new();
        let mut textures: BTreeMap<String, Arc<wgpu::BindGroup>> = BTreeMap::new();
        let mut lods = BTreeMap::new();
        for asset in assets {
            let kind = asset["kind"].as_str().unwrap_or("");
            if matches!(kind, "audio" | "spine" | "effekseer") {
                // These assets are host adapters, not GPU mesh inputs. Keep
                // them in the verified package so the player can report a
                // precise presentation warning instead of rejecting the
                // entire scene before its supported visuals are drawn.
                continue;
            }
            if !["mesh3d", "texture2d"].contains(&kind) {
                return Err(format!("NATIVE_DECODER_UNAVAILABLE: {kind}"));
            }
            if kind != "mesh3d" {
                continue;
            }
            let value: serde_json::Value = serde_json::from_slice(package.get(&format!(
                "content/{}",
                asset["source"].as_str().ok_or("ASSET_SOURCE_MISSING")?
            ))?)
            .map_err(|e| e.to_string())?;
            let positions: Vec<f32> =
                serde_json::from_value(value["positions"].clone()).map_err(|e| e.to_string())?;
            let uvs: Vec<f32> =
                serde_json::from_value(value["uvs"].clone()).map_err(|e| e.to_string())?;
            let indices: Vec<u32> =
                serde_json::from_value(value["indices"].clone()).map_err(|e| e.to_string())?;
            crate::lod::validate(&positions, &uvs, &indices)?;
            let lower = crate::lod::levels(&value)?;
            if positions.len() % 3 != 0
                || uvs.len() != positions.len() / 3 * 2
                || indices.iter().any(|i| *i as usize >= positions.len() / 3)
            {
                return Err("MESH_INVALID".into());
            }
            let mut vertices = Vec::new();
            for (i, p) in positions.chunks_exact(3).enumerate() {
                vertices.extend_from_slice(p);
                vertices.extend_from_slice(&[uvs[i * 2], 1. - uvs[i * 2 + 1]]);
            }
            let texture = assets
                .iter()
                .find(|a| a["id"] == value["texture"])
                .ok_or("MESH_TEXTURE_MISSING")?;
            let texture_id = texture["id"].as_str().ok_or("TEXTURE_ID_MISSING")?.to_string();
            let bytes = package.get(&format!(
                "content/{}",
                texture["source"].as_str().ok_or("TEXTURE_SOURCE_MISSING")?
            ))?;
            let (texture_width, texture_height, rgba) = decode_texture(bytes)
                .map_err(|error| format!("{error}; asset={}", texture["id"]))?;
            let size = wgpu::Extent3d {
                width: texture_width,
                height: texture_height,
                depth_or_array_layers: 1,
            };
            let tex = device.create_texture(&wgpu::TextureDescriptor {
                label: None,
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            queue.write_texture(
                tex.as_image_copy(),
                &rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(texture_width * 4),
                    rows_per_image: Some(texture_height),
                },
                size,
            );
            let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                mag_filter: wgpu::FilterMode::Nearest,
                min_filter: wgpu::FilterMode::Nearest,
                ..Default::default()
            });
            let view = tex.create_view(&Default::default());
            let texture = Arc::new(device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &texture_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&sampler),
                    },
                ],
            }));
            textures.insert(texture_id, texture.clone());
            meshes.insert(
                asset["id"].as_str().ok_or("ASSET_ID_MISSING")?.into(),
                Mesh {
                    vertices: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: None,
                        contents: bytemuck::cast_slice(&vertices),
                        usage: wgpu::BufferUsages::VERTEX,
                    }),
                    indices: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: None,
                        contents: bytemuck::cast_slice(&indices),
                        usage: wgpu::BufferUsages::INDEX,
                    }),
                    count: indices.len() as u32,
                    radius: positions
                        .chunks_exact(3)
                        .map(|p| p.iter().map(|x| x * x).sum::<f32>().sqrt())
                        .fold(0., f32::max),
                    texture,
                },
            );
            let base = asset["id"].as_str().unwrap();
            let mut chain = Vec::new();
            for (i, l) in lower.iter().enumerate() {
                let id = format!("@lod:{i}:{base}");
                let texture = meshes[base].texture.clone();
                let mut vertices = Vec::new();
                for (n, p) in l.positions.chunks_exact(3).enumerate() {
                    vertices.extend_from_slice(p);
                    vertices.extend_from_slice(&[l.uvs[n * 2], 1. - l.uvs[n * 2 + 1]]);
                }
                meshes.insert(
                    id.clone(),
                    Mesh {
                        vertices: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                            label: Some("lod-vertices"),
                            contents: bytemuck::cast_slice(&vertices),
                            usage: wgpu::BufferUsages::VERTEX,
                        }),
                        indices: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                            label: Some("lod-indices"),
                            contents: bytemuck::cast_slice(&l.indices),
                            usage: wgpu::BufferUsages::INDEX,
                        }),
                        count: l.indices.len() as u32,
                        radius: meshes[base].radius,
                        texture,
                    },
                );
                chain.push((l.distance, id));
            }
            if !chain.is_empty() {
                lods.insert(base.to_owned(), chain);
            }
        }
        // Texture assets that are used by 2D sprites may not be referenced by
        // a mesh. Decode those once as well so the same verified PNG path is
        // used by both 3D materials and 2D sprites.
        for asset in assets {
            if asset["kind"].as_str() != Some("texture2d") {
                continue;
            }
            let id = asset["id"].as_str().ok_or("ASSET_ID_MISSING")?.to_string();
            if textures.contains_key(&id) {
                continue;
            }
            let source = asset["source"].as_str().ok_or("TEXTURE_SOURCE_MISSING")?;
            textures.insert(id, load_texture(&device, &queue, &texture_layout, package.get(&format!("content/{source}"))?)?);
        }
        let builtin_texture = solid_texture(&device, &queue, &texture_layout, [230, 236, 245, 255]);
        meshes.insert(
            "mesh://primitive/box".to_string(),
            builtin_box(&device, builtin_texture.clone()),
        );
        meshes.insert(
            "mesh://primitive/sphere".to_string(),
            builtin_sphere(&device, builtin_texture),
        );
        let depth = depth(&device, &config);
        let bloom_enabled = package
            .get("content/presentation.json")
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(bytes).ok())
            .and_then(|value| value.get("bloom").and_then(serde_json::Value::as_bool))
            .unwrap_or(false);
        let bloom = bloom_enabled.then(|| {
            Bloom::new(&device, format, config.width, config.height)
        });
        let particles = crate::particles::Particles::new(&device, format, &camera_layout);
        Ok(Self {
            ui:crate::ui::Surface::new(&device,format,package)?,
            particles,
            presentation_batches: serde_json::json!([]),
            lod_enabled: true,
            lods,
            lod_cache: BTreeMap::new(),
            triangles: 0,
            lod_counts: [0; 4],
            lod_ms: 0.,
            classify_ms: 0.,
            upload_ms: 0.,
            acquire_ms: 0.,
            submit_ms: 0.,
            present_ms: 0.,
            prepare_ms: 0.,
            sprite_prepare_ms: 0.,
            sprite_upload_ms: 0.,
            last_view: None,
            last_particle: None,
            surface,
            device,
            queue,
            config,
            pipeline,
            sprite_pipeline,
            camera,
            camera_group,
            sprite_camera,
            sprite_camera_group,
            sprite_vertices,
            sprite_indices,
            depth,
            bloom,
            meshes,
            textures,
            batches: BTreeMap::new(),
            sprites: Default::default(),
            sprite_buffer: None,
            sprite_capacity: 0,
            last_sprite_data: Vec::new(),
            last_sprite_camera: None,
            is_2d: false,
            adapter: name,
            submitted: 0,
            draws: 0,
            uploaded: 0,
        })
    }
    pub fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
        self.depth = depth(&self.device, &self.config);
        if let Some(bloom) = &mut self.bloom {
            bloom.resize(&self.device, self.config.width, self.config.height);
        }
    }
    fn batch(&mut self, id: &str, asset: &str, bytes: &[u8], revision: u64) -> R<()> {
        let started = std::time::Instant::now();
        if !self.meshes.contains_key(asset) {
            return Err(format!("NATIVE_MESH_MISSING: {asset}"));
        }
        let create = |capacity: usize| {
            std::array::from_fn(|_| {
                self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("native-instance-ring"),
                    size: capacity as u64,
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                })
            })
        };
        let b = self.batches.entry(id.into()).or_insert_with(|| Batch {
            buffers: create(bytes.len().max(40)),
            slot: 0,
            last_zero: Vec::new(),
            capacity: bytes.len().max(40),
            count: 0,
            asset: asset.into(),
            revision: 0,
            lod: 0,
        });
        if b.capacity < bytes.len() {
            b.capacity = bytes.len().next_power_of_two();
            b.buffers = create(b.capacity);
            b.revision = 0;
            b.last_zero.clear();
        }
        if (revision == 0 && b.last_zero != bytes) || (revision != 0 && b.revision != revision) {
            b.slot = (b.slot + 1) % 3;
            if !bytes.is_empty() {
                self.queue.write_buffer(&b.buffers[b.slot], 0, bytes);
                self.uploaded += bytes.len() as u64;
            }
            if revision == 0 {
                b.last_zero.clear();
                b.last_zero.extend_from_slice(bytes);
            }
            b.revision = revision;
        }
        b.count = (bytes.len() / 40) as u32;
        b.asset = asset.into();
        self.upload_ms += started.elapsed().as_secs_f64() * 1000.;
        Ok(())
    }
    fn prepare(&mut self, s: &WorldSnapshot) -> R<()> {
        if s.camera3d.is_none() {
            return self.prepare_2d(s);
        }
        self.is_2d = false;
        self.submitted = 0;
        self.draws = 0;
        self.triangles = 0;
        self.lod_counts = [0; 4];
        self.uploaded = 0;
        self.classify_ms = 0.;
        self.upload_ms = 0.;
        self.prepare_sprites(s)?;
        for b in self.batches.values_mut() {
            b.count = 0;
        }
        let c = s.camera3d.as_ref().ok_or("NATIVE_CAMERA3D_REQUIRED")?;
        let view = crate::lod::View::new(c, self.config.width as f32 / self.config.height as f32);
        let lod_start = std::time::Instant::now();
        let mut rows = Vec::new();
        for (id, b) in &s.instances3d {
            let chain = self
                .lods
                .get(&b.asset)
                .filter(|_| self.lod_enabled)
                .cloned()
                .unwrap_or_default();
            let radius = self
                .meshes
                .get(&b.asset)
                .ok_or_else(|| format!("NATIVE_MESH_MISSING: {}", b.asset))?
                .radius;
            let cache = self
                .lod_cache
                .entry(id.clone())
                .or_insert_with(|| LodCache {
                    revision: 0,
                    asset: String::new(),
                    view: None,
                    parts: Vec::new(),
                    generation: 1,
                });
            if cache.revision != b.revision || cache.view != Some(view) || cache.asset != b.asset {
                cache.parts.resize_with(chain.len() + 1, Vec::new);
                for p in &mut cache.parts {
                    p.clear();
                }
                let classify_started = std::time::Instant::now();
                let distances: Vec<_> = chain.iter().map(|l| l.0).collect();
                for record in b.packed.chunks_exact(40) {
                    let read =
                        |n: usize| f32::from_le_bytes(record[n * 4..n * 4 + 4].try_into().unwrap());
                    let position = std::array::from_fn(read);
                    let scale = read(7).max(read(8)).max(read(9));
                    if !view.intersects(position, radius * scale) {
                        continue;
                    }
                    let level = crate::lod::select(position, view.position, &distances);
                    cache.parts[level].extend_from_slice(record);
                }
                self.classify_ms += classify_started.elapsed().as_secs_f64() * 1000.;
                cache.revision = b.revision;
                cache.asset = b.asset.clone();
                cache.view = Some(view);
                cache.generation += 1;
            }
            let cache = self.lod_cache.remove(id).unwrap();
            let mut counts = Vec::new();
            let mut triangles = 0;
            for (level, bytes) in cache.parts.iter().enumerate() {
                if bytes.is_empty() {
                    counts.push(0);
                    continue;
                }
                let asset = if level == 0 {
                    &b.asset
                } else {
                    &chain[level - 1].1
                };
                let key = format!("batch:{id}:lod:{level}");
                self.batch(&key, asset, bytes, cache.generation)?;
                self.batches.get_mut(&key).unwrap().lod = level;
                counts.push(bytes.len() / 40);
                triangles += self.meshes[asset].count as u64 / 3 * (bytes.len() / 40) as u64;
            }
            rows.push(serde_json::json!({"id":id,"asset":b.asset,"input_instances":b.count,"frustum_candidates":counts.iter().sum::<usize>(),"lod_counts":counts,"submitted_triangles":triangles}));
            self.lod_cache.insert(id.clone(), cache);
        }
        self.presentation_batches = serde_json::Value::Array(rows);
        self.lod_cache
            .retain(|id, _| s.instances3d.contains_key(id));
        self.lod_ms = lod_start.elapsed().as_secs_f64() * 1000.;
        for (id, e) in &s.entities {
            if let (Some(t), Some(m)) = (&e.transform3d, &e.mesh3d) {
                if !m.visible {
                    continue;
                }
                let (sx, cx) = (t.rotation.x * 0.5).sin_cos();
                let (sy, cy) = (t.rotation.y * 0.5).sin_cos();
                let (sz, cz) = (t.rotation.z * 0.5).sin_cos();
                let v = [
                    t.position.x,
                    t.position.y,
                    t.position.z,
                    sx * cy * cz + cx * sy * sz,
                    cx * sy * cz - sx * cy * sz,
                    cx * cy * sz + sx * sy * cz,
                    cx * cy * cz - sx * sy * sz,
                    t.scale.x,
                    t.scale.y,
                    t.scale.z,
                ]
                .map(|x| x as f32);
                self.batch(
                    &format!("entity:{id}"),
                    &m.asset,
                    bytemuck::cast_slice(&v),
                    0,
                )?;
            }
        }
        self.batches.retain(|_, b| b.count > 0);
        let c = s.camera3d.as_ref().ok_or("NATIVE_CAMERA3D_REQUIRED")?;
        if self.last_particle != Some((s.frame, view)) {
            self.particles
                .prepare(&self.device, &self.queue, &s.particles, c);
            self.uploaded += self.particles.uploaded as u64;
            self.last_particle = Some((s.frame, view));
        }
        let values = view.uniform();
        if self.last_view != Some(view) {
            self.queue
                .write_buffer(&self.camera, 0, bytemuck::cast_slice(&values));
            self.last_view = Some(view);
        }
        Ok(())
    }

    fn prepare_2d(&mut self, s: &WorldSnapshot) -> R<()> {
        self.is_2d = true;
        self.submitted = 0;
        self.draws = 0;
        self.triangles = 0;
        self.lod_counts = [0; 4];
        self.uploaded = 0;
        self.classify_ms = 0.;
        self.upload_ms = 0.;
        self.lod_ms = 0.;
        self.presentation_batches = serde_json::json!([]);
        self.prepare_sprites(s)
    }

    fn prepare_sprites(&mut self, s: &WorldSnapshot) -> R<()> {
        let started = std::time::Instant::now();
        self.sprites.prepare(&s.entities);
        for run in &self.sprites.runs {
            if !self.textures.contains_key(&run.asset) {
                return Err(format!("NATIVE_SPRITE_TEXTURE_MISSING: {}", run.asset));
            }
        }
        self.sprite_prepare_ms = started.elapsed().as_secs_f64() * 1000.;
        let started = std::time::Instant::now();
        let height = (s.camera.view_height / s.camera.zoom).max(0.0001);
        let camera = [
            s.camera.position.x as f32,
            s.camera.position.y as f32,
            height as f32,
            self.config.width as f32 / self.config.height.max(1) as f32,
        ];
        if self.last_sprite_camera != Some(camera) {
            self.queue.write_buffer(&self.sprite_camera, 0, bytemuck::cast_slice(&camera));
            self.uploaded += std::mem::size_of_val(&camera) as u64;
            self.last_sprite_camera = Some(camera);
        }
        let bytes = bytemuck::cast_slice(&self.sprites.instances);
        if bytes.len() > self.sprite_capacity {
            self.sprite_capacity = bytes.len().next_power_of_two();
            self.sprite_buffer = Some(self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("native-sprite-instances"),
                size: self.sprite_capacity as u64,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
            self.last_sprite_data.clear();
        }
        if self.last_sprite_data != self.sprites.instances {
            if !bytes.is_empty() {
                self.queue.write_buffer(self.sprite_buffer.as_ref().unwrap(), 0, bytes);
                self.uploaded += bytes.len() as u64;
            }
            self.last_sprite_data.clone_from(&self.sprites.instances);
        }
        self.sprite_upload_ms = started.elapsed().as_secs_f64() * 1000.;
        Ok(())
    }
    fn draw_world(&mut self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView) {
        self.submitted = 0;
        self.draws = 0;
        self.triangles = 0;
        self.lod_counts = [0; 4];
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        // Match the Web renderer's #111827 sRGB clear color.
                        r: 0x11 as f64 / 255.,
                        g: 0x18 as f64 / 255.,
                        b: 0x27 as f64 / 255.,
                        a: 1.,
                    }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &self.depth,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(1.),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.camera_group, &[]);
        for b in self.batches.values() {
            let m = &self.meshes[&b.asset];
            pass.set_bind_group(1, &*m.texture, &[]);
            pass.set_vertex_buffer(0, m.vertices.slice(..));
            pass.set_vertex_buffer(1, b.buffers[b.slot].slice(..));
            pass.set_index_buffer(m.indices.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..m.count, 0, 0..b.count);
            self.submitted += b.count as u64;
            self.triangles += m.count as u64 / 3 * b.count as u64;
            self.lod_counts[b.lod] += b.count as u64;
            self.draws += 1;
        }
        self.particles.draw(&mut pass);
        self.draws += self.particles.draw_calls();
        drop(pass);
    }
    fn draw_world_2d(&mut self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView) {
        self.draw_sprites_2d(encoder, view, true);
    }
    fn draw_sprites_2d(&mut self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView, clear: bool) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("native-2d-world"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: if clear {
                        wgpu::LoadOp::Clear(wgpu::Color { r: 0x11 as f64 / 255., g: 0x18 as f64 / 255., b: 0x27 as f64 / 255., a: 1. })
                    } else {
                        wgpu::LoadOp::Load
                    },
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.sprite_pipeline);
        pass.set_bind_group(0, &self.sprite_camera_group, &[]);
        pass.set_vertex_buffer(0, self.sprite_vertices.slice(..));
        pass.set_index_buffer(self.sprite_indices.slice(..), wgpu::IndexFormat::Uint32);
        if let Some(buffer) = &self.sprite_buffer {
            pass.set_vertex_buffer(1, buffer.slice(..));
        }
        for run in &self.sprites.runs {
            pass.set_bind_group(1, &*self.textures[&run.asset], &[]);
            pass.draw_indexed(0..6, 0, run.start..run.start + run.count);
            self.draws += 1;
            self.submitted += run.count as u64;
            self.triangles += 2 * run.count as u64;
        }
    }
    fn draw(&mut self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView) {
        // Capture redraws this same frame. Report its counts, not a sum of the
        // presentation and capture (the 2D path used to double them).
        self.submitted = 0;
        self.draws = 0;
        self.triangles = 0;
        self.lod_counts = [0; 4];
        if self.is_2d {
            if let Some(scene_view) = self.bloom.as_ref().map(|bloom| bloom.scene_view.clone()) {
                self.draw_world_2d(encoder, &scene_view);
                self.bloom.as_ref().unwrap().encode(encoder, view);
            } else {
                self.draw_world_2d(encoder, view);
            }
        } else {
            if let Some(scene_view) = self.bloom.as_ref().map(|bloom| bloom.scene_view.clone()) {
                self.draw_world(encoder, &scene_view);
                self.draw_sprites_2d(encoder, &scene_view, false);
                self.bloom.as_ref().unwrap().encode(encoder, view);
            } else {
                self.draw_world(encoder, view);
                self.draw_sprites_2d(encoder, view, false);
            }
        }
        if self.ui.draw(encoder,view){self.draws+=1;}
    }
    pub fn render(&mut self, s: &WorldSnapshot) -> R<bool> {
        let started = std::time::Instant::now();
        self.prepare(s)?;
        self.ui.prepare(&self.device,&self.queue,s.ui.as_ref(),self.config.width,self.config.height)?;
        self.uploaded+=self.ui.upload_bytes;
        self.prepare_ms = started.elapsed().as_secs_f64() * 1000.;
        let started = std::time::Instant::now();
        let output = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(false);
            }
            wgpu::CurrentSurfaceTexture::Lost | wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                return Ok(false);
            }
            _ => return Err("NATIVE_SURFACE_INVALID".into()),
        };
        self.acquire_ms = started.elapsed().as_secs_f64() * 1000.;
        let started = std::time::Instant::now();
        let view = output.texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.draw(&mut encoder, &view);
        self.queue.submit([encoder.finish()]);
        self.submit_ms = started.elapsed().as_secs_f64() * 1000.;
        let started = std::time::Instant::now();
        self.queue.present(output);
        self.present_ms = started.elapsed().as_secs_f64() * 1000.;
        Ok(true)
    }
    pub fn capture(&mut self, path: &std::path::Path) -> R<()> {
        let width = self.config.width;
        let height = self.config.height;
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("native-capture"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.config.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let stride = (width * 4).div_ceil(256) * 256;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: stride as u64 * height as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.draw(&mut encoder, &view);
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: Some(height),
                },
            },
            size,
        );
        let submission = self.queue.submit([encoder.finish()]);
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        buffer.slice(..).map_async(wgpu::MapMode::Read, move |v| {
            let _ = tx.send(v);
        });
        self.device
            .poll(wgpu::PollType::Wait {
                submission_index: Some(submission),
                timeout: Some(std::time::Duration::from_secs(10)),
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(1))
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        let mapped = buffer
            .slice(..)
            .get_mapped_range()
            .map_err(|e| e.to_string())?;
        let mut pixels = Vec::new();
        for row in mapped.chunks_exact(stride as usize) {
            pixels.extend_from_slice(&row[..width as usize * 4]);
        }
        drop(mapped);
        buffer.unmap();
        if matches!(
            self.config.format,
            wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb
        ) {
            for p in pixels.chunks_exact_mut(4) {
                p.swap(0, 2);
            }
        }
        let mut encoder = png::Encoder::new(
            std::fs::File::create(path).map_err(|e| e.to_string())?,
            width,
            height,
        );
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .map_err(|e| e.to_string())?
            .write_image_data(&pixels)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
