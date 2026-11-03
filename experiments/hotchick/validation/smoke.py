"""Asset-free CLI checks for the handoff; never exercises the game renderer.

Requires Pillow, FFmpeg and FFprobe. Node.js enables JavaScript syntax checks.
All generated media and copied tool workspaces live in TemporaryDirectory.
"""
from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source"


def executable(explicit, env_name, name):
    value = explicit or os.environ.get(env_name) or shutil.which(name)
    if not value or not Path(value).is_file():
        raise RuntimeError(name + " is required; specify its path with the CLI flag or environment variable")
    return str(Path(value).resolve())


def run(args, env=None):
    result = subprocess.run([str(x) for x in args], capture_output=True,
                            text=True, encoding="utf-8", errors="replace", env=env, timeout=120)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout)[-3000:])
    return result.stdout


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg")
    parser.add_argument("--ffprobe")
    parser.add_argument("--report", type=Path, default=ROOT / "validation/RESULTS.json")
    args = parser.parse_args()
    report = {"schema": "hotchick.handoff-smoke.v1", "passed": False,
              "scope": "Text syntax and synthetic asset-tool CLI only",
              "checks": [], "skips": [], "generated_media_committed": False,
              "not_executed": ["Original asset-dependent QA suites", "Full-game native acceptance",
                               "Browser rendering, video concurrency, GPU shader and frame-time tests"]}
    scratch_path = None

    def check(name, detail=None):
        report["checks"].append({"name": name, **({"detail": detail} if detail is not None else {})})

    try:
        for path in sorted(SOURCE.rglob("*.py")):
            ast.parse(path.read_text(encoding="utf-8-sig"), filename=path.name)
            check("python-ast", path.relative_to(SOURCE).as_posix())
        for path in sorted(SOURCE.rglob("*.json")):
            json.loads(path.read_text(encoding="utf-8-sig"))
            check("json-parse", path.relative_to(SOURCE).as_posix())
        js_files = sorted([*SOURCE.rglob("*.mjs"), *SOURCE.rglob("*.js")])
        node = shutil.which("node")
        if node:
            for path in js_files:
                run([node, "--check", path])
                check("javascript-syntax", path.relative_to(SOURCE).as_posix())
        else:
            report["skips"].append({"name": "javascript-syntax", "files": len(js_files), "reason": "Node.js unavailable"})
        ffmpeg = executable(args.ffmpeg, "HOTCHICK_FFMPEG", "ffmpeg")
        ffprobe = executable(args.ffprobe, "HOTCHICK_FFPROBE", "ffprobe")
        env = {**os.environ, "HOTCHICK_FFMPEG": ffmpeg, "HOTCHICK_FFPROBE": ffprobe,
               "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8"}
        with tempfile.TemporaryDirectory(prefix="hotchick-handoff-") as temporary:
            scratch_path = Path(temporary)
            # The tools derive their workspace from their file location. Copy the
            # unchanged CLI files so their intermediate cache is also temporary.
            tools = {}
            for folder, filename in [("card-tool", "card_tool.py"), ("media-tool", "media_tool.py")]:
                target = scratch_path / "scripts" / folder / filename
                target.parent.mkdir(parents=True)
                shutil.copyfile(SOURCE / "scripts" / folder / filename, target)
                assert digest(target) == digest(SOURCE / "scripts" / folder / filename)
                tools[folder] = target
            check("unchanged-tool-copies")
            image_path = scratch_path / "abstract.png"
            image = Image.new("RGB", (360, 540), "#263868")
            ImageDraw.Draw(image).rectangle((120, 0, 239, 539), fill="#54c8a0")
            image.save(image_path)
            video_path = scratch_path / "abstract.mp4"
            run([ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                 "-i", "testsrc2=size=192x128:rate=12:duration=1", "-c:v", "libx264",
                 "-threads", "2", "-pix_fmt", "yuv420p", video_path], env)
            originals = {image_path: digest(image_path), video_path: digest(video_path)}
            recipes = {}
            for kind in ("card", "media"):
                recipes[kind] = json.loads((ROOT / "examples" / (kind + "-recipe.json")).read_text())
            recipes["card"]["sources"][0]["path"] = str(image_path)
            recipes["media"]["sources"][0]["file"] = str(video_path)
            for kind, folder in [("card", "card-tool"), ("media", "media-tool")]:
                recipe_path = scratch_path / (kind + "-recipe.json")
                recipe = copy.deepcopy(recipes[kind])
                recipe["sources"][0]["sha256"] = originals[image_path if kind == "card" else video_path]
                recipe_path.write_text(json.dumps(recipe), encoding="utf-8")
                output = scratch_path / (kind + "-output")
                for command in ("validate", "build"):
                    run([sys.executable, tools[folder], command, "--recipe", recipe_path,
                         "--output-dir", output, "--json"], env)
                    check(kind + "-cli-" + command)
            card = scratch_path / "card-output/abstract.webp"
            with Image.open(card) as result:
                assert result.format == "WEBP" and result.size == (600, 900)
            check("card-webp-600x900")
            media = scratch_path / "media-output"
            atlas = json.loads((media / "field-sprites.json").read_text(encoding="utf-8"))["sources"][0]
            assert (atlas["frame_count"], atlas["fps"], atlas["columns"], atlas["rows"]) == (6, 6, 4, 2)
            assert (atlas["tile_width"], atlas["tile_height"], atlas["width"], atlas["height"]) == (64, 64, 256, 128)
            with Image.open(media / "abstract-atlas.webp") as result:
                assert result.size == (256, 128)
                assert result.convert("RGBA").crop((128, 64, 192, 128)).getextrema()[3] == (0, 0)
            check("atlas-metadata-dimensions-and-unused-alpha")
            probe = json.loads(run([ffprobe, "-v", "error", "-show_streams", "-of", "json", media / "abstract-video.mp4"], env))
            stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
            assert (stream["codec_name"], stream["width"], stream["height"]) == ("h264", 192, 128)
            run([ffmpeg, "-v", "error", "-i", media / "abstract-video.mp4", "-f", "null", "-"], env)
            check("video-h264-dimensions-and-full-decode")
            with Image.open(media / "abstract-poster.webp") as result:
                assert result.size == (96, 64)
            check("poster-dimensions")
            assert all(digest(path) == expected for path, expected in originals.items())
            check("source-sha256-unchanged")
        report["passed"] = True
    except Exception as error:
        message = str(error).replace(str(ROOT), "<handoff>")
        if scratch_path is not None:
            message = message.replace(str(scratch_path), "<temporary>")
        report["error"] = message
    report["passed_checks"] = len(report["checks"])
    report["skipped_groups"] = len(report["skips"])
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("passed", "passed_checks", "skipped_groups")}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
