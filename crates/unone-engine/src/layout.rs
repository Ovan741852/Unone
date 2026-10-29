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

use crate::ui::{UiBackgroundScope, UiNode, UiRect, UiTree};

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
    pub asset: Option<String>,
    /// Roughly how much of the declared content width the label needs. Styled
    /// nodes use their explicit or fixed default font size; legacy nodes use
    /// box height. Above 1.0 suggests overflow under the assumed font metrics;
    /// the host obeys the declared wrapping/clipping and never resizes a styled
    /// font automatically. This is a measurement for the reader, not a verdict.
    pub text_fit: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayoutReport {
    pub usage: crate::ui::UiUsage,
    pub screen: String,
    pub cols: usize,
    pub rows: usize,
    /// The character grid, newline separated, without a trailing newline.
    pub ascii: String,
    pub nodes: Vec<LayoutNode>,
    pub findings: Vec<LayoutFinding>,
    pub allowed_overlaps: Vec<LayoutFinding>,
    pub readable: bool,
    pub assumptions: Vec<String>,
}

/// Explicit per-screen art layering. Never permits a button to hide another
/// interactive node: the earlier/background node must be an image or panel.
/// Repeated ordered pairs share one evidence entry, retaining the first reason.
/// Typed background and external policy evidence share the same output limit;
/// errors leave the entire report unchanged.
pub fn apply_overlap_policy(
    report: &mut LayoutReport,
    policy: &serde_json::Value,
) -> Result<(), String> {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Pair {
        behind: String,
        front: String,
        reason: String,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Policy {
        version: u32,
        screens: std::collections::BTreeMap<String, Vec<Pair>>,
    }
    let policy: Policy = serde_json::from_value(policy.clone()).map_err(|e| e.to_string())?;
    if policy.version != 1 {
        return Err("UI_OVERLAP_POLICY_VERSION: expected 1".into());
    }
    let Some(pairs) = policy.screens.get(&report.screen) else {
        return Ok(());
    };
    let evidence_limit = crate::ui::ui_contract().max_layout_findings;
    if report.allowed_overlaps.len() > evidence_limit {
        return Err(format!(
            "UI_LAYOUT_WORK_LIMIT: allowed-overlap evidence already exceeds max_layout_findings={evidence_limit}; the report was not changed"
        ));
    }
    let mut approved = Vec::new();
    let mut seen_pairs = std::collections::BTreeSet::new();
    for pair in pairs {
        if pair.reason.trim().is_empty() {
            return Err("UI_OVERLAP_REASON_REQUIRED".into());
        }
        // Every occurrence must have a reason. The remaining validation is the
        // same for repeated IDs because report mutation happens only at commit.
        if !seen_pairs.insert((&pair.behind, &pair.front)) {
            continue;
        }
        let behind = report
            .nodes
            .iter()
            .position(|n| n.id == pair.behind)
            .ok_or_else(|| format!("UI_OVERLAP_UNKNOWN_NODE: {}", pair.behind))?;
        let front = report
            .nodes
            .iter()
            .position(|n| n.id == pair.front)
            .ok_or_else(|| format!("UI_OVERLAP_UNKNOWN_NODE: {}", pair.front))?;
        if behind >= front || !matches!(report.nodes[behind].kind.as_str(), "image" | "image_batch" | "panel") {
            return Err("UI_OVERLAP_POLICY_UNSAFE: behind must be an earlier image, image_batch or panel; interactive/text pairs and later occluding backgrounds cannot be exempted".into());
        }
        let ids = vec![pair.behind.clone(), pair.front.clone()];
        let finding = report
            .findings
            .iter()
            .find(|f| f.code == "UI_NODES_OVERLAP" && f.nodes == ids)
            .ok_or("UI_OVERLAP_POLICY_STALE: pair does not currently overlap")?;
        if report.allowed_overlaps.len() + approved.len() >= evidence_limit {
            return Err(format!(
                "UI_LAYOUT_WORK_LIMIT: typed background and external policy overlap evidence would exceed max_layout_findings={evidence_limit}; the report was not changed"
            ));
        }
        let mut finding = finding.clone();
        finding.code = "UI_INTENTIONAL_ART_OVERLAP".into();
        finding.resolution = pair.reason.clone();
        approved.push(finding);
    }
    report.findings.retain(|f| {
        !approved
            .iter()
            .any(|a| a.nodes == f.nodes && f.code == "UI_NODES_OVERLAP")
    });
    report.allowed_overlaps.extend(approved);
    report.readable = report.findings.is_empty();
    Ok(())
}

fn node_parts(node: &UiNode) -> (&str, &str, &UiRect, &str, Option<&str>, Option<&str>) {
    match node {
        UiNode::TextInput { id, rect, text, .. } => ("text_input", id, rect, text, None, None),
        UiNode::Text { id, rect, text, .. } => ("text", id, rect, text, None, None),
        UiNode::Button {
            id,
            rect,
            text,
            action,
            ..
        } => ("button", id, rect, text, Some(action), None),
        UiNode::Slider {
            id,
            rect,
            text,
            action,
            ..
        } => ("slider", id, rect, text, Some(action), None),
        UiNode::ComboBox { id, rect, text, action, .. } => ("combobox", id, rect, text, Some(action), None),
        UiNode::Image {
            id, rect, asset, ..
        } => ("image", id, rect, "", None, Some(asset)),
        UiNode::ImageBatch { id, rect, .. } => ("image_batch", id, rect, "", None, None),
        UiNode::Panel { id, rect, .. } => ("panel", id, rect, "", None, None),
        UiNode::Component { .. } => {
            unreachable!("component nodes are expanded before layout inspection")
        }
        UiNode::ScrollView { id, rect, .. } => ("scroll_view", id, rect, "", None, None),
    }
}

fn overlap(left: &UiRect, right: &UiRect) -> Option<(f64, f64)> {
    let x = (left.x + left.width).min(right.x + right.width) - left.x.max(right.x);
    let y = (left.y + left.height).min(right.y + right.height) - left.y.max(right.y);
    (x > 0.01 && y > 0.01).then_some((x, y))
}

/// Inspection needs the actual component instances, not merely matching names:
/// component wrappers share stage coordinates but define explicit ownership.
struct InspectionLeaf<'a> {
    node: &'a UiNode,
    components: Vec<&'a UiNode>,
}

