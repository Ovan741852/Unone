//! Host-owned UI raster surface and input routing; no game-specific actions.
use crate::{Package, R};
use base64::Engine;
use std::collections::{BTreeMap, VecDeque};
use unone_engine::{UiNode, UiTree};

fn leaves(tree: &UiTree) -> Vec<&UiNode> {
    let mut out = Vec::new();
    for n in &tree.children {
        n.leaf_nodes(&mut out);
    }
    out
}
#[derive(Default)]
pub struct PointerRouter {
    captures: BTreeMap<u64, Option<(String, String)>>,
    holds: BTreeMap<String, usize>,
    edges: VecDeque<(String, bool)>,
}
impl PointerRouter {
    pub fn captured(&self, id: u64) -> bool {
        self.captures.contains_key(&id)
    }
    pub fn down(&mut self, tree: Option<&UiTree>, id: u64, x: f64, y: f64) -> bool {
        if self.captures.contains_key(&id) {
            return true;
        }
        let hit = tree.and_then(|t| {
            leaves(t).into_iter().rev().find(|n| {
                let r = n.rect();
                x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height
            })
        });
        let Some(hit) = hit else {
            return false;
        };
        let action = if let UiNode::Button { id, action, .. } = hit {
            Some((id.clone(), action.clone()))
        } else {
            None
        };
        if let Some((_, a)) = &action {
            let n = self.holds.entry(a.clone()).or_default();
            if *n == 0 {
                self.edges.push_back((a.clone(), true));
            }
            *n += 1;
        }
        self.captures.insert(id, action);
        true
    }
    pub fn up(&mut self, id: u64) -> bool {
        let Some(value) = self.captures.remove(&id) else {
            return false;
        };
        if let Some((_, a)) = value {
            let n = self.holds.get_mut(&a).unwrap();
            *n -= 1;
            if *n == 0 {
                self.holds.remove(&a);
                self.edges.push_back((a, false));
            }
        }
        true
    }
    pub fn reconcile(&mut self, tree: Option<&UiTree>) {
        let nodes = tree.map(leaves).unwrap_or_default();
        let removed: Vec<_> = self
            .captures
            .iter()
            .filter_map(|(id, a)| {
                a.as_ref()
                    .filter(|(node, action)| {
                        !nodes.iter().any(
                            |n| matches!(n,UiNode::Button{id,action:a,..}if id==node&&a==action),
                        )
                    })
                    .map(|_| *id)
            })
            .collect();
        for id in removed {
            self.up(id);
            self.captures.insert(id, None);
        }
    }
    pub fn release_all(&mut self) {
        for id in self.captures.keys().copied().collect::<Vec<_>>() {
            self.up(id);
        }
    }
    pub fn next_edge(&mut self) -> Option<(String, bool)> {
        self.edges.pop_front()
    }
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
struct Rasterizer {
    images: BTreeMap<String, String>,
    options: resvg::usvg::Options<'static>,
    family: String,
}
impl Rasterizer {
    fn new(package: &Package) -> R<Self> {
        let mut options = resvg::usvg::Options::default();
        options.fontdb_mut().load_system_fonts();
        let presentation: serde_json::Value =
            serde_json::from_slice(package.get("content/presentation.json")?)
                .map_err(|e| e.to_string())?;
        if let Some(path) = presentation["ui"]["font_source"].as_str() {
            if !crate::safe(path) {
                return Err("UI_FONT_PATH_INVALID".into());
            }
            options
                .fontdb_mut()
                .load_font_data(package.get(&format!("content/{path}"))?.to_vec());
        }
        let family = presentation["ui"]["font_family"]
            .as_str()
            .unwrap_or("sans-serif")
            .to_owned();
        let assets: serde_json::Value = serde_json::from_slice(package.get("content/assets.json")?)
            .map_err(|e| e.to_string())?;
        let mut images = BTreeMap::new();
        for asset in assets["assets"]
            .as_array()
            .ok_or("UI_ASSET_MANIFEST_INVALID")?
        {
            if asset["kind"] != "texture2d" {
                continue;
            }
            let id = asset["id"].as_str().ok_or("UI_ASSET_ID_MISSING")?;
            let source = asset["source"].as_str().ok_or("UI_ASSET_SOURCE_MISSING")?;
            let bytes = package.get(&format!("content/{source}"))?;
            let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                "image/png"
            } else {
                continue;
            };
            images.insert(
                id.into(),
                format!(
                    "data:{mime};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                ),
            );
        }
        Ok(Self {
            images,
            options,
            family,
        })
    }
    fn draw(&self, tree: &UiTree, width: u32, height: u32) -> R<Vec<u8>> {
        let mut svg = format!(
            "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='{width}' height='{height}'>"
        );
        for (index, node) in leaves(tree).into_iter().enumerate() {
            let r = node.rect();
            let x = r.x * width as f64 / 100.;
            let y = (100. - r.y - r.height) * height as f64 / 100.;
            let w = r.width * width as f64 / 100.;
            let h = r.height * height as f64 / 100.;
            svg += &format!(
                "<defs><clipPath id='c{index}'><rect x='{x}' y='{y}' width='{w}' height='{h}'/></clipPath></defs><g clip-path='url(#c{index})'>"
            );
            match node {
                UiNode::Image { asset, fit, .. } => {
                    let uri=self.images.get(asset).ok_or_else(||format!("UI_IMAGE_UNAVAILABLE: {asset}; native UI requires a declared PNG companion"))?;
                    let aspect = match fit {
                        unone_engine::UiImageFit::Stretch => "none",
                        unone_engine::UiImageFit::Cover => "xMidYMid slice",
                        _ => "xMidYMid meet",
                    };
                    svg += &format!(
                        "<image x='{x}' y='{y}' width='{w}' height='{h}' preserveAspectRatio='{aspect}' xlink:href='{uri}'/>"
                    );
                }
                UiNode::Text { text, .. } | UiNode::Button { text, .. } => {
                    if !text.is_empty() {
                        if self.options.fontdb.faces().next().is_none() {
                            return Err("UI_FONT_UNAVAILABLE: package a licensed font via presentation.ui.font_source".into());
                        }
                        let lines: Vec<_> = text.lines().collect();
                        let size = (h / (lines.len().max(1) as f64 * 1.2)).min(h * 0.72);
                        for (i, line) in lines.iter().enumerate() {
                            let cy = y
                                + h / 2.
                                + (i as f64 - (lines.len() - 1) as f64 / 2.) * size * 1.2;
                            svg += &format!(
                                "<text x='{}' y='{cy}' text-anchor='middle' dominant-baseline='central' font-family='{}' font-size='{size}' fill='white'>{}</text>",
                                x + w / 2.,
                                escape(&self.family),
                                escape(line)
                            );
                        }
                    }
                }
                _ => {}
            }
            svg += "</g>";
        }
        svg += "</svg>";
        let tree = resvg::usvg::Tree::from_str(&svg, &self.options)
            .map_err(|e| format!("UI_RASTER_FAILED: {e}"))?;
        let mut pixmap =
            resvg::tiny_skia::Pixmap::new(width, height).ok_or("UI_SURFACE_SIZE_INVALID")?;
        resvg::render(
            &tree,
            resvg::tiny_skia::Transform::identity(),
            &mut pixmap.as_mut(),
        );
        let mut pixels = pixmap.take();
        for p in pixels.chunks_exact_mut(4) {
            let a = p[3] as u16;
            if a > 0 {
                for c in &mut p[..3] {
                    *c = ((*c as u16 * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
        Ok(pixels)
    }
}
pub struct Surface {
    raster: Rasterizer,
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    image: Option<(wgpu::Texture, wgpu::BindGroup)>,
    key: Vec<u8>,
    size: [u32; 2],
    visible: bool,
    pub raster_ms: f64,
    pub upload_bytes: u64,
}
impl Surface {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat, package: &Package) -> R<Self> {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ui"),
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
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ui"),
            source: wgpu::ShaderSource::Wgsl(include_str!("ui.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ui overlay"),
            layout: Some(
                &device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: None,
                    bind_group_layouts: &[Some(&layout)],
                    immediate_size: 0,
                }),
            ),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Ok(Self {
            raster: Rasterizer::new(package)?,
            pipeline,
            layout,
            sampler,
            image: None,
            key: Vec::new(),
            size: [0, 0],
            visible: false,
            raster_ms: 0.,
            upload_bytes: 0,
        })
    }
    pub fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        tree: Option<&UiTree>,
        width: u32,
        height: u32,
    ) -> R<()> {
        self.raster_ms = 0.;
        self.upload_bytes = 0;
        self.visible = tree.is_some();
        let Some(tree) = tree else {
            return Ok(());
        };
        let limit = 8192.min(device.limits().max_texture_dimension_2d);
        let width = width.clamp(1, limit);
        let height = height.clamp(1, limit);
        let key = serde_json::to_vec(tree).map_err(|e| e.to_string())?;
        if key == self.key && self.size == [width, height] {
            return Ok(());
        }
        let start = std::time::Instant::now();
        let pixels = self.raster.draw(tree, width, height)?;
        self.raster_ms = start.elapsed().as_secs_f64() * 1000.;
        if self.size != [width, height] {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("ui surface"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("ui surface"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(
                            &texture.create_view(&Default::default()),
                        ),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                ],
            });
            self.image = Some((texture, group));
        }
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.image.as_ref().unwrap().0,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width * 4),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.upload_bytes = pixels.len() as u64;
        self.key = key;
        self.size = [width, height];
        Ok(())
    }
    pub fn draw(&self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView) -> bool {
        if !self.visible {
            return false;
        }
        let Some((_, group)) = &self.image else {
            return false;
        };
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("ui"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, group, &[]);
        pass.draw(0..6, 0..1);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png_bytes(pixels: &[u8], w: u32, h: u32) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut e = png::Encoder::new(&mut out, w, h);
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            e.write_header().unwrap().write_image_data(pixels).unwrap();
        }
        out
    }
    #[test]
    #[ignore = "requires a native GPU and installed fonts; run explicitly on a verified host"]
    fn gpu_png_cjk_transparent_button_surface() {
        pollster::block_on(async {
            let package=Package{digest:String::new(),files:BTreeMap::from([
            ("content/assets.json".into(),br#"{"assets":[{"kind":"texture2d","id":"asset://red","source":"red.png"}]}"#.to_vec()),
            ("content/presentation.json".into(),b"{}".to_vec()),("content/red.png".into(),png_bytes(&[255,0,0,128],1,1))])};
            let adapter = wgpu::Instance::default()
                .request_adapter(&wgpu::RequestAdapterOptions::default())
                .await
                .unwrap();
            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor::default())
                .await
                .unwrap();
            let format = wgpu::TextureFormat::Rgba8UnormSrgb;
            let mut surface = Surface::new(&device, format, &package).unwrap();
            let tree=UiTree::from_json(serde_json::json!({"kind":"screen","id":"test","node":"test","children":[
            {"kind":"image","id":"art","asset":"asset://red","fit":"stretch","rect":{"x":0,"y":0,"width":50,"height":50}},
            {"kind":"button","id":"b","text":"","action":"Hold","rect":{"x":0,"y":0,"width":50,"height":50}},
            {"kind":"text","id":"cjk","text":"中文 Unone","rect":{"x":0,"y":60,"width":100,"height":30}}]})).unwrap();
            surface
                .prepare(&device, &queue, Some(&tree), 512, 256)
                .unwrap();
            assert!(surface.upload_bytes > 0);
            let size = wgpu::Extent3d {
                width: 512,
                height: 256,
                depth_or_array_layers: 1,
            };
            let target = device.create_texture(&wgpu::TextureDescriptor {
                label: None,
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: 512 * 256 * 4,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            let view = target.create_view(&Default::default());
            let mut encoder = device.create_command_encoder(&Default::default());
            {
                let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color {
                                r: 0.,
                                g: 0.,
                                b: 1.,
                                a: 1.,
                            }),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
            }
            assert!(surface.draw(&mut encoder, &view));
            encoder.copy_texture_to_buffer(
                target.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(2048),
                        rows_per_image: Some(256),
                    },
                },
                size,
            );
            let submission = queue.submit([encoder.finish()]);
            let (tx, rx) = std::sync::mpsc::channel();
            buffer
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |v| tx.send(v).unwrap());
            device
                .poll(wgpu::PollType::Wait {
                    submission_index: Some(submission),
                    timeout: Some(std::time::Duration::from_secs(10)),
                })
                .unwrap();
            rx.recv().unwrap().unwrap();
            let data = buffer.slice(..).get_mapped_range().unwrap();
            let pixel = &data[(200 * 512 + 50) * 4..][..4];
            assert!(
                pixel[0] > 170 && pixel[0] < 205 && pixel[2] > 170 && pixel[2] < 205,
                "alpha composited PNG: {pixel:?}"
            );
            assert!(
                data[..128 * 512 * 4]
                    .chunks_exact(4)
                    .filter(|p| p[0] > 180 && p[1] > 180)
                    .count()
                    > 100,
                "text must rasterize"
            );
            if let Some(path) = std::env::var_os("UNONE_UI_SMOKE_OUTPUT") {
                std::fs::write(path, png_bytes(&data, 512, 256)).unwrap();
            }
            drop(data);
            buffer.unmap();
            surface
                .prepare(&device, &queue, Some(&tree), 512, 256)
                .unwrap();
            assert_eq!(surface.upload_bytes, 0);
        });
    }
    #[test]
    fn pointer_short_press_and_removed_button_releases_but_keeps_capture() {
        let t=UiTree::from_json(serde_json::json!({"kind":"screen","id":"test","node":"test","children":[{"kind":"button","id":"hold","text":"","action":"Hold","rect":{"x":0,"y":0,"width":50,"height":50}}]})).unwrap();
        let mut p = PointerRouter::default();
        assert!(p.down(Some(&t), 1, 10., 10.));
        assert_eq!(p.next_edge(), Some(("Hold".into(), true)));
        p.reconcile(None);
        assert_eq!(p.next_edge(), Some(("Hold".into(), false)));
        assert!(p.up(1));
        assert!(p.next_edge().is_none());
        assert!(p.down(Some(&t), 1, 10., 10.));
        assert!(p.down(Some(&t), 2, 10., 10.));
        assert_eq!(p.next_edge(), Some(("Hold".into(), true)));
        assert!(p.up(1));
        assert!(p.next_edge().is_none());
        assert!(p.captured(2));
        p.release_all();
        assert_eq!(p.next_edge(), Some(("Hold".into(), false)));
        assert!(!p.captured(2));
    }
}
