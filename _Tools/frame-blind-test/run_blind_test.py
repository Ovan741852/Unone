#!/usr/bin/env python3
"""Send a screenshot-only payload to the Frame Atelier blind-decompose route."""
import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from render_hierarchy import export_outputs


ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / "evidence"
SCREENSHOT = EVIDENCE / "hero-loadout.png"
GROUND_TRUTH = EVIDENCE / "html-ground-truth.json"
BLIND_RESULT = EVIDENCE / "blind-result.json"
VISION_RESULT = EVIDENCE / "vision-result.json"
HIERARCHY_RESULT = EVIDENCE / "layout-hierarchy.json"
COMPARISON = EVIDENCE / "comparison.json"
EVALUATION_LOG = EVIDENCE / "evaluation-log.jsonl"
API_URL = "http://127.0.0.1:8787/api/layout-assist"


def iou(first, second):
    left = max(first["x"], second["x"])
    top = max(first["y"], second["y"])
    right = min(first["x"] + first["width"], second["x"] + second["width"])
    bottom = min(first["y"] + first["height"], second["y"] + second["height"])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    first_area = first["width"] * first["height"]
    second_area = second["width"] * second["height"]
    union = first_area + second_area - intersection
    return intersection / union if union else 0.0


def text_score(expected, predicted):
    expected = str(expected or "").strip()
    predicted = str(predicted or "").strip()
    if not expected or not predicted:
        return 0.0
    if expected == predicted:
        return 1.0
    if expected in predicted or predicted in expected:
        return 0.75
    expected_tokens = {token for token in expected.replace("·", " ").split() if len(token) > 1}
    predicted_tokens = {token for token in predicted.replace("·", " ").split() if len(token) > 1}
    return 0.5 if expected_tokens & predicted_tokens else 0.0


def list_score(expected, predicted):
    expected = {str(value) for value in expected or []}
    predicted = {str(value) for value in predicted or []}
    if not expected and not predicted:
        return 1.0
    if not expected or not predicted:
        return 0.0
    return len(expected & predicted) / max(len(expected), len(predicted))


def semantic_compare(expected, predicted):
    expected_component = expected.get("component") or {}
    predicted_component = predicted.get("component") or {}
    expected_grid = expected.get("nine_grid") or {}
    predicted_grid = predicted.get("nine_grid") or {}
    expected_icon = expected.get("icon") or {}
    predicted_icon = predicted.get("icon") or {}
    fields = {
        "label": text_score(expected.get("label"), predicted.get("label")),
        "purpose": text_score(expected.get("purpose"), predicted.get("purpose")),
        "role": 1.0 if expected.get("role") == predicted.get("role") else 0.0,
        "behavior": 1.0 if expected.get("behavior") == predicted.get("behavior") else 0.0,
        "dynamic_fields": list_score(expected.get("dynamic_fields"), predicted.get("dynamic_fields")),
        "fixed_fields": list_score(expected.get("fixed_fields"), predicted.get("fixed_fields")),
        "children": list_score(expected.get("children"), predicted.get("children")),
        "component": 1.0 if (bool(expected_component.get("reusable")) == bool(predicted_component.get("reusable")) and expected_component.get("type") == predicted_component.get("type")) else 0.0,
        "nine_grid": 1.0 if bool(expected_grid.get("eligible")) == bool(predicted_grid.get("eligible")) else 0.0,
        "icon": 1.0 if bool(expected_icon.get("required")) == bool(predicted_icon.get("required")) else 0.0,
    }
    return {"score": round(sum(fields.values()) / len(fields), 4), "fields": fields}


def post_stage(stage, encoded, **extra):
    body = json.dumps({"stage": stage, "screenshot_base64": encoded, **extra}).encode("utf-8")
    request = Request(API_URL, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=300) as response:
        return json.loads(response.read().decode("utf-8"))


def post_blind(encoded):
    return post_stage("blind", encoded)


def dedupe_elements(elements):
    result = []
    for item in elements:
        if not item.get("rect"):
            continue
        duplicate = next((existing for existing in result
                          if existing.get("parent_id") == item.get("parent_id")
                          and iou(existing["rect"], item["rect"]) >= 0.88), None)
        if duplicate is None or item.get("confidence", 0) > duplicate.get("confidence", 0):
            if duplicate is not None:
                result[result.index(duplicate)] = item
            else:
                result.append(item)
    return result


