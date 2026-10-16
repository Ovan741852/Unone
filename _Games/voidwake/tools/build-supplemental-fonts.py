"""Build licensed, missing-glyph-only fallbacks without modifying the original faces.

Requires fontTools. The cached upstream variable font is an explicit input, not a
network dependency. The source hash is pinned so an upstream update cannot silently
change this game's typography. --check only verifies the checked-in outputs.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path

import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "fonts"
SOURCE_SHA256 = "c6481c5d93420aeac11087367dae56ae7492eb1989ce42f4ca5d5aa5e2db3116"
UPSTREAM = "https://github.com/google/fonts/tree/main/ofl/notosanstc"
WEIGHTS = {400: "Regular", 600: "SemiBold", 700: "Bold"}
FAMILY = "Noto Sans TC Supplemental"
MANIFEST = FONTS / "supplemental-fonts.json"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cmap(path):
    with TTFont(path) as font:
        return set(font.getBestCmap())


def required_characters():
    sources = [ROOT / "gameplay.luau", *sorted(ROOT.glob("*.fragment.luau"))]
    return {ord(char) for path in sources for char in path.read_text(encoding="utf-8")
            if ord(char) > 127 and not char.isspace()}


def check():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for name, expected in manifest["original_faces_sha256"].items():
        assert sha256(FONTS / name) == expected, f"Original face changed: {name}"
    for name, expected in manifest["output_faces_sha256"].items():
        assert sha256(FONTS / name) == expected, f"Supplemental face changed: {name}"
    required = required_characters()
    for weight in WEIGHTS:
        coverage = cmap(FONTS / f"NotoSansTC-{weight}.ttf")
        coverage |= cmap(FONTS / f"NotoSansTC-Supplemental-{weight}.ttf")
        missing = required - coverage
        assert not missing, f"Weight {weight} needs supplemental codepoints: {sorted(missing)}"
    print(json.dumps({"ok": True, "weights": list(WEIGHTS),
                      "authored_non_ascii_codepoints": len(required),
                      "supplemental_codepoints": len(manifest["codepoints"])}))


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, help="Pinned, licensed upstream NotoSansTC variable TTF")
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if args.check:
    check()
    raise SystemExit(0)
if args.source is None:
    parser.error("--source is required when rebuilding")
if sha256(args.source) != SOURCE_SHA256:
    parser.error("Source SHA-256 differs from the pinned upstream font; do not substitute a newer face")

originals = {f"NotoSansTC-{weight}.ttf": sha256(FONTS / f"NotoSansTC-{weight}.ttf")
             for weight in WEIGHTS}
shared_coverage = set.intersection(*(cmap(FONTS / name) for name in originals))
missing = required_characters() - shared_coverage
source = TTFont(args.source, recalcTimestamp=False)
assert missing <= set(source.getBestCmap()), "Upstream font lacks an authored character"
options = subset.Options()
options.name_IDs = ["*"]
options.name_languages = ["*"]
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=missing)
subsetter.subset(source)
outputs = {}
for weight, subfamily in WEIGHTS.items():
    font = instantiateVariableFont(copy.deepcopy(source), {"wght": weight}, inplace=True)
    font.recalcTimestamp = False
    # A distinct family identifies this derivative; no glyphs are merged into any
    # original Noto or Share Tech Mono face. Preserve copyright/license records.
    for name_id, value in {1: FAMILY, 2: subfamily, 4: f"{FAMILY} {subfamily}",
                           6: f"NotoSansTCSupplemental-{subfamily}",
                           16: FAMILY, 17: subfamily}.items():
        for record in list(font["name"].names):
            if record.nameID == name_id:
                font["name"].removeNames(nameID=name_id)
                break
        font["name"].setName(value, name_id, 3, 1, 0x409)
        font["name"].setName(value, name_id, 1, 0, 0)
    output = FONTS / f"NotoSansTC-Supplemental-{weight}.ttf"
    font.save(output)
    outputs[output.name] = sha256(output)
MANIFEST.write_text(json.dumps({
    "family": FAMILY,
    "upstream_family_url": UPSTREAM,
    "cached_source_filename": args.source.name,
    "source_sha256": SOURCE_SHA256,
    "license": "SIL Open Font License 1.1; see notosanstc-LICENSE.txt",
    "fonttools_version": fontTools.__version__,
    "codepoints": [f"U+{value:04X}" for value in sorted(missing)],
    "original_faces_sha256": originals,
    "output_faces_sha256": outputs,
}, indent=2) + "\n", encoding="utf-8")
check()
