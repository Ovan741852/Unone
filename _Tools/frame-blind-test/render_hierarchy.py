#!/usr/bin/env python3
"""Small renderer adapters for layout-hierarchy.v1."""
import argparse
import html
import json
import os
import re
from pathlib import Path


ROLE_CLASS = {
    "root": "root", "panel": "panel", "card": "card", "list": "list", "list_row": "row",
    "button": "button", "image": "image", "avatar": "avatar", "progress": "progress",
    "metric": "metric", "heading": "heading", "text": "text", "tab": "tab", "nav": "nav",
    "status": "status", "icon": "icon", "badge": "badge",
}


def slug(value):
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "node")).strip("-") or "node"


def read_hierarchy(path):
    data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if "hierarchy" in data:
        data = data["hierarchy"]
    if data.get("schema_version") != "layout-hierarchy.v1":
        if isinstance(data.get("nodes"), list) and (data.get("root") or data.get("children")):
            root = data.get("root") or {"id": data.get("id", "screen"), "children": data.get("children") or []}
            data = {**data, "root": root, "schema_version": "layout-hierarchy.v1"}
        else:
            raise ValueError("Expected layout-hierarchy.v1")
    return data


def reachable_nodes(data):
    by_id = {node["id"]: node for node in data.get("nodes", []) if isinstance(node, dict) and node.get("id")}
    output = []

    def walk(node_id, depth=0):
        node = by_id.get(node_id)
        if not node:
            return
        output.append((node, depth))
        for child in node.get("children") or []:
            walk(child, depth + 1)

    for root_id in data.get("root", {}).get("children") or []:
        walk(root_id)
    return output


def rect_style(rect):
    rect = rect or {}
    return ";".join([
        f"left:{float(rect.get('x', 0)):.3f}%",
        f"top:{float(rect.get('y', 0)):.3f}%",
        f"width:{float(rect.get('width', 0)):.3f}%",
        f"height:{float(rect.get('height', 0)):.3f}%",
    ])


def tree_markup(data):
    by_id = {node["id"]: node for node in data.get("nodes", []) if isinstance(node, dict) and node.get("id")}

    def render(node_id, depth=0):
        node = by_id.get(node_id)
        if not node:
            return ""
        label = html.escape(str(node.get("label") or node.get("name") or node_id))
        role = html.escape(str(node.get("role") or "unknown"))
        purpose = html.escape(str(node.get("purpose") or "結構節點"))
        children = "".join(render(child_id, depth + 1) for child_id in node.get("children") or [])
        return (
            f'<details class="tree-node depth-{min(depth, 8)}" data-node-id="{html.escape(str(node_id))}">'
            f'<summary><span class="tree-label">{label}</span><span class="tree-role">{role}</span></summary>'
            f'<div class="tree-purpose">{purpose}</div>{children}</details>'
        )

    return "".join(render(node_id) for node_id in data.get("root", {}).get("children") or [])


