use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct UiContract {
    pub version: u32,
    pub default_max_nodes: usize,
    pub host_max_nodes: usize,
    pub max_component_depth: usize,
    pub max_string_bytes: usize,
    pub max_layout_comparisons: usize,
    pub max_layout_findings: usize,
}

pub fn ui_contract() -> &'static UiContract {
    static CONTRACT: std::sync::OnceLock<UiContract> = std::sync::OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(include_str!("ui-contract.json")).expect("bundled UI contract")
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiBudget {
    pub max_nodes: usize,
}

/// Source borders are pixels; pixels_per_unit converts them to vertical design
/// units (one unit = 1% of viewport height). This preserves corners across DPI
/// and aspect ratios. Source is an optional atlas/trim region, in source pixels.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiSlice {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub pixels_per_unit: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<UiRect>,
}

impl UiSlice {
    pub fn validate(&self) -> Result<(), String> {
        if [self.left, self.top, self.right, self.bottom]
            .iter()
            .any(|n| !n.is_finite() || *n < 0.0)
            || !self.pixels_per_unit.is_finite()
            || self.pixels_per_unit <= 0.0
        {
            return Err("UI_SLICE_INVALID: borders must be finite non-negative source pixels; pixels_per_unit must be positive".into());
        }
        if let Some(s) = self.source
            && ([s.x, s.y, s.width, s.height].iter().any(|n| !n.is_finite())
                || s.x < 0.0
                || s.y < 0.0
                || s.width <= self.left + self.right
                || s.height <= self.top + self.bottom)
            {
                return Err("UI_SLICE_SOURCE_INVALID: source must be a positive pixel rectangle with room between its borders".into());
        }
        Ok(())
    }

    /// Returns source and destination rectangles in pixels, both y-down. Small
    /// destinations uniformly shrink all four borders; they never overlap.
    pub fn patches(
        &self,
        image_width: f64,
        image_height: f64,
        width: f64,
        height: f64,
        viewport_height: f64,
    ) -> Result<Vec<(UiRect, UiRect)>, String> {
        self.validate()?;
        if [image_width, image_height, width, height, viewport_height]
            .iter()
            .any(|v| !v.is_finite() || *v <= 0.0)
        {
            return Err("UI_SLICE_SIZE_INVALID: image, destination and viewport dimensions must be positive finite pixels".into());
        }
        let s = self.source.unwrap_or(UiRect {
            x: 0.0,
            y: 0.0,
            width: image_width,
            height: image_height,
        });
        if s.x + s.width > image_width
            || s.y + s.height > image_height
            || self.left + self.right >= s.width
            || self.top + self.bottom >= s.height
        {
            return Err(format!(
                "UI_SLICE_BOUNDS: source/borders exceed image {image_width}x{image_height}; correct slice source pixels, do not stretch the whole image"
            ));
        }
        let requested_scale = viewport_height / 100.0 / self.pixels_per_unit;
        if !requested_scale.is_finite() {
            return Err(
                "UI_SLICE_SIZE_INVALID: pixels_per_unit is too small for this viewport".into(),
            );
        }
        let scale = requested_scale
            .min(if self.left + self.right > 0.0 {
                width / (self.left + self.right)
            } else {
                f64::INFINITY
            })
            .min(if self.top + self.bottom > 0.0 {
                height / (self.top + self.bottom)
            } else {
                f64::INFINITY
            });
        let sx = [
            s.x,
            s.x + self.left,
            s.x + s.width - self.right,
            s.x + s.width,
        ];
        let sy = [
            s.y,
            s.y + self.top,
            s.y + s.height - self.bottom,
            s.y + s.height,
        ];
        let dx = [0.0, self.left * scale, width - self.right * scale, width];
        let dy = [0.0, self.top * scale, height - self.bottom * scale, height];
        let mut patches = Vec::with_capacity(9);
        for y in 0..3 {
            for x in 0..3 {
                let source = UiRect {
                    x: sx[x],
                    y: sy[y],
                    width: sx[x + 1] - sx[x],
                    height: sy[y + 1] - sy[y],
                };
                let dest = UiRect {
                    x: dx[x],
                    y: dy[y],
                    width: (dx[x + 1] - dx[x]).max(0.0),
                    height: (dy[y + 1] - dy[y]).max(0.0),
                };
                if source.width > 0.0
                    && source.height > 0.0
                    && dest.width > 0.0
                    && dest.height > 0.0
                {
                    patches.push((source, dest));
                }
            }
        }
        Ok(patches)
    }
}

/// The cross-platform UI design space. Hosts map this normalized space to
/// their viewport, pixels, DPI and safe area.
pub const UI_DESIGN_WIDTH: f64 = 100.0;
pub const UI_DESIGN_HEIGHT: f64 = 100.0;

/// Viewport shape a project is authored against when it says nothing else.
pub const UI_REFERENCE_ASPECT: f64 = 16.0 / 9.0;

/// Where an anchored node hangs from, and which of its own corners it hangs by.
///
/// A named corner is the whole point: an author who cannot see the screen picks
/// a word correctly far more often than four normalized floats, which is what
/// every RectTransform-style anchor system asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum UiAnchor {
    TopLeft,
    Top,
    TopRight,
    Left,
    Center,
    Right,
    BottomLeft,
    Bottom,
    BottomRight,
}

impl UiAnchor {
    /// Fraction of the design space this anchor sits at, x then y (y up).
    fn fractions(self) -> (f64, f64) {
        let x = match self {
            Self::TopLeft | Self::Left | Self::BottomLeft => 0.0,
            Self::Top | Self::Center | Self::Bottom => 0.5,
            Self::TopRight | Self::Right | Self::BottomRight => 1.0,
        };
        let y = match self {
            Self::BottomLeft | Self::Bottom | Self::BottomRight => 0.0,
            Self::Left | Self::Center | Self::Right => 0.5,
            Self::TopLeft | Self::Top | Self::TopRight => 1.0,
        };
        (x, y)
    }

    /// Which way an offset pushes the node away from its edge.
    fn offset_signs(self) -> (f64, f64) {
        let x = match self {
            Self::TopRight | Self::Right | Self::BottomRight => -1.0,
            _ => 1.0,
        };
        let y = match self {
            Self::TopLeft | Self::Top | Self::TopRight => -1.0,
            _ => 1.0,
        };
        (x, y)
    }
}

/// Logical coordinates for a host-rendered UI element.
///
/// Both axes run 0..100 and **y points up**: y = 0 is the bottom of the screen
/// and a rect grows upward from its y. Most UI systems are y-down, so this is
/// the easiest thing for an author who cannot see the screen to get wrong.
///
/// The platform host maps this design space to its viewport. The engine does
/// not know about pixels, DPI, safe areas, fonts, or platform widgets.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum UiSliderAxis {
    #[default]
    Horizontal,
    Vertical,
}

/// Official slider gesture geometry in the same space as its node: stage
/// y-up, or scroll-local top-left/y-down before host projection. Hosts map
/// track coordinates to a clamped ratio and apply reverse exactly once.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiSliderDrag {
    #[serde(default)]
    pub axis: UiSliderAxis,
    #[serde(default)]
    pub reverse: bool,
    #[serde(default = "slider_enabled")]
    pub enabled: bool,
    pub track_rect: UiRect,
    pub hit_rect: UiRect,
}

fn slider_enabled() -> bool { true }

impl UiSliderDrag {
    fn validate(&self, local: bool) -> Result<(), String> {
        for (name, rect) in [("track_rect", self.track_rect), ("hit_rect", self.hit_rect)] {
            let valid = [rect.x, rect.y, rect.width, rect.height].iter().all(|n| n.is_finite())
                && (rect.x + rect.width).is_finite() && (rect.y + rect.height).is_finite()
                && rect.width > 0.0 && rect.height > 0.0
                // Hit tolerance may protrude: hosts clip it to the stage and
                // scroll ancestors. Authored visible track bounds stay strict.
                && (name == "hit_rect" || (rect.x >= 0.0 && rect.y >= 0.0
                    && (local || (rect.x + rect.width <= UI_DESIGN_WIDTH && rect.y + rect.height <= UI_DESIGN_HEIGHT))));
            if !valid {
                return Err(format!("UI_SLIDER_DRAG_INVALID: {name} needs finite bounds and positive width/height; track_rect must have non-negative x/y{}", if local { " in scroll-local coordinates" } else { " inside stage 0..100" }));
            }
        }
        Ok(())
    }
}

/// Shared UI styling uses vertical design units (one unit is 1% of viewport
/// height), including horizontal padding and letter spacing. Styles are local
/// to one leaf: components do not create implicit style inheritance.
#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiInsets {
    #[serde(default)]
    pub left: f64,
    #[serde(default)]
    pub top: f64,
    #[serde(default)]
    pub right: f64,
    #[serde(default)]
    pub bottom: f64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum UiTextAlign { Start, Center, End }

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum UiVerticalAlign { Top, Middle, Bottom }

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum UiTextWrap { None, Word }

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum UiTextOverflow { Clip, Ellipsis }

