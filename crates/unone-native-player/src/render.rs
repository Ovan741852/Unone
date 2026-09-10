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
    texture: wgpu::BindGroup,
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
pub struct Renderer {
    ui:crate::ui::Surface,
    particles: crate::particles::Particles,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    camera: wgpu::Buffer,
    camera_group: wgpu::BindGroup,
    depth: wgpu::TextureView,
    meshes: BTreeMap<String, Mesh>,
    batches: BTreeMap<String, Batch>,
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
    last_view: Option<crate::lod::View>,
    last_particle: Option<(u64, crate::lod::View)>,
    pub adapter: String,
    pub submitted: u64,
    pub draws: u64,
    pub uploaded: u64,
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
impl Renderer {
    pub fn cpu_phases(&self) -> [(&'static str, f64); 7] {
        [
            ("ui_raster",self.ui.raster_ms),
            ("prepare", self.prepare_ms),
            ("classify", self.classify_ms),
            ("instance_upload", self.upload_ms),
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
        let assets: serde_json::Value = serde_json::from_slice(package.get("content/assets.json")?)
            .map_err(|e| e.to_string())?;
        let assets = assets["assets"]
            .as_array()
            .ok_or("ASSET_MANIFEST_INVALID")?;
        let mut meshes = BTreeMap::new();
        let mut lods = BTreeMap::new();
        for asset in assets {
            let kind = asset["kind"].as_str().unwrap_or("");
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
            let bytes = package.get(&format!(
                "content/{}",
                texture["source"].as_str().ok_or("TEXTURE_SOURCE_MISSING")?
            ))?;
            let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
            if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                return Err(format!("NATIVE_MESH_TEXTURE_FORMAT_UNSUPPORTED: {}; mesh textures require PNG; SVG support is UI-only",texture["id"]));
            }
            decoder
                .set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
            let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
            let mut pixels = vec![0; reader.output_buffer_size().ok_or("TEXTURE_TOO_LARGE")?];
            let info = reader.next_frame(&mut pixels).map_err(|e| e.to_string())?;
            pixels.truncate(info.buffer_size());
            let rgba = match info.color_type {
                png::ColorType::Rgba => pixels,
                png::ColorType::Rgb => pixels
                    .chunks_exact(3)
                    .flat_map(|v| [v[0], v[1], v[2], 255])
                    .collect(),
                _ => return Err("NATIVE_TEXTURE_FORMAT_UNSUPPORTED: use RGB/RGBA PNG".into()),
            };
            let size = wgpu::Extent3d {
                width: info.width,
                height: info.height,
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
                    bytes_per_row: Some(info.width * 4),
                    rows_per_image: Some(info.height),
                },
                size,
            );
            let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                mag_filter: wgpu::FilterMode::Nearest,
                min_filter: wgpu::FilterMode::Nearest,
                ..Default::default()
            });
            let view = tex.create_view(&Default::default());
            let texture = device.create_bind_group(&wgpu::BindGroupDescriptor {
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
            });
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
        let depth = depth(&device, &config);
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
            last_view: None,
            last_particle: None,
            surface,
            device,
            queue,
            config,
            pipeline,
            camera,
            camera_group,
            depth,
            meshes,
            batches: BTreeMap::new(),
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
        self.submitted = 0;
        self.draws = 0;
        self.triangles = 0;
        self.lod_counts = [0; 4];
        self.uploaded = 0;
        self.classify_ms = 0.;
        self.upload_ms = 0.;
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
    fn draw(&mut self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView) {
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
                        r: 0.045,
                        g: 0.07,
                        b: 0.10,
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
            pass.set_bind_group(1, &m.texture, &[]);
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