def element_detection_score(truth, predicted):
    expected = truth.get("elements") or []
    available = set(range(len(predicted)))
    matches = []
    for source in expected:
        choices = [(iou(source["rect"], predicted[index]["rect"]), index) for index in available]
        score, index = max(choices, default=(0.0, None))
        if index is not None and score >= 0.18:
            available.remove(index)
        else:
            index = None
            score = 0.0
        found = predicted[index] if index is not None else None
        role_score = 1.0 if found and (source.get("role") == found.get("role") or source.get("role") in {"text", "heading"} and found.get("role") in {"text", "heading"}) else 0.0
        matches.append({"expected": source["id"], "predicted": found.get("id") if found else None, "iou": round(score, 4), "role": role_score, "pass": score >= 0.35})
    passed = [item for item in matches if item["pass"]]
    return {
        "expected_count": len(expected),
        "predicted_count": len(predicted),
        "matched_count": len(passed),
        "match_rate": round(len(passed) / len(matches), 4) if matches else 0.0,
        "mean_iou": round(sum(item["iou"] for item in matches) / len(matches), 4) if matches else 0.0,
        "mean_role": round(sum(item["role"] for item in matches) / len(matches), 4) if matches else 0.0,
        "matches": matches,
    }


def build_renderer_hierarchy(blind, elements):
    """Compose a renderer-neutral tree from pixel parents and Vision children."""
    regions = [dict(item) for item in blind.get("regions", [])]
    nodes = []
    by_id = {}
    for region in regions:
        node = {**region, "children": []}
        by_id[node["id"]] = node
        nodes.append(node)
    for element in elements:
        node = {**element, "children": []}
        node_id = node["id"]
        if node_id in by_id:
            node_id = f"{node_id}-{len(nodes) + 1}"
            node["id"] = node_id
        by_id[node_id] = node
        nodes.append(node)

    def area(item):
        rect = item.get("rect") or {}
        return float(rect.get("width", 0)) * float(rect.get("height", 0))

    def contains(parent, child):
        p, c = parent.get("rect") or {}, child.get("rect") or {}
        return (c.get("x", 0) >= p.get("x", 0) - 0.8 and c.get("y", 0) >= p.get("y", 0) - 0.8 and
                c.get("x", 0) + c.get("width", 0) <= p.get("x", 0) + p.get("width", 0) + 0.8 and
                c.get("y", 0) + c.get("height", 0) <= p.get("y", 0) + p.get("height", 0) + 0.8)

    root_children = [region["id"] for region in regions]
    for node in nodes[len(regions):]:
        parent_id = node.get("parent_id")
        parent = by_id.get(parent_id) if parent_id else None
        if parent is None:
            candidates = [candidate for candidate in nodes if candidate is not node and area(candidate) > area(node) * 1.02 and contains(candidate, node)]
            parent = min(candidates, key=area) if candidates else None
        if parent is not None:
            node["parent_id"] = parent["id"]
            parent["children"].append(node["id"])
        else:
            node["parent_id"] = "screen"
            if not regions and node["id"] not in root_children:
                root_children.append(node["id"])
    return {
        "schema_version": "layout-hierarchy.v1",
        "coordinate_space": "viewport_percent",
        "text_policy": "region_only_exact_text_optional",
        "root": {"id": "screen", "label": "畫面", "role": "root", "rect": {"x": 0, "y": 0, "width": 100, "height": 100}, "children": root_children},
        "nodes": nodes,
    }