fn inspection_leaves<'a>(
    children: &'a [UiNode],
    components: &mut Vec<&'a UiNode>,
    output: &mut Vec<InspectionLeaf<'a>>,
) {
    for node in children {
        if let UiNode::Component { children, .. } = node {
            components.push(node);
            inspection_leaves(children, components, output);
            components.pop();
        } else {
            // A scroll viewport is a stage leaf. Its local content belongs to
            // the clipped host projection, just as in UiNode::leaf_nodes.
            output.push(InspectionLeaf {
                node,
                components: components.clone(),
            });
        }
    }
}

fn contains_rect(outer: &UiRect, inner: &UiRect) -> bool {
    const EPSILON: f64 = 1e-8;
    [outer, inner].iter().all(|rect| {
        [rect.x, rect.y, rect.width, rect.height]
            .iter()
            .all(|value| value.is_finite())
            && rect.width > 0.0
            && rect.height > 0.0
    }) && inner.x >= outer.x - EPSILON
        && inner.y >= outer.y - EPSILON
        && inner.x + inner.width <= outer.x + outer.width + EPSILON
        && inner.y + inner.height <= outer.y + outer.height + EPSILON
}

/// The caller supplies only earlier/later pairs. Neither this declaration nor
/// the geometry changes paint order, layout, clipping, or input ownership.
fn declared_background_reason(
    behind: &InspectionLeaf<'_>,
    front: &InspectionLeaf<'_>,
) -> Option<String> {
    let background = behind.node.background_for()?;
    if !matches!(behind.node, UiNode::Image { .. } | UiNode::ImageBatch { .. } | UiNode::Panel { .. })
        || !contains_rect(behind.node.rect(), front.node.rect())
    {
        return None;
    }
    let scope = match background {
        UiBackgroundScope::Screen { screen: true } => {
            let stage = UiRect { x: 0.0, y: 0.0, width: 100.0, height: 100.0 };
            if !contains_rect(&stage, behind.node.rect()) {
                return None;
            }
            "screen".to_string()
        }
        UiBackgroundScope::Component { component } => {
            let owner = behind.components.iter().rev().find(|node| node.id() == component.as_str())?;
            if !contains_rect(owner.rect(), behind.node.rect())
                || !front.components.iter().any(|node| std::ptr::eq(*node, *owner))
            {
                return None;
            }
            format!("component '{component}'")
        }
        UiBackgroundScope::Screen { screen: false } => return None,
    };
    Some(format!(
        "Explicit background_for declares '{}' as the background of {scope}; '{}' is painted later, belongs to that scope and is fully contained by the background.",
        behind.node.id(), front.node.id()
    ))
}