/// Platform-neutral style data. Fonts name installed host families, not files
/// or URLs. An explicit font_size is never inferred from the node's box and is
/// never silently shrunk to fit it. A styled text leaf defaults to font_size=2,
/// weight=400, line_height=1.2, centered/middle, no-wrap and clipped overflow.
/// Absence of the entire style object preserves the legacy presentation path.
#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<[f64; 4]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_align: Option<UiTextAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<UiVerticalAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap: Option<UiTextWrap>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overflow: Option<UiTextOverflow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<UiInsets>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<[f64; 4]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_color: Option<[f64; 4]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_radius: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
}

impl UiStyle {
    pub fn validate(&self) -> Result<(), String> {
        let range = |name: &str, value: Option<f64>, min: f64, max: f64, inclusive_min: bool| {
            if value.is_some_and(|v| !v.is_finite() || v > max || if inclusive_min { v < min } else { v <= min }) {
                Err(format!("UI_STYLE_INVALID: {name} must be finite and {} {min} and <= {max}", if inclusive_min { ">=" } else { ">" }))
            } else { Ok(()) }
        };
        if self.font_family.as_ref().is_some_and(|name| name.trim().is_empty()
            || name.len() > 256 || name.chars().any(char::is_control)
            || name.contains("://") || name.contains([';', '{', '}'])) {
            return Err("UI_STYLE_INVALID: font_family must name installed font families (1..256 bytes), not a URL or stylesheet".into());
        }
        range("font_size", self.font_size, 0.0, 100.0, false)?;
        if self.font_weight.is_some_and(|weight| !(100..=900).contains(&weight)) {
            return Err("UI_STYLE_INVALID: font_weight must be an integer from 100 to 900".into());
        }
        range("line_height", self.line_height, 0.5, 4.0, true)?;
        range("letter_spacing", self.letter_spacing, -10.0, 10.0, true)?;
        range("border_width", self.border_width, 0.0, 100.0, true)?;
        range("border_radius", self.border_radius, 0.0, 100.0, true)?;
        range("opacity", self.opacity, 0.0, 1.0, true)?;
        if let Some(padding) = self.padding {
            for (name, value) in [("padding.left", padding.left), ("padding.top", padding.top), ("padding.right", padding.right), ("padding.bottom", padding.bottom)] {
                range(name, Some(value), 0.0, 100.0, true)?;
            }
        }
        for (name, color) in [("color", self.color), ("background", self.background), ("border_color", self.border_color)] {
            if color.is_some_and(|rgba| rgba.iter().any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))) {
                return Err(format!("UI_STYLE_INVALID: {name} must contain four finite RGBA values in 0..1"));
            }
        }
        if self.overflow == Some(UiTextOverflow::Ellipsis) && self.wrap == Some(UiTextWrap::Word) {
            return Err("UI_STYLE_INVALID: ellipsis requires wrap=none (or omitted wrap)".into());
        }
        Ok(())
    }

    fn has_text_fields(&self) -> bool {
        self.font_family.is_some() || self.font_size.is_some() || self.font_weight.is_some()
            || self.line_height.is_some() || self.letter_spacing.is_some() || self.color.is_some()
            || self.text_align.is_some() || self.vertical_align.is_some() || self.wrap.is_some()
            || self.overflow.is_some()
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
struct UiViewport { left: f64, top: f64, width: f64, height: f64 }

/// Scroll content is local, top-left, y-down, in the same axis units as rect.
/// Only the viewport uses the containing space. No implicit flow layout.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiScroll {
    #[serde(default = "vertical_axis")]
    pub axis: String,
    #[serde(default = "enabled_scroll")]
    pub enabled: bool,
    /// Presentation-only drag momentum; opt in without changing simulation.
    #[serde(default)]
    pub inertia: bool,
    /// Exponential velocity decay per second, in (0, 100].
    #[serde(default = "scroll_deceleration")]
    pub deceleration: f64,
    #[serde(default)]
    pub reset_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wheel_rect: Option<UiRect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub virtual_items: Option<UiVirtualItems>,
}
fn vertical_axis() -> String { "vertical".into() }
fn enabled_scroll() -> bool { true }
fn scroll_deceleration() -> f64 { 8.0 }

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiVirtualItems {
    #[serde(deserialize_with = "virtual_keys")]
    pub keys: Vec<String>,
    pub row_height: f64,
    pub column_width: f64,
    pub columns: usize,
    pub gap_x: f64,
    pub gap_y: f64,
    pub revision: u32,
    /// Inclusive, one-based materialized range. Empty data uses (0, 0).
    pub first: usize,
    pub last: usize,
}
fn virtual_keys<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    if value.as_object().is_some_and(|o| o.is_empty()) { return Ok(Vec::new()); }
    serde_json::from_value(value).map_err(serde::de::Error::custom)
}

/// Explicit decorative ownership for overlap diagnostics. This declares intent;
/// it does not change coordinates, paint order, input or component styles.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(untagged, deny_unknown_fields)]
pub enum UiBackgroundScope {
    Screen {
        #[serde(deserialize_with = "background_screen_true", serialize_with = "serialize_background_screen")]
        #[cfg_attr(feature = "dev-tools", schemars(schema_with = "background_screen_schema"))]
        screen: bool,
    },
    Component { component: String },
}

fn background_screen_true<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    if bool::deserialize(d)? {
        Ok(true)
    } else {
        Err(serde::de::Error::custom("background_for.screen must be true"))
    }
}

fn serialize_background_screen<S: serde::Serializer>(value: &bool, serializer: S) -> Result<S::Ok, S::Error> {
    if *value {
        serializer.serialize_bool(true)
    } else {
        Err(serde::ser::Error::custom("background_for.screen must be true"))
    }
}

#[cfg(feature = "dev-tools")]
fn background_screen_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type": "boolean", "const": true})
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind")]
pub enum UiNode {
    #[serde(rename = "text")]
    Text {
        id: String,
        rect: UiRect,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        style: Option<UiStyle>,
    },
    #[serde(rename = "button")]
    Button {
        id: String,
        rect: UiRect,
        text: String,
        action: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        style: Option<UiStyle>,
    },
    /// A host-rendered texture. The asset field is a stable asset id, not a
    /// project-relative path; the host resolves the id through the verified
    /// asset bundle and decides whether SVG is decoded directly or via a
    /// derived texture.
    #[serde(rename = "image")]
    Image {
        id: String,
        rect: UiRect,
        asset: String,
        fit: UiImageFit,
        #[serde(skip_serializing_if = "Option::is_none")]
        slice: Option<UiSlice>,
        /// Optional accessibility/inspection text. Hosts may use it as the
        /// image alt text; Core does not interpret or localize it.
        #[serde(skip_serializing_if = "Option::is_none")]
        alt: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        style: Option<UiStyle>,
        #[serde(skip_serializing_if = "Option::is_none")]
        background_for: Option<UiBackgroundScope>,
    },
    /// A semantic slider input. Official models declare `drag` geometry so
    /// hosts capture gestures and report normalized ratios through input.
    /// Leaves without drag retain the legacy project-owned pointer path.
    /// Artwork and value formatting remain reusable component concerns.
    #[serde(rename = "slider")]
    Slider {
        id: String,
        rect: UiRect,
        text: String,
        action: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        drag: Option<UiSliderDrag>,
        #[serde(skip_serializing_if = "Option::is_none")]
        style: Option<UiStyle>,
    },
    /// A skinnable selection field. Hosts route the whole rect to `action`;
    /// selected text and expanded state remain controlled by the UI author.
    /// Put field/value/arrow/popup visuals beside it in a reusable component.
    #[serde(rename = "combobox")]
    ComboBox {
        id: String,
        rect: UiRect,
        text: String,
        action: String,
        expanded: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        style: Option<UiStyle>,
    },
    /// A decorative box with no input, text, image, or child ownership.
    #[serde(rename = "panel")]
    Panel {
        id: String,
        rect: UiRect,
        #[serde(skip_serializing_if = "Option::is_none")]
        style: Option<UiStyle>,
        #[serde(skip_serializing_if = "Option::is_none")]
        background_for: Option<UiBackgroundScope>,
    },
    /// A reusable semantic component instance. Core owns the tree boundary and
    /// validates its children, while the host decides how the component is
    /// styled. Children retain the same screen design space as the existing
    /// flat nodes, so adding nesting does not introduce a second layout system.
    #[serde(rename = "component")]
    Component {
        id: String,
        rect: UiRect,
        component: String,
        children: Vec<UiNode>,
    },
    #[serde(rename = "scroll_view")]
    ScrollView {
        id: String,
        rect: UiRect,
        scroll: UiScroll,
        children: Vec<UiNode>,
    },
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum UiImageFit {
    #[default]
    Contain,
    Cover,
    Stretch,
}

impl UiNode {
    pub fn id(&self) -> &str {
        match self {
            Self::Text { id, .. }
            | Self::Button { id, .. }
            | Self::Image { id, .. }
            | Self::Slider { id, .. }
            | Self::ComboBox { id, .. }
            | Self::Panel { id, .. }
            | Self::Component { id, .. }
            | Self::ScrollView { id, .. } => id,
        }
    }

    pub fn rect(&self) -> &UiRect {
        match self {
            Self::Text { rect, .. }
            | Self::Button { rect, .. }
            | Self::Image { rect, .. }
            | Self::Slider { rect, .. }
            | Self::ComboBox { rect, .. }
            | Self::Panel { rect, .. }
            | Self::Component { rect, .. }
            | Self::ScrollView { rect, .. } => rect,
        }
    }

