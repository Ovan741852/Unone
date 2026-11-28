use crate::Package;
use std::{collections::{BTreeMap, HashMap}, sync::Arc};
use unone_engine::{WindowsGpuMemory, WorldSnapshot};
use wgpu::util::DeviceExt;
use crate::host::SharedWindow;
type R<T> = Result<T, String>;

// Index once without changing manifest iteration/upload order. The SDK rejects
// duplicate IDs; enforce the same contract here instead of choosing one entry.
fn index_assets(assets: &[serde_json::Value]) -> R<HashMap<&str, &serde_json::Value>> {
    let mut index = HashMap::with_capacity(assets.len());
    for asset in assets {
        let id = asset["id"].as_str().ok_or("ASSET_ID_MISSING")?;
        if index.insert(id, asset).is_some() {
            return Err(format!("ASSET_MANIFEST_DUPLICATE_ID: {id}"));
        }
    }
    Ok(index)
}

fn indexed_texture<'a>(index: &HashMap<&str, &'a serde_json::Value>, id: &str) -> R<&'a serde_json::Value> {
    index.get(id).copied()
        .filter(|asset| asset["kind"].as_str() == Some("texture2d"))
        .ok_or_else(|| "MESH_TEXTURE_MISSING".to_owned())
}

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
    /// The scene material this batch's entities name, if any.
    material: Option<String>,
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
    sampler: wgpu::Sampler,
    params_extract: wgpu::Buffer,
    params_blur_h: wgpu::Buffer,
    params_blur_v: wgpu::Buffer,
    params_composite: wgpu::Buffer,
    params_fxaa: wgpu::Buffer,
    look: wgpu::Buffer,
    layout: wgpu::BindGroupLayout,
    look_layout: wgpu::BindGroupLayout,
    extract_pipeline: wgpu::RenderPipeline,
    blur_pipeline: wgpu::RenderPipeline,
    composite_pipeline: wgpu::RenderPipeline,
    fxaa_pipeline: wgpu::RenderPipeline,
    /// Always Some after new(); an Option only so new() can build it from self.
    targets: Option<PostTargets>,
    /// Settings last written by configure; None keeps the creation defaults.
    settings: Option<PostSettings>,
    /// The look uniform last uploaded.
    look_values: [f32; LOOK_FLOATS],
    surface_format: wgpu::TextureFormat,
}

/// Everything sized to the surface: the post chain's targets and the bind
/// groups that read them. Rebuilt on resize, or when the depth view changes.
struct PostTargets {
    scene_view: wgpu::TextureView,
    bright_a_view: wgpu::TextureView,
    bright_b_view: wgpu::TextureView,
    /// The composite's target when FXAA follows it.
    post_view: wgpu::TextureView,
    extract_group: wgpu::BindGroup,
    blur_h_group: wgpu::BindGroup,
    blur_v_group: wgpu::BindGroup,
    composite_group: wgpu::BindGroup,
    look_group: wgpu::BindGroup,
    fxaa_group: wgpu::BindGroup,
}

/// bloom.wgsl `Look`: seven vec4s.
const LOOK_FLOATS: usize = 28;

impl Bloom {
    const BLOOM_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

    fn texture(
        device: &wgpu::Device,
        label: &'static str,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> wgpu::TextureView {
        device
            .create_texture(&wgpu::TextureDescriptor {
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
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            })
            .create_view(&Default::default())
    }

    fn uniform(device: &wgpu::Device, label: &'static str, values: &[f32]) -> wgpu::Buffer {
        device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(label),
            contents: bytemuck::cast_slice(values),
            // COPY_DST: a declared render pipeline rewrites params per frame.
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        })
    }

    fn pipeline(
        device: &wgpu::Device,
        layouts: &[&wgpu::BindGroupLayout],
        shader: &wgpu::ShaderModule,
        entry: &'static str,
        format: wgpu::TextureFormat,
        label: &'static str,
    ) -> wgpu::RenderPipeline {
        let groups: Vec<_> = layouts.iter().map(|layout| Some(*layout)).collect();
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(label),
            bind_group_layouts: &groups,
            immediate_size: 0,
        });
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(label),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: shader,
                // Every pass, the composite included, samples its inputs in
                // framebuffer row order, so the image keeps its orientation.
                entry_point: Some("vs_texel"),
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

    fn build_targets(&self, device: &wgpu::Device, width: u32, height: u32, depth: &wgpu::TextureView) -> PostTargets {
        let (width, height) = (width.max(1), height.max(1));
        let (bright_width, bright_height) = (width.div_ceil(4).max(1), height.div_ceil(4).max(1));
        let scene_view = Self::texture(device, "native-bloom-scene", width, height, self.surface_format);
        let bright_a_view = Self::texture(device, "native-bloom-bright-a", bright_width, bright_height, Self::BLOOM_FORMAT);
        let bright_b_view = Self::texture(device, "native-bloom-bright-b", bright_width, bright_height, Self::BLOOM_FORMAT);
        let post_view = Self::texture(device, "native-post-composite", width, height, self.surface_format);
        let group = |image, bloom, params, label| Self::bind_group(device, &self.layout, image, bloom, &self.sampler, params, label);
        PostTargets {
            extract_group: group(&scene_view, &scene_view, &self.params_extract, "native-bloom-extract-bindings"),
            blur_h_group: group(&bright_a_view, &bright_a_view, &self.params_blur_h, "native-bloom-blur-h-bindings"),
            blur_v_group: group(&bright_b_view, &bright_b_view, &self.params_blur_v, "native-bloom-blur-v-bindings"),
            composite_group: group(&scene_view, &bright_a_view, &self.params_composite, "native-bloom-composite-bindings"),
            fxaa_group: group(&post_view, &post_view, &self.params_fxaa, "native-fxaa-bindings"),
            look_group: device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("native-post-look-bindings"),
                layout: &self.look_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(depth),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: self.look.as_entire_binding(),
                    },
                ],
            }),
            scene_view,
            bright_a_view,
            bright_b_view,
            post_view,
        }
    }

    fn new(
        device: &wgpu::Device,
        surface_format: wgpu::TextureFormat,
        width: u32,
        height: u32,
        depth: &wgpu::TextureView,
    ) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("native-bloom"),
            source: wgpu::ShaderSource::Wgsl(include_str!("bloom.wgsl").into()),
        });
        let texture_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let uniform_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("native-bloom-bindings"),
            entries: &[
                texture_entry(0),
                texture_entry(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                uniform_entry(3),
            ],
        });
        let look_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("native-post-look"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                uniform_entry(1),
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
        let (w, h) = (width.max(1) as f32, height.max(1) as f32);
        let mut bloom = Self {
            params_extract: Self::uniform(device, "native-bloom-extract-params", &[0.55, 0.95, 0., 0.]),
            params_blur_h: Self::uniform(device, "native-bloom-blur-h-params", &[1., 0., 0., 0.]),
            params_blur_v: Self::uniform(device, "native-bloom-blur-v-params", &[0., 1., 0., 0.]),
            params_composite: Self::uniform(device, "native-bloom-composite-params", &[0.75, 0., 0., 0.]),
            params_fxaa: Self::uniform(device, "native-fxaa-params", &[1. / w, 1. / h, 0., 0.]),
            look: Self::uniform(device, "native-post-look", &[0.; LOOK_FLOATS]),
            extract_pipeline: Self::pipeline(device, &[&layout], &shader, "extract", Self::BLOOM_FORMAT, "native-bloom-extract-pipeline"),
            blur_pipeline: Self::pipeline(device, &[&layout], &shader, "blur", Self::BLOOM_FORMAT, "native-bloom-blur-pipeline"),
            composite_pipeline: Self::pipeline(device, &[&layout, &look_layout], &shader, "composite", surface_format, "native-bloom-composite-pipeline"),
            fxaa_pipeline: Self::pipeline(device, &[&layout], &shader, "fxaa", surface_format, "native-fxaa-pipeline"),
            targets: None,
            layout,
            look_layout,
            sampler,
            settings: None,
            look_values: [0.; LOOK_FLOATS],
            surface_format,
        };
        bloom.targets = Some(bloom.build_targets(device, width, height, depth));
        bloom
    }

    fn sized(&self) -> &PostTargets {
        self.targets.as_ref().expect("Bloom::new builds the post targets")
    }

    /// The texture the world draws into while post passes are on.
    fn scene_view(&self) -> &wgpu::TextureView {
        &self.sized().scene_view
    }

    /// Recreate the size-dependent targets; `depth` is the renderer's new depth view.
    fn resize(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, width: u32, height: u32, depth: &wgpu::TextureView) {
        self.targets = Some(self.build_targets(device, width, height, depth));
        queue.write_buffer(&self.params_fxaa, 0, bytemuck::cast_slice(&[1. / width.max(1) as f32, 1. / height.max(1) as f32, 0., 0.]));
    }

    /// Write this frame's settings; unchanged values cost no upload. `lens` is
    /// [tan(fov / 2), aspect, near, far]; `has_depth` is false on the 2D path,
    /// which draws no depth, so AO and fog stay off there.
    fn configure(&mut self, queue: &wgpu::Queue, post: PostSettings, lens: [f32; 4], has_depth: bool) {
        if self.settings != Some(post) {
            let threshold = post.bloom.map_or(0.55, |bloom| bloom.0);
            queue.write_buffer(&self.params_extract, 0, bytemuck::cast_slice(&[threshold, threshold + 0.4, 0., 0.]));
            let (mode, exposure) = post.tone.map_or((0., 1.), |(aces, exposure)| (if aces { 2. } else { 1. }, exposure));
            let strength = post.bloom.map_or(0., |bloom| bloom.1);
            queue.write_buffer(&self.params_composite, 0, bytemuck::cast_slice(&[strength, exposure, mode, 0.]));
            self.settings = Some(post);
        }
        let look = post.look(lens, has_depth);
        if look != self.look_values {
            queue.write_buffer(&self.look, 0, bytemuck::cast_slice(&look));
            self.look_values = look;
        }
    }

    fn fullscreen(
        encoder: &mut wgpu::CommandEncoder,
        label: &'static str,
        target: &wgpu::TextureView,
        pipeline: &wgpu::RenderPipeline,
        groups: &[&wgpu::BindGroup],
    ) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
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
        pass.set_pipeline(pipeline);
        for (index, group) in groups.iter().enumerate() {
            pass.set_bind_group(index as u32, *group, &[]);
        }
        pass.draw(0..3, 0..1);
    }

    fn encode(&self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView) {
        let t = self.sized();
        // Presentation Bloom (no declared pipeline) always runs the glow.
        if self.settings.is_none_or(|post| post.bloom.is_some()) {
            Self::fullscreen(encoder, "native-bloom-extract", &t.bright_a_view, &self.extract_pipeline, &[&t.extract_group]);
            Self::fullscreen(encoder, "native-bloom-blur-horizontal", &t.bright_b_view, &self.blur_pipeline, &[&t.blur_h_group]);
            // The vertical blur writes back to bright_a, the composite's glow.
            Self::fullscreen(encoder, "native-bloom-blur-vertical", &t.bright_a_view, &self.blur_pipeline, &[&t.blur_v_group]);
        }
        let antialias = self.settings.is_some_and(|post| post.fxaa);
        let composite_target = if antialias { &t.post_view } else { target };
        Self::fullscreen(encoder, "native-bloom-composite", composite_target, &self.composite_pipeline, &[&t.composite_group, &t.look_group]);
        if antialias {
            Self::fullscreen(encoder, "native-fxaa", target, &self.fxaa_pipeline, &[&t.fxaa_group]);
        }
    }
}

