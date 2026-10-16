//! Host-owned UI raster surface and input routing; no game-specific actions.
use crate::{Package, R};
use base64::Engine;
use std::collections::{BTreeMap, VecDeque};
use unicode_script::{Script, UnicodeScript};
use unicode_segmentation::UnicodeSegmentation;
use unone_engine::{
    SliderInteraction, SliderPhase, UiNode, UiRect, UiSliderAxis, UiSliderDrag, UiStyle,
    UiTextAlign, UiTextOverflow, UiTextWrap, UiTree, UiVerticalAlign,
};

fn leaves(tree: &UiTree) -> Vec<&UiNode> {
    let mut out = Vec::new();
    for n in &tree.children {
        n.leaf_nodes(&mut out);
    }
    out
}
#[derive(Default)]
pub struct PointerRouter {
    captures: BTreeMap<u64, Capture>,
    holds: BTreeMap<String, usize>,
    edges: VecDeque<(String, bool)>,
    slider_events: VecDeque<(String, SliderInteraction)>,
    slider_active: BTreeMap<String, f64>,
    slider_consumed_active: BTreeMap<String, f64>,
    error: Option<String>,
}
enum Capture {
    Action { node: String, action: String },
    Slider { node: String, rect: UiRect, drag: UiSliderDrag, ratio: f64 },
    Suppressed,
}
fn slider_ratio(drag: &UiSliderDrag, x: f64, y: f64) -> f64 {
    let r = drag.track_rect;
    let value = match drag.axis {
        UiSliderAxis::Horizontal => (x - r.x) / r.width,
        UiSliderAxis::Vertical => (y - r.y) / r.height,
    }.clamp(0.0, 1.0);
    if drag.reverse { 1.0 - value } else { value }
}
impl PointerRouter {
    fn queue_slider(&mut self, node: String, phase: SliderPhase, ratio: f64) {
        if phase == SliderPhase::Drag
            && let Some((last_id, last)) = self.slider_events.back_mut()
            && *last_id == node && last.phase == SliderPhase::Drag
        {
            last.ratio = ratio;
            self.slider_active.insert(node, ratio);
            return;
        }
        let new_id = !self.slider_active.contains_key(&node) && !self.slider_consumed_active.contains_key(&node);
        let active_count = self.slider_active.keys().chain(self.slider_consumed_active.keys())
            .collect::<std::collections::BTreeSet<_>>().len();
        if self.slider_events.len() >= 256 || (new_id && active_count >= 256) {
            self.reset_sliders();
            self.error = Some("UI_SLIDER_QUEUE_FULL: release pointers and retry".into());
            return;
        }
        if matches!(phase, SliderPhase::Start | SliderPhase::Drag) { self.slider_active.insert(node.clone(), ratio); }
        else { self.slider_active.remove(&node); }
        self.slider_events.push_back((node, SliderInteraction { phase, ratio }));
    }
    fn reset_sliders(&mut self) {
        let mut active = self.slider_consumed_active.clone();
        active.extend(self.slider_active.iter().map(|(id, ratio)| (id.clone(), *ratio)));
        self.slider_events.clear();
        self.slider_active.clear();
        for (id, ratio) in active { self.slider_events.push_back((id, SliderInteraction { phase: SliderPhase::Cancel, ratio })); }
    }
    pub fn take_error(&mut self) -> Option<String> { self.error.take() }
    pub fn captured(&self, id: u64) -> bool {
        self.captures.contains_key(&id)
    }
    pub fn down(&mut self, tree: Option<&UiTree>, id: u64, x: f64, y: f64) -> bool {
        if self.captures.contains_key(&id) {
            return true;
        }
        let hit = tree.and_then(|t| {
            leaves(t).into_iter().rev().find(|n| {
                let r = match n { UiNode::Slider { drag: Some(drag), .. } => &drag.hit_rect, _ => n.rect() };
                matches!(n, UiNode::Button { .. } | UiNode::ComboBox { .. } | UiNode::Slider { drag: Some(_), .. })
                    && x >= r.x
                    && y >= r.y
                    && x < r.x + r.width
                    && y < r.y + r.height
            })
        });
        let Some(hit) = hit else {
            return false;
        };
        if let UiNode::Slider { id: node, rect, drag: Some(drag), .. } = hit {
            if !drag.enabled || self.captures.values().any(|c| matches!(c, Capture::Slider { node: owner, .. } if owner == node)) {
                self.captures.insert(id, Capture::Suppressed);
            } else {
                let ratio = slider_ratio(drag, x, y);
                self.captures.insert(id, Capture::Slider { node: node.clone(), rect: *rect, drag: drag.clone(), ratio });
                self.queue_slider(node.clone(), SliderPhase::Start, ratio);
            }
            return true;
        }
        if let UiNode::Button { id: node, action, .. } | UiNode::ComboBox { id: node, action, .. } = hit {
            let n = self.holds.entry(action.clone()).or_default();
            if *n == 0 {
                self.edges.push_back((action.clone(), true));
            }
            *n += 1;
            self.captures.insert(id, Capture::Action { node: node.clone(), action: action.clone() });
        }
        true
    }
    fn release(&mut self, id: u64, phase: SliderPhase) -> bool {
        let Some(value) = self.captures.remove(&id) else {
            return false;
        };
        if let Capture::Slider { node, ratio, .. } = value {
            self.queue_slider(node, phase, ratio);
        } else if let Capture::Action { action: a, .. } = value {
            let n = self.holds.get_mut(&a).unwrap();
            *n -= 1;
            if *n == 0 {
                self.holds.remove(&a);
                self.edges.push_back((a, false));
            }
        }
        true
    }
    pub fn up(&mut self, id: u64) -> bool { self.release(id, SliderPhase::End) }
    pub fn cancel(&mut self, id: u64) -> bool { self.release(id, SliderPhase::Cancel) }
    pub fn move_pointer(&mut self, id: u64, x: f64, y: f64) -> bool {
        if let Some(Capture::Slider { node, drag, ratio, .. }) = self.captures.get_mut(&id) {
            if x.is_finite() && y.is_finite() {
                *ratio = slider_ratio(drag, x, y);
                let event = (node.clone(), *ratio);
                self.queue_slider(event.0, SliderPhase::Drag, event.1);
            }
        }
        self.captured(id)
    }
    pub fn up_at(&mut self, id: u64, x: f64, y: f64) -> bool {
        if x.is_finite() && y.is_finite()
            && let Some(Capture::Slider { drag, ratio, .. }) = self.captures.get_mut(&id)
        { *ratio = slider_ratio(drag, x, y); }
        self.up(id)
    }
    pub fn reconcile(&mut self, tree: Option<&UiTree>) {
        let nodes = tree.map(leaves).unwrap_or_default();
        let removed: Vec<_> = self
            .captures
            .iter()
            .filter_map(|(id, capture)| {
                let valid = match capture {
                    Capture::Action { node, action } => nodes.iter().any(
                        |n| matches!(n,UiNode::Button{id,action:a,..}|UiNode::ComboBox{id,action:a,..}if id==node&&a==action)),
                    Capture::Slider { node, rect, drag, .. } => nodes.iter().any(
                        |n| matches!(n,UiNode::Slider{id,rect:r,drag:Some(d),..}if id==node&&r==rect&&d==drag&&d.enabled)),
                    Capture::Suppressed => true,
                };
                (!valid).then_some(*id)
            })
            .collect();
        for id in removed {
            self.cancel(id);
            self.captures.insert(id, Capture::Suppressed);
        }
    }
    pub fn release_all(&mut self) {
        for id in self.captures.keys().copied().collect::<Vec<_>>() {
            self.cancel(id);
        }
    }
    /// Drop stale queued presses but deliver cancellation to controls whose
    /// start/drag has already reached the simulation, even after physical up.
    pub fn reset(&mut self) {
        self.slider_events.clear();
        self.release_all();
        self.edges.clear();
        self.holds.clear();
        self.reset_sliders();
    }
    /// At most one transition per control per successful tick. Quick taps
    /// remain Start then End; adjacent Drag events coalesce before this step.
    pub fn drain_sliders(&mut self) -> BTreeMap<String, SliderInteraction> {
        let mut frame = BTreeMap::new();
        let mut remaining = VecDeque::new();
        while let Some((id, event)) = self.slider_events.pop_front() {
            if frame.contains_key(&id) { remaining.push_back((id, event)); continue; }
            if matches!(event.phase, SliderPhase::Start | SliderPhase::Drag) {
                self.slider_consumed_active.insert(id.clone(), event.ratio);
            } else { self.slider_consumed_active.remove(&id); }
            frame.insert(id, event);
        }
        self.slider_events = remaining;
        frame
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

fn load_font(
    options: &mut resvg::usvg::Options<'_>,
    package: &Package,
    path: &str,
    alias: Option<(&str, u16)>,
) -> R<()> {
    if !crate::safe(path) {
        return Err("UI_FONT_PATH_INVALID".into());
    }
    let bytes = package.get(&format!("content/{path}"))?;
    if !(bytes.starts_with(b"\0\x01\0\0")
        || bytes.starts_with(b"OTTO")
        || (alias.is_none() && bytes.starts_with(b"ttcf")))
    {
        return Err(format!(
            "UI_FONT_FORMAT_UNSUPPORTED: {path}; package a TTF or OTF font"
        ));
    }
    let db = options.fontdb_mut();
    let ids = db.load_font_source(resvg::usvg::fontdb::Source::Binary(std::sync::Arc::new(
        bytes.to_vec(),
    )));
    if ids.is_empty() {
        return Err(format!("UI_FONT_INVALID: {path}; no readable font faces"));
    }
    if let Some((family, weight)) = alias {
        for id in ids {
            let mut face = db.face(id).expect("just loaded font face").clone();
            face.families = vec![(
                family.to_owned(),
                resvg::usvg::fontdb::Language::English_UnitedStates,
            )];
            face.weight = resvg::usvg::fontdb::Weight(weight);
            db.remove_face(id);
            db.push_face_info(face);
        }
    }
    Ok(())
}

fn rgba(color: [f64; 4]) -> String {
    format!(
        "rgb({},{},{})",
        color[0] * 255.,
        color[1] * 255.,
        color[2] * 255.
    )
}

fn text_tag(text: &str, family: &str, size: f64, weight: u16, spacing: f64) -> String {
    format!(
        "<text x='0' y='0' xml:space='preserve' font-family='{}' font-size='{size}' font-weight='{weight}' letter-spacing='{spacing}'>{}</text>",
        escape(family),
        escape(text)
    )
}

/// Use the same shaped text that resvg will rasterize, including fallback faces
/// and spacing, rather than estimating line width from character count.
fn measure_text(
    options: &resvg::usvg::Options<'_>,
    text: &str,
    family: &str,
    size: f64,
    weight: u16,
    spacing: f64,
) -> R<f64> {
    if text.is_empty() {
        return Ok(0.);
    }
    let source = format!(
        "<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'>{}</svg>",
        text_tag(text, family, size, weight, spacing)
    );
    let tree = resvg::usvg::Tree::from_str(&source, options)
        .map_err(|e| format!("UI_TEXT_LAYOUT_FAILED: {e}"))?;
    Ok(tree
        .root()
        .children()
        .first()
        .map_or(0., |node| node.bounding_box().width() as f64))
}

fn fit_prefix<F: FnMut(&str) -> R<f64>>(text: &str, width: f64, measure: &mut F) -> R<usize> {
    let ends: Vec<_> = text
        .grapheme_indices(true)
        .map(|(at, g)| at + g.len())
        .collect();
    let (mut low, mut high) = (0, ends.len());
    while low < high {
        let mid = (low + high).div_ceil(2);
        if measure(&text[..ends[mid - 1]])? <= width {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    Ok(if low == 0 { 0 } else { ends[low - 1] })
}

fn wrap_lines<F: FnMut(&str) -> R<f64>>(
    text: &str,
    width: f64,
    wrap: bool,
    measure: &mut F,
) -> R<Vec<String>> {
    let mut out = Vec::new();
    for paragraph in text.split('\n') {
        let mut rest = paragraph.trim_end_matches('\r');
        if !wrap || rest.is_empty() {
            out.push(rest.to_owned());
            continue;
        }
        while !rest.is_empty() {
            let fit = fit_prefix(rest, width, measure)?;
            if fit == rest.len() {
                out.push(rest.trim_end().to_owned());
                break;
            }
            let fit = if fit == 0 {
                rest.graphemes(true).next().unwrap().len()
            } else {
                fit
            };
            let cjk = |text: &str| {
                text.chars().any(|c| {
                    matches!(
                        c.script(),
                        Script::Han | Script::Hiragana | Script::Katakana | Script::Hangul
                    )
                })
            };
            let boundary = rest[..fit]
                .grapheme_indices(true)
                .rev()
                .find_map(|(at, g)| {
                    let end = at + g.len();
                    (g.chars().any(char::is_whitespace)
                        || cjk(g)
                        || cjk(rest[end..].graphemes(true).next().unwrap_or("")))
                    .then_some(end)
                });
            let end = boundary.unwrap_or(fit);
            out.push(rest[..end].trim_end().to_owned());
            rest = rest[end..].trim_start();
        }
    }
    Ok(out)
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
        let presentation: serde_json::Value =
            serde_json::from_slice(package.get("content/presentation.json")?)
                .map_err(|e| e.to_string())?;
        if let Some(path) = presentation["ui"]["font_source"].as_str() {
            load_font(&mut options, package, path, None)?;
        }
        if let Some(fonts) = presentation["ui"]["fonts"].as_array() {
            let mut pairs = std::collections::BTreeSet::new();
            for font in fonts {
                let family = font["family"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty())
                    .ok_or("UI_FONT_INVALID: fonts[].family is required")?;
                let source = font["source"]
                    .as_str()
                    .ok_or("UI_FONT_INVALID: fonts[].source is required")?;
                let weight = font
                    .get("weight")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(400);
                if !(100..=900).contains(&weight) || !pairs.insert((family.to_owned(), weight)) {
                    return Err("UI_FONT_INVALID: catalog family/weight pairs must be unique; weights are integers from 100 to 900".into());
                }
                load_font(&mut options, package, source, Some((family, weight as u16)))?;
            }
        }
        // Project faces take precedence over installed fonts with the same name.
        options.fontdb_mut().load_system_fonts();
        let family = presentation["ui"]["font_family"]
            .as_str()
            .or_else(|| presentation["ui"]["fonts"][0]["family"].as_str())
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

    fn styled_text(
        &self,
        svg: &mut String,
        text: &str,
        style: &UiStyle,
        rect: [f64; 4],
        unit: f64,
    ) -> R<()> {
        if text.is_empty() {
            return Ok(());
        }
        if self.options.fontdb.faces().next().is_none() {
            return Err(
                "UI_FONT_UNAVAILABLE: package a licensed font via presentation.ui.fonts".into(),
            );
        }
        let [x, y, w, h] = rect;
        if w <= 0. || h <= 0. {
            return Ok(());
        }
        let family = style.font_family.as_deref().unwrap_or(&self.family);
        let size = style.font_size.unwrap_or(2.) * unit;
        let weight = style.font_weight.unwrap_or(400);
        let spacing = style.letter_spacing.unwrap_or(0.) * unit;
        let line_height = size * style.line_height.unwrap_or(1.2);
        let mut measure =
            |value: &str| measure_text(&self.options, value, family, size, weight, spacing);
        let mut lines = wrap_lines(text, w, style.wrap == Some(UiTextWrap::Word), &mut measure)?;
        if style.overflow == Some(UiTextOverflow::Ellipsis) {
            for line in &mut lines {
                if measure(line)? > w {
                    let ellipsis = "…";
                    if measure(ellipsis)? > w {
                        line.clear();
                        continue;
                    }
                    let mut fit = fit_prefix(line, w - measure(ellipsis)?, &mut measure)?;
                    // Kerning can make a combined suffix differ from isolated widths.
                    while fit > 0 && measure(&format!("{}…", &line[..fit]))? > w {
                        fit = line[..fit]
                            .grapheme_indices(true)
                            .next_back()
                            .map_or(0, |(at, _)| at);
                    }
                    *line = format!("{}…", line[..fit].trim_end());
                }
            }
        }
        let block_height = lines.len() as f64 * line_height;
        let top = match style.vertical_align.unwrap_or(UiVerticalAlign::Middle) {
            UiVerticalAlign::Top => y,
            UiVerticalAlign::Middle => y + (h - block_height) / 2.,
            UiVerticalAlign::Bottom => y + h - block_height,
        };
        let (tx, anchor) = match style.text_align.unwrap_or(UiTextAlign::Center) {
            UiTextAlign::Start => (x, "start"),
            UiTextAlign::Center => (x + w / 2., "middle"),
            UiTextAlign::End => (x + w, "end"),
        };
        let color = style.color.unwrap_or([1., 1., 1., 1.]);
        for (index, line) in lines.iter().enumerate() {
            let cy = top + line_height * (index as f64 + 0.5);
            *svg += &format!(
                "<text x='{tx}' y='{cy}' xml:space='preserve' text-anchor='{anchor}' dominant-baseline='central' font-family='{}' font-size='{size}' font-weight='{weight}' letter-spacing='{spacing}' fill='{}' fill-opacity='{}'>{}</text>",
                escape(family),
                rgba(color),
                color[3],
                escape(line)
            );
        }
        Ok(())
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
            let unit = height as f64 / 100.;
            let style = node.style();
            let opacity = style.and_then(|s| s.opacity).unwrap_or(1.);
            let radius =
                (style.and_then(|s| s.border_radius).unwrap_or(0.) * unit).min(w.min(h) / 2.);
            svg += &format!(
                "<defs><clipPath id='c{index}'><rect x='{x}' y='{y}' width='{w}' height='{h}' rx='{radius}'/></clipPath></defs><g opacity='{opacity}' clip-path='url(#c{index})'>"
            );
            if let Some(color) = style.and_then(|s| s.background) {
                svg += &format!(
                    "<rect x='{x}' y='{y}' width='{w}' height='{h}' rx='{radius}' fill='{}' fill-opacity='{}'/>",
                    rgba(color),
                    color[3]
                );
            }
            let padding = style.and_then(|s| s.padding).unwrap_or_default();
            let (cx, cy) = (x + padding.left * unit, y + padding.top * unit);
            let (cw, ch) = (
                (w - (padding.left + padding.right) * unit).max(0.),
                (h - (padding.top + padding.bottom) * unit).max(0.),
            );
            svg += &format!(
                "<defs><clipPath id='t{index}'><rect x='{cx}' y='{cy}' width='{cw}' height='{ch}'/></clipPath></defs><g clip-path='url(#t{index})'>"
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
                            .patches(
                                iw,
                                ih,
                                cw.max(f64::EPSILON),
                                ch.max(f64::EPSILON),
                                height as f64,
                            )
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
                                cx + d.x,
                                cy + d.y,
                                d.width,
                                d.height,
                                s.x,
                                s.y,
                                s.width,
                                s.height
                            );
                        }
                    } else {
                        let aspect = match fit {
                            unone_engine::UiImageFit::Stretch => "none",
                            unone_engine::UiImageFit::Cover => "xMidYMid slice",
                            _ => "xMidYMid meet",
                        };
                        svg += &format!(
                            "<image x='{cx}' y='{cy}' width='{cw}' height='{ch}' preserveAspectRatio='{aspect}' xlink:href='{uri}'/>"
                        );
                    }
                }
                UiNode::Text { text, .. } | UiNode::Button { text, .. } => {
                    if let Some(style) = style {
                        self.styled_text(&mut svg, text, style, [cx, cy, cw, ch], unit)?;
                    } else if !text.is_empty() {
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
                UiNode::Slider { text, .. } | UiNode::ComboBox { text, .. } => {
                    if let Some(style) = style {
                        self.styled_text(&mut svg, text, style, [cx, cy, cw, ch], unit)?;
                    }
                }
                _ => {}
            }
            svg += "</g>";
            let border_width =
                (style.and_then(|s| s.border_width).unwrap_or(0.) * unit).min(w.min(h));
            if border_width > 0. {
                let color = style
                    .and_then(|s| s.border_color)
                    .unwrap_or([1., 1., 1., 1.]);
                let inset = border_width / 2.;
                svg += &format!(
                    "<rect x='{}' y='{}' width='{}' height='{}' rx='{}' fill='none' stroke='{}' stroke-opacity='{}' stroke-width='{border_width}'/>",
                    x + inset,
                    y + inset,
                    w - border_width,
                    h - border_width,
                    (radius - inset).max(0.),
                    rgba(color),
                    color[3]
                );
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
            for c in &mut p[..3] {
                if let Some(value) = (*c as u16 * 255 + a / 2).checked_div(a) {
                    *c = value.min(255) as u8;
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
        if leaves(tree)
            .iter()
            .any(|n| matches!(n, UiNode::ScrollView { .. }))
        {
            return Err("UI_HOST_CAPABILITY_UNSUPPORTED: scroll_view currently requires the Web scroll host; native scrolling is not implemented".into());
        }
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

    fn empty_package(presentation: serde_json::Value) -> Package {
        Package {
            digest: String::new(),
            files: BTreeMap::from([
                ("content/assets.json".into(), br#"{"assets":[]}"#.to_vec()),
                (
                    "content/presentation.json".into(),
                    serde_json::to_vec(&presentation).unwrap(),
                ),
            ]),
        }
    }

    #[test]
    fn styled_panel_opacity_border_radius_and_noninteractive_input() {
        let raster = Rasterizer::new(&empty_package(serde_json::json!({}))).unwrap();
        let tree = UiTree::from_json(serde_json::json!({"kind":"screen","id":"settings","node":"settings","children":[
            {"kind":"button","id":"apply","text":"","action":"Apply","rect":{"x":10,"y":10,"width":80,"height":80}},
            {"kind":"panel","id":"card","rect":{"x":10,"y":10,"width":80,"height":80},"style":{"background":[0,0,1,1],"border_color":[1,0,0,1],"border_width":4,"border_radius":10,"opacity":0.5}},
            {"kind":"text","id":"caption","text":"","rect":{"x":10,"y":10,"width":80,"height":80}}
        ]})).unwrap();
        for (w, h) in [(200, 100), (400, 200)] {
            let pixels = raster.draw(&tree, w, h).unwrap();
            let p = |x: u32, y: u32| &pixels[((y * w + x) * 4) as usize..][..4];
            assert!(p(w / 2, h / 2)[2] > 250 && (126..=129).contains(&p(w / 2, h / 2)[3]));
            assert!(p(w / 2, h / 10 + h / 50)[0] > 250, "inside border");
            assert_eq!(p(w / 10, h / 10)[3], 0, "rounded corner clips paint");
        }
        let mut pointer = PointerRouter::default();
        assert!(pointer.down(Some(&tree), 1, 50., 50.));
        assert_eq!(
            pointer.next_edge(),
            Some(("Apply".into(), true)),
            "visual leaves do not hide a semantic button"
        );
        let decorative = UiTree::from_json(serde_json::json!({"kind":"screen","id":"status","node":"status","children":[{"kind":"panel","id":"p","rect":{"x":0,"y":0,"width":100,"height":100}}]})).unwrap();
        assert!(
            !pointer.down(Some(&decorative), 2, 50., 50.),
            "decorations do not consume world input"
        );
    }

    #[test]
    fn font_catalog_aliases_and_styled_typography_pixels() {
        let mut system = resvg::usvg::Options::default();
        system.fontdb_mut().load_system_fonts();
        let Some(bytes) = system.fontdb.faces().find_map(|face| {
            system
                .fontdb
                .with_face_data(face.id, |bytes, _| {
                    (bytes.starts_with(b"\0\x01\0\0") || bytes.starts_with(b"OTTO"))
                        .then(|| bytes.to_vec())
                })
                .flatten()
        }) else {
            eprintln!(
                "native font pixel fixture requires an installed TTF/OTF; box and invalid-format tests are independent"
            );
            return;
        };
        let mut package = empty_package(
            serde_json::json!({"ui":{"fonts":[{"family":"FixtureFont","source":"fonts/body.ttf","weight":600}]}}),
        );
        package.files.insert("content/fonts/body.ttf".into(), bytes);
        let raster = Rasterizer::new(&package).unwrap();
        assert_eq!(
            raster.family, "FixtureFont",
            "first catalog family is the shared default"
        );
        assert!(
            raster.options.fontdb.faces().any(|f| f
                .families
                .iter()
                .any(|(name, _)| name == "FixtureFont")
                && f.weight.0 == 600)
        );
        let tree = |height: u32, align: &str| {
            UiTree::from_json(serde_json::json!({"kind":"screen","id":"reading","node":"reading","children":[{"kind":"text","id":"heading","text":"Reading room","rect":{"x":0,"y":0,"width":100,"height":height},"style":{"font_family":"FixtureFont","font_weight":600,"font_size":8,"text_align":"start","vertical_align":align,"color":[0,1,0,1],"padding":{"left":3,"right":3,"top":2,"bottom":2}}}]})).unwrap()
        };
        let bounds = |pixels: &[u8], w: u32| {
            let lit: Vec<_> = pixels
                .chunks_exact(4)
                .enumerate()
                .filter(|(_, p)| p[3] > 64)
                .map(|(at, _)| (at as u32 % w, at as u32 / w))
                .collect();
            assert!(!lit.is_empty());
            (
                lit.iter().map(|p| p.0).min().unwrap(),
                lit.iter().map(|p| p.1).min().unwrap(),
                lit.iter().map(|p| p.0).max().unwrap(),
                lit.iter().map(|p| p.1).max().unwrap(),
            )
        };
        let a = raster.draw(&tree(40, "middle"), 400, 200).unwrap();
        let b = raster.draw(&tree(80, "middle"), 400, 200).unwrap();
        let (aa, bb) = (bounds(&a, 400), bounds(&b, 400));
        assert_eq!(
            aa.2 - aa.0,
            bb.2 - bb.0,
            "explicit font size is independent of text rectangle height"
        );
        assert_eq!(aa.3 - aa.1, bb.3 - bb.1);
        assert!(
            a.chunks_exact(4)
                .filter(|p| p[3] > 64)
                .all(|p| p[0] == 0 && p[1] > 250 && p[2] == 0)
        );
        let top = bounds(&raster.draw(&tree(80, "top"), 400, 200).unwrap(), 400);
        let bottom = bounds(&raster.draw(&tree(80, "bottom"), 400, 200).unwrap(), 400);
        assert!(
            top.1 < bottom.1,
            "vertical alignment changes position without resizing text"
        );
        let measure = |text: &str| measure_text(&raster.options, text, "FixtureFont", 16., 600, 0.);
        assert!(measure("Wide text").unwrap() > measure("text").unwrap());
        let mut measure = measure;
        assert!(
            wrap_lines(
                "alpha beta gamma",
                measure("alpha beta").unwrap(),
                true,
                &mut measure
            )
            .unwrap()
            .len()
                >= 2
        );
        eprintln!(
            "native styled font fixture rendered: same glyph bounds {:?}/{:?}; top {:?}; bottom {:?}",
            aa, bb, top, bottom
        );
    }

    #[test]
    fn paragraph_breaks_preserve_graphemes_and_cjk_word_boundaries() {
        let mut measure = |text: &str| Ok(text.graphemes(true).count() as f64);
        assert_eq!(
            fit_prefix("e\u{301}👩‍🚀Z", 2., &mut measure).unwrap(),
            "e\u{301}👩‍🚀".len(),
            "never split grapheme clusters"
        );
        assert_eq!(
            wrap_lines("alpha 中文文字", 8., true, &mut measure).unwrap(),
            vec!["alpha 中文", "文字"],
            "mixed Latin/CJK fills the same word-wrap boundary as Web"
        );
        assert_eq!(
            wrap_lines("one two three", 8., true, &mut measure).unwrap(),
            vec!["one two", "three"]
        );
    }

    #[test]
    fn font_catalog_rejects_unsupported_or_invalid_sources() {
        for (bytes, code) in [
            (b"wOF2fake".to_vec(), "UI_FONT_FORMAT_UNSUPPORTED"),
            (b"\0\x01\0\0fake".to_vec(), "UI_FONT_INVALID"),
        ] {
            let mut package = empty_package(
                serde_json::json!({"ui":{"fonts":[{"family":"Fixture","source":"font.ttf","weight":400}]}}),
            );
            package.files.insert("content/font.ttf".into(), bytes);
            let err = Rasterizer::new(&package).err().unwrap();
            assert!(err.contains(code), "{err}");
        }
    }

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

    fn semantic_slider_tree() -> UiTree {
        UiTree::from_json(serde_json::json!({"kind":"screen","id":"s","node":"s","children":[
            {"kind":"slider","id":"gain","action":"AdjustGain","rect":{"x":10,"y":20,"width":50,"height":10},
             "drag":{"track_rect":{"x":15,"y":24,"width":40,"height":1},"hit_rect":{"x":10,"y":20,"width":50,"height":10}}},
            {"kind":"slider","id":"other","action":"AdjustOther","rect":{"x":10,"y":50,"width":50,"height":10},
             "drag":{"track_rect":{"x":15,"y":54,"width":40,"height":1},"hit_rect":{"x":10,"y":50,"width":50,"height":10}}},
            {"kind":"text","id":"decoration","text":"Gain","rect":{"x":10,"y":20,"width":50,"height":10}}
        ]})).unwrap()
    }

    #[test]
    fn semantic_slider_captures_clamps_and_keeps_start_drag_end_on_separate_ticks() {
        let tree = semantic_slider_tree();
        let mut router = PointerRouter::default();
        assert!(router.down(Some(&tree), 1, 25.0, 25.0));
        assert!(router.move_pointer(1, 35.0, 25.0));
        assert!(router.move_pointer(1, 45.0, 80.0));
        assert!(router.up_at(1, 120.0, -20.0));
        assert!(!router.captured(1));
        for (phase, ratio) in [(SliderPhase::Start, 0.25), (SliderPhase::Drag, 0.75), (SliderPhase::End, 1.0)] {
            assert_eq!(router.drain_sliders().get("gain"), Some(&SliderInteraction { phase, ratio }));
        }
        assert!(router.drain_sliders().is_empty());
        assert!(router.next_edge().is_none(), "semantic sliders never dispatch button actions");
        assert!(!router.move_pointer(1, 20.0, 25.0));
    }

    #[test]
    fn semantic_slider_vertical_reverse_and_final_release_coordinates() {
        let mut value = serde_json::to_value(semantic_slider_tree()).unwrap();
        let drag = &mut value["children"][0]["drag"];
        drag["axis"] = "vertical".into();
        drag["reverse"] = true.into();
        drag["track_rect"] = serde_json::json!({"x":24,"y":20,"width":1,"height":40});
        let tree = UiTree::from_json(value).unwrap();
        let mut router = PointerRouter::default();
        assert!(router.down(Some(&tree), 0, 25.0, 25.0));
        assert_eq!(router.drain_sliders()["gain"].ratio, 0.875);
        assert!(router.up_at(0, 25.0, 80.0));
        assert_eq!(router.drain_sliders()["gain"], SliderInteraction { phase: SliderPhase::End, ratio: 0.0 });
    }

    #[test]
    fn semantic_slider_disabled_and_second_finger_consume_without_replacing_owner() {
        let tree = semantic_slider_tree();
        let mut router = PointerRouter::default();
        router.down(Some(&tree), 1, 25.0, 25.0);
        router.down(Some(&tree), 2, 35.0, 25.0);
        router.move_pointer(2, 55.0, 25.0);
        router.down(Some(&tree), 3, 35.0, 55.0);
        let frame = router.drain_sliders();
        assert_eq!(frame.len(), 2);
        assert_eq!(frame["gain"].ratio, 0.25);
        assert_eq!(frame["other"].ratio, 0.5);
        router.up(1);
        assert!(router.captured(2));
        router.up_at(2, 55.0, 25.0);
        assert_eq!(router.drain_sliders().len(), 1);
        assert!(router.drain_sliders().is_empty());
        let mut value = serde_json::to_value(&tree).unwrap();
        value["children"][0]["drag"]["enabled"] = false.into();
        let disabled = UiTree::from_json(value).unwrap();
        assert!(router.down(Some(&disabled), 4, 25.0, 25.0));
        assert!(router.move_pointer(4, 45.0, 25.0));
        assert!(router.up_at(4, 45.0, 25.0));
        assert!(router.drain_sliders().is_empty());
    }

    #[test]
    fn semantic_slider_reconcile_cancels_geometry_disable_and_removal_without_click_through() {
        let tree = semantic_slider_tree();
        for path in ["track", "hit", "axis", "reverse", "enabled", "rect", "remove"] {
            let mut router = PointerRouter::default();
            router.down(Some(&tree), 1, 25.0, 25.0);
            router.drain_sliders();
            let mut value = serde_json::to_value(&tree).unwrap();
            let node = &mut value["children"][0];
            match path {
                "track" => node["drag"]["track_rect"]["x"] = 16.into(),
                "hit" => node["drag"]["hit_rect"]["width"] = 51.into(),
                "axis" => node["drag"]["axis"] = "vertical".into(),
                "reverse" => node["drag"]["reverse"] = true.into(),
                "enabled" => node["drag"]["enabled"] = false.into(),
                "rect" => node["rect"]["width"] = 51.into(),
                "remove" => value["children"] = serde_json::json!([]),
                _ => unreachable!(),
            }
            let changed = UiTree::from_json(value).unwrap();
            router.reconcile(Some(&changed));
            assert_eq!(router.drain_sliders()["gain"].phase, SliderPhase::Cancel, "{path}");
            assert!(router.move_pointer(1, 80.0, 80.0), "{path} keeps the abandoned physical stream consumed");
            assert!(router.up_at(1, 80.0, 80.0));
            assert!(router.drain_sliders().is_empty());
        }
    }

    #[test]
    fn semantic_slider_pause_reset_preserves_cancel_after_an_already_consumed_start() {
        let tree = semantic_slider_tree();
        let mut router = PointerRouter::default();
        router.down(Some(&tree), 1, 25.0, 25.0);
        router.drain_sliders();
        router.up_at(1, 55.0, 25.0);
        router.reset();
        assert_eq!(router.drain_sliders()["gain"].phase, SliderPhase::Cancel, "pause does not discard a pending end and leave the Luau control dragging");
        assert!(router.drain_sliders().is_empty());
        router.down(Some(&tree), 1, 25.0, 25.0);
        router.up_at(1, 55.0, 25.0);
        router.reset();
        assert!(router.drain_sliders().is_empty(), "an entirely unconsumed tap is discarded on pause");
        router.down(Some(&tree), 1, 25.0, 25.0);
        router.drain_sliders();
        router.cancel(1);
        assert_eq!(router.drain_sliders()["gain"].phase, SliderPhase::Cancel);
    }

    #[test]
    fn semantic_slider_queue_coalesces_moves_preserves_edges_and_reports_overflow() {
        let mut router = PointerRouter::default();
        router.queue_slider("one".into(), SliderPhase::Start, 0.0);
        for i in 0..1000 { router.queue_slider("one".into(), SliderPhase::Drag, i as f64 / 1000.0); }
        router.queue_slider("one".into(), SliderPhase::End, 1.0);
        assert_eq!(router.slider_events.len(), 3);
        assert_eq!(router.drain_sliders()["one"].phase, SliderPhase::Start);
        assert_eq!(router.drain_sliders()["one"].ratio, 0.999);
        assert_eq!(router.drain_sliders()["one"].phase, SliderPhase::End);
        for _ in 0..128 {
            router.queue_slider("one".into(), SliderPhase::Start, 0.0);
            router.queue_slider("one".into(), SliderPhase::End, 1.0);
        }
        router.queue_slider("one".into(), SliderPhase::Start, 0.0);
        assert!(router.take_error().unwrap().contains("UI_SLIDER_QUEUE_FULL"));
        assert!(router.slider_events.len() <= 256);
        assert!(router.take_error().is_none());
        for i in 0..257 { router.queue_slider(format!("control-{i}"), SliderPhase::Start, 0.0); }
        assert!(router.take_error().unwrap().contains("UI_SLIDER_QUEUE_FULL"));
        assert!(router.drain_sliders().len() <= 256);
    }

    #[test]
    fn legacy_slider_remains_passthrough_and_foreground_button_keeps_action_ownership() {
        let mut value = serde_json::to_value(semantic_slider_tree()).unwrap();
        value["children"][0].as_object_mut().unwrap().remove("drag");
        let legacy = UiTree::from_json(value.clone()).unwrap();
        let mut router = PointerRouter::default();
        assert!(!router.down(Some(&legacy), 1, 25.0, 25.0));
        value["children"].as_array_mut().unwrap().push(serde_json::json!({"kind":"button","id":"overlay","action":"Click","text":"","rect":{"x":10,"y":20,"width":50,"height":10}}));
        let overlay = UiTree::from_json(value).unwrap();
        assert!(router.down(Some(&overlay), 1, 25.0, 25.0));
        assert_eq!(router.next_edge(), Some(("Click".into(), true)));
        assert!(router.up(1));
        assert_eq!(router.next_edge(), Some(("Click".into(), false)));
        assert!(router.drain_sliders().is_empty());
    }
}