    pub fn rect_mut(&mut self) -> &mut UiRect {
        match self {
            Self::Text { rect, .. }
            | Self::Button { rect, .. }
            | Self::Image { rect, .. }
            | Self::Slider { rect, .. }
            | Self::ComboBox { rect, .. }
            | Self::Panel { rect, .. }
            | Self::Component { rect, .. }
            | Self::ScrollView { rect, .. } => rect,
        }
    }

    pub fn text_mut(&mut self) -> Option<&mut String> {
        match self {
            Self::Text { text, .. }
            | Self::Button { text, .. }
            | Self::Slider { text, .. }
            | Self::ComboBox { text, .. } => Some(text),
            Self::Image { .. } | Self::Panel { .. } | Self::Component { .. } | Self::ScrollView { .. } => None,
        }
    }

    pub fn style(&self) -> Option<&UiStyle> {
        match self {
            Self::Text { style, .. } | Self::Button { style, .. } | Self::Image { style, .. }
            | Self::Slider { style, .. } | Self::ComboBox { style, .. } | Self::Panel { style, .. } => style.as_ref(),
            Self::Component { .. } | Self::ScrollView { .. } => None,
        }
    }

    pub fn background_for(&self) -> Option<&UiBackgroundScope> {
        match self {
            Self::Image { background_for, .. } | Self::Panel { background_for, .. } => {
                background_for.as_ref()
            }
            _ => None,
        }
    }

    pub fn children(&self) -> &[UiNode] {
        match self {
            Self::Component { children, .. } | Self::ScrollView { children, .. } => children,
            _ => &[],
        }
    }

    pub fn find_mut(&mut self, id: &str) -> Option<&mut Self> {
        if self.id() == id {
            return Some(self);
        }
        if let Self::Component { children, .. } | Self::ScrollView { children, .. } = self {
            for child in children {
                if let Some(found) = child.find_mut(id) {
                    return Some(found);
                }
            }
        }
        None
    }

