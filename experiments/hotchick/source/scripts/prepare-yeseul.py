"""Prepare the six supplied Yeseul clips, preserving original files and framing.

Use inspect before performances. Field mode is explicit because only one
dedicated board clip was supplied: small-only, shared, or classic-segments.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\maverickchiu\Downloads\yeseul")
ORIGINALS = ROOT / "assets/media/yeseul"
RUNTIME = ROOT / "game/presentation/assets/yeseul"
TEMP = ROOT / ".cache/tmp/yeseul-media"
FFMPEG = Path(r"C:\ffmpeg\ffmpeg.exe")
FFPROBE = Path(r"C:\ffmpeg\ffprobe.exe")
CLIPS = [
    ("field-small", "經典小獎.mp4"),
    ("classic-medium", "經典 中獎表演.mp4"),
    ("halloween-medium", "萬聖 中獎表演.mp4"),
    ("classic-large", "經典  大獎表演.mp4"),
    ("halloween-large", "萬聖 大獎表演.mp4"),
    ("summer-large", "夏日 大獎表演.mp4"),
]


def run(*args: object) -> None:
    subprocess.run([str(FFMPEG), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], check=True)


def probe(path: Path) -> dict:
    raw = json.loads(subprocess.run([str(FFPROBE), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)], check=True, capture_output=True, text=True, encoding="utf-8").stdout)
    return {"duration": float(raw["format"]["duration"]) if "duration" in raw["format"] else None, "size": int(raw["format"]["size"]), "streams": [{key: stream[key] for key in ("codec_type", "codec_name", "width", "height", "pix_fmt", "r_frame_rate", "nb_frames", "duration", "sample_rate", "channels") if key in stream} for stream in raw["streams"]]}


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def update_runtime_manifest(outputs: list[dict], field_mode: str | None = None) -> None:
    path = RUNTIME / "runtime-manifest.json"
    current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    merged = {entry["file"]: entry for entry in current.get("outputs", [])}
    merged.update({entry["file"]: entry for entry in outputs})
    current.update({"character": "藝瑟", "character_id": "yeseul", "source_manifest": "assets/media/yeseul/source-manifest.json", "cropped": False, "background_removed": False, "audio": "Source AAC copied when present; runtime player starts muted.", "outputs": list(merged.values())})
    if field_mode is not None:
        current["field_mode"] = field_mode
        current["field_atlases"] = "field-sprites.json"
    write_json(path, current)


def copy_originals() -> dict:
    ORIGINALS.mkdir(parents=True, exist_ok=True)
    clips = []
    for clip_id, filename in CLIPS:
        source = SOURCE / filename
        target = ORIGINALS / f"{clip_id}-source.mp4"
        source_hash = digest(source)
        if not target.exists() or digest(target) != source_hash:
            shutil.copy2(source, target)
        assert digest(target) == source_hash
        clips.append({"id": clip_id, "original_filename": filename, "source_path": str(source), "copy": target.name, "sha256": source_hash, "media": probe(target)})
    manifest = {"character": "藝瑟", "character_id": "yeseul", "originals_preserved": True, "background_removed": False, "cropped": False, "clips": clips}
    write_json(ORIGINALS / "source-manifest.json", manifest)
    return manifest


def inspect(manifest: dict) -> None:
    sheet_dir = ORIGINALS / "contact-sheets"
    sheet_dir.mkdir(parents=True, exist_ok=True)
    TEMP.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 18)
    overview = Image.new("RGB", (1200, 390 * len(CLIPS)), "#14121b")
    for row, clip in enumerate(manifest["clips"]):
        sheet = Image.new("RGB", (1200, 390), "#14121b")
        draw = ImageDraw.Draw(sheet)
        duration = clip["media"]["duration"]
        draw.text((12, 10), f"{clip['id']} | full frame | {duration:.6f}s", fill="white", font=font)
        times = [0.125 + index * (duration - 0.375) / 4 for index in range(5)]
        for index, seconds in enumerate(times):
            frame_path = TEMP / f"{clip['id']}-{index}.png"
            run("-ss", f"{seconds:.6f}", "-i", ORIGINALS / clip["copy"], "-frames:v", "1", "-vf", "scale=230:320:force_original_aspect_ratio=decrease,setsar=1", frame_path)
            with Image.open(frame_path) as image:
                frame = image.convert("RGB")
            sheet.paste(frame, (index * 240 + (240 - frame.width) // 2, 42 + (320 - frame.height) // 2))
            draw.text((index * 240 + 12, 365), f"{seconds:.3f}s", fill="#dfbdd0", font=font)
        sheet.save(sheet_dir / f"{clip['id']}.jpg", quality=94)
        overview.paste(sheet, (0, row * 390))
        clip["contact_sheet"] = f"contact-sheets/{clip['id']}.jpg"
        clip["contact_sample_times"] = times
        print(f"Contact sheet: {clip['id']}", flush=True)
    overview.save(sheet_dir / "overview.jpg", quality=94)
    manifest["contact_sheet_overview"] = "contact-sheets/overview.jpg"
    write_json(ORIGINALS / "source-manifest.json", manifest)


def validate_video(path: Path, clip: dict, width: int, height: int) -> dict:
    media = probe(path)
    video = next(stream for stream in media["streams"] if stream["codec_type"] == "video")
    assert (video["codec_name"], video["width"], video["height"], video["r_frame_rate"]) == ("h264", width, height, "24/1")
    assert abs(media["duration"] - clip["media"]["duration"]) < 0.05
    source_audio = any(stream["codec_type"] == "audio" for stream in clip["media"]["streams"])
    assert any(stream["codec_type"] == "audio" for stream in media["streams"]) == source_audio
    return media


def performances(manifest: dict) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    variants = [
        ("classic-medium", "classic-medium-480.mp4", 270, 480),
        ("halloween-medium", "halloween-medium-480.mp4", 270, 480),
        ("classic-medium", "classic-medium.mp4", 720, 1280),
        ("halloween-medium", "halloween-medium.mp4", 720, 1280),
        ("classic-large", "classic-large.mp4", 1920, 1080),
        ("halloween-large", "halloween-large.mp4", 1920, 1080),
        ("summer-large", "summer-large.mp4", 1920, 1080),
        ("field-small", "field-small.mp4", 480, 480),
    ]
    by_id = {clip["id"]: clip for clip in manifest["clips"]}
    outputs = []
    for source_id, filename, width, height in variants:
        clip = by_id[source_id]
        target = RUNTIME / filename
        run("-i", ORIGINALS / clip["copy"], "-map", "0:v:0", "-map", "0:a?", "-vf", f"scale={width}:{height}:flags=lanczos,setsar=1", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", target)
        outputs.append({"file": filename, "source_id": source_id, "sha256": digest(target), "media": validate_video(target, clip, width, height)})
        print(f"Runtime H.264: {filename}", flush=True)
    poster_times = {"field-small": 1.958, "classic-medium": 1.958, "halloween-medium": 1.958, "classic-large": 2.042, "halloween-large": 2.042, "summer-large": 2.042}
    for source_id, seconds in poster_times.items():
        target = RUNTIME / f"{source_id}-poster.webp"
        clip = by_id[source_id]
        bound = "320:320" if source_id.startswith("field-") else "640:640"
        run("-ss", str(seconds), "-i", ORIGINALS / clip["copy"], "-frames:v", "1", "-vf", f"scale={bound}:force_original_aspect_ratio=decrease,setsar=1", "-c:v", "libwebp", "-quality", "90", target)
        outputs.append({"file": target.name, "source_id": source_id, "source_time": seconds, "sha256": digest(target), "media": probe(target)})
    update_runtime_manifest(outputs)


def fields(manifest: dict, mode: str) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    by_id = {clip["id"]: clip for clip in manifest["clips"]}
    tiers = ("small",) if mode == "small-only" else ("small", "medium", "large")
    entries, outputs = [], []
    frame_count, fps, columns, rows, tile = 49, 12, 8, 8, 128
    duration = by_id["field-small"]["media"]["duration"]
    for tier in tiers:
        source_id = f"classic-{tier}" if mode == "classic-segments" and tier != "small" else "field-small"
        clip = by_id[source_id]
        frame_dir = TEMP / f"field-{tier}"
        frame_dir.mkdir(parents=True, exist_ok=True)
        run("-i", ORIGINALS / clip["copy"], "-map", "0:v:0", "-vf", r"select=not(mod(n\,2)),scale=128:128:force_original_aspect_ratio=decrease,format=rgba,pad=128:128:(ow-iw)/2:(oh-ih)/2:color=0x00000000,setsar=1", "-fps_mode", "vfr", "-frames:v", frame_count, frame_dir / "frame-%03d.png")
        frame_paths = [frame_dir / f"frame-{index:03d}.png" for index in range(1, frame_count+1)]
        assert all(path.exists() for path in frame_paths)
        sheet = Image.new("RGBA", (columns*tile, rows*tile), (0, 0, 0, 0))
        for index, frame_path in enumerate(frame_paths):
            with Image.open(frame_path) as image:
                frame = image.convert("RGBA")
            assert frame.size == (tile, tile)
            sheet.paste(frame, ((index % columns)*tile, (index // columns)*tile))
        target = RUNTIME / f"field-{tier}.webp"
        sheet.save(target, "WEBP", quality=88, method=6)
        with Image.open(target) as decoded:
            assert decoded.size == (1024, 1024)
            assert decoded.getpixel((1023, 1023))[3] == 0
        poster = RUNTIME / f"field-{tier}-poster.webp"
        run("-ss", "1.958", "-i", ORIGINALS / clip["copy"], "-frames:v", "1", "-vf", "scale=320:320:force_original_aspect_ratio=decrease,setsar=1", "-c:v", "libwebp", "-quality", "90", poster)
        entries.append({"id": f"field-{tier}", "symbol_tier": tier, "file": target.name, "poster": poster.name, "source_id": source_id, "source_filename": clip["original_filename"], "source_sha256": clip["sha256"], "source_duration": duration, "source_original_duration": clip["media"]["duration"], "source_fps": 24, "source_frame_indices": list(range(0, frame_count*2, 2)), "source_start": 0, "source_end": duration, "sha256": digest(target)})
        outputs.extend([{"file": target.name, "source_id": source_id, "sha256": digest(target), "media": probe(target), "sprite_metadata": "field-sprites.json"}, {"file": poster.name, "source_id": source_id, "source_time": 1.958, "sha256": digest(poster), "media": probe(poster)}])
        print(f"Runtime field atlas: {tier} ({frame_count} frames)", flush=True)
    write_json(RUNTIME / "field-sprites.json", {"character": "藝瑟", "character_id": "yeseul", "field_mode": mode, "fps": fps, "frame_count": frame_count, "columns": columns, "rows": rows, "tile": tile, "width": columns*tile, "height": rows*tile, "order": "row-major", "cropped": False, "background_removed": False, "unused_tiles": "transparent; never sample frame >=49", "sources": entries})
    update_runtime_manifest(outputs, mode)


def validate(manifest: dict) -> None:
    for clip in manifest["clips"]:
        assert digest(ORIGINALS / clip["copy"]) == clip["sha256"] == digest(SOURCE / clip["original_filename"])
    runtime = json.loads((RUNTIME / "runtime-manifest.json").read_text(encoding="utf-8"))
    for output in runtime["outputs"]:
        path = RUNTIME / output["file"]
        assert digest(path) == output["sha256"]
        if path.suffix == ".mp4":
            run("-i", path, "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-")
    field_meta = json.loads((RUNTIME / "field-sprites.json").read_text(encoding="utf-8"))
    for source in field_meta["sources"]:
        with Image.open(RUNTIME / source["file"]) as sheet:
            sheet = sheet.convert("RGBA")
            assert sheet.size == (field_meta["width"], field_meta["height"])
            for index in range(field_meta["frame_count"], field_meta["columns"]*field_meta["rows"]):
                column, row = index % field_meta["columns"], index // field_meta["columns"]
                tile = field_meta["tile"]
                unused = sheet.crop((column*tile,row*tile,(column+1)*tile,(row+1)*tile))
                assert unused.getextrema()[3] == (0,0)
    report = {"ok": True, "character_id": "yeseul", "source_hashes": len(manifest["clips"]), "runtime_hashes": len(runtime["outputs"]), "decoded_mp4": sum(Path(output["file"]).suffix == ".mp4" for output in runtime["outputs"]), "runtime_media_bytes": sum((RUNTIME / output["file"]).stat().st_size for output in runtime["outputs"]), "field_mode": runtime.get("field_mode"), "atlas_count": len(field_meta["sources"]), "atlas_frame_count": field_meta["frame_count"], "unused_tiles_transparent": True}
    write_json(ORIGINALS / "validation.json", report)
    print(json.dumps(report), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=("inspect", "performances", "fields", "validate"), required=True)
    parser.add_argument("--field-mode", choices=("small-only", "shared", "classic-segments"), default="small-only")
    args = parser.parse_args()
    if args.stage == "inspect":
        inspect(copy_originals())
        return
    path = ORIGINALS / "source-manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8")) if path.exists() else copy_originals()
    if args.stage == "performances": performances(manifest)
    elif args.stage == "fields": fields(manifest, args.field_mode)
    else: validate(manifest)


if __name__ == "__main__":
    main()
