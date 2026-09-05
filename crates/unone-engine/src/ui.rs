use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

/// The cross-platform UI design space. Hosts map this normalized space to
/// their viewport, pixels, DPI and safe area.
pub const UI_DESIGN_WIDTH: f64 = 100.0;
pub const UI_DESIGN_HEIGHT: f64 = 100.0;

/// Logical coordinates for a host-rendered UI element.
///
/// The platform host maps this design space to its viewport. The engine does
/// not know about pixels, DPI, safe areas, fonts, or platform widgets.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
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

#[derive(Debug, Deserialize)]
struct RawUiTree {
    kind: String,
    id: String,
    node: String,
    children: Vec<RawUiNode>,
}

#[derive(Debug, Deserialize)]
struct RawUiNode {
    kind: String,
    id: String,
    rect: UiRect,
    text: String,
    #[serde(default)]
    action: Option<String>,
}

const MAX_UI_NODES: usize = 256;

impl UiTree {
    /// Validate the only UI representation the engine understands.
    ///
    /// This deliberately accepts one screen with a flat list of text and
    /// button nodes. ViewModel composition, layout policy, styling, input
    /// meaning, and all game-specific behavior remain in Luau/host code.
    pub fn from_json(value: serde_json::Value) -> Result<Self, String> {
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
            validate_rect(raw_node.rect)?;
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
                        rect: raw_node.rect,
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
                        rect: raw_node.rect,
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
    use super::{UiNode, UiRect, UiTree};

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