/// One frame of a declared render pipeline (ADR 0048), or None to keep the
/// built-in passes. Bloom is (threshold, strength); tone is (aces, exposure).
/// Colours are linear, converted from the declared "#rrggbb" sRGB text.
#[derive(Clone, Copy, PartialEq, Debug, Default)]
struct PostSettings {
    ao: Option<f32>,
    fog: Option<Fog>,
    bloom: Option<(f32, f32)>,
    tone: Option<(bool, f32)>,
    grade: Option<Grade>,
    vignette: Option<Vignette>,
    fxaa: bool,
}

#[derive(Clone, Copy, PartialEq, Debug)]
struct Fog {
    linear: bool,
    color: [f32; 3],
    density: f32,
    start: f32,
    end: f32,
}

#[derive(Clone, Copy, PartialEq, Debug)]
struct Grade {
    saturation: f32,
    contrast: f32,
    brightness: f32,
    tint: [f32; 3],
}

#[derive(Clone, Copy, PartialEq, Debug)]
struct Vignette {
    strength: f32,
    radius: f32,
    softness: f32,
    color: [f32; 3],
}

impl PostSettings {
    fn any(&self) -> bool {
        self.ao.is_some()
            || self.fog.is_some()
            || self.bloom.is_some()
            || self.tone.is_some()
            || self.grade.is_some()
            || self.vignette.is_some()
            || self.fxaa
    }

    /// The bloom.wgsl `Look` uniform for this frame.
    fn look(&self, lens: [f32; 4], has_depth: bool) -> [f32; LOOK_FLOATS] {
        let fog = self.fog;
        let grade = self.grade;
        let vignette = self.vignette;
        let fog_color = fog.map_or([0.; 3], |fog| fog.color);
        let tint = grade.map_or([1.; 3], |grade| grade.tint);
        let vignette_color = vignette.map_or([0.; 3], |vignette| vignette.color);
        [
            fog_color[0], fog_color[1], fog_color[2], fog.map_or(0., |fog| if fog.linear { 2. } else { 1. }),
            fog.map_or(0.02, |fog| fog.density), fog.map_or(0., |fog| fog.start), fog.map_or(100., |fog| fog.end), self.ao.unwrap_or(0.),
            tint[0], tint[1], tint[2], if grade.is_some() { 1. } else { 0. },
            grade.map_or(1., |grade| grade.saturation), grade.map_or(1., |grade| grade.contrast), grade.map_or(1., |grade| grade.brightness), vignette.map_or(0., |vignette| vignette.strength),
            vignette_color[0], vignette_color[1], vignette_color[2], vignette.map_or(0.6, |vignette| vignette.radius),
            vignette.map_or(0.6, |vignette| vignette.softness), lens[2], lens[3], if has_depth { 1. } else { 0. },
            lens[0], lens[1], 0., 0.,
        ]
    }
}

/// "#rrggbb" sRGB text to linear RGB, as three.js Color.set does.
fn linear_color(text: &str) -> Option<[f32; 3]> {
    let digits = text.strip_prefix('#').filter(|digits| digits.len() == 6)?;
    let channel = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).ok().map(|byte| srgb_to_linear(byte as f32 / 255.));
    Some([channel(0)?, channel(2)?, channel(4)?])
}

fn srgb_to_linear(value: f32) -> f32 {
    if value <= 0.04045 { value / 12.92 } else { ((value + 0.055) / 1.055).powf(2.4) }
}

/// The Web renderer's #111827 sRGB clear colour. wgpu clear values are linear
/// and an sRGB target encodes them, so convert first; writing the sRGB bytes
/// as linear made native backgrounds visibly lighter than Web.
fn clear_color(format: wgpu::TextureFormat) -> wgpu::Color {
    let channel = |byte: u8| {
        let value = byte as f32 / 255.;
        (if format.is_srgb() { srgb_to_linear(value) } else { value }) as f64
    };
    wgpu::Color { r: channel(0x11), g: channel(0x18), b: channel(0x27), a: 1. }
}

#[derive(Clone, Copy, PartialEq, Debug)]
struct PipelineFrame {
    scene: bool,
    post: PostSettings,
    projected: bool,
    ui: bool,
}