def html_scaffold(data, reference_name="hero-loadout.png"):
    root_id = str(data.get("root", {}).get("id") or "screen")
    nodes = []
    for node, depth in reachable_nodes(data):
        node_id = html.escape(str(node.get("id")))
        role = str(node.get("role") or "unknown")
        label = html.escape(str(node.get("label") or node.get("name") or node.get("id")))
        parent = html.escape(str(node.get("parent_id") or root_id))
        classes = f"node role-{ROLE_CLASS.get(role, 'unknown')} depth-{min(depth, 8)}"
        text_flag = "1" if node.get("contains_text") else "0"
        has_children = "1" if node.get("children") else "0"
        nodes.append(
            f'<div class="{classes}" data-node-id="{node_id}" data-parent-id="{parent}" '
            f'data-role="{html.escape(role)}" data-depth="{depth}" data-has-text="{text_flag}" '
            f'data-has-children="{has_children}" style="{rect_style(node.get("rect"))}">'
            f'<span class="node-chip">{label}</span><span class="node-meta">{html.escape(role)} · {node_id}</span></div>'
        )
    tree = tree_markup(data)
    return f'''<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unone · Hierarchy HTML Scaffold</title>
<style>
:root {{ color-scheme: dark; --bg:#081116; --paper:#e9e5d7; --muted:#91aaa5; --cyan:#63e6d5; --gold:#e0b873; --pink:#ff9fba; }}
* {{ box-sizing:border-box; }} body {{ margin:0; min-width:980px; background:var(--bg); color:var(--paper); font:13px "Segoe UI","Noto Sans TC",sans-serif; }}
.toolbar {{ position:sticky; top:0; z-index:20; display:flex; flex-wrap:wrap; gap:10px 14px; align-items:center; padding:14px 18px; background:#0d2026; border-bottom:1px solid #2d565c; }}
.toolbar strong {{ color:var(--gold); font-weight:500; letter-spacing:.04em; }} .toolbar span {{ color:var(--muted); }}
button {{ border:1px solid #3a7a79; background:#123339; color:var(--paper); padding:7px 11px; cursor:pointer; }} button:hover {{ border-color:var(--cyan); }}
.stage {{ width:min(1920px,calc(100vw - 36px)); margin:24px auto; padding:18px; }}
.workspace {{ display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:16px; align-items:start; }}
.screen {{ position:relative; width:100%; aspect-ratio:16 / 9; overflow:hidden; border:1px solid #2d565c; background:#0b1d22; }}
.reference {{ position:absolute; inset:0; background:url('{html.escape(reference_name)}') center/100% 100% no-repeat; opacity:.52; filter:saturate(.72) brightness(.72); }}
.scaffold {{ position:absolute; inset:0; }}
.node {{ position:absolute; min-width:10px; min-height:8px; border:1px solid rgba(99,230,213,.72); background:rgba(13,53,57,.12); color:var(--paper); pointer-events:auto; transition:background .15s,border-color .15s,opacity .15s; }}
.node.is-hidden {{ display:none; }}
.node:not([data-depth="0"]) .node-chip,.node:not([data-depth="0"]) .node-meta {{ opacity:0; pointer-events:none; }}
.node:hover .node-chip,.node:hover .node-meta,.node.is-active .node-chip,.node.is-active .node-meta {{ opacity:1; pointer-events:auto; }}
.node:hover {{ z-index:10; border-color:var(--gold); background:rgba(224,184,115,.16); }}
.node.is-active {{ z-index:12; border-color:var(--gold); background:rgba(224,184,115,.18); }}
.node-chip,.node-meta {{ position:absolute; left:3px; max-width:calc(100% - 6px); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; background:rgba(5,14,18,.9); padding:2px 5px; }}
.node-chip {{ top:3px; color:var(--pink); font-size:11px; }} .node-meta {{ bottom:3px; color:var(--muted); font:10px Consolas,monospace; }}
.role-button {{ border-color:rgba(224,184,115,.85); }} .role-image,.role-avatar {{ border-color:rgba(255,159,186,.7); background:rgba(255,159,186,.08); }}
.role-progress {{ border-color:var(--gold); background:rgba(224,184,115,.2); }} .role-text,.role-heading,.role-metric {{ border-style:dashed; }}
.hide-labels .node-chip,.hide-labels .node-meta {{ display:none; }} .hide-reference .reference {{ display:none; }}
.legend {{ margin-top:14px; color:var(--muted); line-height:1.5; }} .legend b {{ color:var(--pink); font-weight:500; }}
.tree-panel {{ max-height:min(76vh,760px); overflow:auto; padding:14px; border:1px solid #2d565c; background:#0d2026; }}
.tree-panel h2 {{ margin:0 0 10px; color:var(--gold); font-size:14px; font-weight:500; }}
.tree-hint {{ margin:0 0 12px; color:var(--muted); line-height:1.45; }}
.tree-node {{ margin:5px 0; padding-left:8px; border-left:1px solid #285057; }}
.tree-node[open] > summary {{ color:var(--gold); }}
.tree-node summary {{ display:flex; gap:8px; align-items:baseline; cursor:pointer; padding:5px 4px; list-style-position:outside; }}
.tree-node summary::marker {{ color:var(--cyan); }} .tree-label {{ color:var(--paper); }} .tree-role {{ color:var(--cyan); font:10px Consolas,monospace; }}
.tree-purpose {{ margin:0 4px 7px 18px; color:var(--muted); font-size:11px; line-height:1.4; }}
@media (max-width:1100px) {{ .workspace {{ grid-template-columns:1fr; }} .tree-panel {{ max-height:none; }} }}
</style></head><body>
<div class="toolbar"><strong>LAYOUT HIERARCHY / HTML SCAFFOLD</strong><span>先看 panel，再逐層展開元件</span><button id="expand-one">展開可見子層</button><button id="collapse-all">收合全部</button><button id="labels">隱藏節點標籤</button><button id="reference">隱藏參考圖</button></div>
<main class="stage"><div class="workspace"><section><div id="screen" class="screen"><div class="reference"></div><div class="scaffold">{' '.join(nodes)}</div></div>
<div class="legend">原圖是底層參考；<b>點擊畫面框</b> 或展開右側樹狀節點，才會顯示下一層。粉紅文字是節點標籤，邊框是 hierarchy 節點。</div></section>
<aside class="tree-panel"><h2>Hierarchy tree</h2><p class="tree-hint">外層 panel 預設可見。開啟節點後，畫面只顯示它的子層。</p>{tree}</aside></div></main>
<script>
const screen=document.getElementById('screen');
const rootId={json.dumps(root_id, ensure_ascii=False)};
const nodes=[...screen.querySelectorAll('.node')];
const treeNodes=[...document.querySelectorAll('.tree-node')];
const expanded=new Set();
const nodeById=new Map(nodes.map(node=>[node.dataset.nodeId,node]));
const treeById=new Map(treeNodes.map(node=>[node.dataset.nodeId,node]));
function visible(node) {{
  let parent=node.dataset.parentId;
  while (parent && parent !== rootId) {{
    if (!expanded.has(parent)) return false;
    parent=nodeById.get(parent)?.dataset.parentId;
  }}
  return true;
}}
function refresh() {{
  nodes.forEach(node=>{{ node.classList.toggle('is-hidden', !visible(node)); node.classList.toggle('is-active', expanded.has(node.dataset.nodeId)); }});
  treeNodes.forEach(treeNode=>{{ treeNode.open=expanded.has(treeNode.dataset.nodeId); }});
}}
function toggle(id, value) {{
  if (!nodeById.get(id)?.dataset.hasChildren || nodeById.get(id).dataset.hasChildren === '0') return;
  value === undefined ? (expanded.has(id) ? expanded.delete(id) : expanded.add(id)) : (value ? expanded.add(id) : expanded.delete(id));
  refresh();
}}
nodes.forEach(node=>node.addEventListener('click', event=>{{ event.stopPropagation(); toggle(node.dataset.nodeId); }}));
treeNodes.forEach(treeNode=>treeNode.addEventListener('toggle',()=>{{ if (treeNode.open) expanded.add(treeNode.dataset.nodeId); else expanded.delete(treeNode.dataset.nodeId); refresh(); }}));
document.getElementById('expand-one').onclick=()=>{{ nodes.filter(node=>visible(node) && node.dataset.hasChildren==='1').forEach(node=>expanded.add(node.dataset.nodeId)); refresh(); }};
document.getElementById('collapse-all').onclick=()=>{{ expanded.clear(); refresh(); }};
document.getElementById('labels').onclick=(event)=>{{screen.classList.toggle('hide-labels');event.currentTarget.textContent=screen.classList.contains('hide-labels')?'顯示節點標籤':'隱藏節點標籤'}};
document.getElementById('reference').onclick=(event)=>{{screen.classList.toggle('hide-reference');event.currentTarget.textContent=screen.classList.contains('hide-reference')?'顯示參考圖':'隱藏參考圖'}};
refresh();
</script></body></html>'''


