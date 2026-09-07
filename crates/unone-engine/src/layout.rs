//! Render a UI tree as text, and report what is structurally wrong with it.
//!
//! An AI author cannot see the screen. Every other gate in this engine checks
//! semantic state, so a game can pass all of them while its controls sit on top
//! of each other. A character grid is the cheapest artefact that both a person
//! and a model can read, it is deterministic enough to assert, and it needs no
//! GPU, font or window.
//!
//! A finding here is a verdict, so it must be objectively decidable from the
//! tree alone. Anything that needs a guessed constant — a font metric, a
//! viewport shape — is reported as a measurement instead, and the reader
//! decides. Rules that guess turn a gate into noise: see decision 0029.
//!
//! This reports structure only. It says nothing about whether a screen looks
//! good.

use serde::Serialize;

use crate::ui::{UiNode, UiRect, UiTree};

/// Default grid. Character cells are about twice as tall as they are wide, so
/// twice as many columns as rows keeps the square design space square.
pub const DEFAULT_LAYOUT_COLS: usize = 96;
pub const DEFAULT_LAYOUT_ROWS: usize = 48;

/// Viewport shape assumed when measuring how full a text box is.
///
/// The design space is 0..100 on both axes, so the engine cannot know the real
/// aspect; 16:9 is the shape every current host uses. This assumption is why
/// text fullness is a number in the report and never a finding.
const ASSUMED_ASPECT: f64 = 16.0 / 9.0;
/// Character advance as a fraction of font height, for a typical UI face.
const CHARACTER_ADVANCE: f64 = 0.5;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LayoutFinding {
    pub code: String,
    pub detail: String,
    pub nodes: Vec<String>,
    /// The smallest change that clears the finding. Reporting that two boxes
    /// intersect without naming an axis leaves the author to work out the
    /// direction, which is exactly the judgement a gate should remove.
    pub resolution: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayoutNode {
    pub id: String,
    pub kind: String,
    pub rect: UiRect,
    pub text: String,
    pub action: Option<String>,
    /// Roughly how much of the declared width the label needs, if the host sizes
    /// text to the box height. Above 1.0 means the host must shrink, wrap or
    /// clip it. This rests on assumed font metrics, so it is a measurement for
    /// the reader, not a verdict.
    pub text_fit: f64,
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
        // Out-of-bounds rects cannot reach here: UiTree::from_json already
        // rejects anything outside the 0..100 design space.
        let text_fit = if text.is_empty() || rect.width <= 0.0 {
            0.0
        } else {
            (needed_width(text, rect) / rect.width * 100.0).round() / 100.0
        };
        nodes.push(LayoutNode {
            id: id.clone(),
            kind: kind.to_string(),
            rect: *rect,
            text: text.clone(),
            action: action.cloned(),
            text_fit,
        });
    }

    for (index, left) in tree.children.iter().enumerate() {
        let (_, left_id, left_rect, _, _) = node_parts(left);
        for right in tree.children.iter().skip(index + 1) {
            let (_, right_id, right_rect, _, _) = node_parts(right);
            if let Some((x, y)) = overlap(left_rect, right_rect) {
                // Move along whichever axis needs the smaller change, and say
                // which way: y grows upward in this design space.
                let resolution = if x <= y {
                    let (mover, direction) = if left_rect.x <= right_rect.x {
                        (right_id, "right")
                    } else {
                        (left_id, "right")
                    };
                    format!(
                        "Increase '{mover}' x by {x:.1} (to the {}), or reduce one of the widths.",
                        if direction == "right" { "right" } else { "left" }
                    )
                } else {
                    let mover = if left_rect.y <= right_rect.y {
                        right_id
                    } else {
                        left_id
                    };
                    format!(
                        "Increase '{mover}' y by {y:.1} (upward; the design-space y axis points upward), or reduce one of the heights."
                    )
                };
                findings.push(LayoutFinding {
                    code: "UI_NODES_OVERLAP".to_string(),
                    detail: format!(
                        "'{left_id}' and '{right_id}' overlap by {x:.1} x {y:.1} (design-space units)."
                    ),
                    nodes: vec![left_id.clone(), right_id.clone()],
                    resolution,
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
            "text_fit assumes a 16:9 viewport and a 0.5 character advance, so it is a              measurement to read, never a pass/fail"
                .to_string(),
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
            out.push_str(&format!(
                "- **{}** {} → {}\n",
                finding.code, finding.detail, finding.resolution
            ));
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

    /// Text fullness rests on guessed font metrics, so it is reported as a
    /// number and never as a verdict. A rule that guesses cannot be a gate.
    #[test]
    fn text_fullness_is_measured_but_never_becomes_a_finding() {
        let tree = tree(serde_json::json!([
            {"kind": "text", "id": "cramped", "rect": {"x": 0.0, "y": 0.0, "width": 4.0, "height": 6.0}, "text": "a very long label"},
            {"kind": "text", "id": "roomy", "rect": {"x": 0.0, "y": 50.0, "width": 60.0, "height": 6.0}, "text": "ok"}
        ]));
        let report = inspect(&tree, DEFAULT_LAYOUT_COLS, DEFAULT_LAYOUT_ROWS);
        assert!(report.readable, "{:?}", report.findings);
        let cramped = &report.nodes[0];
        let roomy = &report.nodes[1];
        assert!(cramped.text_fit > 2.0, "{}", cramped.text_fit);
        assert!(roomy.text_fit < 0.2, "{}", roomy.text_fit);
    }
}