impl PipelineFrame {
    /// The kinds native executes; render() rejects others before this runs.
    /// Absent params take the same defaults as the Web player.
    fn from_snapshot(pipeline: &unone_engine::RenderPipeline) -> Self {
        let pass = |kind: &str| pipeline.passes.iter().find(|pass| pass.kind == kind);
        let enabled = |kind: &str| pass(kind).is_some_and(|pass| pass.enabled);
        let number = |kind: &str, key: &str, fallback: f32| match pass(kind).and_then(|pass| pass.params.get(key)) {
            Some(unone_engine::RenderParam::Number(value)) => *value as f32,
            _ => fallback,
        };
        let text = |kind: &str, key: &str| match pass(kind).and_then(|pass| pass.params.get(key)) {
            Some(unone_engine::RenderParam::Text(value)) => Some(value.clone()),
            _ => None,
        };
        let color = |kind: &str, key: &str, fallback: &str| {
            text(kind, key).and_then(|value| linear_color(&value)).or_else(|| linear_color(fallback)).unwrap_or([0.; 3])
        };
        let aces = text("tonemap", "mode").as_deref() == Some("aces");
        Self {
            scene: enabled("scene"),
            post: PostSettings {
                ao: enabled("ao").then(|| number("ao", "strength", 1.7)),
                fog: enabled("fog").then(|| Fog {
                    linear: text("fog", "mode").as_deref() == Some("linear"),
                    color: color("fog", "color", "#c8d0dc"),
                    density: number("fog", "density", 0.02),
                    start: number("fog", "start", 0.),
                    end: number("fog", "end", 100.),
                }),
                bloom: enabled("bloom").then(|| (number("bloom", "threshold", 0.55), number("bloom", "strength", 0.75))),
                tone: enabled("tonemap").then(|| (aces, number("tonemap", "exposure", 1.))),
                grade: enabled("grade").then(|| Grade {
                    saturation: number("grade", "saturation", 1.),
                    contrast: number("grade", "contrast", 1.),
                    brightness: number("grade", "brightness", 1.),
                    tint: color("grade", "tint", "#ffffff"),
                }),
                vignette: enabled("vignette").then(|| Vignette {
                    strength: number("vignette", "strength", 0.5),
                    radius: number("vignette", "radius", 0.6),
                    softness: number("vignette", "softness", 0.6),
                    color: color("vignette", "color", "#000000"),
                }),
                fxaa: enabled("fxaa"),
            },
            projected: pass("projected").is_none_or(|pass| pass.enabled),
            ui: pass("ui").is_none_or(|pass| pass.enabled),
        }
    }
}

/// 4x MSAA targets for the world and sprite passes (presentation
/// `"antialias": true`), and the pass that copies sample 0 of the multisampled
/// depth into the single-sample depth AO, fog and projected geometry read.
struct Msaa {
    color: wgpu::TextureView,
    depth: wgpu::TextureView,
    resolve_layout: wgpu::BindGroupLayout,
    resolve_group: wgpu::BindGroup,
    resolve_pipeline: wgpu::RenderPipeline,
}

impl Msaa {
    const SAMPLES: u32 = 4;

    fn targets(device: &wgpu::Device, config: &wgpu::SurfaceConfiguration) -> (wgpu::TextureView, wgpu::TextureView) {
        let target = |label, format, usage| {
            device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d { width: config.width, height: config.height, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: Self::SAMPLES,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        (
            target("native-msaa-color", config.format, wgpu::TextureUsages::RENDER_ATTACHMENT),
            target("native-msaa-depth", wgpu::TextureFormat::Depth32Float, wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING),
        )
    }

    fn resolve_group(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, depth: &wgpu::TextureView) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("native-msaa-depth-resolve"),
            layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(depth) }],
        })
    }

    fn new(device: &wgpu::Device, config: &wgpu::SurfaceConfiguration) -> Self {
        let (color, depth) = Self::targets(device, config);
        let resolve_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("native-msaa-depth-resolve"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Depth,
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: true,
                },
                count: None,
            }],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("native-msaa-depth-resolve"),
            source: wgpu::ShaderSource::Wgsl(include_str!("depth_resolve.wgsl").into()),
        });
        let resolve_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("native-msaa-depth-resolve"),
            layout: Some(&device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("native-msaa-depth-resolve"),
                bind_group_layouts: &[Some(&resolve_layout)],
                immediate_size: 0,
            })),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs"), buffers: &[], compilation_options: Default::default() },
            fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some("fs"), targets: &[], compilation_options: Default::default() }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Always),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let resolve_group = Self::resolve_group(device, &resolve_layout, &depth);
        Self { color, depth, resolve_layout, resolve_group, resolve_pipeline }
    }

    fn resize(&mut self, device: &wgpu::Device, config: &wgpu::SurfaceConfiguration) {
        (self.color, self.depth) = Self::targets(device, config);
        self.resolve_group = Self::resolve_group(device, &self.resolve_layout, &self.depth);
    }

    fn resolve_depth(&self, encoder: &mut wgpu::CommandEncoder, depth: &wgpu::TextureView) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("native-msaa-depth-resolve"),
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: depth,
                depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.), store: wgpu::StoreOp::Store }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.resolve_pipeline);
        pass.set_bind_group(0, &self.resolve_group, &[]);
        pass.draw(0..3, 0..1);
    }
}

/// The window's GPU context: created first, so the startup screen can draw
/// while the package loads, then handed to the renderer.
pub struct Gpu {
    surface: wgpu::Surface<'static>,
    adapter: wgpu::Adapter,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    format: wgpu::TextureFormat,
    name: String,
    memory_profile: WindowsGpuMemory,
}
impl Gpu {
    pub async fn new(window: SharedWindow, memory_profile: WindowsGpuMemory) -> R<Self> {
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
                memory_hints: match memory_profile {
                    WindowsGpuMemory::Performance => wgpu::MemoryHints::Performance,
                    WindowsGpuMemory::MemoryUsage => wgpu::MemoryHints::MemoryUsage,
                },
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
        Ok(Self { surface, adapter, device, queue, config, format, name, memory_profile })
    }
    pub fn target(&self) -> Target<'_> {
        Target { device: &self.device, queue: &self.queue, surface: &self.surface, config: &self.config }
    }
    pub fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 { return; }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
    }
}
/// What the startup screen draws through.
pub struct Target<'a> {
    pub device: &'a wgpu::Device,
    pub queue: &'a wgpu::Queue,
    pub surface: &'a wgpu::Surface<'static>,
    pub config: &'a wgpu::SurfaceConfiguration,
}
pub struct Renderer {
    pub(crate) memory_profile: WindowsGpuMemory,
    projected:crate::projected::Projected,
    world_visible:bool,
    render_pipeline: Option<PipelineFrame>,
    ui:crate::ui::Surface,
    particles: crate::particles::Particles,
    /// Scene lighting: the mesh pipeline's group 2 and the sun's shadow pass.
    lighting: crate::lighting::LightingGpu,
    /// Scene materials: the mesh pipeline's group 3.
    materials: crate::lighting::MaterialsGpu,
    /// Primitives with a material start from white rather than their grey.
    white_texture: Arc<wgpu::BindGroup>,
    /// Draws the environment panorama as the sky.
    sky_pipeline: wgpu::RenderPipeline,
    /// .hdr data assets by id, decoded when lighting.environment names one.
    environment_sources: BTreeMap<String, Vec<u8>>,
    /// Present when presentation "antialias": true selected 4x MSAA.
    msaa: Option<Msaa>,
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
    heightfield_revisions: BTreeMap<String, u64>,
    textures: BTreeMap<String, Arc<wgpu::BindGroup>>,
    texture_layout: wgpu::BindGroupLayout,
    texture_catalog: crate::sprite_resources::TextureCatalog,
    texture_bytes: BTreeMap<String,u64>,
    texture_estimates: BTreeMap<String,u64>,
    /// Width and height of resident textures (image particles size by the image's aspect ratio).
    texture_dims: BTreeMap<String,(u32,u32)>,
    /// Images particles have used; they stay resident like scene-declared art.
    particle_textures: std::collections::BTreeSet<String>,
    persistent_textures: std::collections::BTreeSet<String>,
    sprite_resources: crate::sprite_resources::Resources,
    sprite_plan_revision:Option<u64>,
    sprite_plan:Vec<unone_engine::SpriteResourcePlan>,
    batches: BTreeMap<String, Batch>,
    // Packed mesh-entity records per asset, retained between frames.
    entity_records: BTreeMap<String, Vec<u8>>,
    sprites: crate::sprites::Frame,
    sprite_buffer: Option<wgpu::Buffer>,
    sprite_capacity: usize,
    last_sprite_data: Vec<crate::sprites::Instance>,
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
    use super::{decode_texture, index_assets, indexed_texture};