/// Approximate width; styled font sizing is independent of the node height.
fn needed_width(text: &str, rect: &UiRect, style: Option<&crate::UiStyle>) -> f64 {
    let characters = text.lines().map(|line| line.chars().count()).max().unwrap_or(0) as f64;
    let font_size = style.map_or(rect.height, |style| style.font_size.unwrap_or(2.0));
    let spacing = style.and_then(|style| style.letter_spacing).unwrap_or(0.0);
    (characters * CHARACTER_ADVANCE * font_size + (characters - 1.0).max(0.0) * spacing).max(0.0) / ASSUMED_ASPECT
}

/// Inspect one UI tree: draw it, and report what is structurally wrong.
pub fn inspect(tree: &UiTree, cols: usize, rows: usize) -> LayoutReport {
    let cols = cols.clamp(16, 400);
    let rows = rows.clamp(8, 200);
    let mut findings = Vec::new();
    let mut allowed_overlaps = Vec::new();
    let mut leaves = Vec::new();
    inspection_leaves(&tree.children, &mut Vec::new(), &mut leaves);
    let mut nodes = Vec::with_capacity(leaves.len());

    for leaf in &leaves {
        let node = leaf.node;
        let (kind, id, rect, text, action, asset) = node_parts(node);
        // Out-of-bounds rects cannot reach here: UiTree::from_json already
        // rejects anything outside the 0..100 design space.
        let text_fit = if text.is_empty() || rect.width <= 0.0 {
            0.0
        } else {
            let padding = node.style().and_then(|style| style.padding).unwrap_or_default();
            let content_width = (rect.width - (padding.left + padding.right) / ASSUMED_ASPECT).max(f64::EPSILON);
            (needed_width(text, rect, node.style()) / content_width * 100.0).round() / 100.0
        };
        nodes.push(LayoutNode {
            id: id.to_string(),
            kind: kind.to_string(),
            rect: *rect,
            text: text.to_string(),
            action: action.map(str::to_string),
            asset: asset.map(str::to_string),
            text_fit,
        });
    }

    let mut comparisons = 0usize;
    'pairs: for (index, left) in leaves.iter().enumerate() {
        let (_, left_id, left_rect, _, _, _) = node_parts(left.node);
        for right in leaves.iter().skip(index + 1) {
            comparisons += 1;
            if comparisons > crate::ui::ui_contract().max_layout_comparisons
                || findings.len() >= crate::ui::ui_contract().max_layout_findings
                || allowed_overlaps.len() >= crate::ui::ui_contract().max_layout_findings
            {
                findings.push(LayoutFinding{code:"UI_LAYOUT_WORK_LIMIT".into(),detail:format!("Inspection incomplete: comparisons={comparisons}, findings={}, allowed_overlaps={}; the full UI tree is retained",findings.len(),allowed_overlaps.len()),nodes:Vec::new(),resolution:"Inspect one component/subtree at a time. Findings and allowed-overlap evidence are each bounded by max_layout_findings. This is a diagnostic work limit, not a rendering node limit or a passing layout result.".into()});
                break 'pairs;
            }
            let (_, right_id, right_rect, _, _, _) = node_parts(right.node);
            if let Some((x, y)) = overlap(left_rect, right_rect) {
                // Classify explicit ownership before accumulating collision
                // findings. Art beneath a whole component is declared once.
                if let Some(reason) = declared_background_reason(left, right) {
                    allowed_overlaps.push(LayoutFinding {
                        code: "UI_INTENTIONAL_ART_OVERLAP".into(),
                        detail: format!(
                            "'{left_id}' and '{right_id}' overlap by {x:.1} x {y:.1} (design-space units), as declared by background_for."
                        ),
                        nodes: vec![left_id.to_string(), right_id.to_string()],
                        resolution: reason,
                    });
                    continue;
                }
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
                        if direction == "right" {
                            "right"
                        } else {
                            "left"
                        }
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
                    nodes: vec![left_id.to_string(), right_id.to_string()],
                    resolution,
                });
            }
        }
    }

    LayoutReport {
        usage:tree.usage(),
        allowed_overlaps,
        screen: tree.id.clone(),
        cols,
        rows,
        ascii: draw(tree, cols, rows),
        nodes,
        readable: findings.is_empty(),
        findings,
        assumptions: vec![
            "text_fit assumes a 16:9 viewport and a 0.5 character advance; it uses explicit font_size/letter_spacing/padding when declared, otherwise legacy box height; it does not measure host fonts or wrapping and is never a pass/fail"
                .to_string(),
            "structure only: this says nothing about whether the screen looks good".to_string(),
            "scroll_view is inspected as a viewport only; local/virtual content requires the Web clipped projection and scroll diagnostics".to_string(),
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

    let mut leaves = Vec::new();
    for node in &tree.children {
        node.leaf_nodes(&mut leaves);
    }
    for node in &leaves {
        let (kind, _, rect, text, _, _) = node_parts(node);
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
        let fill = match kind {
            "button" => '=',
            "image" | "image_batch" => '@',
            _ => '-',
        };
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
    out.push_str(
        "| id | kind | x | y | w | h | text | asset |\n|---|---|---|---|---|---|---|---|\n",
    );
    for node in &report.nodes {
        out.push_str(&format!(
            "| {} | {} | {:.1} | {:.1} | {:.1} | {:.1} | {} | {} |\n",
            node.id,
            node.kind,
            node.rect.x,
            node.rect.y,
            node.rect.width,
            node.rect.height,
            node.text.replace('|', "\\|"),
            node.asset.as_deref().unwrap_or("")
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
    if !report.allowed_overlaps.is_empty() {
        out.push_str(&format!("\n### {} intentional art overlaps\n\n", report.allowed_overlaps.len()));
        for finding in &report.allowed_overlaps {
            out.push_str(&format!("- **{}** {} → {}\n", finding.code, finding.detail, finding.resolution));
        }
    }
    for assumption in &report.assumptions {
        out.push_str(&format!("\n> {assumption}\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn background_pair_allowance_preserves_interactive_overlap_gate() {
        let tree=UiTree::from_json(serde_json::json!({"kind":"screen","id":"menu","node":"menu","children":[
            {"kind":"image","id":"plate","asset":"asset://plate","rect":{"x":0,"y":0,"width":50,"height":50}},
            {"kind":"button","id":"start","action":"Start","text":"","rect":{"x":0,"y":0,"width":50,"height":50}},
            {"kind":"button","id":"other","action":"Other","text":"","rect":{"x":0,"y":0,"width":50,"height":50}}]})).unwrap();
        let mut report = inspect(&tree, 16, 8);
        super::apply_overlap_policy(&mut report,&serde_json::json!({"version":1,"screens":{"menu":[{"behind":"plate","front":"start","reason":"art beneath hit target"},{"behind":"plate","front":"other","reason":"background"}]}})).unwrap();
        assert_eq!(report.allowed_overlaps.len(), 2);
        assert_eq!(report.findings.len(), 1);
        assert!(!report.readable);
        assert!(super::apply_overlap_policy(&mut report,&serde_json::json!({"version":1,"screens":{"menu":[{"behind":"start","front":"other","reason":"cannot waive button overlap"}]}})).is_err());
    }

    #[test]
    fn panel_layers_require_explicit_policy_and_cannot_hide_text_or_controls() {
        let tree = UiTree::from_json(serde_json::json!({"kind":"screen","id":"menu","node":"menu","children":[
            {"kind":"panel","id":"surface","rect":{"x":0,"y":0,"width":50,"height":50},"style":{"background":[0,0,0,0.8]}},
            {"kind":"text","id":"title","text":"Title","rect":{"x":5,"y":30,"width":30,"height":10}},
            {"kind":"button","id":"button","action":"Start","text":"Start","rect":{"x":5,"y":5,"width":30,"height":10}},
            {"kind":"panel","id":"late","rect":{"x":5,"y":30,"width":30,"height":10}}
        ]})).unwrap();
        let mut report = inspect(&tree, 16, 8);
        assert!(!report.readable);
        super::apply_overlap_policy(&mut report, &serde_json::json!({"version":1,"screens":{"menu":[
            {"behind":"surface","front":"title","reason":"decorative panel behind heading"},
            {"behind":"surface","front":"button","reason":"decorative panel behind action"}
        ]}})).unwrap();
        assert_eq!(report.allowed_overlaps.len(), 2);
        assert!(!report.readable, "later panel still obscures title");
        for pair in [serde_json::json!({"behind":"late","front":"title","reason":"unsafe order"}), serde_json::json!({"behind":"title","front":"late","reason":"text cannot be waived"})] {
            assert!(super::apply_overlap_policy(&mut report, &serde_json::json!({"version":1,"screens":{"menu":[pair]}})).unwrap_err().contains("UI_OVERLAP_POLICY_UNSAFE"));
        }
    }
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

    fn mixed_background_policy(
        typed_count: usize,
        external_count: usize,
    ) -> (super::LayoutReport, serde_json::Value) {
        // Disjoint surfaces let each label contribute exactly one intended
        // overlap, through either the typed or the external policy path.
        let mut children = vec![
            serde_json::json!({"kind":"panel","id":"typed","background_for":{"screen":true},"rect":{"x":0,"y":0,"width":45,"height":100}}),
            serde_json::json!({"kind":"image","id":"art","asset":"asset://art","rect":{"x":50,"y":0,"width":45,"height":100}}),
        ];
        for (prefix, offset, count) in [("typed", 0.0, typed_count), ("external", 50.0, external_count)] {
            children.extend((0..count).map(|index| serde_json::json!({
                "kind":"text", "id":format!("{prefix}{index}"), "text":"Label",
                "rect":{"x":offset+1.0+(index%20) as f64*2.0,"y":1.0+(index/20) as f64*2.0,"width":1,"height":1}
            })));
        }
        let tree = tree(serde_json::Value::Array(children));
        let policy = serde_json::json!({"version":1,"screens":{"test":(0..external_count).map(|index| serde_json::json!({
            "behind":"art", "front":format!("external{index}"), "reason":"Reviewed artwork beneath the label"
        })).collect::<Vec<_>>()}});
        (inspect(&tree, 16, 8), policy)
    }

    #[test]
    fn typed_and_external_overlap_evidence_share_the_exact_output_cap() {
        let limit = crate::ui::ui_contract().max_layout_findings;
        let (mut report, policy) = mixed_background_policy(limit / 2, limit - limit / 2);
        assert_eq!(report.allowed_overlaps.len(), limit / 2);
        assert_eq!(report.findings.len(), limit - limit / 2);
        super::apply_overlap_policy(&mut report, &policy).unwrap();
        assert_eq!(report.allowed_overlaps.len(), limit);
        assert!(report.findings.is_empty());
        assert!(report.readable);
    }

    #[test]
    fn combined_overlap_evidence_overflow_leaves_the_entire_report_unchanged() {
        let limit = crate::ui::ui_contract().max_layout_findings;
        let (mut report, policy) = mixed_background_policy(limit / 2, limit - limit / 2 + 1);
        let before = serde_json::to_value(&report).unwrap();
        let error = super::apply_overlap_policy(&mut report, &policy).unwrap_err();
        assert!(error.starts_with("UI_LAYOUT_WORK_LIMIT:"), "{error}");
        assert_eq!(serde_json::to_value(&report).unwrap(), before);
        assert!(!report.readable);
    }

    #[test]
    fn duplicate_external_pairs_cannot_amplify_evidence_at_the_combined_cap() {
        let limit = crate::ui::ui_contract().max_layout_findings;
        let (mut report, mut policy) = mixed_background_policy(limit / 2, limit - limit / 2);
        let pairs = policy["screens"]["test"].as_array_mut().unwrap();
        let originals = pairs.clone();
        pairs.extend(originals.clone());
        pairs.extend(originals);
        // The same ordered pair still records the first authored reason.
        pairs[limit - limit / 2]["reason"] = serde_json::json!("Repeated explanation");
        super::apply_overlap_policy(&mut report, &policy).unwrap();
        assert_eq!(report.allowed_overlaps.len(), limit);
        assert!(report.allowed_overlaps.iter().filter(|finding| finding.nodes[0] == "art").all(|finding| {
            finding.resolution == "Reviewed artwork beneath the label"
        }));
        assert!(report.readable);
    }

    #[test]
    fn invalid_duplicate_reason_is_rejected_without_partial_policy_mutation() {
        let (mut report, mut policy) = mixed_background_policy(1, 1);
        let pairs = policy["screens"]["test"].as_array_mut().unwrap();
        let mut duplicate = pairs[0].clone();
        duplicate["reason"] = serde_json::json!("  ");
        pairs.push(duplicate);
        let before = serde_json::to_value(&report).unwrap();
        assert_eq!(super::apply_overlap_policy(&mut report, &policy).unwrap_err(), "UI_OVERLAP_REASON_REQUIRED");
        assert_eq!(serde_json::to_value(&report).unwrap(), before);
    }

    #[test]
    fn declared_screen_background_covers_later_leaves_with_auditable_evidence() {
        let tree = tree(serde_json::json!([
            {"kind":"panel","id":"backdrop","background_for":{"screen":true},"rect":{"x":0,"y":0,"width":100,"height":100}},
            {"kind":"text","id":"title","text":"Title","rect":{"x":5,"y":70,"width":30,"height":10}},
            {"kind":"component","id":"actions","component":"ui.actions","rect":{"x":5,"y":5,"width":40,"height":20},"children":[
                {"kind":"button","id":"go","action":"Go","text":"Go","rect":{"x":5,"y":5,"width":30,"height":10}}
            ]}
        ]));
        let report = inspect(&tree, 16, 8);
        assert!(report.readable, "{:?}", report.findings);
        assert_eq!(report.allowed_overlaps.len(), 2);
        assert_eq!(report.allowed_overlaps[0].nodes, ["backdrop", "title"]);
        assert_eq!(report.allowed_overlaps[1].nodes, ["backdrop", "go"]);
        assert!(report.allowed_overlaps.iter().all(|finding| {
            finding.code == "UI_INTENTIONAL_ART_OVERLAP"
                && finding.resolution.contains("background_for")
                && finding.resolution.contains("screen")
        }));
        assert!(super::to_markdown(&report).contains("intentional art overlaps"));
    }

    #[test]
    fn declared_component_background_reaches_nested_descendants_only() {
        let tree = tree(serde_json::json!([
            {"kind":"component","id":"card","component":"ui.card","rect":{"x":0,"y":0,"width":60,"height":60},"children":[
                {"kind":"component","id":"art","component":"ui.art","rect":{"x":0,"y":0,"width":60,"height":60},"children":[
                    {"kind":"image","id":"surface","asset":"asset://card","background_for":{"component":"card"},"rect":{"x":0,"y":0,"width":60,"height":60}}
                ]},
                {"kind":"component","id":"contents","component":"ui.contents","rect":{"x":5,"y":5,"width":50,"height":50},"children":[
                    {"kind":"text","id":"title","text":"Title","rect":{"x":5,"y":40,"width":30,"height":10}},
                    {"kind":"button","id":"go","action":"Go","text":"Go","rect":{"x":5,"y":5,"width":30,"height":10}}
                ]}
            ]},
            {"kind":"component","id":"sibling","component":"ui.sibling","rect":{"x":40,"y":20,"width":10,"height":10},"children":[
                {"kind":"text","id":"outside","text":"Outside","rect":{"x":40,"y":20,"width":10,"height":10}}
            ]}
        ]));
        let report = inspect(&tree, 16, 8);
        assert_eq!(report.allowed_overlaps.len(), 2);
        assert!(report.allowed_overlaps.iter().all(|finding| {
            finding.resolution.contains("component 'card'")
        }));
        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].nodes, ["surface", "outside"]);
        assert!(!report.readable, "a same-coordinate sibling is outside the declared scope");
    }

    #[test]
    fn background_declaration_preserves_partial_and_foreground_collisions() {
        let tree = tree(serde_json::json!([
            {"kind":"panel","id":"surface","background_for":{"screen":true},"rect":{"x":0,"y":0,"width":30,"height":30}},
            {"kind":"text","id":"partial","text":"Partial","rect":{"x":25,"y":20,"width":10,"height":5}},
            {"kind":"text","id":"label","text":"Label","rect":{"x":5,"y":5,"width":10,"height":5}},
            {"kind":"button","id":"button","action":"Go","text":"Go","rect":{"x":5,"y":5,"width":10,"height":5}}
        ]));
        let report = inspect(&tree, 16, 8);
        assert_eq!(report.allowed_overlaps.len(), 2);
        assert_eq!(report.findings.len(), 2);
        assert!(report.findings.iter().any(|finding| finding.nodes == ["surface", "partial"]));
        assert!(report.findings.iter().any(|finding| finding.nodes == ["label", "button"]));
        assert!(!report.readable);
    }

    #[test]
    fn exact_art_policy_still_supports_partial_pairs_alongside_declared_backgrounds() {
        let tree = tree(serde_json::json!([
            {"kind":"panel","id":"backdrop","background_for":{"screen":true},"rect":{"x":0,"y":0,"width":100,"height":100}},
            {"kind":"image","id":"art","asset":"asset://art","rect":{"x":0,"y":0,"width":30,"height":30}},
            {"kind":"button","id":"partial","action":"Go","text":"Go","rect":{"x":25,"y":20,"width":10,"height":5}}
        ]));
        let mut report = inspect(&tree, 16, 8);
        assert_eq!(report.allowed_overlaps.len(), 2);
        assert_eq!(report.findings.len(), 1);
        super::apply_overlap_policy(&mut report, &serde_json::json!({"version":1,"screens":{"test":[
            {"behind":"art","front":"partial","reason":"Explicitly reviewed partial artwork beneath the input"}
        ]}})).unwrap();
        assert!(report.readable);
        assert_eq!(report.allowed_overlaps.len(), 3);
        assert_eq!(report.allowed_overlaps[2].nodes, ["art", "partial"]);
        assert_eq!(report.allowed_overlaps[2].resolution, "Explicitly reviewed partial artwork beneath the input");
    }

    #[test]
    fn later_declared_background_cannot_waive_its_occlusion_of_earlier_content() {
        let tree = tree(serde_json::json!([
            {"kind":"text","id":"earlier","text":"Earlier","rect":{"x":5,"y":70,"width":30,"height":10}},
            {"kind":"panel","id":"late","background_for":{"screen":true},"style":{"background":[0,0,0,1]},"rect":{"x":0,"y":0,"width":100,"height":100}},
            {"kind":"button","id":"later","action":"Go","text":"Go","rect":{"x":5,"y":5,"width":30,"height":10}}
        ]));
        let report = inspect(&tree, 16, 8);
        assert_eq!(report.allowed_overlaps.len(), 1);
        assert_eq!(report.allowed_overlaps[0].nodes, ["late", "later"]);
        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].nodes, ["earlier", "late"]);
        assert!(!report.readable);
    }

    #[test]
    fn background_inspection_stops_at_the_scroll_coordinate_boundary() {
        let tree = tree(serde_json::json!([
            {"kind":"panel","id":"backdrop","background_for":{"screen":true},"rect":{"x":0,"y":0,"width":100,"height":100}},
            {"kind":"scroll_view","id":"viewport","viewport":{"left":20,"top":20,"width":40,"height":40},"scroll":{"axis":"vertical"},"children":[
                {"kind":"component","id":"local_card","component":"ui.card","rect":{"x":0,"y":0,"width":30,"height":30},"children":[
                    {"kind":"panel","id":"local_surface","background_for":{"component":"local_card"},"rect":{"x":0,"y":0,"width":30,"height":30}},
                    {"kind":"text","id":"local_label","text":"Local","rect":{"x":5,"y":5,"width":20,"height":5}}
                ]}
            ]}
        ]));
        let report = inspect(&tree, 16, 8);
        assert_eq!(report.nodes.len(), 2);
        assert_eq!(report.nodes[1].id, "viewport");
        assert_eq!(report.allowed_overlaps.len(), 1);
        assert_eq!(report.allowed_overlaps[0].nodes, ["backdrop", "viewport"]);
        assert!(report.assumptions.iter().any(|assumption| assumption.contains("local/virtual content")));
    }

    #[test]
    fn intentional_background_evidence_is_bounded_without_claiming_a_pass() {
        // Every pair is intentional, so the collision finding limit alone
        // would not bound either output or the work needed to retain evidence.
        let count = 2 + (2.0 * crate::ui::ui_contract().max_layout_findings as f64).sqrt().ceil() as usize;
        let tree = tree(serde_json::json!((0..count).map(|index| serde_json::json!({
            "kind":"panel", "id":format!("surface{index}"), "background_for":{"screen":true},
            "rect":{"x":0,"y":0,"width":100,"height":100}
        })).collect::<Vec<_>>()));
        let mut report = inspect(&tree, 16, 8);
        assert_eq!(report.nodes.len(), count);
        assert_eq!(report.allowed_overlaps.len(), crate::ui::ui_contract().max_layout_findings);
        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].code, "UI_LAYOUT_WORK_LIMIT");
        assert!(report.findings[0].detail.contains("allowed_overlaps="));
        super::apply_overlap_policy(&mut report, &serde_json::json!({"version":1,"screens":{"test":[]}})).unwrap();
        assert!(!report.readable, "an external art policy cannot clear an incomplete inspection");
    }

    #[test]
    fn background_declarations_do_not_bypass_the_pair_comparison_budget() {
        // Enough non-overlapping leaves exceed the pair budget without
        // exhausting either findings or intentional-overlap output.
        let mut children = vec![serde_json::json!({
            "kind":"panel","id":"surface","background_for":{"screen":true},
            "rect":{"x":0,"y":0,"width":1,"height":1}
        })];
        children.extend((0..1500).map(|index| serde_json::json!({
            "kind":"text", "id":format!("label{index}"), "text":"x",
            "rect":{"x":2.0+(index%95) as f64,"y":2.0+(index/95) as f64,"width":0.5,"height":0.5}
        })));
        let tree = tree(serde_json::Value::Array(children));
        let report = inspect(&tree, 16, 8);
        assert!(report.allowed_overlaps.is_empty());
        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].code, "UI_LAYOUT_WORK_LIMIT");
        assert!(!report.readable);
    }

    #[test]
    fn large_overlapping_screens_bound_diagnostics_without_claiming_a_pass() {
        let tree=tree(serde_json::json!((0..2000).map(|i|serde_json::json!({"kind":"text","id":format!("n{i}"),"text":"x","rect":{"x":0,"y":0,"width":10,"height":10}})).collect::<Vec<_>>()));
        let report = inspect(&tree, 16, 8);
        assert_eq!(report.nodes.len(), 2000);
        assert_eq!(report.usage.logical_nodes, 2000);
        assert!(!report.readable);
        assert_eq!(report.findings.last().unwrap().code, "UI_LAYOUT_WORK_LIMIT");
        assert_eq!(
            report.findings.len(),
            crate::ui::ui_contract().max_layout_findings + 1
        );
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

    #[test]
    fn nested_components_are_inspected_by_their_visible_leaves() {
        let tree = tree(serde_json::json!([
            {"kind": "component", "id": "toolbar", "component": "ui.toolbar", "rect": {"x": 0.0, "y": 80.0, "width": 100.0, "height": 20.0}, "children": [
                {"kind": "image", "id": "logo", "asset": "asset://ui/logo", "rect": {"x": 5.0, "y": 85.0, "width": 10.0, "height": 10.0}},
                {"kind": "button", "id": "save", "text": "Save", "action": "Save", "rect": {"x": 20.0, "y": 85.0, "width": 20.0, "height": 10.0}}
            ]}
        ]));
        let report = inspect(&tree, DEFAULT_LAYOUT_COLS, DEFAULT_LAYOUT_ROWS);
        assert!(report.readable, "{:?}", report.findings);
        assert_eq!(
            report
                .nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            vec!["logo", "save"]
        );
        assert_eq!(report.nodes[0].kind, "image");
        assert_eq!(report.nodes[0].asset.as_deref(), Some("asset://ui/logo"));
        assert!(report.ascii.contains('@'));
    }
}