    pub fn leaf_nodes<'a>(&'a self, output: &mut Vec<&'a Self>) {
        match self {
            Self::Component { children, .. } => {
                for child in children {
                    child.leaf_nodes(output);
                }
            }
            // Legacy render/layout backends must not mistake local content for
            // stage coordinates. The scroll viewport is an explicit capability.
            Self::ScrollView { .. } => output.push(self),
            _ => output.push(self),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UiTree {
    pub kind: String,
    pub id: String,
    pub node: String,
    pub children: Vec<UiNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<UiBudget>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub(crate) struct RawUiTree {
    kind: String,
    id: String,
    node: String,
    children: Vec<RawUiNode>,
    #[serde(default)]
    budget: Option<UiBudget>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
struct RawUiNode {
    kind: String,
    id: String,
    /// Absolute placement in the design space. Use it when the layout is not
    /// edge relative, such as a ring laid out with trigonometry.
    #[serde(default)]
    rect: Option<UiRect>,
    #[serde(default)]
    viewport: Option<UiViewport>,
    /// Edge-relative placement, resolved by the engine against the host's real
    /// viewport shape so a screen keeps its proportions on any aspect.
    #[serde(default)]
    anchor: Option<UiAnchor>,
    #[serde(default)]
    pivot: Option<UiAnchor>,
    #[serde(default)]
    offset: Option<RawOffset>,
    #[serde(default)]
    size: Option<RawSize>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    asset: Option<String>,
    #[serde(default)]
    fit: Option<UiImageFit>,
    #[serde(default)]
    slice: Option<UiSlice>,
    #[serde(default)]
    alt: Option<String>,
    #[serde(default)]
    component: Option<String>,
    #[serde(default)]
    children: Option<Vec<RawUiNode>>,
    #[serde(default)]
    expanded: Option<bool>,
    #[serde(default)]
    drag: Option<UiSliderDrag>,
    #[serde(default)]
    scroll: Option<UiScroll>,
    #[serde(default)]
    style: Option<UiStyle>,
    #[serde(default)]
    background_for: Option<UiBackgroundScope>,
}

/// Anchored offsets and sizes are in vertical units: percent of the viewport
/// height, on both axes. One unit system means an author never has to reason
/// about the aspect, and a box keeps its shape when the aspect changes.
#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
struct RawOffset {
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
struct RawSize {
    width: f64,
    height: f64,
}

/// Inspectable resource usage, not a claim about GPU draw calls or frame time.
#[derive(Debug, Clone, Serialize)]
pub struct UiUsage {
    pub logical_nodes: usize,
    pub leaf_nodes: usize,
    pub render_regions_upper_bound: usize,
    pub max_nodes: usize,
    pub host_max_nodes: usize,
    pub limit_source: &'static str,
    pub subtrees: Vec<(String, usize)>,
}

/// Turn a node's declared placement into a design-space rect.
///
/// Anchored numbers are vertical units, so the x axis is divided by the real
/// aspect: a box declared 20 wide is always as wide as 20% of the screen height,
/// whatever shape the screen is.
fn resolve_rect(node: &RawUiNode, aspect: f64) -> Result<UiRect, String> {
    match (node.rect, node.anchor) {
        (Some(_), Some(_)) => Err(format!(
            "ui.setRoot node '{}' declares both rect and anchor; pick one placement",
            node.id
        )),
        (Some(rect), None) => {
            if node.offset.is_some() || node.size.is_some() || node.pivot.is_some() {
                return Err(format!(
                    "ui.setRoot node '{}' uses rect, so offset, size and pivot do not apply",
                    node.id
                ));
            }
            Ok(rect)
        }
        (None, Some(anchor)) => {
            let size = node
                .size
                .ok_or_else(|| format!("ui.setRoot anchored node '{}' requires a size", node.id))?;
            if !size.width.is_finite() || !size.height.is_finite() {
                return Err(format!(
                    "ui.setRoot node '{}' size must be finite numbers",
                    node.id
                ));
            }
            if size.width <= 0.0 || size.height <= 0.0 {
                return Err(format!(
                    "ui.setRoot node '{}' size must be greater than zero",
                    node.id
                ));
            }
            let offset = node.offset.unwrap_or(RawOffset { x: 0.0, y: 0.0 });
            if !offset.x.is_finite() || !offset.y.is_finite() {
                return Err(format!(
                    "ui.setRoot node '{}' offset must be finite numbers",
                    node.id
                ));
            }
            // Vertical units on both axes: divide x by the aspect so the shape
            // survives a different screen.
            let width = size.width / aspect;
            let height = size.height;
            let (anchor_x, anchor_y) = anchor.fractions();
            let (sign_x, sign_y) = anchor.offset_signs();
            let pivot = node.pivot.unwrap_or(anchor);
            let (pivot_x, pivot_y) = pivot.fractions();
            let x = anchor_x * UI_DESIGN_WIDTH + sign_x * offset.x / aspect - pivot_x * width;
            let y = anchor_y * UI_DESIGN_HEIGHT + sign_y * offset.y - pivot_y * height;
            Ok(UiRect {
                x,
                y,
                width,
                height,
            })
        }
        (None, None) => Err(format!(
            "ui.setRoot node '{}' needs either a rect or an anchor",
            node.id
        )),
    }
}

impl UiTree {
    pub fn usage(&self) -> UiUsage {
        fn count(node: &UiNode, out: &mut UiUsage) -> usize {
            out.logical_nodes += 1;
            match node {
                UiNode::Component { children, .. } | UiNode::ScrollView { children, .. } => {
                    1 + children.iter().map(|n| count(n, out)).sum::<usize>()
                }
                _ => {
                    out.leaf_nodes += 1;
                    out.render_regions_upper_bound +=
                        if matches!(node, UiNode::Image { slice: Some(_), .. }) {
                            9
                        } else {
                            1
                        };
                    if let Some(style) = node.style() {
                        out.render_regions_upper_bound += usize::from(style.background.is_some());
                        out.render_regions_upper_bound += usize::from(style.border_color.is_some()
                            && style.border_width.is_some_and(|width| width > 0.0));
                    }
                    1
                }
            }
        }
        let mut out = UiUsage {
            logical_nodes: 0,
            leaf_nodes: 0,
            render_regions_upper_bound: 0,
            max_nodes: self
                .budget
                .map_or(ui_contract().default_max_nodes, |b| b.max_nodes),
            host_max_nodes: ui_contract().host_max_nodes,
            limit_source: if self.budget.is_some() {
                "screen.budget"
            } else {
                "contract.default"
            },
            subtrees: Vec::new(),
        };
        for n in &self.children {
            let size = count(n, &mut out);
            out.subtrees.push((n.id().into(), size));
        }
        out
    }
    /// Validate the UI representation the engine understands.
    ///
    /// Ordinary stage nodes use the design-space contract. Components preserve
    /// their containing coordinate space and introduce no layout. ScrollView is
    /// the explicit exception: its content uses non-negative local top-left
    /// coordinates, while its viewport uses the containing space.
    pub fn from_json(value: serde_json::Value) -> Result<Self, String> {
        Self::from_json_for_viewport(value, UI_REFERENCE_ASPECT)
    }

    /// Validate a UI tree against the viewport the host actually has.
    ///
    /// Absolute rects are unchanged. Anchored nodes are resolved here, in the
    /// engine, so every host receives the same plain rects and layout has one
    /// implementation that tests can pin.
    pub fn from_json_for_viewport(
        value: serde_json::Value,
        viewport_aspect: f64,
    ) -> Result<Self, String> {
        let aspect = if viewport_aspect.is_finite() && viewport_aspect > 0.0 {
            viewport_aspect
        } else {
            return Err(format!(
                "viewport aspect must be a positive finite ratio, got {viewport_aspect}"
            ));
        };
        // Guard before recursive typed deserialization. Report the first exact
        // offending path, including its containing component, without truncation.
        let requested = value
            .get("budget")
            .map(|b| serde_json::from_value::<UiBudget>(b.clone()))
            .transpose()
            .map_err(|e| {
                format!("UI_BUDGET_INVALID: {e}; expected budget={{max_nodes: positive integer}}")
            })?;
        let limit = requested.map_or(ui_contract().default_max_nodes, |b| b.max_nodes);
        if limit == 0 || limit > ui_contract().host_max_nodes {
            return Err(format!(
                "UI_BUDGET_INVALID: requested={limit}, host_max_nodes={}; set budget.max_nodes within 1..host_max_nodes",
                ui_contract().host_max_nodes
            ));
        }
        let mut stack = vec![(&value, String::from("root"), 0usize)];
        let mut count = 0;
        let mut bytes = 0;
        while let Some((n, path, depth)) = stack.pop() {
            if depth > 0 {
                count += 1;
            }
            if count > limit {
                return Err(format!(
                    "UI_NODE_LIMIT: path={path}, node={}, used={count}, limit={limit}, host_max_nodes={}; raise screen.budget.max_nodes within the host limit or use one image with slice for each nine-slice panel",
                    n["id"],
                    ui_contract().host_max_nodes
                ));
            }
            if depth > ui_contract().max_component_depth + 1
                || (n["kind"] == "component" && depth > ui_contract().max_component_depth)
            {
                return Err(format!(
                    "UI_DEPTH_LIMIT: {path} exceeds the maximum component nesting depth of {}",
                    ui_contract().max_component_depth
                ));
            }
            if let Some(obj) = n.as_object() {
                for v in obj.values() {
                    if let Some(s) = v.as_str() {
                        bytes += s.len();
                    }
                }
                if let Some(family) = n["style"]["font_family"].as_str() {
                    bytes += family.len();
                }
                if let Some(component) = n["background_for"]["component"].as_str() {
                    bytes += component.len();
                }
                if let Some(keys) = n["scroll"]["virtual_items"]["keys"].as_array() {
                    if keys.len() > 100_000 { return Err(format!("UI_VIRTUAL_ITEM_LIMIT: {path}; maximum 100000 keys")); }
                    bytes += keys.iter().filter_map(|k| k.as_str()).map(str::len).sum::<usize>();
                }
            }
            if bytes > ui_contract().max_string_bytes {
                return Err(format!(
                    "UI_STRING_LIMIT: {path}, used={bytes}, limit={}; reduce UI text/identifiers",
                    ui_contract().max_string_bytes
                ));
            }
            if let Some(children) = n["children"].as_array() {
                for (i, c) in children.iter().enumerate().rev() {
                    stack.push((c, format!("{path}.children[{i}]"), depth + 1));
                }
            }
        }
        let raw: RawUiTree = serde_json::from_value(value)
            .map_err(|error| format!("ui.setRoot expects a valid UI tree object: {error}"))?;
        if raw.kind != "screen" {
            return Err(format!(
                "ui.setRoot root kind must be 'screen', got '{}'",
                raw.kind
            ));
        }
        ensure_non_empty("root id", &raw.id)?;
        ensure_non_empty("root node", &raw.node)?;
        let mut ids = BTreeSet::new();
        let mut node_count = 0;
        let mut children = Vec::with_capacity(raw.children.len());
        for raw_node in raw.children {
            children.push(parse_node(raw_node, aspect, &mut ids, &mut node_count, 1, false)?);
        }
        validate_background_scopes(&children, &mut Vec::new(), false)?;

        Ok(Self {
            kind: raw.kind,
            id: raw.id,
            node: raw.node,
            children,
            budget: raw.budget,
        })
    }
}

fn parse_node(
    raw_node: RawUiNode,
    aspect: f64,
    ids: &mut BTreeSet<String>,
    node_count: &mut usize,
    depth: usize,
    local: bool,
) -> Result<UiNode, String> {
    if raw_node.kind == "component" && depth > ui_contract().max_component_depth {
        return Err(format!(
            "ui.setRoot node '{}' exceeds the maximum component nesting depth of {}",
            raw_node.id,
            ui_contract().max_component_depth
        ));
    }
    ensure_non_empty("node id", &raw_node.id)?;
    if !ids.insert(raw_node.id.clone()) {
        return Err(format!(
            "ui.setRoot node id '{}' is duplicated",
            raw_node.id
        ));
    }
    *node_count += 1;
    if raw_node.expanded.is_some() && raw_node.kind != "combobox" {
        return Err(format!("ui.setRoot node '{}' only supports expanded on combobox", raw_node.id));
    }
    if raw_node.drag.is_some() && raw_node.kind != "slider" {
        return Err(format!("UI_SLIDER_DRAG_KIND: '{}' only accepts drag on slider", raw_node.id));
    }
    if let Some(drag) = &raw_node.drag {
        drag.validate(local).map_err(|error| format!("{error}; node={}", raw_node.id))?;
    }
    if raw_node.slice.is_some() && raw_node.kind != "image" {
        return Err(format!(
            "UI_SLICE_INVALID: node '{}' is not an image",
            raw_node.id
        ));
    }
    if raw_node.background_for.is_some() && !matches!(raw_node.kind.as_str(), "image" | "panel") {
        return Err(format!(
            "UI_BACKGROUND_KIND: node '{}' only supports background_for on image or panel",
            raw_node.id
        ));
    }
    let rect = if let Some(v) = raw_node.viewport {
        if raw_node.kind != "scroll_view" || raw_node.rect.is_some() || raw_node.anchor.is_some()
            || raw_node.size.is_some() || raw_node.pivot.is_some() || raw_node.offset.is_some() {
            return Err(format!("UI_SCROLL_VIEWPORT: '{}' uses viewport={{left,top,width,height}} only, not rect/anchor", raw_node.id));
        }
        UiRect { x: v.left, y: if local { v.top } else { 100.0-v.top-v.height }, width: v.width, height: v.height }
    } else { resolve_rect(&raw_node, aspect)? };
    if local {
        if raw_node.anchor.is_some() { return Err(format!("UI_SCROLL_LOCAL_RECT: '{}' needs a local rect, not a stage anchor", raw_node.id)); }
        if [rect.x, rect.y, rect.width, rect.height].iter().any(|v| !v.is_finite())
            || rect.x < 0.0 || rect.y < 0.0 || rect.width <= 0.0 || rect.height <= 0.0 {
            return Err(format!("UI_SCROLL_LOCAL_RECT: '{}' needs finite non-negative x/y and positive width/height", raw_node.id));
        }
    } else { validate_rect(rect)?; }
    if raw_node.scroll.is_some() && raw_node.kind != "scroll_view" {
        return Err(format!("UI_SCROLL_KIND: '{}' only accepts scroll on scroll_view", raw_node.id));
    }
    if let Some(style) = &raw_node.style {
        if matches!(raw_node.kind.as_str(), "component" | "scroll_view") {
            return Err(format!("UI_STYLE_INVALID: '{}' is a container; apply style to its leaves or a panel (styles do not inherit)", raw_node.id));
        }
        style.validate().map_err(|error| format!("{error}; node={}", raw_node.id))?;
        if matches!(raw_node.kind.as_str(), "image" | "panel") && style.has_text_fields() {
            return Err(format!("UI_STYLE_INVALID: '{}' has no text; typography fields require text, button, slider or combobox", raw_node.id));
        }
    }
    let id = raw_node.id;
    match raw_node.kind.as_str() {
        "text" => {
            if raw_node.action.is_some()
                || raw_node.asset.is_some()
                || raw_node.fit.is_some()
                || raw_node.alt.is_some()
                || raw_node.component.is_some()
                || raw_node.children.is_some()
            {
                return Err(format!(
                    "ui.setRoot text node '{id}' only accepts text, optional style and placement"
                ));
            }
            Ok(UiNode::Text {
                id,
                rect,
                text: raw_node.text.unwrap_or_default(),
                style: raw_node.style,
            })
        }
        "button" => {
            if raw_node.asset.is_some()
                || raw_node.fit.is_some()
                || raw_node.alt.is_some()
                || raw_node.component.is_some()
                || raw_node.children.is_some()
            {
                return Err(format!(
                    "ui.setRoot button node '{id}' only accepts text, action, optional style and placement"
                ));
            }
            let action = raw_node.action.ok_or_else(|| {
                format!("ui.setRoot button node '{id}' requires a non-empty action")
            })?;
            ensure_non_empty("button action", &action)?;
            Ok(UiNode::Button {
                id,
                rect,
                text: raw_node.text.unwrap_or_default(),
                action,
                style: raw_node.style,
            })
        }
        "slider" | "combobox" => {
            let kind = raw_node.kind.as_str();
            if raw_node.asset.is_some()
                || raw_node.fit.is_some()
                || raw_node.alt.is_some()
                || raw_node.component.is_some()
                || raw_node.children.is_some()
            {
                return Err(format!(
                    "ui.setRoot {kind} node '{id}' only accepts text, action, optional style, placement and combobox expanded"
                ));
            }
            let action = raw_node.action.ok_or_else(|| {
                format!("ui.setRoot {kind} node '{id}' requires a non-empty action")
            })?;
            ensure_non_empty("widget action", &action)?;
            if kind == "combobox" {
                return Ok(UiNode::ComboBox {
                    id,
                    rect,
                    text: raw_node.text.unwrap_or_default(),
                    action,
                    expanded: raw_node.expanded.unwrap_or(false),
                    style: raw_node.style,
                });
            }
            if raw_node.drag.is_some() && id.len() > 1024 {
                return Err("UI_SLIDER_ID: interactive slider IDs must be at most 1024 UTF-8 bytes".into());
            }
            Ok(UiNode::Slider {
                id,
                rect,
                text: raw_node.text.unwrap_or_default(),
                action,
                drag: raw_node.drag,
                style: raw_node.style,
            })
        }
        "image" => {
            if raw_node.text.is_some()
                || raw_node.action.is_some()
                || raw_node.component.is_some()
                || raw_node.children.is_some()
            {
                return Err(format!(
                    "ui.setRoot image node '{id}' only accepts asset, fit, alt, optional style, background_for and placement"
                ));
            }
            let asset = raw_node
                .asset
                .ok_or_else(|| format!("ui.setRoot image node '{id}' requires an asset id"))?;
            ensure_asset_id(&asset)?;
            if let Some(slice) = raw_node.slice {
                slice
                    .validate()
                    .map_err(|e| format!("{e}; node={id}; asset={asset}"))?;
                if raw_node.fit.is_some_and(|fit| fit != UiImageFit::Stretch) {
                    return Err(format!(
                        "UI_SLICE_FIT_CONFLICT: node={id}; slice replaces contain/cover; omit fit or use stretch"
                    ));
                }
            }
            Ok(UiNode::Image {
                id,
                rect,
                asset,
                fit: raw_node.fit.unwrap_or(if raw_node.slice.is_some() {
                    UiImageFit::Stretch
                } else {
                    UiImageFit::Contain
                }),
                slice: raw_node.slice,
                alt: raw_node.alt,
                style: raw_node.style,
                background_for: raw_node.background_for,
            })
        }
        "panel" => {
            if raw_node.text.is_some() || raw_node.action.is_some() || raw_node.asset.is_some()
                || raw_node.fit.is_some() || raw_node.alt.is_some() || raw_node.component.is_some()
                || raw_node.children.is_some() {
                return Err(format!("ui.setRoot panel node '{id}' only accepts style, background_for and placement"));
            }
            Ok(UiNode::Panel { id, rect, style: raw_node.style, background_for: raw_node.background_for })
        }
        "component" => {
            if raw_node.text.is_some()
                || raw_node.action.is_some()
                || raw_node.asset.is_some()
                || raw_node.fit.is_some()
                || raw_node.alt.is_some()
            {
                return Err(format!(
                    "ui.setRoot component node '{id}' only accepts component, children and placement"
                ));
            }
            let component = raw_node.component.ok_or_else(|| {
                format!("ui.setRoot component node '{id}' requires a component name")
            })?;
            ensure_non_empty("component name", &component)?;
            let children = raw_node.children.unwrap_or_default();
            let mut parsed_children = Vec::with_capacity(children.len());
            for child in children {
                parsed_children.push(parse_node(child, aspect, ids, node_count, depth + 1, local)?);
            }
            Ok(UiNode::Component {
                id,
                rect,
                component,
                children: parsed_children,
            })
        }
        "scroll_view" => {
            if raw_node.text.is_some() || raw_node.action.is_some() || raw_node.asset.is_some()
                || raw_node.fit.is_some() || raw_node.alt.is_some() || raw_node.component.is_some() {
                return Err(format!("UI_SCROLL_FIELDS: '{id}' accepts placement, scroll and children only"));
            }
            let scroll = raw_node.scroll.ok_or_else(|| format!("UI_SCROLL_SPEC: '{id}' requires scroll"))?;
            if !matches!(scroll.axis.as_str(), "vertical" | "horizontal" | "both") {
                return Err(format!("UI_SCROLL_AXIS: '{id}' expected vertical, horizontal or both"));
            }
            if !scroll.deceleration.is_finite() || scroll.deceleration <= 0.0 || scroll.deceleration > 100.0 {
                return Err(format!("UI_SCROLL_DECELERATION: '{id}' needs a finite number in (0, 100] per second"));
            }
            if let Some(r) = scroll.wheel_rect {
                if local { return Err(format!("UI_SCROLL_WHEEL_RECT: nested '{id}' uses its viewport only")); }
                validate_rect(r)?;
            }
            if let Some(v) = &scroll.virtual_items {
                let mut keys = BTreeSet::new();
                if scroll.axis != "vertical" || v.columns == 0 || v.columns > 1024
                    || [v.row_height, v.column_width].iter().any(|n| !n.is_finite() || *n <= 0.0)
                    || [v.gap_x, v.gap_y].iter().any(|n| !n.is_finite() || *n < 0.0)
                    || v.column_width * v.columns as f64 + v.gap_x * (v.columns - 1) as f64 > rect.width + 1e-8
                    || !(v.keys.len().div_ceil(v.columns.max(1)) as f64 * (v.row_height + v.gap_y)).is_finite()
                    || v.keys.len() > 100_000 || v.keys.iter().any(|k| k.trim().is_empty() || !keys.insert(k))
                    || (v.keys.is_empty() && (v.first != 0 || v.last != 0))
                    || (!v.keys.is_empty() && (v.first == 0 || v.first > v.last || v.last > v.keys.len())) {
                    return Err(format!("UI_VIRTUAL_SPEC: '{id}' needs unique stable keys, positive cell size, fitting columns and a valid inclusive range"));
                }
                let expected = if v.keys.is_empty() { 0 } else { v.last - v.first + 1 };
                if raw_node.children.as_ref().map_or(0, Vec::len) != expected {
                    return Err(format!("UI_VIRTUAL_WINDOW: '{id}' needs one wrapper per materialized item ({expected})"));
                }
            }
            let mut children = Vec::new();
            for child in raw_node.children.unwrap_or_default() {
                children.push(parse_node(child, aspect, ids, node_count, depth + 1, true)?);
            }
            Ok(UiNode::ScrollView { id, rect, scroll, children })
        }
        kind => Err(format!(
            "ui.setRoot node '{id}' has unsupported kind '{kind}'; use text, button, slider, combobox, image, panel, component or scroll_view"
        )),
    }
}

fn validate_background_scopes<'a>(
    nodes: &'a [UiNode],
    ancestors: &mut Vec<(&'a str, UiRect)>,
    local: bool,
) -> Result<(), String> {
    for node in nodes {
        if let Some(scope) = node.background_for() {
            let bounds = match scope {
                UiBackgroundScope::Screen { .. } if local => {
                    return Err(format!(
                        "UI_BACKGROUND_SCOPE: node '{}' cannot target screen across a scroll content boundary",
                        node.id()
                    ));
                }
                UiBackgroundScope::Screen { .. } => UiRect {
                    x: 0.0, y: 0.0, width: 100.0, height: 100.0,
                },
                UiBackgroundScope::Component { component } => {
                    ancestors.iter().rev().find(|(id, _)| *id == component.as_str()).map(|(_, rect)| *rect)
                        .ok_or_else(|| format!(
                            "UI_BACKGROUND_SCOPE: node '{}' background_for.component '{}' must name an ancestor component in the same coordinate space",
                            node.id(), component
                        ))?
                }
            };
            let rect = node.rect();
            let epsilon = 1e-8;
            let dx = rect.x - bounds.x;
            let dy = rect.y - bounds.y;
            // Differences avoid overflowing right/bottom sums in local scroll
            // coordinates, which deliberately have no stage-size ceiling.
            if dx < -epsilon || dy < -epsilon
                || rect.width > bounds.width + epsilon - dx
                || rect.height > bounds.height + epsilon - dy {
                return Err(format!(
                    "UI_BACKGROUND_BOUNDS: node '{}' must fit inside its declared background_for scope",
                    node.id()
                ));
            }
        }
        match node {
            UiNode::Component { id, rect, children, .. } => {
                ancestors.push((id, *rect));
                validate_background_scopes(children, ancestors, local)?;
                ancestors.pop();
            }
            UiNode::ScrollView { children, .. } => {
                validate_background_scopes(children, &mut Vec::new(), true)?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn ensure_non_empty(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("ui.setRoot {label} must not be empty"));
    }
    Ok(())
}

fn ensure_asset_id(value: &str) -> Result<(), String> {
    ensure_non_empty("image asset", value)?;
    let Some((scheme, path)) = value.split_once("://") else {
        return Err("ui.setRoot image asset must be a stable id such as asset://ui/logo, not a project path or URL".to_string());
    };
    if scheme.is_empty()
        || !scheme.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
        })
        || path.trim().is_empty()
        || matches!(
            scheme.to_ascii_lowercase().as_str(),
            "http" | "https" | "file" | "data"
        )
    {
        return Err(
            "ui.setRoot image asset must be a stable non-URL id such as asset://ui/logo"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_rect(rect: UiRect) -> Result<(), String> {
    if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.width.is_finite()
        || !rect.height.is_finite()
    {
        return Err("ui.setRoot rect values must be finite".to_string());
    }
    if rect.width <= 0.0 || rect.height <= 0.0 {
        return Err("ui.setRoot rect width and height must be greater than zero".to_string());
    }
    if rect.x < 0.0
        || rect.y < 0.0
        || rect.x + rect.width > UI_DESIGN_WIDTH
        || rect.y + rect.height > UI_DESIGN_HEIGHT
    {
        return Err(format!(
            "ui.setRoot rect must stay inside the normalized 0..100 design space (x={}, y={}, width={}, height={})",
            rect.x, rect.y, rect.width, rect.height
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{UI_REFERENCE_ASPECT, UiBackgroundScope, UiNode, UiRect, UiTree};

    #[test]
    fn slider_drag_geometry_defaults_and_raw_boundary_validation() {
        let slider = serde_json::json!({"kind":"slider","id":"volume","text":"50%","action":"Volume",
            "rect":{"x":10,"y":10,"width":30,"height":10},
            "drag":{"track_rect":{"x":12,"y":12,"width":26,"height":2},"hit_rect":{"x":8,"y":8,"width":34,"height":14}}});
        let tree = |node| serde_json::json!({"kind":"screen","id":"screen","node":"screen","children":[node]});
        let json = serde_json::to_value(UiTree::from_json(tree(slider.clone())).unwrap()).unwrap();
        assert_eq!(json["children"][0]["drag"]["axis"], "horizontal");
        assert_eq!(json["children"][0]["drag"]["reverse"], false);
        assert_eq!(json["children"][0]["drag"]["enabled"], true);
        let mut old = slider.clone(); old.as_object_mut().unwrap().remove("drag");
        assert!(serde_json::to_value(UiTree::from_json(tree(old)).unwrap()).unwrap()["children"][0].get("drag").is_none());
        for (field, invalid) in [("axis", serde_json::json!("diagonal")), ("reverse", serde_json::json!(1)), ("enabled", serde_json::json!("true")), ("unknown", serde_json::json!(true))] {
            let mut node = slider.clone(); node["drag"][field] = invalid;
            assert!(UiTree::from_json(tree(node)).is_err(), "{field}");
        }
        for (field, invalid) in [("x", -1.0), ("y", -1.0), ("width", 0.0), ("height", -1.0), ("x", 90.0)] {
            let mut node = slider.clone(); node["drag"]["track_rect"][field] = invalid.into();
            assert!(UiTree::from_json(tree(node)).unwrap_err().contains("UI_SLIDER_DRAG_INVALID"));
        }
        let mut node = slider.clone();node["kind"] = "button".into();
        assert!(UiTree::from_json(tree(node)).unwrap_err().contains("UI_SLIDER_DRAG_KIND"));
        let mut node = slider.clone();node.as_object_mut().unwrap().remove("rect");
        node["anchor"] = "center".into();node["size"] = serde_json::json!({"width":30,"height":10});
        assert!(UiTree::from_json(tree(node)).is_ok());
        let mut local = slider;local["drag"]["track_rect"]["y"] = 1000.into();
        let local_tree = |node| tree(serde_json::json!({"kind":"scroll_view","id":"list","viewport":{"left":10,"top":10,"width":50,"height":50},"scroll":{},"children":[node]}));
        assert!(UiTree::from_json(local_tree(local.clone())).is_ok());
        local["drag"]["hit_rect"]["x"] = (-1).into();
        assert!(UiTree::from_json(local_tree(local.clone())).is_ok(), "hit tolerance is clipped by the host");
        local["drag"]["track_rect"]["x"] = (-1).into();
        assert!(UiTree::from_json(local_tree(local)).unwrap_err().contains("UI_SLIDER_DRAG_INVALID"));
    }

    #[test]
    fn scroll_momentum_defaults_and_raw_boundary_validation() {
        let node = serde_json::json!({"kind":"scroll_view","id":"scroller",
            "viewport":{"left":10,"top":10,"width":20,"height":20},"scroll":{}});
        let value = serde_json::json!({"kind":"screen","id":"s","node":"s","children":[node]});
        let json = serde_json::to_value(UiTree::from_json(value.clone()).unwrap()).unwrap();
        assert_eq!(json["children"][0]["scroll"]["inertia"], false);
        assert_eq!(json["children"][0]["scroll"]["deceleration"], 8.0);
        let mut value = value;
        value["children"][0]["scroll"]["inertia"] = true.into();
        value["children"][0]["scroll"]["deceleration"] = 12.0.into();
        assert!(UiTree::from_json(value.clone()).is_ok());
        for invalid in [serde_json::json!(0), serde_json::json!(-1), serde_json::json!(101), serde_json::json!("8")] {
            value["children"][0]["scroll"]["deceleration"] = invalid;
            assert!(UiTree::from_json(value.clone()).is_err());
        }
        value["children"][0]["scroll"]["deceleration"] = 8.into();
        value["children"][0]["scroll"]["inertia"] = "yes".into();
        assert!(UiTree::from_json(value).is_err());
    }

    fn background_panel(scope: serde_json::Value) -> serde_json::Value {
        serde_json::json!({"kind":"panel","id":"surface",
            "rect":{"x":12,"y":12,"width":16,"height":16},"background_for":scope})
    }

    fn background_component(children: Vec<serde_json::Value>) -> serde_json::Value {
        serde_json::json!({"kind":"component","id":"card","component":"test.card",
            "rect":{"x":10,"y":10,"width":20,"height":20},"children":children})
    }

    fn background_screen(children: Vec<serde_json::Value>) -> serde_json::Value {
        serde_json::json!({"kind":"screen","id":"screen","node":"settings","children":children})
    }

    #[test]
    fn background_ownership_roundtrips_without_changing_order_or_placement() {
        let mut image = background_panel(serde_json::json!({"component":"card"}));
        image["kind"] = "image".into();
        image["asset"] = "asset://card".into();
        let mut value = background_screen(vec![
            background_panel(serde_json::json!({"screen":true})),
            background_component(vec![image]),
            serde_json::json!({"kind":"panel","id":"plain","rect":{"x":0,"y":0,"width":1,"height":1}}),
        ]);
        value["children"][0]["id"] = "backdrop".into();
        // Root and component ids have always been separate namespaces. Explicit
        // scope objects preserve the distinction even when their ids match.
        value["id"] = "card".into();
        let tree = UiTree::from_json(value).unwrap();
        assert_eq!(tree.children[0].background_for(), Some(&UiBackgroundScope::Screen { screen: true }));
        assert_eq!(tree.children[1].children()[0].background_for(),
            Some(&UiBackgroundScope::Component { component: "card".into() }));
        assert!(tree.children[2].background_for().is_none());
        let serialized = serde_json::to_value(&tree).unwrap();
        assert_eq!(serialized["children"][0]["id"], "backdrop");
        assert_eq!(serialized["children"][0]["background_for"], serde_json::json!({"screen":true}));
        assert_eq!(serialized["children"][1]["children"][0]["background_for"], serde_json::json!({"component":"card"}));
        assert_eq!(*tree.children[1].children()[0].rect(), UiRect {x:12.0,y:12.0,width:16.0,height:16.0});
        assert!(serialized["children"][2].get("background_for").is_none());
        assert!(serde_json::to_value(UiBackgroundScope::Screen { screen: false }).is_err());
    }

    #[test]
    fn background_ownership_rejects_ambiguous_scopes_and_inapplicable_nodes() {
        for scope in [
            serde_json::json!({"screen":false}),
            serde_json::json!({"screen":true,"component":"card"}),
            serde_json::json!({"screen":true,"extra":true}),
            serde_json::json!({"component":"card","extra":true}),
            serde_json::json!({}), serde_json::json!("screen"),
            serde_json::json!({"screen":"true"}),
        ] {
            assert!(UiTree::from_json(background_screen(vec![background_panel(scope.clone())])).is_err(), "accepted {scope}");
        }
        for kind in ["text", "button", "slider", "combobox", "component", "scroll_view"] {
            let mut node = background_panel(serde_json::json!({"screen":true}));
            node["kind"] = kind.into();
            let error = UiTree::from_json(background_screen(vec![node])).unwrap_err();
            assert!(error.contains("UI_BACKGROUND_KIND"), "{kind}: {error}");
        }
        let mut root = background_screen(vec![]);
        root["background_for"] = serde_json::json!({"screen":true});
        assert!(UiTree::from_json(root).unwrap_err().contains("unknown field `background_for`"));
    }

    #[test]
    fn background_component_scope_requires_an_actual_ancestor() {
        for target in ["", "missing", "screen", "surface", "sibling", "descendant"] {
            let mut card = background_component(vec![background_panel(serde_json::json!({"component":target}))]);
            card["children"].as_array_mut().unwrap().push(serde_json::json!({
                "kind":"component","id":"descendant","component":"test.child",
                "rect":{"x":12,"y":12,"width":1,"height":1},"children":[]}));
            let sibling = serde_json::json!({"kind":"component","id":"sibling","component":"test.sibling",
                "rect":{"x":10,"y":10,"width":20,"height":20},"children":[]});
            let error = UiTree::from_json(background_screen(vec![sibling, card])).unwrap_err();
            assert!(error.contains("UI_BACKGROUND_SCOPE") && error.contains("ancestor"), "{target}: {error}");
        }
        let error = UiTree::from_json(background_screen(vec![background_panel(serde_json::json!({"component":"screen"}))])).unwrap_err();
        assert!(error.contains("UI_BACKGROUND_SCOPE"));
        // A non-immediate ancestor is valid without making nested coordinates local.
        let nested = serde_json::json!({"kind":"component","id":"inner","component":"test.inner",
            "rect":{"x":12,"y":12,"width":16,"height":16},
            "children":[background_panel(serde_json::json!({"component":"card"}))]});
        assert!(UiTree::from_json(background_screen(vec![background_component(vec![nested])])).is_ok());
    }

    #[test]
    fn background_ownership_cannot_cross_scroll_coordinate_boundaries() {
        let scroll = |children: Vec<serde_json::Value>| serde_json::json!({"kind":"scroll_view","id":"scroller",
            "viewport":{"left":10,"top":10,"width":30,"height":30},"scroll":{},"children":children});
        for scope in [serde_json::json!({"screen":true}), serde_json::json!({"component":"card"})] {
            let value = background_screen(vec![background_component(vec![scroll(vec![background_panel(scope)])])]);
            assert!(UiTree::from_json(value).unwrap_err().contains("UI_BACKGROUND_SCOPE"));
        }
        // A component inside local content may own a local decorative surface.
        let local = scroll(vec![background_component(vec![background_panel(serde_json::json!({"component":"card"}))])]);
        assert!(UiTree::from_json(background_screen(vec![local])).is_ok());
        let mut nested = scroll(vec![background_panel(serde_json::json!({"component":"card"}))]);
        nested["id"] = "nested_scroller".into();
        let local = scroll(vec![background_component(vec![nested])]);
        assert!(UiTree::from_json(background_screen(vec![local])).unwrap_err().contains("UI_BACKGROUND_SCOPE"));
    }

    #[test]
    fn background_surface_must_fit_scope_without_changing_the_authored_rect() {
        for rect in [
            serde_json::json!({"x":9,"y":12,"width":16,"height":16}),
            serde_json::json!({"x":12,"y":9,"width":16,"height":16}),
            serde_json::json!({"x":12,"y":12,"width":19,"height":16}),
            serde_json::json!({"x":12,"y":12,"width":16,"height":19}),
        ] {
            let mut panel = background_panel(serde_json::json!({"component":"card"}));
            panel["rect"] = rect;
            let error = UiTree::from_json(background_screen(vec![background_component(vec![panel])])).unwrap_err();
            assert!(error.contains("UI_BACKGROUND_BOUNDS"), "{error}");
        }
        let mut panel = background_panel(serde_json::json!({"component":"card"}));
        panel["rect"] = serde_json::json!({"x":10.0-1e-9,"y":10.0,"width":20.0+2e-9,"height":20.0});
        let tree = UiTree::from_json(background_screen(vec![background_component(vec![panel.clone()])])).unwrap();
        assert_eq!(serde_json::to_value(tree).unwrap()["children"][0]["children"][0]["rect"], panel["rect"]);
    }

    #[test]
    fn background_component_reference_counts_toward_the_string_budget() {
        let target = "x".repeat(super::ui_contract().max_string_bytes + 1);
        let error = UiTree::from_json(background_screen(vec![background_panel(serde_json::json!({"component":target}))])).unwrap_err();
        assert!(error.contains("UI_STRING_LIMIT"), "{error}");
    }

    #[cfg(feature = "dev-tools")]
    #[test]
    fn background_scope_schema_matches_exact_runtime_objects() {
        let schema = serde_json::to_value(schemars::schema_for!(UiBackgroundScope)).unwrap();
        let variants = schema["anyOf"].as_array().unwrap();
        assert_eq!(variants.len(), 2);
        for variant in variants {
            assert_eq!(variant["additionalProperties"], false);
        }
        assert_eq!(variants[0]["properties"]["screen"]["const"], true);
    }

    #[test]
    fn configurable_budget_counts_wrappers_and_preserves_large_screens() {
        let node = |i| serde_json::json!({"kind":"text","id":format!("t{i}"),"text":"x","rect":{"x":0,"y":0,"width":1,"height":1}});
        let mut value = serde_json::json!({"kind":"screen","id":"s","node":"test","children":(0..3000).map(node).collect::<Vec<_>>()});
        let error = UiTree::from_json(value.clone()).unwrap_err();
        assert!(
            error.contains("UI_NODE_LIMIT")
                && error.contains("children[2048]")
                && error.contains("used=2049"),
            "{error}"
        );
        value["budget"] = serde_json::json!({"max_nodes":3000});
        let tree = UiTree::from_json(value.clone()).unwrap();
        assert_eq!(tree.usage().logical_nodes, 3000);
        assert_eq!(tree.usage().limit_source, "screen.budget");
        assert_eq!(
            serde_json::to_value(tree).unwrap()["budget"]["max_nodes"],
            3000
        );
        for bad in [0, 16385] {
            value["budget"]["max_nodes"] = bad.into();
            assert!(
                UiTree::from_json(value.clone())
                    .unwrap_err()
                    .contains("UI_BUDGET_INVALID")
            );
        }
        value["children"] = serde_json::json!([{"kind":"component","id":"group","component":"panel","rect":{"x":0,"y":0,"width":1,"height":1},"children":[node(0)]}]);
        value["budget"]["max_nodes"] = 1.into();
        assert!(
            UiTree::from_json(value)
                .unwrap_err()
                .contains("children[0].children[0]")
        );
    }

    #[test]
    fn slice_is_one_node_and_nine_regions_with_safe_small_destinations() {
        let mut value = serde_json::json!({"kind":"screen","id":"s","node":"test","children":[{"kind":"image","id":"panel","asset":"texture://panel","rect":{"x":0,"y":0,"width":100,"height":100},"slice":{"left":2,"top":3,"right":4,"bottom":5,"pixels_per_unit":2}}]});
        let tree = UiTree::from_json(value.clone()).unwrap();
        assert_eq!(tree.usage().logical_nodes, 1);
        assert_eq!(tree.usage().render_regions_upper_bound, 9);
        let UiNode::Image {
            slice: Some(slice), ..
        } = tree.children[0]
        else {
            panic!()
        };
        let patches = slice.patches(20.0, 20.0, 200.0, 100.0, 100.0).unwrap();
        assert_eq!(patches.len(), 9);
        assert_eq!(patches[0].1.width, 1.0);
        assert_eq!(patches[0].1.height, 1.5);
        let small = slice.patches(20.0, 20.0, 1.0, 1.0, 100.0).unwrap();
        for (_, d) in small {
            assert!(d.x + d.width <= 1.0 + 1e-9 && d.y + d.height <= 1.0 + 1e-9);
        }
        assert!(
            slice
                .patches(4.0, 4.0, 100.0, 100.0, 100.0)
                .unwrap_err()
                .contains("UI_SLICE_BOUNDS")
        );
        value["children"][0]["slice"]["pixels_per_unit"] = 0.into();
        assert!(
            UiTree::from_json(value.clone())
                .unwrap_err()
                .contains("UI_SLICE_INVALID")
        );
        value["children"][0]["slice"]["pixels_per_unit"] = 2.into();
        value["children"][0]["fit"] = "cover".into();
        assert!(
            UiTree::from_json(value)
                .unwrap_err()
                .contains("UI_SLICE_FIT_CONFLICT")
        );
    }

    #[test]
    fn combobox_preserves_controlled_state_and_requires_action() {
        let mut value = serde_json::json!({
            "kind":"screen", "id":"settings", "node":"settings", "children":[{
                "kind":"combobox", "id":"quality", "text":"High", "action":"QualityToggle",
                "rect":{"x":10,"y":10,"width":70,"height":10}
            }]
        });
        let tree = UiTree::from_json(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(tree).unwrap()["children"][0]["expanded"], false);
        value["children"][0]["expanded"] = true.into();
        let tree = UiTree::from_json(value.clone()).unwrap();
        let serialized = serde_json::to_value(tree).unwrap();
        assert_eq!(serialized["children"][0]["expanded"], true);
        assert_eq!(serialized["children"][0]["action"], "QualityToggle");
        value["children"][0]["action"] = "".into();
        assert!(UiTree::from_json(value.clone()).is_err());
        value["children"][0]["kind"] = "text".into();
        assert!(UiTree::from_json(value).unwrap_err().contains("expanded on combobox"));
    }

    #[test]
    fn validates_and_serializes_the_minimal_flat_tree() {
        let tree = UiTree::from_json(serde_json::json!({
            "kind": "screen",
            "id": "dialogue",
            "node": "intro",
            "children": [
                {
                    "kind": "text",
                    "id": "speaker",
                    "rect": {"x": 10.0, "y": 70.0, "width": 80.0, "height": 10.0},
                    "text": "Mira"
                },
                {
                    "kind": "button",
                    "id": "kind",
                    "rect": {"x": 10.0, "y": 10.0, "width": 35.0, "height": 10.0},
                    "text": "Kind",
                    "action": "ChooseKind"
                }
            ]
        }))
        .unwrap();

        assert_eq!(
            serde_json::to_value(tree).unwrap(),
            serde_json::json!({
                "kind": "screen",
                "id": "dialogue",
                "node": "intro",
                "children": [
                    {
                        "kind": "text",
                        "id": "speaker",
                        "rect": {"x": 10.0, "y": 70.0, "width": 80.0, "height": 10.0},
                        "text": "Mira"
                    },
                    {
                        "kind": "button",
                        "id": "kind",
                        "rect": {"x": 10.0, "y": 10.0, "width": 35.0, "height": 10.0},
                        "text": "Kind",
                        "action": "ChooseKind"
                    }
                ]
            })
        );
    }

    fn anchored(node: serde_json::Value, aspect: f64) -> UiRect {
        let tree = UiTree::from_json_for_viewport(
            serde_json::json!({"kind": "screen", "id": "s", "node": "s", "children": [node]}),
            aspect,
        )
        .unwrap();
        *tree.children[0].rect()
    }

    fn corner_button() -> serde_json::Value {
        serde_json::json!({
            "kind": "button", "id": "spin", "text": "Spin", "action": "Spin",
            "anchor": "bottom_right",
            "offset": {"x": 4.0, "y": 4.0},
            "size": {"width": 30.0, "height": 10.0}
        })
    }

    /// The point of anchoring: one declaration stays in the same corner and
    /// keeps its shape when the screen changes shape.
    #[test]
    fn an_anchored_node_keeps_its_corner_and_proportions_on_any_aspect() {
        let wide = anchored(corner_button(), UI_REFERENCE_ASPECT);
        let tall = anchored(corner_button(), 9.0 / 16.0);

        assert!((wide.y - 4.0).abs() < 1e-9, "{wide:?}");
        assert!((tall.y - 4.0).abs() < 1e-9, "{tall:?}");
        let wide_gap = (100.0 - (wide.x + wide.width)) * UI_REFERENCE_ASPECT;
        let tall_gap = (100.0 - (tall.x + tall.width)) * (9.0 / 16.0);
        assert!((wide_gap - 4.0).abs() < 1e-9, "{wide_gap}");
        assert!((tall_gap - 4.0).abs() < 1e-9, "{tall_gap}");

        assert!((wide.width * UI_REFERENCE_ASPECT / wide.height - 3.0).abs() < 1e-9);
        assert!((tall.width * (9.0 / 16.0) / tall.height - 3.0).abs() < 1e-9);
        assert!(
            tall.width > wide.width,
            "a narrow screen needs more design width for the same shape"
        );
    }

    #[test]
    fn a_centered_node_is_centered() {
        let rect = anchored(
            serde_json::json!({
                "kind": "text", "id": "title", "text": "Title",
                "anchor": "center", "size": {"width": 40.0, "height": 10.0}
            }),
            UI_REFERENCE_ASPECT,
        );
        assert!((rect.x + rect.width / 2.0 - 50.0).abs() < 1e-9, "{rect:?}");
        assert!((rect.y + rect.height / 2.0 - 50.0).abs() < 1e-9, "{rect:?}");
    }

    #[test]
    fn placement_must_be_declared_exactly_once() {
        let both = UiTree::from_json(serde_json::json!({
            "kind": "screen", "id": "s", "node": "s", "children": [{
                "kind": "text", "id": "t", "text": "x",
                "rect": {"x": 0.0, "y": 0.0, "width": 10.0, "height": 10.0},
                "anchor": "center", "size": {"width": 10.0, "height": 10.0}
            }]
        }));
        assert!(both.unwrap_err().contains("pick one placement"));

        let neither = UiTree::from_json(serde_json::json!({
            "kind": "screen", "id": "s", "node": "s", "children": [
                {"kind": "text", "id": "t", "text": "x"}
            ]
        }));
        assert!(neither.unwrap_err().contains("either a rect or an anchor"));

        let sizeless = UiTree::from_json(serde_json::json!({
            "kind": "screen", "id": "s", "node": "s", "children": [
                {"kind": "text", "id": "t", "text": "x", "anchor": "top"}
            ]
        }));
        assert!(sizeless.unwrap_err().contains("requires a size"));
    }

    #[test]
    fn rejects_duplicate_ids_and_invalid_rectangles() {
        let duplicate = UiTree::from_json(serde_json::json!({
            "kind": "screen", "id": "screen", "node": "intro",
            "children": [
                {"kind": "text", "id": "same", "rect": {"x": 0, "y": 0, "width": 1, "height": 1}, "text": "a"},
                {"kind": "text", "id": "same", "rect": {"x": 0, "y": 0, "width": 1, "height": 1}, "text": "b"}
            ]
        }))
        .unwrap_err();
        assert!(duplicate.contains("duplicated"));

        let invalid_rect = UiTree::from_json(serde_json::json!({
            "kind": "screen", "id": "screen", "node": "intro",
            "children": [{"kind": "text", "id": "text", "rect": {"x": 0, "y": 0, "width": 0, "height": 1}, "text": "a"}]
        }))
        .unwrap_err();
        assert!(invalid_rect.contains("greater than zero"));

        let outside_design_space = UiTree::from_json(serde_json::json!({
            "kind": "screen",
            "id": "screen",
            "node": "main",
            "children": [{"kind": "text", "id": "text", "rect": {"x": 960, "y": 0, "width": 10, "height": 1}, "text": "bad"}]
        }))
        .unwrap_err();
        assert!(outside_design_space.contains("normalized 0..100"));

        let invalid_asset = UiTree::from_json(serde_json::json!({
            "kind": "screen",
            "id": "screen",
            "node": "main",
            "children": [{"kind": "image", "id": "logo", "asset": "assets/logo.svg", "rect": {"x": 0, "y": 0, "width": 1, "height": 1}}]
        }))
        .unwrap_err();
        assert!(invalid_asset.contains("stable id"));
    }

    #[test]
    fn validates_images_and_nested_reusable_components() {
        let tree = UiTree::from_json(serde_json::json!({
            "kind": "screen",
            "id": "screen",
            "node": "screen",
            "children": [{
                "kind": "component",
                "id": "toolbar",
                "component": "ui.toolbar",
                "rect": {"x": 0, "y": 80, "width": 100, "height": 20},
                "children": [
                    {"kind": "image", "id": "logo", "asset": "asset://ui/logo", "fit": "contain", "alt": "Unone", "rect": {"x": 5, "y": 85, "width": 10, "height": 10}},
                    {"kind": "button", "id": "save", "text": "Save", "action": "Save", "rect": {"x": 20, "y": 85, "width": 20, "height": 10}},
                    {"kind": "slider", "id": "volume", "text": "80%", "action": "Setting_music", "rect": {"x": 45, "y": 85, "width": 30, "height": 10}}
                ]
            }]
        }))
        .unwrap();
        assert!(matches!(tree.children[0], UiNode::Component { .. }));
        assert_eq!(tree.children[0].id(), "toolbar");
        assert_eq!(tree.children[0].children().len(), 3);
        assert_eq!(
            serde_json::to_value(tree.children[0].children()[0].clone()).unwrap()["kind"],
            "image"
        );
        assert_eq!(
            serde_json::to_value(tree.children[0].children()[0].clone()).unwrap()["alt"],
            "Unone"
        );
        assert_eq!(
            serde_json::to_value(tree.children[0].children()[2].clone()).unwrap()["kind"],
            "slider"
        );
    }

    #[test]
    fn rejects_duplicate_ids_across_nested_components_and_limits_depth() {
        let duplicate = UiTree::from_json(serde_json::json!({
            "kind": "screen", "id": "screen", "node": "screen", "children": [{
                "kind": "component", "id": "group", "component": "ui.group", "rect": {"x": 0, "y": 0, "width": 100, "height": 100},
                "children": [{"kind": "text", "id": "same", "text": "a", "rect": {"x": 0, "y": 0, "width": 10, "height": 10}}]
            }, {"kind": "text", "id": "same", "text": "b", "rect": {"x": 20, "y": 0, "width": 10, "height": 10}}]
        })).unwrap_err();
        assert!(duplicate.contains("duplicated"));

        let mut node = serde_json::json!({"kind": "text", "id": "leaf", "text": "x", "rect": {"x": 0, "y": 0, "width": 1, "height": 1}});
        for index in (0..17).rev() {
            node = serde_json::json!({"kind": "component", "id": format!("group{index}"), "component": "ui.group", "rect": {"x": 0, "y": 0, "width": 100, "height": 100}, "children": [node]});
        }
        let depth_error = UiTree::from_json(
            serde_json::json!({"kind":"screen","id":"screen","node":"screen","children":[node]}),
        )
        .unwrap_err();
        assert!(depth_error.contains("maximum component nesting depth"));

        let mut within_limit = serde_json::json!({"kind": "text", "id": "leaf_ok", "text": "x", "rect": {"x": 0, "y": 0, "width": 1, "height": 1}});
        for index in (0..16).rev() {
            within_limit = serde_json::json!({"kind": "component", "id": format!("ok{index}"), "component": "ui.group", "rect": {"x": 0, "y": 0, "width": 100, "height": 100}, "children": [within_limit]});
        }
        assert!(UiTree::from_json(serde_json::json!({"kind":"screen","id":"screen_ok","node":"screen","children":[within_limit]})).is_ok());
    }

    #[test]
    fn node_types_have_stable_typed_shape() {
        let _ = UiNode::Text {
            id: "text".to_string(),
            rect: UiRect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            text: "hello".to_string(),
            style: None,
        };
    }
}
