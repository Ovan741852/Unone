"""Evaluation-only grayscale/Canny geometry trial for the Frame Atelier sample."""
import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / "evidence"
IMAGE = EVIDENCE / "hero-loadout.png"
TRUTH = EVIDENCE / "html-ground-truth.json"
RESULT = EVIDENCE / "edge-trial-result.json"
GRAY = EVIDENCE / "edge-trial-gray.png"
EDGE = EVIDENCE / "edge-trial-canny.png"
OVERLAY = EVIDENCE / "edge-trial-overlay.png"


def iou(first, second):
    left = max(first["x"], second["x"])
    top = max(first["y"], second["y"])
    right = min(first["x"] + first["width"], second["x"] + second["width"])
    bottom = min(first["y"] + first["height"], second["y"] + second["height"])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    union = first["width"] * first["height"] + second["width"] * second["height"] - intersection
    return intersection / union if union else 0.0


def detect_candidates(image):
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(gray, 35, 110)
    closed = cv2.morphologyEx(
        edges,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
        iterations=1,
    )
    contours, _ = cv2.findContours(closed, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        area = box_width * box_height
        if area < width * height * 0.004 or box_width < width * 0.04 or box_height < height * 0.025:
            continue
        if box_width > width * 0.99 or box_height > height * 0.95:
            continue
        candidate = {
            "x": x / width * 100,
            "y": y / height * 100,
            "width": box_width / width * 100,
            "height": box_height / height * 100,
        }
        if any(iou(candidate, existing) > 0.88 for existing in candidates):
            continue
        candidates.append(candidate)
    return gray, edges, candidates


def evaluate(candidates, truth):
    expected = [item for item in truth["regions"] if item["id"] != "screen"]
    available = set(range(len(candidates)))
    matches = []
    for item in expected:
        choices = sorted(((iou(item["rect"], candidates[index]), index) for index in available), reverse=True)
        score, index = choices[0] if choices else (0.0, None)
        if index is not None:
            available.remove(index)
        matches.append({"expected": item["id"], "iou": round(score, 4), "pass": score >= 0.5})
    return {
        "expected_count": len(expected),
        "candidate_count": len(candidates),
        "mean_iou": round(sum(item["iou"] for item in matches) / len(matches), 4),
        "pass_rate": round(sum(item["pass"] for item in matches) / len(matches), 4),
        "matches": matches,
    }


def draw_overlay(image, candidates, truth):
    output = image.copy()
    height, width = output.shape[:2]

    def draw(rect, color, thickness):
        x = int(rect["x"] / 100 * width)
        y = int(rect["y"] / 100 * height)
        right = int((rect["x"] + rect["width"]) / 100 * width)
        bottom = int((rect["y"] + rect["height"]) / 100 * height)
        cv2.rectangle(output, (x, y), (right, bottom), color, thickness)

    for item in truth["regions"]:
        if item["id"] != "screen":
            draw(item["rect"], (0, 190, 255), 3)
    for candidate in candidates:
        draw(candidate, (255, 210, 0), 2)
    return output


def main():
    image = cv2.imread(str(IMAGE), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"cannot read {IMAGE}")
    truth = json.loads(TRUTH.read_text(encoding="utf-8"))
    gray, edges, candidates = detect_candidates(image)
    evaluation = evaluate(candidates, truth)
    cv2.imwrite(str(GRAY), gray)
    cv2.imwrite(str(EDGE), edges)
    cv2.imwrite(str(OVERLAY), draw_overlay(image, candidates, truth))
    result = {
        "variant": "grayscale_gaussian_canny35_110_close3_once",
        "input": str(IMAGE),
        "preprocess": ["BGR to grayscale", "GaussianBlur 3x3", "Canny 35/110", "MORPH_CLOSE 3x3 once"],
        "evaluation": evaluation,
        "baseline": {"mean_iou": 0.868, "pass_rate": 1.0, "source": "comparison.json"},
        "artifacts": {"gray": str(GRAY), "canny": str(EDGE), "overlay": str(OVERLAY)},
        "note": "Geometry-only trial; ground truth is used only after detection for evaluation, never during candidate extraction.",
    }
    RESULT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
