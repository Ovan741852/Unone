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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, schemars::JsonSchema)]
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
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UiTree {
    pub kind: String,
    pub id: String,
    pub node: String,
    pub children: Vec<UiNode>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct RawUiTree {
    kind: String,
    id: String,
    node: String,
    children: Vec<RawUiNode>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
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
    text: String,
    #[serde(default)]
    action: Option<String>,
}

/// Anchored offsets and sizes are in vertical units: percent of the viewport
/// height, on both axes. One unit system means an author never has to reason
/// about the aspect, and a box keeps its shape when the aspect changes.
#[derive(Debug, Clone, Copy, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct RawOffset {
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
}

#[derive(Debug, Clone, Copy, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct RawSize {
    width: f64,
    height: f64,
}

const MAX_UI_NODES: usize = 256;

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
            let size = node.size.ok_or_else(|| {
                format!("ui.setRoot anchored node '{}' requires a size", node.id)
            })?;
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
    /// Validate the only UI representation the engine understands.
    ///
    /// This deliberately accepts one screen with a flat list of text and
    /// button nodes. ViewModel composition, layout policy, styling, input
    /// meaning, and all game-specific behavior remain in Luau/host code.
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
        let mut children = Vec::with_capacity(raw.children.len());
        for raw_node in raw.children {
            ensure_non_empty("node id", &raw_node.id)?;
            if !ids.insert(raw_node.id.clone()) {
                return Err(format!(
                    "ui.setRoot node id '{}' is duplicated",
                    raw_node.id
                ));
            }
            let rect = resolve_rect(&raw_node, aspect)?;
            validate_rect(rect)?;
            let node = match raw_node.kind.as_str() {
                "text" => {
                    if raw_node.action.is_some() {
                        return Err(format!(
                            "ui.setRoot text node '{}' must not define action",
                            raw_node.id
                        ));
                    }
                    UiNode::Text {
                        id: raw_node.id,
                        rect,
                        text: raw_node.text,
                    }
                }
                "button" => {
                    let action = raw_node.action.ok_or_else(|| {
                        format!(
                            "ui.setRoot button node '{}' requires a non-empty action",
                            raw_node.id
                        )
                    })?;
                    ensure_non_empty("button action", &action)?;
                    UiNode::Button {
                        id: raw_node.id,
                        rect,
                        text: raw_node.text,
                        action,
                    }
                }
                kind => {
                    return Err(format!(
                        "ui.setRoot node '{}' has unsupported kind '{}'; use text or button",
                        raw_node.id, kind
                    ));
                }
            };
            children.push(node);
        }

        Ok(Self {
            kind: raw.kind,
            id: raw.id,
            node: raw.node,
            children,
        })
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
        match &tree.children[0] {
            UiNode::Text { rect, .. } | UiNode::Button { rect, .. } => *rect,
        }
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