def compare(truth, blind, vision):
    expected = {item["id"]: item for item in truth["regions"] if item["id"] != "screen"}
    predicted = {item["id"]: item for item in blind.get("regions", [])}
    matches = []
    semantic_matches = []

    def add_match(source, found, predicted_id):
        score = iou(source["rect"], found["rect"]) if source and found else 0.0
        if source and found:
            semantic = semantic_compare(source, found)
            semantic_matches.append({"expected": source["id"], "predicted": predicted_id, **semantic})
        return {"expected": source["id"], "predicted": predicted_id if found else None, "iou": round(score, 4), "pass": score >= 0.5}

    for region_id in ("topbar", "hero-panel", "character-stage", "inventory-panel", "stats-panel", "ability-panel"):
        source = expected.get(region_id)
        found = predicted.get(region_id)
        if source:
            matches.append(add_match(source, found, region_id if found else None))

    expected_slots = [item for item in truth["regions"] if item["id"].startswith("slot-")]
    blind_slots = [item for item in blind.get("regions", []) if item["id"].startswith("equipment-slot-")]
    available = set(range(len(blind_slots)))
    for source in expected_slots:
        choices = [(iou(source["rect"], blind_slots[index]["rect"]), index) for index in available]
        score, index = max(choices, default=(0.0, None))
        if index is not None:
            available.remove(index)
        found = blind_slots[index] if index is not None else None
        matches.append(add_match(source, found, found["id"] if found else None))

    passed = [item for item in matches if item["pass"]]
    comparison = {
        "screenshot": str(SCREENSHOT),
        "score": round(sum(item["iou"] for item in matches) / len(matches) * 100, 2) if matches else 0.0,
        "viewport": truth["viewport"],
        "html_region_count": len(truth["regions"]),
        "html_comparable_region_count": len(expected),
        "blind_region_count": len(blind.get("regions", [])),
        "matched_count": len(passed),
        "match_rate": round(len(passed) / len(matches), 4) if matches else 0.0,
        "mean_iou": round(sum(item["iou"] for item in matches) / len(matches), 4) if matches else 0.0,
        "semantic_score": round(sum(item["score"] for item in semantic_matches) / len(semantic_matches), 4) if semantic_matches else 0.0,
        "semantic_matches": semantic_matches,
        "threshold": 0.5,
        "matches": matches,
        "notes": [
            "screen 沒有列入可比對區域，因為它是整張畫布，不是盲拆應該回傳的面板。",
            "盲拆使用截圖可見邊界；HTML metadata 只在評測端作為答案，不會送進 blind API。",
            "語意分數按欄位拆開記錄，方便只重跑出錯的 micro-stage。",
            "Vision 評測只看小元件的區域與粗分類；文字內容不列入主分數。",
        ],
    }
    comparison["vision"] = element_detection_score(truth, vision.get("elements", []))
    comparison["vision_stage_count"] = len(vision.get("children", [])) + 1
    return comparison


def main():
    truth = json.loads(GROUND_TRUTH.read_text(encoding="utf-8"))
    encoded = base64.b64encode(SCREENSHOT.read_bytes()).decode("ascii")
    hierarchy_result = post_stage("hierarchy", encoded)
    blind = hierarchy_result.get("blind", {})
    BLIND_RESULT.write_text(json.dumps(blind, ensure_ascii=False, indent=2), encoding="utf-8")
    full_vision = hierarchy_result.get("vision", {}).get("full", {})
    child_results = hierarchy_result.get("vision", {}).get("children", [])
    vision_elements = hierarchy_result.get("vision", {}).get("elements", [])
    vision = {
        "stage": "vision_pipeline",
        "provider": "qwen2.5-vl-3b-local",
        "ocr_mode": "region_only",
        "full": full_vision,
        "children": child_results,
        "elements": vision_elements,
        "hierarchy": hierarchy_result.get("hierarchy") or build_renderer_hierarchy(blind, vision_elements),
        "analysis": "先掃描整張畫面，再逐層裁切容器並掃描子元件；文字只作為文字區域訊號。",
    }
    VISION_RESULT.write_text(json.dumps(vision, ensure_ascii=False, indent=2), encoding="utf-8")
    HIERARCHY_RESULT.write_text(json.dumps(vision["hierarchy"], ensure_ascii=False, indent=2), encoding="utf-8")
    renderer_outputs = export_outputs(HIERARCHY_RESULT, EVIDENCE)
    comparison = compare(truth, blind, vision)
    comparison["recorded_at"] = datetime.now(timezone.utc).isoformat()
    comparison["model"] = "Gemma 3 4B semantics + Qwen2.5-VL-3B visual hierarchy"
    comparison["gemma3_used_for_pixels"] = False
    comparison["next_eval_target"] = "hierarchy_to_html_unity_renderer"
    comparison["renderer_outputs"] = renderer_outputs
    COMPARISON.write_text(json.dumps(comparison, ensure_ascii=False, indent=2), encoding="utf-8")
    with EVALUATION_LOG.open("a", encoding="utf-8") as history:
        history.write(json.dumps(comparison, ensure_ascii=False) + "\n")
    print(json.dumps({"blind": blind, "comparison": comparison}, ensure_ascii=False))


if __name__ == "__main__":
    main()
