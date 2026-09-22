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
    image_sizes: BTreeMap<String, (f64, f64)>,
    options: resvg::usvg::Options<'static>,
    family: String,
}
// Deliberately static, self-contained SVG. Reject features that would otherwise
// disappear silently or resolve outside the hash-verified content package.
fn validate_svg(bytes: &[u8], options: &resvg::usvg::Options<'_>) -> R<()> {
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("UI_SVG_LIMIT: maximum 8 MiB".into());
    }
    let source = std::str::from_utf8(bytes).map_err(|e| format!("UI_SVG_INVALID: {e}"))?;
    let doc = roxmltree::Document::parse(source).map_err(|e| format!("UI_SVG_INVALID: {e}"))?;
    if doc.root_element().tag_name().name() != "svg" {
        return Err("UI_SVG_INVALID: expected svg root".into());
    }
    if doc.descendants().count() > 10000 {
        return Err("UI_SVG_LIMIT: maximum 10000 XML nodes".into());
    }
    for node in doc.descendants().filter(|n| n.is_element()) {
        let name = node.tag_name().name();
        if matches!(
            name,
            "script"
                | "foreignObject"
                | "animate"
                | "animateMotion"
                | "animateTransform"
                | "set"
                | "image"
                | "style"
        ) {
            return Err(format!(
                "UI_SVG_UNSUPPORTED: <{name}>; use static shapes/inline presentation attributes or a PNG companion"
            ));
        }
        for a in node.attributes() {
            if a.name().starts_with("on") {
                return Err(format!("UI_SVG_UNSUPPORTED: event attribute {}", a.name()));
            }
            if a.name() == "href" && !a.value().starts_with('#') {
                return Err("UI_SVG_EXTERNAL_RESOURCE: href must be an internal #id".into());
            }
            let value = a.value();
            if value.contains('\\') || value.to_ascii_lowercase().contains("@import") {
                return Err("UI_SVG_UNSUPPORTED: CSS escapes/imports".into());
            }
            let mut rest = value;
            while let Some(at) = rest.to_ascii_lowercase().find("url(") {
                rest = &rest[at + 4..];
                let end = rest.find(')').ok_or("UI_SVG_INVALID: unterminated url()")?;
                let url = rest[..end].trim().trim_matches(['\'', '"']);
                if !url.starts_with('#') {
                    return Err(
                        "UI_SVG_EXTERNAL_RESOURCE: url() must reference an internal #id".into(),
                    );
                }
                rest = &rest[end + 1..];
            }
        }
    }
    resvg::usvg::Tree::from_data(bytes, options).map_err(|e| format!("UI_SVG_INVALID: {e}"))?;
    Ok(())
}
impl Rasterizer {
    fn new(package: &Package) -> R<Self> {
        let mut options = resvg::usvg::Options::default();
        options.image_href_resolver.resolve_string = Box::new(|_, _| None);
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
        let mut image_sizes = BTreeMap::new();
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
                let reader = png::Decoder::new(std::io::Cursor::new(bytes))
                    .read_info()
                    .map_err(|e| format!("UI_IMAGE_INVALID: asset={id}; {e}"))?;
                image_sizes.insert(
                    id.to_string(),
                    (reader.info().width as f64, reader.info().height as f64),
                );
                "image/png"
            } else if source.to_ascii_lowercase().ends_with(".svg") {
                validate_svg(bytes, &options)
                    .map_err(|e| format!("{e}; asset={id}; source={source}"))?;
                let tree =
                    resvg::usvg::Tree::from_data(bytes, &options).map_err(|e| e.to_string())?;
                image_sizes.insert(
                    id.to_string(),
                    (tree.size().width() as f64, tree.size().height() as f64),
                );
                "image/svg+xml"
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
            image_sizes,
            options,
            family,
        })
    }
    fn draw(&self, tree: &UiTree, width: u32, height: u32) -> R<Vec<u8>> {
        let mut svg = format!(
            "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='{width}' height='{height}'>"
        );
        let mut defined_images = BTreeMap::new();
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
                UiNode::Image {
                    asset,
                    fit,
                    slice,
                    id,
                    ..
                } => {
                    let uri=self.images.get(asset).ok_or_else(||format!("UI_IMAGE_UNAVAILABLE: {asset}; native UI accepts PNG or self-contained static SVG"))?;
                    if let Some(slice) = slice {
                        let (iw, ih) = self.image_sizes[asset];
                        let patches = slice
                            .patches(iw, ih, w, h, height as f64)
                            .map_err(|e| format!("{e}; node={id}; asset={asset}"))?;
                        let image_id = if let Some(index) = defined_images.get(asset) {
                            *index
                        } else {
                            let index = defined_images.len();
                            defined_images.insert(asset, index);
                            svg += &format!(
                                "<defs><image id='slice{index}' width='{iw}' height='{ih}' xlink:href='{uri}'/></defs>"
                            );
                            index
                        };
                        for (s, d) in patches {
                            svg += &format!(
                                "<svg x='{}' y='{}' width='{}' height='{}' viewBox='{} {} {} {}' preserveAspectRatio='none' overflow='hidden'><use xlink:href='#slice{image_id}'/></svg>",
                                x + d.x,
                                y + d.y,
                                d.width,
                                d.height,
                                s.x,
                                s.y,
                                s.width,
                                s.height
                            );
                        }
                        svg += "</g>";
                        continue;
                    }
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
    #[test]
    fn nine_slice_pixels_and_budget_benchmark() {
        let colors = [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [255, 255, 0, 255],
            [255, 0, 255, 255],
            [0, 255, 255, 255],
            [128, 0, 0, 255],
            [0, 128, 0, 255],
            [0, 0, 128, 255],
        ];
        let mut pixels = Vec::new();
        for y in 0..9 {
            for x in 0..9 {
                pixels.extend_from_slice(&colors[(y / 3) * 3 + x / 3]);
            }
        }
        let package=Package{digest:String::new(),files:BTreeMap::from([
            ("content/assets.json".into(),br#"{"assets":[{"kind":"texture2d","id":"texture://nine","source":"nine.png"}]}"#.to_vec()),
            ("content/presentation.json".into(),b"{}".to_vec()),("content/nine.png".into(),png_bytes(&pixels,9,9))])};
        let raster = Rasterizer::new(&package).unwrap();
        let svg_colors = [
            "red", "lime", "blue", "yellow", "magenta", "cyan", "maroon", "green", "navy",
        ];
        let mut svg = String::from("<svg xmlns='http://www.w3.org/2000/svg' width='9' height='9'>");
        for (i, color) in svg_colors.iter().enumerate() {
            svg += &format!(
                "<rect x='{}' y='{}' width='3' height='3' fill='{color}'/>",
                i % 3 * 3,
                i / 3 * 3
            );
        }
        svg += "</svg>";
        let svg_package = Package { digest:String::new(), files:BTreeMap::from([
            ("content/assets.json".into(),br#"{"assets":[{"kind":"texture2d","id":"texture://nine","source":"nine.svg"}]}"#.to_vec()),
            ("content/presentation.json".into(),b"{}".to_vec()), ("content/nine.svg".into(),svg.into_bytes())]) };
        let svg_raster = Rasterizer::new(&svg_package).unwrap();
        let value = serde_json::json!({"kind":"screen","id":"s","node":"s","children":[{"kind":"image","id":"nine","asset":"texture://nine","rect":{"x":0,"y":0,"width":100,"height":100},"slice":{"left":3,"top":3,"right":3,"bottom":3,"pixels_per_unit":1}}]});
        let tree = UiTree::from_json(value).unwrap();
        for (format, renderer) in [("png", &raster), ("svg", &svg_raster)] {
            for (w, h) in [(300, 100), (100, 300), (600, 200)] {
                let result = renderer.draw(&tree, w, h).unwrap();
                let edge = 3 * h / 100;
                let xs = [edge / 2, w / 2, w - edge / 2 - 1];
                let ys = [edge / 2, h / 2, h - edge / 2 - 1];
                for (row, y) in ys.into_iter().enumerate() {
                    for (col, x) in xs.into_iter().enumerate() {
                        // resvg's filtered PNG sampling can round a channel by a few
                        // levels at 2x scale; geometry is checked exactly in Core.
                        let p = &result[((y * w + x) * 4) as usize..][..4];
                        assert!(
                            p.iter()
                                .zip(colors[row * 3 + col])
                                .all(|(a, b)| a.abs_diff(b) <= 3),
                            "{w}x{h} at {x},{y}: {p:?}"
                        );
                    }
                }
                if let Ok(out) = std::env::var("UNONE_UI_EVIDENCE_DIR") {
                    std::fs::create_dir_all(&out).unwrap();
                    std::fs::write(
                        std::path::Path::new(&out)
                            .join(format!("native-nine-{format}-{w}x{h}.png")),
                        png_bytes(&result, w, h),
                    )
                    .unwrap();
                }
            }
        }
        let mut results = Vec::new();
        for n in [256, 2048, 4096] {
            let mut value = serde_json::to_value(&tree).unwrap();
            value["budget"] = serde_json::json!({"max_nodes":n});
            value["children"]=serde_json::Value::Array((0..n).map(|i|{let mut node=value["children"][0].clone();node["id"]=format!("p{i}").into();node["rect"]=serde_json::json!({"x":(i%50)as f64*2.0,"y":(i/50%50)as f64*2.0,"width":2,"height":2});node}).collect());
            let start = std::time::Instant::now();
            let tree = UiTree::from_json(value).unwrap();
            let validation_ms = start.elapsed().as_secs_f64() * 1000.0;
            let start = std::time::Instant::now();
            raster.draw(&tree, 300, 300).unwrap();
            let raster_ms = start.elapsed().as_secs_f64() * 1000.0;
            results.push(serde_json::json!({"nodes":n,"validation_ms":validation_ms,"raster_ms":raster_ms,"profile":if cfg!(debug_assertions){"debug"}else{"release"},"note":"CPU full redraw; overlapping stress fixture; not a 60fps claim"}));
        }
        eprintln!("UI_BENCHMARK {}", serde_json::to_string(&results).unwrap());
        if let Ok(out) = std::env::var("UNONE_UI_EVIDENCE_DIR") {
            std::fs::write(
                std::path::Path::new(&out).join("native-benchmark.json"),
                serde_json::to_vec_pretty(&results).unwrap(),
            )
            .unwrap();
        }
    }
    #[test]
    fn svg_static_validation_and_scaled_pixels() {
        let svg=br##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="20" height="10" fill="url(#g)" opacity="0.5"/></svg>"##;
        let package = Package {
            digest: String::new(),
            files: BTreeMap::from([
                (
                    "content/assets.json".into(),
                    br#"{"assets":[{"kind":"texture2d","id":"asset://svg","source":"art.svg"}]}"#
                        .to_vec(),
                ),
                ("content/presentation.json".into(), b"{}".to_vec()),
                ("content/art.svg".into(), svg.to_vec()),
            ]),
        };
        let raster = Rasterizer::new(&package).unwrap();
        let tree=UiTree::from_json(serde_json::json!({"kind":"screen","id":"t","node":"t","children":[{"kind":"image","id":"a","asset":"asset://svg","fit":"stretch","rect":{"x":0,"y":0,"width":100,"height":100}}]})).unwrap();
        for (w, h) in [(80, 40), (320, 160)] {
            let pixels = raster.draw(&tree, w, h).unwrap();
            let left = &pixels[((h / 2 * w + w / 8) * 4) as usize..][..4];
            let right = &pixels[((h / 2 * w + w * 7 / 8) * 4) as usize..][..4];
            assert!(
                left[0] > 180 && left[2] < 80 && (120..=135).contains(&left[3]),
                "{left:?}"
            );
            assert!(right[2] > 180 && right[0] < 80, "{right:?}");
        }
        for source in [
            "<svg>",
            r#"<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="file.svg#x"/></svg>"#,
            r#"<!DOCTYPE svg [<!ENTITY a "expanded">]><svg><text>&a;</text></svg>"#,
            "<svg><script/></svg>",
            "<svg><animate/></svg>",
            "<svg><use href='file.svg#x'/></svg>",
            "<svg><rect fill='url(file:///secret)'/></svg>",
            "<svg><style>@import 'x';</style></svg>",
            "<svg><image href='data:image/svg+xml;base64,AAA'/></svg>",
        ] {
            assert!(
                validate_svg(source.as_bytes(), &raster.options).is_err(),
                "{source}"
            );
        }
    }
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
