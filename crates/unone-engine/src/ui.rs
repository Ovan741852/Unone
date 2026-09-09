use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind")]
pub enum UiNode {
    #[serde(rename = "text")]
    Text {
        id: String,
        rect: UiRect,
        text: String,
    },
    #[serde(rename = "button")]
    Button {
        id: String,
        rect: UiRect,
        text: String,
        action: String,
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
        /// Optional accessibility/inspection text. Hosts may use it as the
        /// image alt text; Core does not interpret or localize it.
        #[serde(skip_serializing_if = "Option::is_none")]
        alt: Option<String>,
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum UiImageFit {
    Contain,
    Cover,
    Stretch,
}

impl Default for UiImageFit {
    fn default() -> Self {
        Self::Contain
    }
}

impl UiNode {
    pub fn id(&self) -> &str {
        match self {
            Self::Text { id, .. }
            | Self::Button { id, .. }
            | Self::Image { id, .. }
            | Self::Component { id, .. } => id,
        }
    }

    pub fn rect(&self) -> &UiRect {
        match self {
            Self::Text { rect, .. }
            | Self::Button { rect, .. }
            | Self::Image { rect, .. }
            | Self::Component { rect, .. } => rect,
        }
    }

    pub fn rect_mut(&mut self) -> &mut UiRect {
        match self {
            Self::Text { rect, .. }
            | Self::Button { rect, .. }
            | Self::Image { rect, .. }
            | Self::Component { rect, .. } => rect,
        }
    }

    pub fn text_mut(&mut self) -> Option<&mut String> {
        match self {
            Self::Text { text, .. } | Self::Button { text, .. } => Some(text),
            Self::Image { .. } | Self::Component { .. } => None,
        }
    }

    pub fn children(&self) -> &[UiNode] {
        match self {
            Self::Component { children, .. } => children,
            _ => &[],
        }
    }

    pub fn find_mut(&mut self, id: &str) -> Option<&mut Self> {
        if self.id() == id {
            return Some(self);
        }
        if let Self::Component { children, .. } = self {
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
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
struct RawUiTree {
    kind: String,
    id: String,
    node: String,
    children: Vec<RawUiNode>,
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
    alt: Option<String>,
    #[serde(default)]
    component: Option<String>,
    #[serde(default)]
    children: Option<Vec<RawUiNode>>,
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

const MAX_UI_NODES: usize = 256;
const MAX_UI_DEPTH: usize = 16;

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
    /// Validate the UI representation the engine understands.
    ///
    /// Text, button, image and reusable component nodes share one deterministic
    /// design-space contract. Component children may nest, but they do not
    /// introduce local coordinates or implicit layout; this keeps the Core
    /// boundary inspectable while allowing reusable templates to be published
    /// without flattening away their source identity.
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
        if raw.children.len() > MAX_UI_NODES {
            return Err(format!(
                "ui.setRoot supports at most {MAX_UI_NODES} child nodes"
            ));
        }

        let mut ids = BTreeSet::new();
        let mut node_count = 0;
        let mut children = Vec::with_capacity(raw.children.len());
        for raw_node in raw.children {
            children.push(parse_node(raw_node, aspect, &mut ids, &mut node_count, 1)?);
        }

        Ok(Self {
            kind: raw.kind,
            id: raw.id,
            node: raw.node,
            children,
        })
    }
}

fn parse_node(
    raw_node: RawUiNode,
    aspect: f64,
    ids: &mut BTreeSet<String>,
    node_count: &mut usize,
    depth: usize,
) -> Result<UiNode, String> {
    if raw_node.kind == "component" && depth > MAX_UI_DEPTH {
        return Err(format!(
            "ui.setRoot node '{}' exceeds the maximum component nesting depth of {MAX_UI_DEPTH}",
            raw_node.id
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
    if *node_count > MAX_UI_NODES {
        return Err(format!(
            "ui.setRoot supports at most {MAX_UI_NODES} total UI nodes"
        ));
    }
    let rect = resolve_rect(&raw_node, aspect)?;
    validate_rect(rect)?;
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
                    "ui.setRoot text node '{id}' only accepts text and placement"
                ));
            }
            Ok(UiNode::Text {
                id,
                rect,
                text: raw_node.text.unwrap_or_default(),
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
                    "ui.setRoot button node '{id}' only accepts text, action and placement"
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
            })
        }
        "image" => {
            if raw_node.text.is_some()
                || raw_node.action.is_some()
                || raw_node.component.is_some()
                || raw_node.children.is_some()
            {
                return Err(format!(
                    "ui.setRoot image node '{id}' only accepts asset, fit, alt and placement"
                ));
            }
            let asset = raw_node
                .asset
                .ok_or_else(|| format!("ui.setRoot image node '{id}' requires an asset id"))?;
            ensure_non_empty("image asset", &asset)?;
            Ok(UiNode::Image {
                id,
                rect,
                asset,
                fit: raw_node.fit.unwrap_or_default(),
                alt: raw_node.alt,
            })
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
                parsed_children.push(parse_node(child, aspect, ids, node_count, depth + 1)?);
            }
            Ok(UiNode::Component {
                id,
                rect,
                component,
                children: parsed_children,
            })
        }
        kind => Err(format!(
            "ui.setRoot node '{id}' has unsupported kind '{kind}'; use text, button, image or component"
        )),
    }
}

fn ensure_non_empty(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("ui.setRoot {label} must not be empty"));
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
    use super::{UI_REFERENCE_ASPECT, UiNode, UiRect, UiTree};

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
                    {"kind": "button", "id": "save", "text": "Save", "action": "Save", "rect": {"x": 20, "y": 85, "width": 20, "height": 10}}
                ]
            }]
        }))
        .unwrap();
        assert!(matches!(tree.children[0], UiNode::Component { .. }));
        assert_eq!(tree.children[0].id(), "toolbar");
        assert_eq!(tree.children[0].children().len(), 2);
        assert_eq!(
            serde_json::to_value(tree.children[0].children()[0].clone()).unwrap()["kind"],
            "image"
        );
        assert_eq!(
            serde_json::to_value(tree.children[0].children()[0].clone()).unwrap()["alt"],
            "Unone"
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
        };
    }
}
