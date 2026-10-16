"""Independent cmap coverage of the visible text in a real player QA report.

Does not infer coverage from FontFace.status, document.fonts.check, or font names.
Host/system fallback can still render unproven characters; that distinction is
reported explicitly. No authored project or export content is modified.
"""
import argparse
import csv
import json
from pathlib import Path
from html.parser import HTMLParser
import unicodedata
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser()
parser.add_argument("--export", required=True)
parser.add_argument("--report", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
root = Path(args.export).resolve()
browser = json.loads(Path(args.report).read_text(encoding="utf-8"))


class BaseReader(HTMLParser):
    href = ""

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "base":
            self.href = dict(attrs).get("href", "")


base = BaseReader()
base.feed((root / "index.html").read_text(encoding="utf-8"))
content = (root / base.href / "content").resolve()
if not content.is_relative_to(root):
    raise ValueError("Export base path escapes its root")
presentation = json.loads((content / "presentation.json").read_text(encoding="utf-8"))
ui = presentation.get("ui", {})
faces = list(ui.get("fonts", []))
if ui.get("font_source"):
    faces.insert(0, dict(family=ui["font_family"], source=ui["font_source"], weight=400))
default_family = ui.get("font_family") or (faces[0]["family"] if faces else "sans-serif")
glyphs = {}
face_reports = []
for face in faces:
    path = (content / face["source"]).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Font source escapes export root")
    font = TTFont(path, lazy=True)
    codepoints = set()
    for table in font["cmap"].tables:
        if table.isUnicode():
            codepoints.update(cp for cp, name in table.cmap.items() if name != ".notdef")
    font.close()
    key = (face["family"], face.get("weight", 400))
    glyphs[key] = codepoints
    face_reports.append(dict(**face, unicode_codepoints=len(codepoints), bytes=path.stat().st_size))


def walk(nodes):
    for node in nodes:
        yield node
        yield from walk(node.get("children", []))


def families(value):
    return [name.strip().strip("\"'") for name in next(csv.reader([value], skipinitialspace=True))]


samples = {}
for viewport in browser["viewports"]:
    for state in viewport["states"]:
        for node in walk(state["state"]["snapshot"]["world"]["ui"].get("children", [])):
            text = node.get("text")
            if not text:
                continue
            style = node.get("style") or {}
            family, weight = style.get("font_family", default_family), style.get("font_weight", 400)
            samples[(family, weight, text)] = node["id"]

text_reports = []
missing_all = set()
for (family, weight, text), node_id in samples.items():
    # Match a registered alias at its nearest declared weight, then explicitly
    # listed fallbacks. Undeclared system families are not guessed.
    coverage = set()
    matched = []
    for alias in families(family):
        candidates = [key for key in glyphs if key[0] == alias]
        if candidates:
            key = min(candidates, key=lambda k: abs(k[1] - weight))
            matched.append(dict(family=key[0], weight=key[1]))
            coverage.update(glyphs[key])
    required = {ord(c) for c in text if not c.isspace() and unicodedata.category(c) not in {"Cf", "Cc"}}
    missing = required - coverage
    missing_all.update(missing)
    text_reports.append(dict(node=node_id, family=family, weight=weight, text=text, matched_faces=matched,
                             required_codepoints=len(required), packaged_coverage_proven=not missing,
                             unproven=[dict(code=f"U+{cp:04X}", char=chr(cp)) for cp in sorted(missing)]))

result = dict(ok=not missing_all, strict=browser.get("requirePackagedGlyphCoverage", False),
              faces=face_reports, text_samples=len(samples), samples=text_reports,
              note="Unproven means no explicitly selected packaged face contains the codepoint; system fallback may still paint it.")
Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(dict(ok=result["ok"], strict=result["strict"], faces=len(face_reports), text_samples=len(samples),
                      unproven_codepoints=len(missing_all))))
if result["strict"] and missing_all:
    raise SystemExit(1)
