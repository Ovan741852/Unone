#!/usr/bin/env python3
"""Build and verify matched 5-second transparent WebM and WebP benchmark assets.

The same sixty 144x256 RGBA frames feed both formats. Requires Pillow, NumPy,
ffmpeg and ffprobe; does not modify the original video sample.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, features


WIDTH, HEIGHT, FPS, FRAME_COUNT = 144, 256, 12, 60
PADDING, COLUMNS, ROWS = 2, 8, 4
CELL_WIDTH, CELL_HEIGHT = WIDTH + 2 * PADDING, HEIGHT + 2 * PADDING
PAGE_WIDTH, PAGE_HEIGHT = CELL_WIDTH * COLUMNS, CELL_HEIGHT * ROWS


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_info(path: Path, root: Path) -> dict:
    return {"file": path.relative_to(root).as_posix(),
            "bytes": path.stat().st_size, "sha256": sha256_bytes(path.read_bytes())}


def execute(command: list[str]) -> bytes:
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f"Command failed: {command!r}\n{result.stderr.decode('utf-8', errors='replace')}")
    return result.stdout


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=root / "artifacts/video-sample/rgba")
    parser.add_argument("--output", type=Path, default=root / "artifacts/symbol-benchmark/assets")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    parser.add_argument("--ffprobe", default=shutil.which("ffprobe"))
    args = parser.parse_args()
    if not args.ffmpeg or not args.ffprobe:
        raise SystemExit("ffmpeg and ffprobe must be on PATH or supplied explicitly")
    if not features.check("webp"):
        raise SystemExit("Pillow has no WebP support")

    source_paths = [args.input / f"frame_{i:04d}.png" for i in range(0, 120, 2)]
    missing = [str(path) for path in source_paths if not path.is_file()]
    if missing:
        raise SystemExit(f"Missing source frames: {missing}")
    args.output.mkdir(parents=True, exist_ok=True)
    frame_dir = args.output / "frames"
    frame_dir.mkdir(exist_ok=True)
    canonical: list[np.ndarray] = []
    sources: list[dict] = []
    canonical_files: list[dict] = []

    for index, source_path in enumerate(source_paths):
        with Image.open(source_path) as image:
            if image.size != (430, 768):
                raise ValueError(f"Unexpected source size at {source_path}: {image.size}")
            fitted = ImageOps.contain(image.convert("RGBA"), (WIDTH, HEIGHT), Image.Resampling.LANCZOS)
        frame = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        frame.alpha_composite(fitted, ((WIDTH - fitted.width) // 2, (HEIGHT - fitted.height) // 2))
        frame_path = frame_dir / f"frame_{index:04d}.png"
        frame.save(frame_path, "PNG", compress_level=6)
        pixels = np.array(frame, dtype=np.uint8)
        canonical.append(pixels)
        sources.append({"source_frame": index * 2, "file": source_path.name,
                        "sha256": sha256_bytes(source_path.read_bytes())})
        canonical_files.append({**file_info(frame_path, args.output), "frame": index,
                                "rgba_sha256": sha256_bytes(pixels.tobytes())})
    canonical_array = np.stack(canonical)
    assert canonical_array.shape == (FRAME_COUNT, HEIGHT, WIDTH, 4)

    pages, frames, atlas_validations = [], [], []
    capacity = COLUMNS * ROWS
    for start in range(0, FRAME_COUNT, capacity):
        page_index = len(pages)
        atlas = Image.new("RGBA", (PAGE_WIDTH, PAGE_HEIGHT), (0, 0, 0, 0))
        for slot, index in enumerate(range(start, min(start + capacity, FRAME_COUNT))):
            x = (slot % COLUMNS) * CELL_WIDTH + PADDING
            y = (slot // COLUMNS) * CELL_HEIGHT + PADDING
            atlas.paste(Image.fromarray(canonical[index]), (x, y))
            frames.append({"frame": index, "sourceFrame": index * 2, "page": page_index,
                           "x": x, "y": y, "w": WIDTH, "h": HEIGHT,
                           "time": float(Fraction(index, FPS)), "duration": float(Fraction(1, FPS))})
        page_path = args.output / f"atlas-{page_index + 1:02d}.webp"
        atlas.save(page_path, "WEBP", lossless=True, quality=100, method=6, exact=True)
        with Image.open(page_path) as decoded_image:
            decoded = np.array(decoded_image.convert("RGBA"))
        assert decoded.shape == (PAGE_HEIGHT, PAGE_WIDTH, 4)
        assert np.array_equal(decoded, np.array(atlas)), "Lossless atlas differs after decode"
        alpha = decoded[:, :, 3]
        assert alpha.min() == 0 and alpha.max() == 255
        for frame in frames[start:start + capacity]:
            x, y = frame["x"], frame["y"]
            assert x >= PADDING and y >= PADDING
            assert x + WIDTH + PADDING <= PAGE_WIDTH and y + HEIGHT + PADDING <= PAGE_HEIGHT
            tile = decoded[y:y + HEIGHT, x:x + WIDTH]
            assert np.array_equal(tile, canonical[frame["frame"]]), "Atlas frame mismatch"
            assert not alpha[y - PADDING:y, x - PADDING:x + WIDTH + PADDING].any()
            assert not alpha[y + HEIGHT:y + HEIGHT + PADDING, x - PADDING:x + WIDTH + PADDING].any()
            assert not alpha[y:y + HEIGHT, x - PADDING:x].any()
            assert not alpha[y:y + HEIGHT, x + WIDTH:x + WIDTH + PADDING].any()
        page_info = {**file_info(page_path, args.output), "page": page_index,
                     "width": PAGE_WIDTH, "height": PAGE_HEIGHT,
                     "byteSize": page_path.stat().st_size,
                     "rgba8_bytes": PAGE_WIDTH * PAGE_HEIGHT * 4}
        pages.append(page_info)
        atlas_validations.append({"page": page_index, "decoded_mode": "RGBA",
                                  "alpha_min": int(alpha.min()), "alpha_max": int(alpha.max()),
                                  "partial_alpha_pixels": int(((alpha > 0) & (alpha < 255)).sum()),
                                  "exact_rgba_match_to_canonical_frames": True,
                                  "transparent_padding_verified": True})

    metadata = {"version": 1, "format": "paged-lossless-webp-atlas",
                "fps": FPS, "frame_count": FRAME_COUNT, "duration": 5.0,
                "sampleEvery": 2, "frameWidth": WIDTH, "frameHeight": HEIGHT,
                "padding": PADDING, "columns": COLUMNS, "rows": ROWS,
                "cellWidth": CELL_WIDTH, "cellHeight": CELL_HEIGHT,
                "source": {"fps": 24, "trim_duration": 5.0, "width": 430, "height": 768,
                           "selected_frames": list(range(0, 120, 2))},
                "pages": pages, "frames": frames}
    assert len(frames) == FRAME_COUNT and len(pages) == 2
    assert abs(sum(frame["duration"] for frame in frames) - 5.0) < 1e-10
    assert abs(frames[-1]["time"] + frames[-1]["duration"] - 5.0) < 1e-10
    metadata_path = args.output / "spritesheet.json"
    write_json(metadata_path, metadata)

    video_path = args.output / "girl-alpha-144x256-12fps.webm"
    encode_command = [args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                      "-framerate", str(FPS), "-start_number", "0",
                      "-i", str(frame_dir / "frame_%04d.png"),
                      "-frames:v", str(FRAME_COUNT), "-an", "-c:v", "libvpx-vp9",
                      "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30",
                      "-auto-alt-ref", "0", "-deadline", "good", "-cpu-used", "4",
                      "-row-mt", "1", "-threads", "2", str(video_path)]
    execute(encode_command)
    probe = json.loads(execute([args.ffprobe, "-v", "error", "-count_frames",
                               "-show_streams", "-show_format", "-of", "json", str(video_path)]))
    streams = [stream for stream in probe["streams"] if stream["codec_type"] == "video"]
    assert len(streams) == 1 and not any(s["codec_type"] == "audio" for s in probe["streams"])
    stream = streams[0]
    assert (stream["width"], stream["height"]) == (WIDTH, HEIGHT)
    assert Fraction(stream["avg_frame_rate"]) == FPS
    assert int(stream["nb_read_frames"]) == FRAME_COUNT
    assert abs(float(probe["format"]["duration"]) - 5.0) < 0.001
    assert str(stream.get("tags", {}).get("alpha_mode")) == "1"

    # The native VP9 decoder can omit alpha. Select libvpx-vp9 explicitly.
    raw = execute([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-c:v", "libvpx-vp9",
                   "-i", str(video_path), "-an", "-pix_fmt", "rgba", "-f", "rawvideo", "-"])
    assert len(raw) == FRAME_COUNT * WIDTH * HEIGHT * 4
    decoded_video = np.frombuffer(raw, np.uint8).reshape(FRAME_COUNT, HEIGHT, WIDTH, 4)
    decoded_alpha = decoded_video[:, :, :, 3]
    assert decoded_alpha.min() == 0 and decoded_alpha.max() >= 250
    assert ((decoded_alpha > 0) & (decoded_alpha < 255)).any()
    assert all(frame.min() == 0 and frame.max() >= 250 for frame in decoded_alpha)
    alpha_error = np.abs(decoded_alpha.astype(np.int16) - canonical_array[:, :, :, 3].astype(np.int16))

    # Compare matching frames on a checkerboard, including translucent edges.
    yy, xx = np.indices((HEIGHT, WIDTH))
    checker = np.where(((xx // 12 + yy // 12) % 2)[:, :, None], 180., 70.).astype(np.float32)
    def composite(rgba: np.ndarray) -> np.ndarray:
        alpha = rgba[:, :, :, 3:4].astype(np.float32) / 255
        return rgba[:, :, :, :3].astype(np.float32) * alpha + checker[None] * (1 - alpha)
    reference_composite = composite(canonical_array)
    decoded_composite = composite(decoded_video)
    errors = np.abs(decoded_composite - reference_composite).mean(axis=(1, 2, 3))
    assert float(errors.max()) < 20, f"Unexpected content mismatch: {errors.max()} / 255"
    per_frame_comparisons = []
    for index in range(FRAME_COUNT):
        per_frame_comparisons.append({"frame": index, "source_frame": index * 2,
                                      "canonical_rgba_sha256": canonical_files[index]["rgba_sha256"],
                                      "atlas_exact_rgba_match": True,
                                      "webm_alpha_mae_0_255": float(alpha_error[index].mean()),
                                      "webm_checker_composite_mae_0_255": float(errors[index])})

    video_info = {**file_info(video_path, args.output), "codec": stream["codec_name"],
                  "width": WIDTH, "height": HEIGHT, "fps": FPS,
                  "frame_count": FRAME_COUNT, "duration": float(probe["format"]["duration"]),
                  "audio": False, "encoder": "libvpx-vp9", "crf": 30,
                  "encoded_pixel_format": "yuva420p", "probe_pixel_format": stream["pix_fmt"],
                  "alpha_mode": 1, "rgba8_bytes_per_frame": WIDTH * HEIGHT * 4}
    manifest = {
        "schema_version": 1, "built_at_utc": datetime.now(timezone.utc).isoformat(),
        "purpose": "Matched transparent WebM and lossless WebP atlas benchmark inputs",
        "canonical": {"width": WIDTH, "height": HEIGHT, "fps": FPS,
                      "frame_count": FRAME_COUNT, "duration": 5.0,
                      "source_fps": 24, "source_trim": "[0.0, 5.0) seconds",
                      "source_indices": list(range(0, 120, 2)),
                      "resize": "Pillow ImageOps.contain LANCZOS, centered on transparent 144x256 RGBA",
                      "input_width": 430, "input_height": 768,
                      "fitted_width": 143, "fitted_height": 256,
                      "rgba_sequence_sha256": sha256_bytes(canonical_array.tobytes())},
        "video": video_info, "atlas_pages": pages,
        "atlas_metadata": file_info(metadata_path, args.output),
        "atlas_total_bytes": sum(page["bytes"] for page in pages),
        "atlas_total_rgba8_bytes": sum(page["rgba8_bytes"] for page in pages),
        "validation": {"passed": True, "video_decoder": "libvpx-vp9 explicitly selected",
                       "video_decoded_frame_count": FRAME_COUNT,
                       "video_alpha_min": int(decoded_alpha.min()), "video_alpha_max": int(decoded_alpha.max()),
                       "video_partial_alpha_pixels": int(((decoded_alpha > 0) & (decoded_alpha < 255)).sum()),
                       "webm_alpha_mae_0_255": float(alpha_error.mean()),
                       "webm_checker_composite_mae_0_255": float(errors.mean()),
                       "webm_checker_composite_max_frame_mae_0_255": float(errors.max()),
                       "content_comparison": "Same frame indices, matching RGBA before WebM lossy YUV encoding; atlas decode is pixel-exact",
                       "atlas_pages": atlas_validations,
                       "frames": per_frame_comparisons},
        "source_files": sources, "canonical_frame_files": canonical_files,
        "tool_versions": {"ffmpeg": execute([args.ffmpeg, "-version"]).decode().splitlines()[0],
                          "ffprobe": execute([args.ffprobe, "-version"]).decode().splitlines()[0],
                          "pillow": Image.__version__, "numpy": np.__version__},
        "encode_command": encode_command,
    }
    write_json(args.output / "asset-manifest.json", manifest)
    print(json.dumps({"output": str(args.output.resolve()), "video": video_info,
                      "atlas_pages": pages, "atlas_total_bytes": manifest["atlas_total_bytes"],
                      "atlas_total_rgba8_mib": manifest["atlas_total_rgba8_bytes"] / 2**20,
                      "validation_passed": True,
                      "webm_alpha_mae": manifest["validation"]["webm_alpha_mae_0_255"],
                      "webm_checker_composite_mae": manifest["validation"]["webm_checker_composite_mae_0_255"]}, indent=2))


if __name__ == "__main__":
    main()
