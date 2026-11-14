#!/usr/bin/env python3
"""Build the transparent video sample's paged WebP atlas and offline preview.

Default: 121 RGBA PNGs at 24 fps -> 61 sampled frames at 12 fps.
Each 144x256 content rectangle has 2 transparent pixels of padding per side.
No third-party runtime dependency is required by the generated HTML.
"""

from __future__ import annotations

import argparse
import json
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageOps, features


PREVIEW_HTML = r"""<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>透明 WebM 與 WebP 逐格圖比較</title>
<style>
:root { color-scheme: dark; font: 15px/1.55 system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px; background: #101621; color: #e8edf7; }
main { max-width: 1120px; margin: auto; }
h1 { margin: 0 0 8px; font-size: 26px; }
h2 { margin: 0; font-size: 19px; }
p { margin: 8px 0 18px; color: #b9c5d8; }
.compare { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 20px; }
.card { min-width: 0; border: 1px solid #334157; background: #172131; border-radius: 14px; padding: 16px; }
.stage { position: relative; width: 100%; height: 450px; margin: 14px 0; overflow: hidden; border-radius: 8px;
  background-color: #acb2bd;
  background-image: linear-gradient(45deg,#6f7887 25%,transparent 25%),linear-gradient(-45deg,#6f7887 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#6f7887 75%),linear-gradient(-45deg,transparent 75%,#6f7887 75%);
  background-size: 24px 24px; background-position: 0 0,0 12px,12px -12px,-12px 0;
}
video, canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; max-width: 100%; max-height: 100%; object-fit: contain; object-position: center; background: transparent; }
button { padding: 7px 13px; color: #e8edf7; background: #293b57; border: 1px solid #526985; border-radius: 6px; cursor: pointer; }
button:disabled { opacity: .5; cursor: wait; }
.controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-height: 36px; }
.status { color: #b9c5d8; font-variant-numeric: tabular-nums; }
.stats { margin-top: 20px; padding: 16px; border: 1px solid #334157; border-radius: 12px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; }
th,td { text-align: left; border-bottom: 1px solid #2e3c50; padding: 7px; }
th { color: #c7d4e8; }
.note { font-size: 13px; }
.error { color: #ffadad; }
@media (max-width: 720px) { body { padding: 16px; } .compare { grid-template-columns: 1fr; } .stage { height: 400px; } }
</style>
</head>
<body><main>
<h1>透明影片與逐格圖實例</h1>
<p id="description"></p>
<div class="compare">
  <section class="card">
    <h2>WebM：影片播放</h2>
    <div class="stage"><video id="video" src="girl-alpha.webm" muted loop controls playsinline autoplay preload="metadata"></video></div>
    <div id="videoStatus" class="status">正在載入 girl-alpha.webm…</div>
  </section>
  <section class="card">
    <h2>WebP atlas：Canvas 逐格播放</h2>
    <div class="stage"><canvas id="canvas" width="144" height="256"></canvas></div>
    <div class="controls">
      <button id="toggle" disabled>暫停逐格圖</button>
      <button id="restart" disabled>重新播放兩邊</button>
      <span id="atlasStatus" class="status">正在載入圖集…</span>
    </div>
  </section>
</div>
<section class="stats">
  <h2>檔案與記憶體</h2>
  <table><thead><tr><th>項目</th><th>檔案大小</th><th>解碼／貼圖估算</th></tr></thead><tbody id="stats"></tbody></table>
  <p class="note">貼圖以 RGBA8（寬 × 高 × 4 bytes）估算，不含 mipmap、驅動額外配置與解碼器緩衝；不是實測顯存。WebP 使用無損壓縮。兩側各自循環，逐格圖依 JSON 中的每格時長播放；「重新播放兩邊」可重設起點。</p>
  <p class="note">此頁沒有 CDN、fetch 或本機伺服器需求，可直接以 file:// 開啟；圖集資料已內嵌。透明 WebM 的實際支援仍依瀏覽器而異。</p>
</section>
</main>
<script id="atlas-metadata" type="application/json">__METADATA__</script>
<script>
'use strict';
const meta = JSON.parse(document.getElementById('atlas-metadata').textContent);
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('video');
const atlasStatus = document.getElementById('atlasStatus');
const videoStatus = document.getElementById('videoStatus');
const toggle = document.getElementById('toggle');
const restart = document.getElementById('restart');
canvas.width = meta.frameWidth; canvas.height = meta.frameHeight;
canvas.style.aspectRatio = `${meta.frameWidth} / ${meta.frameHeight}`;
document.getElementById('description').textContent = `${meta.source.frameCount} 個來源影格，${meta.source.fps} fps、${meta.source.duration.toFixed(6)} 秒；每 ${meta.sampleEvery} 幀取一張，共 ${meta.frames.length} 格，名義 ${meta.fps} fps。棋盤格用來檢查透明邊緣。`;
const mib = bytes => `${(bytes / 1048576).toFixed(2)} MiB`;
const kib = bytes => bytes == null ? '未記錄' : `${(bytes / 1024).toFixed(1)} KiB`;
const stats = document.getElementById('stats');
const row = (label, fileSize, memory) => {
  const tr = document.createElement('tr');
  for (const text of [label, fileSize, memory]) {
    const td = document.createElement('td'); td.textContent = text; tr.append(td);
  }
  stats.append(tr); return tr;
};
const videoRow = row(meta.video.file, kib(meta.video.byteSize), '載入影片後估算單張解碼畫面');
for (const page of meta.pages) row(`${page.file} · ${page.width} × ${page.height}`, kib(page.byteSize), `${mib(page.width * page.height * 4)} / 頁`);
row('WebP 圖集總計', kib(meta.pages.reduce((sum,p) => sum + p.byteSize, 0)), `${mib(meta.pages.reduce((sum,p) => sum + p.width*p.height*4, 0))}（所有分頁）`);
row(`單格內容 ${meta.frameWidth} × ${meta.frameHeight}`, '—', `${mib(meta.frameWidth * meta.frameHeight * 4)} / 格`);
const updateVideoMetadata = () => {
  videoStatus.textContent = `${video.videoWidth} × ${video.videoHeight} · ${video.duration.toFixed(3)} 秒 · 靜音循環`;
  videoRow.cells[2].textContent = `${mib(video.videoWidth * video.videoHeight * 4)} / 解碼畫面（RGBA8 等效估算）`;
};
video.addEventListener('loadedmetadata', updateVideoMetadata);
if (video.readyState >= 1) updateVideoMetadata();
video.addEventListener('error', () => {
  videoStatus.textContent = '無法播放 girl-alpha.webm：請確認檔案存在，並以支援透明 WebM 的瀏覽器開啟。';
  videoStatus.classList.add('error');
});
let images = [], running = true, origin = 0, elapsedBeforePause = 0, previous = -1;
function draw(now) {
  if (images.length === meta.pages.length && running) {
    const elapsed = (elapsedBeforePause + (now - origin) / 1000) % meta.source.duration;
    let low = 0, high = meta.frames.length;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (meta.frames[mid].time <= elapsed) low = mid; else high = mid;
    }
    if (low !== previous) {
      const frame = meta.frames[low];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(images[frame.page], frame.x, frame.y, frame.w, frame.h, 0, 0, canvas.width, canvas.height);
      atlasStatus.textContent = `第 ${low + 1} / ${meta.frames.length} 格 · ${elapsed.toFixed(2)} 秒 · 本格 ${(frame.duration*1000).toFixed(1)} ms`;
      previous = low;
    }
  }
  requestAnimationFrame(draw);
}
toggle.addEventListener('click', () => {
  if (running) elapsedBeforePause += (performance.now() - origin) / 1000;
  else origin = performance.now();
  running = !running;
  toggle.textContent = running ? '暫停逐格圖' : '播放逐格圖';
});
restart.addEventListener('click', () => {
  elapsedBeforePause = 0; origin = performance.now(); previous = -1;
  running = true; toggle.textContent = '暫停逐格圖';
  if (video.readyState >= 1) video.currentTime = 0;
  video.play().catch(() => {});
});
Promise.all(meta.pages.map(page => new Promise((resolve, reject) => {
  const img = new Image(); img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`圖集載入失敗：${page.file}`)); img.src = page.file;
}))).then(loaded => {
  images = loaded; origin = performance.now();
  toggle.disabled = false; restart.disabled = false; requestAnimationFrame(draw);
}).catch(error => { atlasStatus.textContent = error.message; atlasStatus.classList.add('error'); });
</script>
</body></html>
"""


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=project_root / "artifacts/video-sample/rgba")
    parser.add_argument("--output", type=Path, default=project_root / "artifacts/video-sample")
    parser.add_argument("--source-fps", type=int, default=24)
    parser.add_argument("--source-duration", type=str, default=None,
                        help="Seconds as a decimal or fraction; default is frame count / source fps")
    parser.add_argument("--expected-frames", type=int, default=121,
                        help="Require this source count; pass 0 to disable the check")
    parser.add_argument("--sample-every", type=int, default=2)
    parser.add_argument("--width", type=int, default=144)
    parser.add_argument("--height", type=int, default=256)
    parser.add_argument("--padding", type=int, default=2)
    parser.add_argument("--columns", type=int, default=8)
    parser.add_argument("--rows", type=int, default=4)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    for field in ("source_fps", "sample_every", "width", "height", "columns", "rows"):
        if getattr(args, field) <= 0:
            raise SystemExit(f"--{field.replace('_', '-')} must be positive")
    if args.padding < 0:
        raise SystemExit("--padding cannot be negative")
    if not features.check("webp"):
        raise SystemExit("Pillow was built without WebP support")

    source_files = sorted(args.input.glob("frame_[0-9][0-9][0-9][0-9].png"))
    if not source_files:
        raise SystemExit(f"No frame_0000.png sequence found in {args.input}")
    if args.expected_frames and len(source_files) != args.expected_frames:
        raise SystemExit(f"Expected {args.expected_frames} source frames, found {len(source_files)}")
    for index, path in enumerate(source_files):
        if path.name != f"frame_{index:04d}.png":
            raise SystemExit(f"Source sequence must be consecutive from frame_0000.png; found {path.name} at {index}")

    source_duration = (Fraction(args.source_duration) if args.source_duration
                       else Fraction(len(source_files), args.source_fps))
    sequence_duration = Fraction(len(source_files), args.source_fps)
    if sequence_duration < source_duration <= sequence_duration + Fraction(1, 1000000):
        source_duration = sequence_duration  # Accept rounded probe durations such as 5.041667.
    if source_duration <= 0 or source_duration > sequence_duration:
        raise SystemExit("Source duration must be positive and no longer than the source frame sequence")
    sample_indices = [i for i in range(0, len(source_files), args.sample_every)
                      if Fraction(i, args.source_fps) < source_duration]
    cell_width, cell_height = args.width + args.padding * 2, args.height + args.padding * 2
    page_width, page_height = cell_width * args.columns, cell_height * args.rows
    capacity = args.columns * args.rows
    args.output.mkdir(parents=True, exist_ok=True)
    pages: list[dict] = []
    frames: list[dict] = []
    source_size = None

    for page_start in range(0, len(sample_indices), capacity):
        page_index = len(pages)
        atlas = Image.new("RGBA", (page_width, page_height), (0, 0, 0, 0))
        for slot, source_index in enumerate(sample_indices[page_start:page_start + capacity]):
            with Image.open(source_files[source_index]) as image:
                if source_size is None:
                    source_size = image.size
                elif image.size != source_size:
                    raise SystemExit(f"Source frame size changed at {source_files[source_index].name}")
                fitted = ImageOps.contain(image.convert("RGBA"), (args.width, args.height), Image.Resampling.LANCZOS)
            x = (slot % args.columns) * cell_width + args.padding
            y = (slot // args.columns) * cell_height + args.padding
            atlas.alpha_composite(fitted, (x + (args.width - fitted.width) // 2,
                                          y + (args.height - fitted.height) // 2))
            time = Fraction(source_index, args.source_fps)
            duration = min(Fraction(args.sample_every, args.source_fps), source_duration - time)
            frames.append({"frame": len(frames), "sourceFrame": source_index,
                           "page": page_index, "x": x, "y": y,
                           "w": args.width, "h": args.height,
                           "time": float(time), "duration": float(duration)})
        filename = f"atlas-{page_index + 1:02d}.webp"
        atlas_path = args.output / filename
        atlas.save(atlas_path, "WEBP", lossless=True, quality=100, method=6, exact=True)
        pages.append({"page": page_index, "file": filename,
                      "width": page_width, "height": page_height,
                      "byteSize": atlas_path.stat().st_size})

    video_path = args.output / "girl-alpha.webm"
    metadata = {
        "version": 1, "format": "paged-lossless-webp-atlas",
        "fps": args.source_fps / args.sample_every,
        "sampleEvery": args.sample_every,
        "frameWidth": args.width, "frameHeight": args.height,
        "padding": args.padding, "columns": args.columns, "rows": args.rows,
        "cellWidth": cell_width, "cellHeight": cell_height,
        "source": {"frameCount": len(source_files), "fps": args.source_fps,
                   "duration": float(source_duration),
                   "width": source_size[0], "height": source_size[1]},
        "video": {"file": "girl-alpha.webm",
                  "byteSize": video_path.stat().st_size if video_path.exists() else None},
        "pages": pages, "frames": frames,
    }
    json_path = args.output / "spritesheet.json"
    json_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    inline_metadata = json.dumps(metadata, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    preview_path = args.output / "preview.html"
    preview_path.write_text(PREVIEW_HTML.replace("__METADATA__", inline_metadata), encoding="utf-8")
    print(f"Source: {len(source_files)} frames, {args.source_fps} fps, {float(source_duration):.9f} s")
    print(f"Atlas: {len(frames)} frames, {metadata['fps']:g} fps, last duration {frames[-1]['duration']:.9f} s")
    for page in pages:
        print(f"{args.output / page['file']}: {page['width']}x{page['height']}, {page['byteSize']} bytes")
    print(json_path)
    print(preview_path)


if __name__ == "__main__":
    main()
