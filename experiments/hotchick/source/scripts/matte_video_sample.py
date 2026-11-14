"""Build a transparent WebM sample with official RVM ONNX recurrent matting.

The source video is never changed. Run --probe for an eight-frame quality check.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path


def run(args: list[str]) -> None:
    subprocess.run(args, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--ratio", type=float, default=0.6)
    parser.add_argument("--threads", type=int, default=6)
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--rgba-only", action="store_true", help="Save transparent frames without a WebM output")
    args = parser.parse_args()
    print("Loading image and ONNX libraries...", flush=True)
    import numpy as np
    import onnxruntime as ort
    from PIL import Image, ImageDraw

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    rgb_dir = output / "rgb"
    rgba_dir = output / ("rgba-probe" if args.probe else "rgba")
    rgb_dir.mkdir(exist_ok=True)
    rgba_dir.mkdir(exist_ok=True)
    metadata = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json",
        str(args.input.resolve()),
    ]))
    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
    numerator, denominator = map(int, video["avg_frame_rate"].split("/"))
    fps = numerator / denominator
    duration = float(video.get("duration", metadata["format"]["duration"]))
    print(f"Source: {video['width']}x{video['height']}, {fps:g} fps, {duration:.6f}s", flush=True)
    extraction = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i",
        str(args.input.resolve()), "-an", "-vf", f"scale=-2:{args.height}",
    ]
    if args.probe:
        extraction += ["-frames:v", "8"]
    extraction += ["-start_number", "0", str(rgb_dir / "frame_%04d.png")]
    run(extraction)
    paths = sorted(rgb_dir.glob("frame_*.png"))
    if args.probe:
        paths = paths[:8]
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = args.threads
    opts.inter_op_num_threads = 1
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(str(args.model.resolve()), sess_options=opts,
                                   providers=["CPUExecutionProvider"])
    recurrent = [np.zeros((1, 1, 1, 1), dtype=np.float32) for _ in range(4)]
    ratio = np.array([args.ratio], dtype=np.float32)
    started = time.perf_counter()
    alpha_stats = []
    print(f"Matting {len(paths)} frames with RVM, recurrent state retained...", flush=True)
    for index, path in enumerate(paths):
        rgb = np.asarray(Image.open(path).convert("RGB"))
        src = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
        feed = {"src": src, "downsample_ratio": ratio}
        feed.update({f"r{i + 1}i": recurrent[i] for i in range(4)})
        foreground, alpha, *recurrent = session.run(None, feed)
        rgba = np.concatenate([foreground[0], alpha[0]], axis=0).transpose(1, 2, 0)
        rgba = np.rint(np.clip(rgba, 0, 1) * 255).astype(np.uint8)
        # Straight alpha: do not multiply foreground RGB by alpha a second time.
        rgba[rgba[:, :, 3] == 0, :3] = 0
        Image.fromarray(rgba, "RGBA").save(rgba_dir / f"frame_{index:04d}.png")
        alpha_stats.append({"frame": index, "min": int(rgba[:, :, 3].min()),
                            "max": int(rgba[:, :, 3].max()),
                            "transparent_fraction": float((rgba[:, :, 3] == 0).mean()),
                            "partial_fraction": float(((rgba[:, :, 3] > 0) & (rgba[:, :, 3] < 255)).mean())})
        if index % 12 == 0 or index == len(paths) - 1:
            elapsed = time.perf_counter() - started
            print(f"Matte {index + 1}/{len(paths)} ({elapsed:.1f}s)", flush=True)
    elapsed = time.perf_counter() - started
    width, height = Image.open(rgba_dir / "frame_0000.png").size
    checker = Image.new("RGB", (width, height), "#d3d7dc")
    draw = ImageDraw.Draw(checker)
    for y in range(0, height, 24):
        for x in range(0, width, 24):
            if (x // 24 + y // 24) % 2:
                draw.rectangle((x, y, x + 23, y + 23), fill="#f0f1f3")
    checker.save(output / "checker.png")
    first = Image.open(rgba_dir / "frame_0000.png").convert("RGBA")
    comp = Image.alpha_composite(checker.convert("RGBA"), first)
    comp.save(output / ("matte-probe.png" if args.probe else "matte-first-frame.png"))
    report = {"source": str(args.input.resolve()), "source_width": video["width"],
              "source_height": video["height"], "source_fps": fps, "source_duration": duration,
              "source_has_alpha": "a" in video.get("pix_fmt", ""),
              "output_width": width, "output_height": height, "frame_count": len(paths),
              "matting_model": "RVM MobileNetV3 FP32 ONNX v1.0.0",
              "model_source": "https://github.com/PeterL1n/RobustVideoMatting",
              "downsample_ratio": args.ratio, "provider": "CPUExecutionProvider",
              "matting_seconds": elapsed, "alpha_stats": alpha_stats}
    if not args.probe and not args.rgba_only:
        webm = output / "girl-alpha.webm"
        encode = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                  "-framerate", str(fps), "-start_number", "0", "-i",
                  str(rgba_dir / "frame_%04d.png"), "-an", "-c:v", "libvpx-vp9",
                  "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", "-row-mt", "1",
                  "-deadline", "good", "-cpu-used", "4", "-threads", str(args.threads),
                  str(webm)]
        print("Encoding transparent VP9 WebM...", flush=True)
        run(encode)
        decoded_dir = output / "decoded-check"
        decoded_dir.mkdir(exist_ok=True)
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-c:v", "libvpx-vp9",
             "-i", str(webm), "-vf", "select=eq(n\\,0)+eq(n\\,48)+eq(n\\,96),format=rgba",
             "-fps_mode", "vfr", "-start_number", "0", str(decoded_dir / "frame_%02d.png")])
        check_paths = sorted(decoded_dir.glob("frame_*.png"))
        report["webm_decoded_alpha"] = []
        contact = Image.new("RGB", (width * len(check_paths), height * 2), "#1e2735")
        for i, check_path in enumerate(check_paths):
            image = Image.open(check_path).convert("RGBA")
            alpha_array = np.asarray(image)[:, :, 3]
            report["webm_decoded_alpha"].append({"sample": i, "min": int(alpha_array.min()),
                "max": int(alpha_array.max()), "transparent_fraction": float((alpha_array == 0).mean()),
                "partial_fraction": float(((alpha_array > 0) & (alpha_array < 255)).mean())})
            contact.paste(Image.alpha_composite(checker.convert("RGBA"), image).convert("RGB"), (width * i, 0))
            dark = Image.new("RGBA", image.size, "#1e2735")
            contact.paste(Image.alpha_composite(dark, image).convert("RGB"), (width * i, height))
        contact.save(output / "alpha-contact-sheet.jpg", quality=92)
        print("Rendering checkerboard playback preview...", flush=True)
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i",
             str(output / "checker.png"), "-c:v", "libvpx-vp9", "-i", str(webm),
             "-filter_complex", "[0:v][1:v]overlay=shortest=1:format=auto", "-an",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-r", str(fps),
             "-t", str(duration), "-movflags", "+faststart", str(output / "checker-preview.mp4")])
        report["webm_bytes"] = webm.stat().st_size
        report["encode_command"] = encode
    report_file = output / ("matting-probe.json" if args.probe else "matting-report.json")
    report_file.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Done: {report_file}", flush=True)


if __name__ == "__main__":
    main()
