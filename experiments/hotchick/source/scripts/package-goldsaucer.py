"""Package an official Unone export for GoldSaucer's static game host."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ALLOWED = set("aac atlas avif basis bin bmp css csv fnt gif glb gltf htm html ico jpeg jpg js json ktx2 m4a map mjs mp3 mp4 ogg otf plist png skel svg ttf txt wasm wav webm webp woff woff2 xml".split())
MAX_FILE = 20 * 1024 * 1024
MAX_TOTAL = 200 * 1024 * 1024
MAX_TRANSPORT_FILE = 5_500_000


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def probe(ffprobe: str, path: Path) -> dict:
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return json.loads(result.stdout)


def compress_video(source: Path, destination: Path, ffmpeg: str, ffprobe: str) -> dict:
    before = probe(ffprobe, source)
    temporary = destination.with_name(destination.stem + ".upload-tmp.mp4")
    for quality in (24, 28, 32):
        subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
             "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "fast",
             "-crf", str(quality), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
             "-movflags", "+faststart", str(temporary)],
            check=True,
        )
        if temporary.stat().st_size <= MAX_TRANSPORT_FILE:
            break
    if temporary.stat().st_size > MAX_TRANSPORT_FILE:
        raise RuntimeError(f"Video still exceeds transport budget: {source.name}")
    after = probe(ffprobe, temporary)
    original_video = next(s for s in before["streams"] if s["codec_type"] == "video")
    encoded_video = next(s for s in after["streams"] if s["codec_type"] == "video")
    if (original_video["width"], original_video["height"]) != (encoded_video["width"], encoded_video["height"]):
        raise RuntimeError("Video dimensions changed unexpectedly")
    if abs(float(before["format"]["duration"]) - float(after["format"]["duration"])) > 0.12:
        raise RuntimeError("Video duration changed unexpectedly")
    subprocess.run([ffmpeg, "-v", "error", "-i", str(temporary), "-f", "null", "-"], check=True)
    os.replace(temporary, destination)
    return {
        "sourceBytes": source.stat().st_size, "bytes": destination.stat().st_size,
        "quality": quality, "width": encoded_video["width"], "height": encoded_video["height"],
        "duration": float(after["format"]["duration"]), "decoded": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cover", type=Path, default=ROOT / "assets/platform/goldsaucer/cover-v1.webp")
    parser.add_argument("--metadata", type=Path, default=ROOT / "assets/platform/goldsaucer/metadata-v1.json")
    parser.add_argument("--functions", type=Path, help="GoldSaucer defineFunctions server script")
    parser.add_argument("--room-script", type=Path, help="GoldSaucer defineRoom multiplayer script")
    parser.add_argument("--currency-name", default="心動幣")
    parser.add_argument("--ffmpeg", default=os.environ.get("HOTCHICK_FFMPEG", r"C:\ffmpeg\ffmpeg.exe"))
    parser.add_argument("--ffprobe", default=os.environ.get("HOTCHICK_FFPROBE", r"C:\ffmpeg\ffprobe.exe"))
    args = parser.parse_args()
    release = args.release.resolve(strict=True)
    output = args.output.resolve()
    if output.exists():
        raise SystemExit("Choose a new output directory")
    index = (release / "index.html").read_text(encoding="utf-8")
    match = re.search(r'<base\s+href="([^"]+)"\s*/?>', index)
    if not match:
        raise SystemExit("Expected an official export with a release base")
    canonical = (release / match.group(1)).resolve(strict=True)
    canonical.relative_to(release)
    metadata = json.loads(args.metadata.read_text(encoding="utf-8-sig"))
    currency_settings = metadata.get("currency", {})
    auto_buy_in = currency_settings.get("autoBuyIn", False)
    auto_cash_out = currency_settings.get("autoCashOut", False)
    if not isinstance(auto_buy_in, bool) or not isinstance(auto_cash_out, bool):
        raise RuntimeError("Currency entry/exit exchange settings must be booleans")
    output.mkdir(parents=True)
    renamed = []
    transcodes = []
    for source in sorted(canonical.rglob("*")):
        if not source.is_file():
            continue
        relative = source.relative_to(canonical)
        if relative.name == "LICENSE":
            renamed.append(relative.as_posix())
            relative = relative.with_name("LICENSE.txt")
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix.lower() == ".mp4" and source.stat().st_size > MAX_TRANSPORT_FILE:
            result = compress_video(source, destination, args.ffmpeg, args.ffprobe)
            transcodes.append({"path": relative.as_posix(), **result})
        else:
            shutil.copyfile(source, destination)
    presentation_path = output / "content/presentation.json"
    presentation = json.loads(presentation_path.read_text(encoding="utf-8"))
    presentation["renderer_files"] = [
        name + ".txt" if name.endswith("/LICENSE") else name
        for name in presentation["renderer_files"]
    ]
    write_json(presentation_path, presentation)
    index = index[:match.start()] + index[match.end():]
    index = re.sub(r"<title>.*?</title>", "<title>" + html.escape(metadata["title"]) + "</title>", index, count=1)
    (output / "index.html").write_text(index, encoding="utf-8")
    shutil.copyfile(args.cover, output / "cover.webp")
    manifest = {
        "entry": "index.html", "cover": "cover.webp", "sdk": {"inject": True},
        "orientation": "landscape", "aspectRatio": 16 / 9,
    }
    if args.functions:
        functions_path = output / "server/functions.js"
        functions_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.functions.resolve(strict=True), functions_path)
        manifest["functions"] = "server/functions.js"
        manifest["currency"] = {"name": args.currency_name, "perDiamond": 50,
                                "autoBuyIn": auto_buy_in, "autoCashOut": auto_cash_out}
    if args.room_script:
        room_path = output / "server/room.js"
        room_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.room_script.resolve(strict=True), room_path)
        manifest["server"] = "server/room.js"
    write_json(output / "goldsaucer.json", manifest)
    entries = []
    for path in sorted(output.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(output).as_posix()
        if path.suffix.lower().lstrip(".") not in ALLOWED:
            raise RuntimeError(f"Unsupported upload extension: {relative}")
        raw = path.read_bytes()
        if len(raw) > MAX_FILE:
            raise RuntimeError(f"File exceeds platform limit: {relative}")
        if len(relative) > 256:
            raise RuntimeError(f"Path exceeds platform limit: {relative}")
        entries.append({"path": relative, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    total = sum(entry["size"] for entry in entries)
    if len(entries) > 2000 or total > MAX_TOTAL:
        raise RuntimeError("Package exceeds platform limits")
    archive = output.with_suffix(".zip")
    if archive.exists():
        raise RuntimeError("Choose a new archive name")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zipped:
        for entry in entries:
            zipped.write(output / entry["path"], entry["path"])
    if archive.stat().st_size > 100 * 1024 * 1024:
        raise RuntimeError("ZIP exceeds archive upload limit; chunked plugin upload is still available")
    report = {
        "schema": "hotchick.goldsaucer-package.v1", "release": release.name,
        "title": metadata["title"], "slug": metadata["suggestedSlug"],
        "files": entries, "totalBytes": total, "archiveBytes": archive.stat().st_size,
        "renamedLicenses": renamed, "transcodedVideos": transcodes,
        "sdkInjection": True, "serverIncluded": bool(args.room_script),
        "functionsIncluded": bool(args.functions),
        "exchange": {"diamonds": 1, "coins": 50, "available": bool(args.functions),
                     "autoBuyIn": bool(args.functions) and auto_buy_in,
                     "autoCashOut": bool(args.functions) and auto_cash_out},
    }
    write_json(output.with_name(output.name + "-upload.json"), report)
    print(json.dumps({"output": str(output), "files": len(entries), "bytes": total,
                      "archive": str(archive), "archiveBytes": archive.stat().st_size,
                      "transcodedVideos": len(transcodes)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