    #[test]
    fn asset_index_matches_linear_texture_lookup_without_reordering() {
        let assets = serde_json::json!([
            {"id":"mesh://quad","kind":"mesh3d","source":"quad.mesh.json"},
            {"id":"texture://atlas-b","kind":"texture2d","source":"b.png"},
            {"id":"audio://click","kind":"audio","source":"click.wav"},
            {"id":"texture://atlas-a","kind":"texture2d","source":"a.png"}
        ]);
        let assets = assets.as_array().unwrap();
        let before = assets.clone();
        let index = index_assets(assets).unwrap();
        for id in ["texture://atlas-a", "texture://atlas-b", "texture://atlas-a"] {
            let old = assets.iter().find(|asset| asset["id"] == id).unwrap();
            let new = indexed_texture(&index, id).unwrap();
            assert!(std::ptr::eq(old, new), "the exact descriptor is reused");
            assert_eq!(old["source"], new["source"]);
        }
        assert_eq!(*assets, before);
        assert_eq!(indexed_texture(&index, "texture://missing").unwrap_err(), "MESH_TEXTURE_MISSING");
        assert_eq!(indexed_texture(&index, "mesh://quad").unwrap_err(), "MESH_TEXTURE_MISSING");
    }

    #[test]
    fn asset_index_rejects_duplicate_ids_including_identical_and_cross_kind_entries() {
        for second in [
            serde_json::json!({"id":"texture://same","kind":"texture2d","source":"a.png"}),
            serde_json::json!({"id":"texture://same","kind":"texture2d","source":"b.png"}),
            serde_json::json!({"id":"texture://same","kind":"mesh3d","source":"b.mesh.json"}),
        ] {
            let assets = [serde_json::json!({"id":"texture://same","kind":"texture2d","source":"a.png"}), second];
            assert_eq!(index_assets(&assets).unwrap_err(), "ASSET_MANIFEST_DUPLICATE_ID: texture://same");
        }
        assert_eq!(index_assets(&[serde_json::json!({"kind":"texture2d","source":"a.png"})]).unwrap_err(), "ASSET_ID_MISSING");
    }

    /// CPU-only differential against an external verified export. The legacy
    /// linear reference is memoized per distinct texture ID; every mesh still
    /// compares its exact descriptor/source against the new registry result.
    #[test]
    fn external_asset_index_differential() {
        let Some(root) = std::env::var_os("UNONE_NATIVE_ASSET_LOOKUP_FIXTURE") else {
            eprintln!("UNONE_NATIVE_ASSET_LOOKUP_FIXTURE unset; external manifest not exercised");
            return;
        };
        let root = std::path::PathBuf::from(root);
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("content/assets.json")).expect("read external asset manifest")
        ).expect("external asset manifest JSON");
        let assets = manifest["assets"].as_array().expect("external asset array");
        assert!(!assets.is_empty());
        let index = index_assets(assets).expect("external IDs must follow SDK uniqueness");
        let mut old_textures = std::collections::HashMap::new();
        let mut meshes = 0usize;
        let mut old_comparisons = 0u64;
        let mut comparisons_on_misses = 0u64;
        for asset in assets {
            if asset["kind"] != "mesh3d" { continue; }
            let path = asset["source"].as_str().expect("mesh source");
            assert!(crate::safe(path), "external fixture mesh source must stay within content");
            let mesh: serde_json::Value = serde_json::from_slice(
                &std::fs::read(root.join("content").join(path)).expect("read external mesh")
            ).expect("external mesh JSON");
            let id = mesh["texture"].as_str().expect("mesh texture ID");
            let (old, position) = *old_textures.entry(id.to_owned()).or_insert_with(|| {
                let (position, old) = assets.iter().enumerate()
                    .find(|(_, candidate)| candidate["id"] == mesh["texture"])
                    .expect("legacy linear texture lookup");
                comparisons_on_misses += position as u64 + 1;
                (old, position as u64 + 1)
            });
            let new = indexed_texture(&index, id).expect("indexed texture lookup");
            assert!(std::ptr::eq(old, new), "mesh {} changed descriptor", asset["id"]);
            assert_eq!(old["source"], new["source"], "mesh {} changed source", asset["id"]);
            old_comparisons += position;
            meshes += 1;
        }
        assert!(meshes > 0);
        eprintln!("NATIVE_ASSET_INDEX_DIFFERENTIAL {}", serde_json::json!({
            "assets":assets.len(), "mesh_source_matches":meshes, "distinct_mesh_textures":old_textures.len(),
            "old_linear_comparisons":old_comparisons, "legacy_reference_comparisons":comparisons_on_misses,
            "geometry_or_source_modified":false, "gpu_exercised":false
        }));
    }

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
    fn declared_post_passes_map_to_the_look_uniform_with_web_defaults() {
        let pipeline: unone_engine::RenderPipeline = serde_json::from_value(serde_json::json!({"version": 1, "passes": [
            {"id": "world", "kind": "scene"},
            {"id": "ao", "kind": "ao"},
            {"id": "haze", "kind": "fog", "params": {"mode": "linear", "color": "#ff0000", "start": 5, "end": 50}},
            {"id": "look", "kind": "grade", "params": {"saturation": 1.5}},
            {"id": "edge", "kind": "vignette", "enabled": false},
            {"id": "aa", "kind": "fxaa"}
        ]})).unwrap();
        let post = super::PipelineFrame::from_snapshot(&pipeline).post;
        assert_eq!(post.ao, Some(1.7), "absent params take the Web defaults");
        assert_eq!(post.fog.map(|fog| (fog.linear, fog.color, fog.start, fog.end)), Some((true, [1., 0., 0.], 5., 50.)));
        assert_eq!(post.grade.map(|grade| (grade.saturation, grade.contrast, grade.tint)), Some((1.5, 1., [1., 1., 1.])));
        assert!(post.vignette.is_none() && post.fxaa && post.bloom.is_none() && post.any());
        let look = post.look([0.5, 2., 0.1, 1000.], true);
        assert_eq!(&look[0..4], &[1., 0., 0., 2.], "fog colour and linear mode");
        assert_eq!(&look[4..8], &[0.02, 5., 50., 1.7], "fog density/start/end and AO strength");
        assert_eq!(look[11], 1., "grade on");
        assert_eq!(look[15], 0., "a disabled vignette has no strength");
        assert_eq!(&look[20..28], &[0.6, 0.1, 1000., 1., 0.5, 2., 0., 0.], "softness, near, far, depth, lens");
        assert_eq!(post.look([0.5, 2., 0.1, 1000.], false)[23], 0., "the 2D path has no depth for AO or fog");
        assert!(!super::PostSettings::default().any());
        // sRGB text converts to linear like three.js Color.set.
        let grey = super::linear_color("#808080").unwrap();
        assert!((grey[0] - 0.2158605).abs() < 1e-6, "{grey:?}");
        assert!(super::linear_color("808080").is_none() && super::linear_color("#80808").is_none());
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
    #[test]
    fn texture_admission_checks_budget_and_device_limits_before_pixel_materialization() {
        let mut bytes=Vec::new();
        {let mut encoder=png::Encoder::new(&mut bytes,2,2);encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);encoder.write_header().unwrap().write_image_data(&[255;16]).unwrap();}
        let (w,h,pixels)=super::decode_texture_bounded(&bytes,15,2).unwrap();
        assert_eq!((w,h),(2,2));assert!(pixels.is_none(),"pending budget must not allocate a retained decoded page");
        assert_eq!(super::decode_texture_bounded(&bytes,16,2).unwrap().2.unwrap().len(),16);
        assert!(super::decode_texture_bounded(&bytes,16,1).unwrap_err().contains("DIMENSIONS_UNSUPPORTED"));
        let svg=br#"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32"/></svg>"#;
        assert!(super::decode_texture_bounded(svg,1,1024).unwrap().2.is_none());
        assert!(super::texture_admitted(u32::MAX,u32::MAX,u64::MAX,u32::MAX).is_err());
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
            // TEXTURE_BINDING: AO and fog read the scene depth after the world pass.
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
        .create_view(&Default::default())
}

