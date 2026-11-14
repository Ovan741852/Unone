"""Prepare supplied Mugi clips without altering the source media.

Stages: inspect (original copies, hashes and contact sheets), performances
(browser H.264/AAC derivatives and source-frame posters), fields (three
confirmed board spritesheets and the small-symbol gallery movie).
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
SOURCE = Path(r"C:\Users\maverickchiu\Downloads")
ORIGINALS = ROOT / "assets/media/mugi"
RUNTIME = ROOT / "game/presentation/assets/mugi"
TEMP = Path(r"D:\.cache\hotchick-mugi-20261102")
FFMPEG = Path(r"C:\ffmpeg\ffmpeg.exe")
FFPROBE = Path(r"C:\ffmpeg\ffprobe.exe")
CLIPS = [
    ("field-small", "小獎.mp4"),
    ("field-medium", "中獎.mp4"),
    ("field-large", "大獎.mp4"),
    ("classic-medium", "中獎表演.mp4"),
    ("christmas-medium", "聖誕中獎表演.mp4"),
    ("classic-large", "大獎表演.mp4"),
    ("christmas-large", "聖誕大獎表演.mp4"),
]


def run(*args: object) -> None:
    subprocess.run([str(FFMPEG), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], check=True)


def probe(path: Path) -> dict:
    result = subprocess.run([str(FFPROBE), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)], check=True, capture_output=True, text=True, encoding="utf-8")
    raw = json.loads(result.stdout)
    return {
        "duration": float(raw["format"]["duration"]) if "duration" in raw["format"] else None,
        "size": int(raw["format"]["size"]),
        "streams": [{key: stream[key] for key in ("codec_type", "codec_name", "width", "height", "pix_fmt", "r_frame_rate", "nb_frames", "duration", "sample_rate", "channels") if key in stream} for stream in raw["streams"]],
    }


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def update_runtime_manifest(outputs: list[dict], field_meta: str | None = None) -> None:
    path = RUNTIME / "runtime-manifest.json"
    current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    merged = {entry["file"]: entry for entry in current.get("outputs", [])}
    merged.update({entry["file"]: entry for entry in outputs})
    current.update({"character": "むぎ", "source_manifest": "assets/media/mugi/source-manifest.json", "cropped": False, "background_removed": False, "audio": "source AAC streams copied when present; muted playback is the renderer's responsibility", "outputs": list(merged.values())})
    if field_meta is not None:
        current["field_atlases"] = field_meta
    else:
        current.setdefault("field_atlases", "pending user confirmation")
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
    manifest = {"character": "むぎ", "originals_preserved": True, "background_removed": False, "cropped": False, "clips": clips}
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
        draw.text((12, 10), f"{clip['id']} | full frame | {clip['media']['duration']:.6f}s", fill="white", font=font)
        duration = clip["media"]["duration"]
        times = [0.125 + index * (duration - 0.375) / 4 for index in range(5)]
        for index, seconds in enumerate(times):
            frame_path = TEMP / f"{clip['id']}-{index}.png"
            run("-ss", f"{seconds:.6f}", "-i", ORIGINALS / clip["copy"], "-frames:v", "1", "-vf", "scale=230:320:force_original_aspect_ratio=decrease,setsar=1", frame_path)
            with Image.open(frame_path) as image:
                frame = image.convert("RGB")
            x = index * 240 + (240 - frame.width) // 2
            y = 42 + (320 - frame.height) // 2
            sheet.paste(frame, (x, y))
            draw.text((index * 240 + 12, 365), f"{seconds:.3f}s", fill="#dfbdd0", font=font)
        sheet.save(sheet_dir / f"{clip['id']}.jpg", quality=94)
        overview.paste(sheet, (0, row * 390))
        clip["contact_sheet"] = f"contact-sheets/{clip['id']}.jpg"
        clip["contact_sample_times"] = times
        print(f"Contact sheet: {clip['id']}", flush=True)
    overview.save(sheet_dir / "overview.jpg", quality=94)
    manifest["contact_sheet_overview"] = "contact-sheets/overview.jpg"
    write_json(ORIGINALS / "source-manifest.json", manifest)


def performances(manifest: dict) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    variants = [
        ("classic-medium", "classic-medium-480.mp4", 270, 480),
        ("christmas-medium", "christmas-medium-480.mp4", 270, 480),
        ("classic-medium", "classic-medium.mp4", 720, 1280),
        ("christmas-medium", "christmas-medium.mp4", 720, 1280),
        ("classic-large", "classic-large.mp4", 1920, 1080),
        ("christmas-large", "christmas-large.mp4", 1920, 1080),
    ]
    by_id = {clip["id"]: clip for clip in manifest["clips"]}
    outputs = []
    for source_id, filename, width, height in variants:
        target = RUNTIME / filename
        run("-i", ORIGINALS / by_id[source_id]["copy"], "-map", "0:v:0", "-map", "0:a?", "-vf", f"scale={width}:{height}:flags=lanczos,setsar=1", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", target)
        media = probe(target)
        video = next(stream for stream in media["streams"] if stream["codec_type"] == "video")
        assert (video["codec_name"], video["width"], video["height"], video["r_frame_rate"]) == ("h264", width, height, "24/1")
        assert abs(media["duration"] - by_id[source_id]["media"]["duration"]) < 0.05
        source_audio = any(stream["codec_type"] == "audio" for stream in by_id[source_id]["media"]["streams"])
        assert any(stream["codec_type"] == "audio" for stream in media["streams"]) == source_audio
        outputs.append({"file": filename, "source_id": source_id, "sha256": digest(target), "media": media})
        print(f"Runtime H.264: {filename}", flush=True)
    # Fixed source times are selected only after reviewing the full-frame sheets.
    poster_times = {"field-small": 1.958, "field-medium": 1.958, "field-large": 2.875, "classic-medium": 0.125, "christmas-medium": 1.292, "classic-large": 2.042, "christmas-large": 0.125}
    for source_id, seconds in poster_times.items():
        target = RUNTIME / f"{source_id}-poster.webp"
        clip = by_id[source_id]
        is_field = source_id.startswith("field-")
        bound = "320:320" if is_field else "640:640"
        run("-ss", str(seconds), "-i", ORIGINALS / clip["copy"], "-frames:v", "1", "-vf", f"scale={bound}:force_original_aspect_ratio=decrease,setsar=1", "-c:v", "libwebp", "-quality", "90", target)
        outputs.append({"file": target.name, "source_id": source_id, "source_time": seconds, "sha256": digest(target), "media": probe(target)})
    update_runtime_manifest(outputs)


def fields(manifest: dict) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    by_id = {clip["id"]: clip for clip in manifest["clips"]}
    entries = []
    outputs = []
    for source_id in ("field-small", "field-medium", "field-large"):
        clip = by_id[source_id]
        frame_dir = TEMP / source_id
        frame_dir.mkdir(parents=True, exist_ok=True)
        # The supplied clips have 97 frames at 24 fps. Keeping frames 0,2,...,96
        # gives exactly 49 full-frame samples with the first sample at t=0.
        run("-i", ORIGINALS / clip["copy"], "-map", "0:v:0", "-vf", r"select=not(mod(n\,2)),scale=128:128:flags=lanczos,setsar=1", "-fps_mode", "vfr", "-frames:v", "49", frame_dir / "frame-%03d.png")
        frame_paths = [frame_dir / f"frame-{index:03d}.png" for index in range(1, 50)]
        assert all(path.exists() for path in frame_paths)
        sheet = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        for index, frame_path in enumerate(frame_paths):
            with Image.open(frame_path) as image:
                frame = image.convert("RGBA")
            assert frame.size == (128, 128)
            sheet.paste(frame, ((index % 8) * 128, (index // 8) * 128))
        target = RUNTIME / f"{source_id}.webp"
        sheet.save(target, "WEBP", quality=88, method=6)
        with Image.open(target) as decoded:
            assert decoded.size == (1024, 1024)
            assert decoded.getpixel((1023, 1023))[3] == 0
        entries.append({"id": source_id, "symbol_tier": source_id.removeprefix("field-"), "file": target.name, "poster": f"{source_id}-poster.webp", "source_id": source_id, "source_filename": clip["original_filename"], "source_sha256": clip["sha256"], "source_duration": clip["media"]["duration"], "source_fps": 24, "source_frame_indices": list(range(0, 97, 2)), "sha256": digest(target)})
        outputs.append({"file": target.name, "source_id": source_id, "sha256": digest(target), "media": probe(target), "sprite_metadata": "field-sprites.json"})
        print(f"Runtime field atlas: {target.name} (49 frames)", flush=True)
    write_json(RUNTIME / "field-sprites.json", {"character": "むぎ", "fps": 12, "frame_count": 49, "columns": 8, "rows": 8, "tile": 128, "width": 1024, "height": 1024, "order": "row-major", "cropped": False, "background_removed": False, "unused_tiles": "transparent; never sample frame >=49", "sources": entries})
    small_clip = by_id["field-small"]
    target = RUNTIME / "field-small.mp4"
    run("-i", ORIGINALS / small_clip["copy"], "-map", "0:v:0", "-map", "0:a?", "-vf", "scale=480:480:flags=lanczos,setsar=1", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", target)
    media = probe(target)
    video = next(stream for stream in media["streams"] if stream["codec_type"] == "video")
    assert (video["codec_name"], video["width"], video["height"], video["r_frame_rate"]) == ("h264", 480, 480, "24/1")
    assert abs(media["duration"] - small_clip["media"]["duration"]) < 0.05
    outputs.append({"file": target.name, "source_id": "field-small", "sha256": digest(target), "media": media})
    update_runtime_manifest(outputs, "field-sprites.json")
    print("Runtime small gallery movie: field-small.mp4", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=("inspect", "performances", "fields"), required=True)
    args = parser.parse_args()
    manifest_path = ORIGINALS / "source-manifest.json"
    if args.stage == "inspect":
        inspect(copy_originals())
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else copy_originals()
        if args.stage == "performances":
            performances(manifest)
        else:
            fields(manifest)


if __name__ == "__main__":
    main()
