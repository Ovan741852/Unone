//! Render a UI tree as text, and report what is structurally wrong with it.
//!
//! An AI author cannot see the screen. Every other gate in this engine checks
//! semantic state, so a game can pass all of them while its controls sit on top
//! of each other. A character grid is the cheapest artefact that both a person
//! and a model can read, it is deterministic enough to assert, and it needs no
//! GPU, font or window.
//!
//! This reports structure only: overlap, out of bounds, text that cannot fit.
//! It says nothing about whether a screen looks good.

use serde::Serialize;

use crate::ui::{UiNode, UiRect, UiTree};

/// Default grid. Character cells are about twice as tall as they are wide, so
/// twice as many columns as rows keeps the square design space square.
pub const DEFAULT_LAYOUT_COLS: usize = 96;
pub const DEFAULT_LAYOUT_ROWS: usize = 48;

/// Viewport shape assumed when estimating whether text fits its box.
///
/// The design space is 0..100 on both axes, so the engine cannot know the real
/// aspect; 16:9 is the shape every current host uses.
const ASSUMED_ASPECT: f64 = 16.0 / 9.0;
/// Character advance as a fraction of font height, for a typical UI face.
const CHARACTER_ADVANCE: f64 = 0.5;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LayoutFinding {
    pub code: String,
    pub detail: String,
    pub nodes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayoutNode {
    pub id: String,
    pub kind: String,
    pub rect: UiRect,
    pub text: String,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayoutReport {
    pub screen: String,
    pub cols: usize,
    pub rows: usize,
    /// The character grid, newline separated, without a trailing newline.
    pub ascii: String,
    pub nodes: Vec<LayoutNode>,
    pub findings: Vec<LayoutFinding>,
    pub readable: bool,
    pub assumptions: Vec<String>,
}

fn node_parts(node: &UiNode) -> (&str, &String, &UiRect, &String, Option<&String>) {
    match node {
        UiNode::Text { id, rect, text } => ("text", id, rect, text, None),
        UiNode::Button {
            id,
            rect,
            text,
            action,
        } => ("button", id, rect, text, Some(action)),
    }
}

fn overlap(left: &UiRect, right: &UiRect) -> Option<(f64, f64)> {
    let x = (left.x + left.width).min(right.x + right.width) - left.x.max(right.x);
    let y = (left.y + left.height).min(right.y + right.height) - left.y.max(right.y);
    (x > 0.01 && y > 0.01).then_some((x, y))
}

/// Design-space width the text needs if the host fits it to the box height.
fn needed_width(text: &str, rect: &UiRect) -> f64 {
    let characters = text.chars().count() as f64;
    characters * CHARACTER_ADVANCE * rect.height / ASSUMED_ASPECT
}

/// Inspect one UI tree: draw it, and report what is structurally wrong.
pub fn inspect(tree: &UiTree, cols: usize, rows: usize) -> LayoutReport {
    let cols = cols.clamp(16, 400);
    let rows = rows.clamp(8, 200);
    let mut findings = Vec::new();
    let mut nodes = Vec::with_capacity(tree.children.len());

    for node in &tree.children {
        let (kind, id, rect, text, action) = node_parts(node);
        nodes.push(LayoutNode {
            id: id.clone(),
            kind: kind.to_string(),
            rect: *rect,
            text: text.clone(),
            action: action.cloned(),
        });
        // Out-of-bounds rects cannot reach here: UiTree::from_json already
        // rejects anything outside the 0..100 design space.
        let required = needed_width(text, rect);
        if !text.is_empty() && required > rect.width * 1.05 {
            findings.push(LayoutFinding {
                code: "UI_TEXT_EXCEEDS_RECT".to_string(),
                detail: format!(
                    "'{id}' 的 {} 個字在框高 {:.1} 下約需要寬度 {required:.1}，但只宣告了 {:.1}。",
                    text.chars().count(),
                    rect.height,
                    rect.width
                ),
                nodes: vec![id.clone()],
            });
        }
    }

    for (index, left) in tree.children.iter().enumerate() {
        let (_, left_id, left_rect, _, _) = node_parts(left);
        for right in tree.children.iter().skip(index + 1) {
            let (_, right_id, right_rect, _, _) = node_parts(right);
            if let Some((x, y)) = overlap(left_rect, right_rect) {
                findings.push(LayoutFinding {
                    code: "UI_NODES_OVERLAP".to_string(),
                    detail: format!(
                        "'{left_id}' 與 '{right_id}' 重疊 {x:.1} x {y:.1}（設計空間單位）。"
                    ),
                    nodes: vec![left_id.clone(), right_id.clone()],
                });
            }
        }
    }

    LayoutReport {
        screen: tree.id.clone(),
        cols,
        rows,
        ascii: draw(tree, cols, rows),
        nodes,
        readable: findings.is_empty(),
        findings,
        assumptions: vec![
            format!("viewport aspect assumed to be 16:9 when estimating text width"),
            "structure only: this says nothing about whether the screen looks good".to_string(),
        ],
    }
}

/// Draw the tree onto a character grid.
///
/// The design space has y pointing up, so row 0 is the top of the screen. A
/// cell covered by more than one node is drawn as `#`, which is the whole point
/// of the picture.
pub fn draw(tree: &UiTree, cols: usize, rows: usize) -> String {
    let cols = cols.clamp(16, 400);
    let rows = rows.clamp(8, 200);
    let mut cells = vec![vec![' '; cols]; rows];
    let mut owners: Vec<Vec<usize>> = vec![vec![0; cols]; rows];

    for node in &tree.children {
        let (kind, _, rect, text, _) = node_parts(node);
        let left = ((rect.x / 100.0) * cols as f64).round().max(0.0) as usize;
        let right = (((rect.x + rect.width) / 100.0) * cols as f64).round() as usize;
        // y is measured up from the bottom; rows are counted down from the top.
        let top = (((100.0 - rect.y - rect.height) / 100.0) * rows as f64).round() as usize;
        let bottom = (((100.0 - rect.y) / 100.0) * rows as f64).round() as usize;
        let right = right.min(cols).max(left + 1).min(cols);
        let bottom = bottom.min(rows).max(top + 1).min(rows);
        if top >= rows || left >= cols {
            continue;
        }
        let fill = if kind == "button" { '=' } else { '-' };
        for row in top..bottom {
            for col in left..right {
                owners[row][col] += 1;
                cells[row][col] = if owners[row][col] > 1 { '#' } else { fill };
            }
        }
        // Label the first row of the box, leaving overlap marks visible.
        let label: Vec<char> = text.chars().collect();
        let width = right.saturating_sub(left);
        for (offset, character) in label.iter().take(width).enumerate() {
            let col = left + offset;
            if owners[top][col] > 1 {
                continue;
            }
            cells[top][col] = if character.is_whitespace() {
                fill
            } else {
                *character
            };
        }
    }

    let mut out = String::with_capacity((cols + 3) * (rows + 2));
    out.push('+');
    out.push_str(&"-".repeat(cols));
    out.push_str("+\n");
    for row in cells {
        out.push('|');
        out.extend(row);
        out.push_str("|\n");
    }
    out.push('+');
    out.push_str(&"-".repeat(cols));
    out.push('+');
    out
}

/// Render the report the way an AI or a reviewer reads it.
pub fn to_markdown(report: &LayoutReport) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "## UI layout: {} ({} nodes, {}x{} cells)\n\n```\n{}\n```\n\n",
        report.screen,
        report.nodes.len(),
        report.cols,
        report.rows,
        report.ascii
    ));
    out.push_str("| id | kind | x | y | w | h | text |\n|---|---|---|---|---|---|---|\n");
    for node in &report.nodes {
        out.push_str(&format!(
            "| {} | {} | {:.1} | {:.1} | {:.1} | {:.1} | {} |\n",
            node.id,
            node.kind,
            node.rect.x,
            node.rect.y,
            node.rect.width,
            node.rect.height,
            node.text.replace('|', "\\|")
        ));
    }
    if report.findings.is_empty() {
        out.push_str("\nNo structural layout problems found.\n");
    } else {
        out.push_str(&format!("\n### {} findings\n\n", report.findings.len()));
        for finding in &report.findings {
            out.push_str(&format!("- **{}** {}\n", finding.code, finding.detail));
        }
    }
    for assumption in &report.assumptions {
        out.push_str(&format!("\n> {assumption}\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_LAYOUT_COLS, DEFAULT_LAYOUT_ROWS, inspect};
    use crate::ui::UiTree;

    fn tree(children: serde_json::Value) -> UiTree {
        UiTree::from_json(serde_json::json!({
            "kind": "screen",
            "id": "test",
            "node": "test",
            "children": children,
        }))
        .unwrap()
    }

    #[test]
    fn a_clean_screen_reports_no_findings_and_draws_its_boxes() {
        let tree = tree(serde_json::json!([
            {"kind": "text", "id": "title", "rect": {"x": 10.0, "y": 80.0, "width": 80.0, "height": 8.0}, "text": "Title"},
            {"kind": "button", "id": "go", "rect": {"x": 10.0, "y": 10.0, "width": 30.0, "height": 8.0}, "text": "Go", "action": "Go"}
        ]));
        let report = inspect(&tree, DEFAULT_LAYOUT_COLS, DEFAULT_LAYOUT_ROWS);
        assert!(report.readable, "{:?}", report.findings);
        assert!(report.ascii.contains("Title"));
        assert!(report.ascii.contains("Go"));
        assert!(!report.ascii.contains('#'));
    }

    #[test]
    fn overlapping_nodes_are_reported_and_marked_in_the_picture() {
        let tree = tree(serde_json::json!([
            {"kind": "text", "id": "left", "rect": {"x": 10.0, "y": 50.0, "width": 30.0, "height": 10.0}, "text": ""},
            {"kind": "text", "id": "right", "rect": {"x": 30.0, "y": 50.0, "width": 30.0, "height": 10.0}, "text": ""}
        ]));
        let report = inspect(&tree, DEFAULT_LAYOUT_COLS, DEFAULT_LAYOUT_ROWS);
        assert!(!report.readable);
        let overlap = report
            .findings
            .iter()
            .find(|finding| finding.code == "UI_NODES_OVERLAP")
            .expect("overlap finding");
        assert_eq!(overlap.nodes, vec!["left".to_string(), "right".to_string()]);
        assert!(report.ascii.contains('#'), "{}", report.ascii);
    }

    #[test]
    fn text_that_cannot_fit_its_box_is_reported() {
        let tree = tree(serde_json::json!([
            {"kind": "text", "id": "cramped", "rect": {"x": 0.0, "y": 0.0, "width": 4.0, "height": 6.0}, "text": "a very long label"}
        ]));
        let report = inspect(&tree, DEFAULT_LAYOUT_COLS, DEFAULT_LAYOUT_ROWS);
        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].code, "UI_TEXT_EXCEEDS_RECT");
    }
}