UNITY_IMPORTER = r'''// Put this file under Assets/Editor/UnoneHierarchyImporter.cs.
// It imports layout-hierarchy.v1 and creates a Canvas/Prefab from the hierarchy.
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

public static class UnoneHierarchyImporter
{
    [Serializable] class LayoutFile { public LayoutRoot root; public LayoutNode[] nodes; }
    [Serializable] class LayoutRoot { public string id; public string label; public LayoutRect rect; public string[] children; }
    [Serializable] class LayoutNode { public string id; public string label; public string role; public string parent_id; public bool contains_text; public LayoutRect rect; public string[] children; }
    [Serializable] class LayoutRect { public float x; public float y; public float width; public float height; }

    [MenuItem("Tools/Unone/Import Layout Hierarchy...")]
    public static void Import()
    {
        var jsonPath = EditorUtility.OpenFilePanel("Open layout-hierarchy.v1", Application.dataPath, "json");
        if (string.IsNullOrEmpty(jsonPath)) return;
        var data = JsonUtility.FromJson<LayoutFile>(File.ReadAllText(jsonPath));
        var byId = new Dictionary<string, LayoutNode>();
        foreach (var node in data.nodes ?? Array.Empty<LayoutNode>()) if (!string.IsNullOrEmpty(node.id)) byId[node.id] = node;

        var canvas = new GameObject("ImportedLayout", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        var canvasComponent = canvas.GetComponent<Canvas>(); canvasComponent.renderMode = RenderMode.ScreenSpaceOverlay;
        var canvasRect = canvas.GetComponent<RectTransform>(); canvasRect.anchorMin = Vector2.zero; canvasRect.anchorMax = Vector2.one; canvasRect.offsetMin = Vector2.zero; canvasRect.offsetMax = Vector2.zero;
        var rootRect = new LayoutRect { x = 0, y = 0, width = 100, height = 100 };
        foreach (var id in data.root.children ?? Array.Empty<string>()) CreateNode(id, canvas.transform, rootRect, byId);

        var folder = "Assets/ImportedLayouts"; Directory.CreateDirectory(folder);
        var prefabPath = AssetDatabase.GenerateUniqueAssetPath(folder + "/ImportedLayout.prefab");
        PrefabUtility.SaveAsPrefabAsset(canvas, prefabPath); UnityEngine.Object.DestroyImmediate(canvas);
        AssetDatabase.Refresh(); Selection.activeObject = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
        Debug.Log("Unone hierarchy imported: " + prefabPath);
    }

    static void CreateNode(string id, Transform parent, LayoutRect parentRect, Dictionary<string, LayoutNode> byId)
    {
        if (!byId.TryGetValue(id, out var node)) return;
        var go = new GameObject(string.IsNullOrEmpty(node.label) ? node.id : node.label, typeof(RectTransform));
        go.transform.SetParent(parent, false); var rect = go.GetComponent<RectTransform>(); SetRect(rect, node.rect, parentRect); AddVisual(node, go);
        foreach (var child in node.children ?? Array.Empty<string>()) CreateNode(child, rect, node.rect, byId);
    }

    static void SetRect(RectTransform target, LayoutRect value, LayoutRect parent)
    {
        if (value == null) return;
        var pw = Mathf.Max(0.01f, parent.width); var ph = Mathf.Max(0.01f, parent.height);
        var x = (value.x - parent.x) / pw; var y = (value.y - parent.y) / ph; var w = value.width / pw; var h = value.height / ph;
        target.anchorMin = new Vector2(x, 1f - y - h); target.anchorMax = new Vector2(x + w, 1f - y); target.offsetMin = Vector2.zero; target.offsetMax = Vector2.zero;
    }

    static void AddVisual(LayoutNode node, GameObject go)
    {
        var role = node.role ?? "unknown";
        if (role == "button") go.AddComponent<Button>();
        if (role == "panel" || role == "card" || role == "button" || role == "image" || role == "avatar" || role == "progress" || role == "badge")
        {
            var image = go.GetComponent<Image>() ?? go.AddComponent<Image>(); image.color = ColorFor(role);
        }
        if (node.contains_text || role == "heading" || role == "text" || role == "metric" || role == "tab" || role == "status")
        {
            var label = go.AddComponent<Text>(); label.text = node.label ?? node.id; label.color = Color.white; label.alignment = TextAnchor.MiddleCenter; label.font = Resources.GetBuiltinResource<Font>("Arial.ttf"); label.resizeTextForBestFit = true;
        }
    }

    static Color ColorFor(string role)
    {
        if (role == "button") return new Color(.78f, .55f, .22f, .9f);
        if (role == "image" || role == "avatar") return new Color(.55f, .28f, .45f, .35f);
        if (role == "progress") return new Color(.35f, .82f, .75f, .65f);
        return new Color(.08f, .22f, .26f, .65f);
    }
}
'''


def export_outputs(hierarchy_path, output_dir):
    hierarchy_path = Path(hierarchy_path)
    output_dir = Path(output_dir)
    data = read_hierarchy(hierarchy_path)
    raw = json.loads(hierarchy_path.read_text(encoding="utf-8-sig"))
    source_image = Path(raw.get("screenshot", "")) if raw.get("screenshot") else hierarchy_path.parent / "hero-loadout.png"
    if not source_image.is_file():
        source_image = hierarchy_path.parent / "hero-loadout.png"
    reference_name = Path(os.path.relpath(source_image, output_dir)).as_posix() if source_image.is_file() else "hero-loadout.png"
    html_path = output_dir / "hierarchy-scaffold.html"
    unity_path = output_dir / "UnoneHierarchyImporter.cs"
    html_path.write_text(html_scaffold(data, reference_name), encoding="utf-8")
    unity_path.write_text(UNITY_IMPORTER, encoding="utf-8")
    return {"html": str(html_path), "unity_importer": str(unity_path), "schema": "layout-hierarchy.v1"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    result = export_outputs(args.input, args.output_dir)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