fn load_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    bytes: &[u8],
    max_bytes:u64,
) -> R<(Option<Arc<wgpu::BindGroup>>,u64,(u32,u32))> {
    let (width,height,rgba)=decode_texture_bounded(bytes,max_bytes,device.limits().max_texture_dimension_2d)?;
    let byte_length=u64::from(width)*u64::from(height)*4;
    let Some(rgba)=rgba else {return Ok((None,byte_length,(width,height)));};
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
    Ok((Some(Arc::new(device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("native-texture-bind-group"), layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&sampler) },
        ],
    }))),byte_length,(width,height)))
}

fn ensure_texture(device:&wgpu::Device,queue:&wgpu::Queue,layout:&wgpu::BindGroupLayout,
    catalog:&crate::sprite_resources::TextureCatalog,package:&Package,
    textures:&mut BTreeMap<String,Arc<wgpu::BindGroup>>,sizes:&mut BTreeMap<String,u64>,
    estimates:&mut BTreeMap<String,u64>,dims:&mut BTreeMap<String,(u32,u32)>,id:&str,max_bytes:u64)->R<Option<u64>> {
    // Always validate kind/id, including an asset already owned by a mesh.
    let source=catalog.texture_source(id)?;
    if estimates.get(id).is_some_and(|bytes|*bytes>max_bytes) {return Ok(None);}
    if textures.contains_key(id) {return Ok(sizes.get(id).copied().filter(|bytes|*bytes<=max_bytes));}
    let (texture,bytes,size)=load_texture(device,queue,layout,package.get(&format!("content/{source}"))?,max_bytes)?;
    estimates.insert(id.into(),bytes);dims.insert(id.into(),size);
    let Some(texture)=texture else {return Ok(None);};
    textures.insert(id.into(),texture);sizes.insert(id.into(),bytes);
    Ok(Some(bytes))
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
    let normals: [[f32; 3]; 6] = [[0., 0., -1.], [0., 0., 1.], [-1., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., -1., 0.]];
    let mut vertices = Vec::with_capacity(24 * 8);
    let mut indices = Vec::with_capacity(36);
    for (face, corners) in faces.into_iter().enumerate() {
        let base = (face * 4) as u32;
        for (corner, position) in corners.into_iter().enumerate() {
            vertices.extend_from_slice(&position);
            vertices.extend_from_slice(&uv[corner]);
            vertices.extend_from_slice(&normals[face]);
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
    let mut vertices = Vec::with_capacity(((RINGS + 1) * (SEGMENTS + 1) * 8) as usize);
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
                sin_phi * theta.cos(),
                phi.cos(),
                sin_phi * theta.sin(),
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
    let (width,height,pixels)=decode_texture_bounded(bytes,u64::MAX,u32::MAX)?;
    Ok((width,height,pixels.ok_or("NATIVE_TEXTURE_BUDGET_PENDING")?))
}
fn texture_admitted(width:u32,height:u32,max_bytes:u64,max_dimension:u32)->R<bool> {
    if width==0 || height==0 || width>max_dimension || height>max_dimension {
        return Err("NATIVE_TEXTURE_DIMENSIONS_UNSUPPORTED: image exceeds this GPU's texture limits".into());
    }
    let bytes=u64::from(width).checked_mul(u64::from(height)).and_then(|n|n.checked_mul(4))
        .ok_or("NATIVE_TEXTURE_DIMENSIONS_UNSUPPORTED: RGBA size overflow")?;
    Ok(bytes<=max_bytes)
}
/// Read dimensions before allocating pixels. A budget-pending page retains only
/// its scalar size estimate, not a decoded image or a GPU texture.
fn decode_texture_bounded(bytes:&[u8],max_bytes:u64,max_dimension:u32)->R<(u32,u32,Option<Vec<u8>>)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info().map_err(|e| format!("NATIVE_TEXTURE_DECODE_FAILED: {e}"))?;
        let (width,height)=(reader.info().width,reader.info().height);
        if !texture_admitted(width,height,max_bytes,max_dimension)? {return Ok((width,height,None));}
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
        return Ok((info.width, info.height, Some(rgba)));
    }

    // Keep the native route aligned with the Web texture contract for common
    // raster assets as well. `image` is only reached after the fast PNG path,
    // so the verified SVG policy below remains explicit and bounded.
    let source = match std::str::from_utf8(bytes) {
        Ok(source) if source.trim_start().starts_with('<') => source,
        _ => {
            let reader=image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format()
                .map_err(|e|format!("NATIVE_TEXTURE_DECODE_FAILED: {e}"))?;
            let (width,height)=reader.into_dimensions().map_err(|_|"NATIVE_TEXTURE_FORMAT_UNSUPPORTED: use PNG, JPEG, WebP, or static SVG")?;
            if !texture_admitted(width,height,max_bytes,max_dimension)? {return Ok((width,height,None));}
            let decoded = image::load_from_memory(bytes)
                .map_err(|_| "NATIVE_TEXTURE_FORMAT_UNSUPPORTED: use PNG, JPEG, WebP, or static SVG")?
                .to_rgba8();
            let (width, height) = decoded.dimensions();
            return Ok((width, height, Some(decoded.into_raw())));
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
    if !texture_admitted(size.width(),size.height(),max_bytes,max_dimension)? {
        return Ok((size.width(),size.height(),None));
    }
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size.width(), size.height())
        .ok_or("NATIVE_TEXTURE_SVG_TOO_LARGE")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());
    Ok((size.width(), size.height(), Some(pixmap.take())))
}
impl Renderer {
    pub fn projected_buffer_bytes(&self)->usize {self.projected.retained_bytes()}
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
    /// The window surface and device, for the startup screen's last frame and
    /// for the error screen of a game that stopped.
    pub fn target(&self) -> Target<'_> {
        Target { device: &self.device, queue: &self.queue, surface: &self.surface, config: &self.config }
    }
    pub async fn new(window: SharedWindow, package: &Package, memory_profile: WindowsGpuMemory) -> R<Self> {
        Self::with_gpu(Gpu::new(window, memory_profile).await?, package)
    }
    pub(crate) fn gpu_allocator_report(&self) -> Option<serde_json::Value> {
        let allocator = self.device.generate_allocator_report()?;
        Some(serde_json::json!({
            "reserved_bytes": allocator.total_reserved_bytes,
            "allocated_bytes": allocator.total_allocated_bytes,
            "block_count": allocator.blocks.len(),
            "startup_texture_allocations": allocator.allocations.iter().filter(|allocation| allocation.name == "startup screen").count(),
        }))
    }
    /// Builds the pipelines and package resources on a GPU context that may
    /// already have drawn the startup screen.
    pub fn with_gpu(gpu: Gpu, package: &Package) -> R<Self> {
        let Gpu { surface, adapter, device, queue, config, format, name, memory_profile } = gpu;
        // Explicit "antialias": true selects 4x MSAA for the world and sprite
        // passes, fixed until relaunch like the Web context option. An adapter
        // without 4x support for these formats keeps single sampling.
        let antialias = package
            .get("content/presentation.json")
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(bytes).ok())
            .and_then(|value| value.get("antialias").and_then(serde_json::Value::as_bool))
            .unwrap_or(false);
        let supports = |format: wgpu::TextureFormat| adapter.get_texture_format_features(format).flags.sample_count_supported(Msaa::SAMPLES);
        let samples = if antialias && supports(format) && supports(wgpu::TextureFormat::Depth32Float) { Msaa::SAMPLES } else { 1 };
        let msaa = (samples > 1).then(|| Msaa::new(&device, &config));
        let camera_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                // FRAGMENT: lit meshes turn their normals towards the camera.
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
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
        let lighting = crate::lighting::LightingGpu::new(&device, &queue, &texture_layout);
        let materials = crate::lighting::MaterialsGpu::new(&device);
        // Vertices are position, uv and normal (lighting::mesh_vertices).
        let pipeline=device.create_render_pipeline(&wgpu::RenderPipelineDescriptor{label:None,layout:Some(&device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor{label:None,bind_group_layouts:&[Some(&camera_layout),Some(&texture_layout),Some(&lighting.layout),Some(&materials.layout)],immediate_size:0})),vertex:wgpu::VertexState{module:&shader,entry_point:Some("vs"),buffers:&[Some(wgpu::VertexBufferLayout{array_stride:32,step_mode:wgpu::VertexStepMode::Vertex,attributes:&wgpu::vertex_attr_array![0=>Float32x3,1=>Float32x2,5=>Float32x3]}),Some(wgpu::VertexBufferLayout{array_stride:40,step_mode:wgpu::VertexStepMode::Instance,attributes:&wgpu::vertex_attr_array![2=>Float32x3,3=>Float32x4,4=>Float32x3]})],compilation_options:Default::default()},fragment:Some(wgpu::FragmentState{module:&shader,entry_point:Some("fs"),targets:&[Some(wgpu::ColorTargetState{format,blend:None,write_mask:wgpu::ColorWrites::ALL})],compilation_options:Default::default()}),primitive:wgpu::PrimitiveState{cull_mode:None,..Default::default()},depth_stencil:Some(wgpu::DepthStencilState{format:wgpu::TextureFormat::Depth32Float,depth_write_enabled:Some(true),depth_compare:Some(wgpu::CompareFunction::Less),stencil:Default::default(),bias:Default::default()}),multisample:wgpu::MultisampleState{count:samples,..Default::default()},multiview_mask:None,cache:None});
        let sky_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("native-sky"),
            layout: Some(&device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("native-sky"),
                bind_group_layouts: &[Some(&camera_layout), Some(&texture_layout), Some(&lighting.layout), Some(&materials.layout)],
                immediate_size: 0,
            })),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_sky"), buffers: &[], compilation_options: Default::default() },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_sky"),
                targets: &[Some(wgpu::ColorTargetState { format, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            // Drawn first, behind everything, writing no depth.
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::Always),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState { count: samples, ..Default::default() },
            multiview_mask: None,
            cache: None,
        });
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
                        array_stride: std::mem::size_of::<crate::sprites::Instance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &wgpu::vertex_attr_array![2=>Float32x2,3=>Float32x2,4=>Float32,5=>Float32,6=>Float32x4],
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
            multisample: wgpu::MultisampleState { count: samples, ..Default::default() },
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
        let assets_by_id = index_assets(assets)?;
        // .hdr data assets, kept for lighting.environment and decoded on demand.
        let mut environment_sources = BTreeMap::new();
        for asset in assets.iter().filter(|asset| asset["kind"] == "data") {
            if let (Some(id), Some(source)) = (asset["id"].as_str(), asset["source"].as_str())
                && source.to_ascii_lowercase().ends_with(".hdr")
            {
                environment_sources.insert(id.to_string(), package.get(&format!("content/{source}"))?.to_vec());
            }
        }
        let texture_catalog = crate::sprite_resources::TextureCatalog::new(assets)?;
        let mut meshes = BTreeMap::new();
        let mut textures: BTreeMap<String, Arc<wgpu::BindGroup>> = BTreeMap::new();
        let mut texture_bytes = BTreeMap::new();
        let mut texture_dims: BTreeMap<String,(u32,u32)> = BTreeMap::new();
        let mut lods = BTreeMap::new();
        for asset in assets {
            let kind = asset["kind"].as_str().unwrap_or("");
            if matches!(kind, "audio" | "spine" | "effekseer" | "data") {
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
            let normals = crate::lighting::vertex_normals(&positions, &indices);
            let vertices = crate::lighting::mesh_vertices(&positions, |i| [uvs[i * 2], 1. - uvs[i * 2 + 1]], &normals);
            let texture_id = value["texture"].as_str().ok_or("TEXTURE_ID_MISSING")?;
            // Many frame meshes may reference one atlas. Keep a single GPU
            // texture/bind group per declared texture rather than uploading an
            // atlas again for every frame's quad.
            let texture = if let Some(shared) = textures.get(texture_id) {
                shared.clone()
            } else {
            let texture = indexed_texture(&assets_by_id, texture_id)?;
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
            textures.insert(texture_id.to_owned(), texture.clone());
            texture_bytes.insert(texture_id.to_owned(),u64::from(texture_width)*u64::from(texture_height)*4);
            texture_dims.insert(texture_id.to_owned(),(texture_width,texture_height));
            texture
            };
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
                let normals = crate::lighting::vertex_normals(&l.positions, &l.indices);
                let vertices = crate::lighting::mesh_vertices(&l.positions, |n| [l.uvs[n * 2], 1. - l.uvs[n * 2 + 1]], &normals);
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
        // Mesh records hold their own shared bind groups. Preserve that existing
        // ownership; ordinary and prepared sprite assets are demand-loaded below.
        let persistent_textures=textures.keys().cloned().collect();
        let builtin_texture = solid_texture(&device, &queue, &texture_layout, [230, 236, 245, 255]);
        let white_texture = solid_texture(&device, &queue, &texture_layout, [255, 255, 255, 255]);
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
            Bloom::new(&device, format, config.width, config.height, &depth)
        });
        let particles = crate::particles::Particles::new(&device, format, &camera_layout, &texture_layout, white_texture.clone(), samples);
        let projected=crate::projected::Projected::new(&device,format,&texture_layout);
        let sprite_budget=crate::sprite_resources::Budget::from_plan(package.files.get("content/image-assets.json").map(Vec::as_slice))?;
        let texture_estimates=texture_bytes.clone();
        Ok(Self {
            memory_profile,
            projected,
            world_visible:true,
            render_pipeline: None,
            ui:crate::ui::Surface::new(&device,format,package)?,
            particles,
            lighting,
            msaa,
            materials,
            white_texture,
            sky_pipeline,
            environment_sources,
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
            heightfield_revisions: BTreeMap::new(),
            textures,
            texture_layout,
            texture_catalog,
            texture_bytes,
            texture_estimates,
            texture_dims,
            particle_textures: Default::default(),
            persistent_textures,
            sprite_resources:crate::sprite_resources::Resources::new(crate::sprite_resources::next_epoch(),sprite_budget),
            sprite_plan_revision:None,
            sprite_plan:Vec::new(),
            batches: BTreeMap::new(),
            entity_records: BTreeMap::new(),
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
        if let Some(msaa) = &mut self.msaa {
            msaa.resize(&self.device, &self.config);
        }
        if let Some(bloom) = &mut self.bloom {
            bloom.resize(&self.device, &self.queue, self.config.width, self.config.height, &self.depth);
        }
    }
    /// Upload incoming demand before retiring outgoing owners. No idle sprite
    /// cache is retained: Game chooses its live/prefetch demand through plans.
    pub fn sprite_plan_revision(&self)->Option<u64> {self.sprite_plan_revision}
    pub fn sync_sprite_resources(&mut self,s:&WorldSnapshot,update:unone_engine::SpriteResourcePlanUpdate,package:&Package)->R<()> {
        if let Some(plan)=update.resources {self.sprite_plan=plan;}
        self.sprite_plan_revision=Some(update.revision);
        self.particle_textures.extend(s.particles.iter().filter_map(|p|p.texture.clone()));
        let (device,queue,layout,catalog)=(&self.device,&self.queue,&self.texture_layout,&self.texture_catalog);
        let (textures,sizes,estimates,dims)=(&mut self.textures,&mut self.texture_bytes,&mut self.texture_estimates,&mut self.texture_dims);
        self.sprite_resources.reconcile(&self.sprite_plan,|id,limit|ensure_texture(device,queue,layout,catalog,package,textures,sizes,estimates,dims,id,limit));
        let mut needed=self.sprite_resources.ready_assets();
        needed.extend(self.persistent_textures.iter().cloned());
        for entity in s.entities.values().filter(|e|self.sprite_resources.drawable(e)) {
            if let Some(sprite)=&entity.sprite && sprite.visible {needed.insert(sprite.asset.clone());}
        }
        needed.extend(s.projected_geometry.values().map(|batch|batch.texture.clone()));
        needed.extend(self.particle_textures.iter().cloned());
        for id in &needed {ensure_texture(device,queue,layout,catalog,package,textures,sizes,estimates,dims,id,u64::MAX)?;}
        textures.retain(|id,_|needed.contains(id));
        sizes.retain(|id,_|needed.contains(id));
        Ok(())
    }
    pub fn sprite_feedback(&mut self,s:&WorldSnapshot)->unone_engine::PresentationResourceInput {
        self.sprite_resources.feedback(s)
    }
    pub fn sprite_resource_report(&self)->serde_json::Value {
        serde_json::json!({"resident_textures":self.textures.len(),"resident_rgba_bytes_estimate":self.texture_bytes.values().sum::<u64>(),
            "mesh_pinned_textures":self.persistent_textures.len(),"unused_sprite_cache_entries":0,
            "prepared":self.sprite_resources.report(),"known_image_size_entries":self.texture_estimates.len(),
            "managed_sprite_budget":{"max_bytes":self.sprite_resources.budget.max_bytes,"max_entries":self.sprite_resources.budget.max_entries},
            "managed_budget_excludes":"ordinary unprepared sprites, mesh/projected/UI owners and temporary incoming/outgoing overlap",
            "scope":"native world texture owners; excludes UI encoded images, render targets and driver/in-flight allocations",
            "readiness":"texture upload commands queued in current renderer epoch; submitted appearance requires successful surface draw submission"})
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
            material: None,
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
        self.world_visible=s.projected_world_visible;
        if !self.world_visible {
            self.is_2d=false;self.submitted=0;self.draws=0;self.triangles=0;self.uploaded=0;
            self.lod_counts=[0;4];self.lod_ms=0.;self.classify_ms=0.;self.upload_ms=0.;
            for b in self.batches.values_mut() {b.count=0;}
            self.presentation_batches=serde_json::json!([]);return self.prepare_sprites(s);
        }
        let removed: Vec<_> = self.heightfield_revisions.keys()
            .filter(|id| !s.heightfields.contains_key(*id)).cloned().collect();
        for id in removed {
            self.heightfield_revisions.remove(&id);
            self.meshes.remove(&format!("@heightfield:{id}"));
        }
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
        self.prepare_heightfields(s, &mut rows)?;
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
        // Mesh entities draw as one instanced batch per asset, like instance
        // batches: draws scale with distinct assets, not entity count.
        let mut groups = std::mem::take(&mut self.entity_records);
        for records in groups.values_mut() {
            records.clear();
        }
        for e in s.entities.values() {
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
                let bytes: &[u8] = bytemuck::cast_slice(&v);
                // One batch per asset and material, keyed "asset\u{1}material".
                let key = match &m.material {
                    Some(material) => format!("{}\u{1}{material}", m.asset),
                    None => m.asset.clone(),
                };
                match groups.get_mut(key.as_str()) {
                    Some(records) => records.extend_from_slice(bytes),
                    None => {
                        groups.insert(key, bytes.to_vec());
                    }
                }
            }
        }
        groups.retain(|_, records| !records.is_empty());
        for (key, records) in &groups {
            let (asset, material) = match key.split_once('\u{1}') {
                Some((asset, material)) => (asset, Some(material.to_string())),
                None => (key.as_str(), None),
            };
            let id = format!("entities:{key}");
            self.batch(&id, asset, records, 0)?;
            if let Some(batch) = self.batches.get_mut(&id) {
                batch.material = material;
            }
        }
        self.materials.update(&self.device, &self.queue, &s.materials);
        self.entity_records = groups;
        self.batches.retain(|_, b| b.count > 0);
        let c = s.camera3d.as_ref().ok_or("NATIVE_CAMERA3D_REQUIRED")?;
        if self.last_particle != Some((s.frame, view)) {
            self.particles
                .prepare(&self.device, &self.queue, &s.particles, c, &self.textures, &self.texture_dims);
            self.uploaded += self.particles.uploaded as u64;
            self.last_particle = Some((s.frame, view));
        }
        let wanted = s.lighting.as_ref().and_then(|lighting| lighting.environment.as_ref()).map(|environment| environment.map.as_str());
        if wanted != self.lighting.environment_key() {
            match wanted {
                Some(id) => {
                    let bytes = self.environment_sources.get(id).ok_or_else(|| {
                        format!("NATIVE_ENVIRONMENT_MAP_INVALID: lighting.environment.map '{id}' must be a declared data asset whose source is an .hdr file")
                    })?;
                    let (width, height, rgb) = crate::environment::decode_hdr(bytes)?;
                    let map = crate::environment::prepare(width, height, rgb);
                    self.lighting.set_environment(&self.device, &self.queue, Some((id, &map)));
                }
                None => self.lighting.set_environment(&self.device, &self.queue, None),
            }
        }
        self.lighting.update(&self.device, &self.queue, s.lighting.as_ref(), [c.target.x as f32, c.target.y as f32, c.target.z as f32]);
        let values = view.uniform();
        if self.last_view != Some(view) {
            self.queue
                .write_buffer(&self.camera, 0, bytemuck::cast_slice(&values));
            self.last_view = Some(view);
        }
        Ok(())
    }

    fn prepare_2d(&mut self, s: &WorldSnapshot) -> R<()> {
        if !s.heightfields.is_empty() {
            return Err("NATIVE_HEIGHTFIELD_CAMERA3D_REQUIRED: heightfields require a perspective camera".into());
        }
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

    fn prepare_heightfields(&mut self, s: &WorldSnapshot, rows: &mut Vec<serde_json::Value>) -> R<()> {
        for (id, field) in &s.heightfields {
            let asset = format!("@heightfield:{id}");
            let definition = field.definition();
            if self.heightfield_revisions.get(id) != Some(&field.revision()) {
                let texture = self.textures.get(&definition.texture).cloned()
                    .ok_or_else(|| format!("NATIVE_HEIGHTFIELD_TEXTURE_MISSING: {}", definition.texture))?;
                let mesh = field.mesh();
                let normals = crate::lighting::vertex_normals(&mesh.positions, &mesh.indices);
                // Heightfield UVs use image-row coordinates: v=0 is PNG top.
                let vertices = crate::lighting::mesh_vertices(&mesh.positions, |n| [mesh.uvs[n * 2], mesh.uvs[n * 2 + 1]], &normals);
                self.uploaded += (vertices.len() * 4 + mesh.indices.len() * 4) as u64;
                self.meshes.insert(asset.clone(), Mesh {
                    vertices: self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("heightfield-vertices"), contents: bytemuck::cast_slice(&vertices),
                        usage: wgpu::BufferUsages::VERTEX,
                    }),
                    indices: self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("heightfield-indices"), contents: bytemuck::cast_slice(&mesh.indices),
                        usage: wgpu::BufferUsages::INDEX,
                    }),
                    count: mesh.indices.len() as u32,
                    radius: mesh.positions.chunks_exact(3)
                        .map(|p| p.iter().map(|v| v * v).sum::<f32>().sqrt()).fold(0., f32::max),
                    texture,
                });
                self.heightfield_revisions.insert(id.clone(), field.revision());
            }
            let origin = definition.origin;
            let instance = [origin.x as f32, origin.y as f32, origin.z as f32,
                0., 0., 0., 1., 1., 1., 1.];
            self.batch(&format!("heightfield:{id}"), &asset, bytemuck::cast_slice(&instance), field.revision())?;
            rows.push(serde_json::json!({"id":id,"kind":"heightfield","revision":field.revision(),
                "samples":definition.heights.len(),"submitted_triangles":self.meshes[&asset].count / 3}));
        }
        Ok(())
    }

    fn prepare_sprites(&mut self, s: &WorldSnapshot) -> R<()> {
        let started = std::time::Instant::now();
        self.sprites.prepare_selected(&s.entities,|entity|self.sprite_resources.drawable(entity));
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
        if self.lighting.shadows && self.world_visible && self.pipeline_scene() {
            let mut pass = self.lighting.begin_shadow_pass(encoder);
            for b in self.batches.values() {
                let m = &self.meshes[&b.asset];
                pass.set_bind_group(1, &*m.texture, &[]);
                pass.set_vertex_buffer(0, m.vertices.slice(..));
                pass.set_vertex_buffer(1, b.buffers[b.slot].slice(..));
                pass.set_index_buffer(m.indices.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..m.count, 0, 0..b.count);
            }
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                // MSAA draws into its multisampled target and resolves to view.
                view: self.msaa.as_ref().map_or(view, |msaa| &msaa.color),
                depth_slice: None,
                resolve_target: self.msaa.as_ref().map(|_| view),
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(clear_color(self.config.format)),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: self.msaa.as_ref().map_or(&self.depth, |msaa| &msaa.depth),
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
        if self.lighting.background && self.world_visible && self.pipeline_scene() {
            pass.set_pipeline(&self.sky_pipeline);
            pass.set_bind_group(0, &self.camera_group, &[]);
            pass.set_bind_group(1, &*self.white_texture, &[]);
            pass.set_bind_group(2, &self.lighting.group, &[]);
            pass.set_bind_group(3, self.materials.group(None), &[]);
            pass.draw(0..3, 0..1);
            self.draws += 1;
        }
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.camera_group, &[]);
        pass.set_bind_group(2, &self.lighting.group, &[]);
        if self.world_visible && self.pipeline_scene() {
        for b in self.batches.values() {
            let m = &self.meshes[&b.asset];
            let primitive = b.asset.starts_with("mesh://primitive/");
            let texture = if primitive && b.material.is_some() { &self.white_texture } else { &m.texture };
            pass.set_bind_group(1, &**texture, &[]);
            pass.set_bind_group(3, self.materials.group(b.material.as_deref()), &[]);
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
        }
        drop(pass);
        if let Some(msaa) = &self.msaa {
            msaa.resolve_depth(encoder, &self.depth);
        }
    }
    fn draw_world_2d(&mut self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView) {
        self.draw_sprites_2d(encoder, view, true);
    }
    fn draw_sprites_2d(&mut self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView, clear: bool) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("native-2d-world"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                // MSAA draws into its multisampled target and resolves to view.
                view: self.msaa.as_ref().map_or(view, |msaa| &msaa.color),
                depth_slice: None,
                resolve_target: self.msaa.as_ref().map(|_| view),
                ops: wgpu::Operations {
                    load: if clear {
                        wgpu::LoadOp::Clear(clear_color(self.config.format))
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
        let runs = if self.pipeline_scene() { self.sprites.runs.len() } else { 0 };
        for run in &self.sprites.runs[..runs] {
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
        let frame = self.render_pipeline;
        if let Some(frame) = frame {
            let needs_post = frame.post.any();
            if needs_post && self.bloom.is_none() {
                self.bloom = Some(Bloom::new(&self.device, self.config.format, self.config.width, self.config.height, &self.depth));
            }
            let lens = self.lens();
            if let Some(bloom) = &mut self.bloom {
                bloom.configure(&self.queue, frame.post, lens, !self.is_2d);
            }
            if !needs_post {
                // The chain stays allocated for a later frame but is skipped.
                return self.draw_unprocessed(encoder, view, frame);
            }
        }
        if self.is_2d {
            if let Some(scene_view) = self.bloom.as_ref().map(|bloom| bloom.scene_view().clone()) {
                self.draw_world_2d(encoder, &scene_view);
                self.bloom.as_ref().unwrap().encode(encoder, view);
            } else {
                self.draw_world_2d(encoder, view);
            }
        } else {
            if let Some(scene_view) = self.bloom.as_ref().map(|bloom| bloom.scene_view().clone()) {
                self.draw_world(encoder, &scene_view);
                self.draw_sprites_2d(encoder, &scene_view, false);
                self.bloom.as_ref().unwrap().encode(encoder, view);
            } else {
                self.draw_world(encoder, view);
                self.draw_sprites_2d(encoder, view, false);
            }
        }
        self.finish_frame(encoder, view, frame);
    }
    /// A declared pipeline with no post pass this frame draws straight to the target.
    fn draw_unprocessed(&mut self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView, frame: PipelineFrame) {
        if self.is_2d {
            self.draw_world_2d(encoder, view);
        } else {
            self.draw_world(encoder, view);
            self.draw_sprites_2d(encoder, view, false);
        }
        self.finish_frame(encoder, view, Some(frame));
    }
    fn finish_frame(&mut self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView, frame: Option<PipelineFrame>) {
        if frame.is_none_or(|frame| frame.projected) {
            self.projected.draw(encoder,view,&self.depth,self.is_2d,self.config.width,self.config.height);
            self.draws+=self.projected.draws;self.triangles+=self.projected.triangles;
            self.submitted+=self.projected.draws;
        }
        if frame.is_none_or(|frame| frame.ui) && self.ui.draw(encoder,view){self.draws+=1;}
    }
    /// [tan(fov / 2), aspect, near, far] of the last 3D view, for AO and fog.
    fn lens(&self) -> [f32; 4] {
        self.last_view.map_or([1., 1., 0.1, 10000.], |view| {
            let values = view.uniform();
            [values[3], values[7], values[11], values[15]]
        })
    }
    fn pipeline_scene(&self) -> bool {
        self.render_pipeline.is_none_or(|frame| frame.scene)
    }
    pub fn render(&mut self, s: &WorldSnapshot, package: &Package) -> R<bool> {
        crate::ensure_shader_backend(s)?;
        self.render_pipeline = s.render_pipeline.as_ref().map(PipelineFrame::from_snapshot);
        let started = std::time::Instant::now();
        self.prepare(s)?;
        self.projected.prepare(&self.device,&self.queue,&self.textures,&s.projected_geometry)?;
        self.uploaded+=self.projected.uploaded;
        self.ui.prepare(&self.device,&self.queue,s.ui.as_deref(),self.config.width,self.config.height,package)?;
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
        let scene_drawn=self.world_visible && self.pipeline_scene();
        self.sprite_resources.submitted(s,scene_drawn);
        self.submit_ms = started.elapsed().as_secs_f64() * 1000.;
        let started = std::time::Instant::now();
        self.queue.present(output);
        self.present_ms = started.elapsed().as_secs_f64() * 1000.;
        Ok(true)
    }
    // Full geometry hashes are evidence for reports, not rendering work. In
    // particular, animated multi-megabyte batches must not be hashed at 60 Hz.
    pub fn presentation_report(&self,s:&WorldSnapshot)->serde_json::Value {
        let mut rows=self.presentation_batches.as_array().cloned().unwrap_or_default();
        rows.extend(crate::projected::rows(&s.projected_geometry));
        serde_json::Value::Array(rows)
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
