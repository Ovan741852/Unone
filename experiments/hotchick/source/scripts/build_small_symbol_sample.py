#!/usr/bin/env python3
"""Build 192/128px small-symbol WebP sprite samples and an offline preview."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

from PIL import Image, features


CROP = (96, 18, 320, 320)
PADDING, COLUMNS, ROWS = 2, 8, 4
SOURCE_COUNT, SOURCE_FPS, SAMPLE_EVERY = 121, 24, 2
DURATION = Fraction(SOURCE_COUNT, SOURCE_FPS)

HTML = r'''<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>小 symbol · WebP sprite 範例</title><style>
:root{color-scheme:dark;font:14px/1.6 system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#101827;color:#e8eef8}main{max-width:1120px;margin:auto;padding:24px}h1{margin:0;font-size:26px}h2{font-size:18px;margin:0 0 12px}p{color:#becbe0;margin:10px 0 18px}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.45fr);gap:18px}.card{padding:18px;border:1px solid #35445e;border-radius:14px;background:#172337;min-width:0}.source-stage{height:350px;position:relative;background:#090f18;border-radius:8px;overflow:hidden}video{position:absolute;inset:0;width:100%;height:100%;min-width:0;min-height:0;object-fit:contain}.sprites{min-height:350px;display:flex;align-items:center;justify-content:center;gap:28px;flex-wrap:wrap;padding:26px 10px;background-color:#bcc4d0;background-image:linear-gradient(45deg,#7d8798 25%,transparent 25%),linear-gradient(-45deg,#7d8798 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#7d8798 75%),linear-gradient(-45deg,transparent 75%,#7d8798 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0;border-radius:8px}.symbol-wrap{text-align:center;flex:none}.symbol{position:relative;transform-origin:center center;will-change:transform,opacity}.bubble{position:absolute;inset:0;overflow:hidden;border-radius:50%;background:linear-gradient(145deg,#bfe6ff15,#ecf5ff10)}.symbol:after{content:"";position:absolute;inset:0;border:2px solid #ffffffd9;border-radius:50%;pointer-events:none;box-shadow:inset 0 0 12px #ffffff35,0 3px 12px #14273a50}canvas{display:block;width:100%;height:100%;background:transparent}.symbol-label{margin-top:18px;color:#172337;font-weight:700}.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:16px}button{padding:9px 16px;border:1px solid #687e9d;border-radius:7px;background:#29486d;color:#eef5ff;cursor:pointer}button:disabled{opacity:.5;cursor:wait}label{color:#c2d0e4}.status{min-height:26px;margin-top:12px;color:#b8d8ff;font-variant-numeric:tabular-nums}.note{font-size:13px}.stats{margin-top:18px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:8px;border-bottom:1px solid #34445a;white-space:nowrap}a{color:#8addf0}.error{color:#ffb7b7}@media(max-width:850px){.grid{grid-template-columns:1fr}main{padding:16px}.sprites{min-height:310px}.source-stage{height:300px}}
</style></head><body><main>
<h1>小 symbol · 原地開獎 sprite 範例</h1>
<p>人物去背後裁至頭肩鎖骨，保留透明邊緣。右側初始停在第 0 格；按鈕播放微笑揮手，再由預覽動作縮小。白色泡泡框與圓形遮罩由頁面繪製，僅作檢查，非最終 UI 美術。</p>
<div class="grid"><section class="card"><h2>來源 MP4 對照</h2><div class="source-stage"><video id="source" src="source.mp4" poster="source-preview.jpg" muted controls playsinline preload="metadata"></video></div><p class="note">左側保留原片供對照；小 symbol 正式示例全程使用右側 WebP sprite，沒有去背 WebM。</p></section>
<section class="card"><h2>192px／128px 泡泡實際尺寸</h2><div class="sprites">
<div class="symbol-wrap"><div class="symbol" id="symbol192" style="width:192px;height:192px"><div class="bubble"><canvas id="sprite192" width="192" height="192"></canvas></div></div><div class="symbol-label">192 × 192 CSS px</div></div>
<div class="symbol-wrap"><div class="symbol" id="symbol128" style="width:128px;height:128px"><div class="bubble"><canvas id="sprite128" width="128" height="128"></canvas></div></div><div class="symbol-label">128 × 128 CSS px</div></div></div>
<div class="controls"><button id="play" disabled>播放小 symbol 開獎</button><button id="reset" disabled>回到初始格</button><label><input id="loop" type="checkbox"> 檢查用循環</label></div><div id="status" class="status">正在載入圖集…</div>
<p class="note">循環只供檢查，不表示原片是無縫循環。這裡播放完整來源片段約 5.042 秒，結束後以 360ms 縮小；正式小 symbol 的演出時長與縮小節奏仍待確認。</p></section></div>
<section class="card stats"><h2>素材與記憶體</h2><div class="table-wrap"><table><thead><tr><th>版本</th><th>影格／播放</th><th>圖集分頁</th><th>WebP 檔案</th><th>RGBA8 貼圖估算</th><th>透明 poster</th></tr></thead><tbody id="stats"></tbody></table></div><p class="note">RGBA8 為貼圖寬 × 高 × 4 bytes，不含 mipmap、驅動與其他資源。本頁為方便比較同時載入兩套圖集；遊戲可按盤面所需尺寸選用。圓框未烘焙進人物圖集。</p><p class="note">角色映射待定，未將此來源指定為既有舞蹈素材的同一位女孩。<a href="manifest.json">manifest.json</a> · <a href="spritesheet-192.json">192 JSON</a> · <a href="spritesheet-128.json">128 JSON</a></p></section>
<script id="metadata" type="application/json">__METADATA__</script><script>
'use strict';
const meta=JSON.parse(document.getElementById('metadata').textContent);
const source=document.getElementById('source'),play=document.getElementById('play'),reset=document.getElementById('reset'),loop=document.getElementById('loop'),status=document.getElementById('status');
const variants=Object.entries(meta.variants).map(([key,v])=>({...v,key,canvas:document.getElementById('sprite'+key),node:document.getElementById('symbol'+key),images:[]}));
const duration=meta.timing.duration,shrinkMs=360;let state='idle',started=0,shrinkStarted=0,lastFrame=-1;
function setScale(scale,opacity=1){for(const v of variants){v.node.style.transform=`scale(${scale})`;v.node.style.opacity=opacity;}}
function draw(index){if(index===lastFrame)return;for(const v of variants){const f=v.frames[index],ctx=v.canvas.getContext('2d');ctx.clearRect(0,0,v.size,v.size);ctx.drawImage(v.images[f.page],f.x,f.y,f.w,f.h,0,0,v.size,v.size);}lastFrame=index;}
function frameAt(time){let lo=0,hi=meta.timing.frame_count;while(lo+1<hi){const mid=(lo+hi)>>1;if(variants[0].frames[mid].time<=time)lo=mid;else hi=mid;}return lo;}
function tick(now){
 if(state==='playing'){
  const elapsed=(now-started)/1000;
  if(loop.checked){const t=elapsed%duration;draw(frameAt(t));status.textContent=`檢查循環 · 第 ${lastFrame+1}/${meta.timing.frame_count} 格 · ${t.toFixed(2)} 秒`;}
  else if(elapsed<duration){draw(frameAt(elapsed));status.textContent=`原地開獎 · 第 ${lastFrame+1}/${meta.timing.frame_count} 格 · ${elapsed.toFixed(2)} / ${duration.toFixed(3)} 秒`;}
  else{draw(meta.timing.frame_count-1);state='shrinking';shrinkStarted=now;source.pause();status.textContent='片段完成 · 預覽縮小動作';}
 }else if(state==='shrinking'){
  const p=Math.min(1,(now-shrinkStarted)/shrinkMs),ease=1-Math.pow(1-p,3);setScale(1-.88*ease,1-.65*ease);
  if(p===1){state='finished';status.textContent='開獎預覽完成，已縮小；可再次播放或回到初始格。';}
 }
 requestAnimationFrame(tick);
}
play.addEventListener('click',()=>{state='playing';started=performance.now();lastFrame=-1;setScale(1);draw(0);source.loop=loop.checked;if(source.readyState>=1)source.currentTime=0;source.play().catch(()=>{});});
reset.addEventListener('click',()=>{state='idle';setScale(1);lastFrame=-1;draw(0);source.pause();if(source.readyState>=1)source.currentTime=0;status.textContent='初始第 0 格 · 等待播放小 symbol 開獎';});
loop.addEventListener('change',()=>{source.loop=loop.checked;if(state==='playing'&&!loop.checked){const now=performance.now();started=now-((now-started)%(duration*1000));}});
source.addEventListener('error',()=>{source.insertAdjacentHTML('afterend','<span class="error">來源 MP4 無法載入；右側 sprite 可獨立檢查。</span>');});
const stats=document.getElementById('stats');
for(const v of variants){const row=document.createElement('tr');const cells=[`${v.size} × ${v.size}`,`${v.frame_count} 格 / ${v.fps} fps / ${v.duration.toFixed(6)}s`,v.pages.map(p=>`${p.width}×${p.height}`).join(' + '),`${(v.total_bytes/1024).toFixed(1)} KiB`,`${(v.total_rgba8_bytes/1048576).toFixed(3)} MiB`,v.poster.file];for(const text of cells){const td=document.createElement('td');td.textContent=text;row.append(td);}stats.append(row);}
Promise.all(variants.map(async v=>{v.images=await Promise.all(v.pages.map(p=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('圖集載入失敗：'+p.file));img.src=p.file;})));})).then(()=>{draw(0);play.disabled=false;reset.disabled=false;status.textContent='初始第 0 格 · 等待播放小 symbol 開獎';requestAnimationFrame(tick);}).catch(e=>{status.textContent=e.message;status.classList.add('error');});
</script></main></body></html>'''


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def info(path: Path) -> dict:
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=root / "artifacts/small-symbol-sample/rgba")
    parser.add_argument("--output", type=Path, default=root / "artifacts/small-symbol-sample")
    args = parser.parse_args()
    if not features.check("webp"):
        raise SystemExit("Pillow WebP support is required")
    paths = [args.input / f"frame_{i:04d}.png" for i in range(SOURCE_COUNT)]
    if not all(path.is_file() for path in paths):
        raise SystemExit("All 121 RGBA source frames must be ready before building")
    args.output.mkdir(parents=True, exist_ok=True)
    selected = list(range(0, SOURCE_COUNT, SAMPLE_EVERY))
    cropped, source_hashes = [], []
    x, y, w, h = CROP
    for index in selected:
        with Image.open(paths[index]) as image:
            if image.size != (512, 512) or image.mode != "RGBA":
                raise ValueError(f"Expected 512x512 RGBA: {paths[index]}")
            cropped.append(image.crop((x, y, x+w, y+h)))
        source_hashes.append({"sourceFrame": index, "file": paths[index].name, "sha256": sha(paths[index])})
    variants = {}
    validations = {}
    for size in (192, 128):
        tiles = [frame.resize((size, size), Image.Resampling.LANCZOS) for frame in cropped]
        cell = size + 2 * PADDING
        page_size = (cell * COLUMNS, cell * ROWS)
        pages, frames, checks = [], [], []
        capacity = COLUMNS * ROWS
        for start in range(0, len(tiles), capacity):
            page_index = len(pages)
            atlas = Image.new("RGBA", page_size, (0, 0, 0, 0))
            local_frames = []
            for slot, index in enumerate(range(start, min(start+capacity, len(tiles)))):
                px, py = (slot % COLUMNS)*cell+PADDING, (slot//COLUMNS)*cell+PADDING
                atlas.paste(tiles[index], (px, py))
                time = Fraction(selected[index], SOURCE_FPS)
                duration = min(Fraction(SAMPLE_EVERY, SOURCE_FPS), DURATION-time)
                frame = {"frame": index, "sourceFrame": selected[index], "page": page_index,
                         "x": px, "y": py, "w": size, "h": size,
                         "time": float(time), "sourceTime": float(time), "duration": float(duration)}
                frames.append(frame)
                local_frames.append(frame)
            path = args.output / f"atlas-{size}-{page_index+1:02d}.webp"
            atlas.save(path, "WEBP", lossless=True, quality=100, method=6, exact=True)
            with Image.open(path) as decoded_source:
                decoded = decoded_source.convert("RGBA")
            assert decoded.size == page_size and decoded.tobytes() == atlas.tobytes()
            alpha = decoded.getchannel("A")
            for frame in local_frames:
                px, py = frame["x"], frame["y"]
                assert px >= PADDING and py >= PADDING and px+size+PADDING <= page_size[0] and py+size+PADDING <= page_size[1]
                assert decoded.crop((px, py, px+size, py+size)).tobytes() == tiles[frame["frame"]].tobytes()
                for rect in [(px-PADDING,py-PADDING,px+size+PADDING,py),
                             (px-PADDING,py+size,px+size+PADDING,py+size+PADDING),
                             (px-PADDING,py,px,py+size),(px+size,py,px+size+PADDING,py+size)]:
                    assert alpha.crop(rect).getbbox() is None
            histogram = alpha.histogram()
            checks.append({"page":page_index,"decoded_size":list(page_size),"decoded_mode":"RGBA",
                           "alpha_extrema":list(alpha.getextrema()), "partial_alpha_pixels":sum(histogram[1:255]),
                           "all_tiles_pixel_exact":True,"transparent_padding_verified":True})
            pages.append({**info(path),"page":page_index,"width":page_size[0],"height":page_size[1],
                          "rgba8_bytes":page_size[0]*page_size[1]*4})
        poster_path = args.output / f"poster-{size}.png"
        tiles[0].save(poster_path, "PNG")
        poster_alpha = tiles[0].getchannel("A")
        assert poster_alpha.getextrema() == (0, 255), "Poster should retain actual transparent and opaque pixels"
        assert len(frames) == 61 and len(pages) == 2
        assert abs(sum(f["duration"] for f in frames)-float(DURATION)) < 1e-10
        assert abs(frames[-1]["time"]+frames[-1]["duration"]-float(DURATION)) < 1e-10
        variant = {"size":size,"width":size,"height":size,"fps":12,"frame_count":61,
                   "duration":float(DURATION),"last_frame_duration":frames[-1]["duration"],
                   "padding_per_side":PADDING,"inter_content_gap":PADDING*2,"columns":COLUMNS,"rows":ROWS,
                   "pages":pages,"frames":frames,"poster":{**info(poster_path),"alpha_extrema":list(poster_alpha.getextrema())},
                   "total_bytes":sum(p["bytes"] for p in pages),"total_rgba8_bytes":sum(p["rgba8_bytes"] for p in pages)}
        metadata_path = args.output / f"spritesheet-{size}.json"
        write_json(metadata_path,variant)
        variant["metadata"] = info(metadata_path)
        variants[str(size)] = variant
        validations[str(size)] = {"passed":True,"pages":checks,"poster_alpha_extrema":list(poster_alpha.getextrema()),
                                 "frame_rectangles_in_bounds":True,"frame_timing_contiguous":True,
                                 "duration_sum":sum(f["duration"] for f in frames)}
    manifest = {"schema_version":1,"built_at_utc":datetime.now(timezone.utc).isoformat(),
                "purpose":"Small symbol sprite test; bubble mask/frame is drawn at runtime, not baked",
                "character_mapping":"待定；未與既有舞蹈來源建立同一角色關係",
                "source":{"file":"source.mp4","width":1440,"height":1440,"fps":24,"frame_count":121,
                          "duration":float(DURATION),"rgba_width":512,"rgba_height":512},
                "crop":{"rgba_pixels":{"x":96,"y":18,"w":320,"h":320},
                        "requested_original_pixels":{"x":270,"y":50,"w":900,"h":900},
                        "exact_scaled_original_pixels":{"x":270.0,"y":50.625,"w":900.0,"h":900.0},
                        "note":"Original-coordinate request is rounded; 512px crop is authoritative."},
                "timing":{"source_fps":24,"sample_every":2,"fps":12,"frame_count":61,
                          "duration":float(DURATION),"last_frame_duration":float(Fraction(1,24)),
                          "preview_shrink_ms":360,"formal_small_animation_duration":"待確認",
                          "source_is_seamless_loop":False},
                "variants":variants,"validation":validations,"selected_source_frames":source_hashes}
    source_path = args.output / "source.mp4"
    if source_path.is_file():
        manifest["source"].update(info(source_path))
    write_json(args.output/"manifest.json",manifest)
    report = {"built_at_utc":manifest["built_at_utc"],"script":info(Path(__file__)),"pillow":Image.__version__,
              "crop":manifest["crop"],"timing":manifest["timing"],"validation":validations,
              "output_files":[p["file"] for v in variants.values() for p in v["pages"]]+[v["poster"]["file"] for v in variants.values()],
              "notes":["No WebM small-symbol output is created.","Preview bubble frame is a runtime test overlay, not final UI art.",
                       "Full source duration is used for inspection; formal timing and character mapping remain pending."]}
    write_json(args.output/"sample-report.json",report)
    preview_data = {"timing":manifest["timing"],"variants":variants}
    inline = json.dumps(preview_data,ensure_ascii=False,separators=(",",":")).replace("<","\\u003c")
    (args.output/"preview.html").write_text(HTML.replace("__METADATA__",inline),encoding="utf-8")
    print(json.dumps({"output":str(args.output.resolve()),"variants":{key:{"pages":v["pages"],"poster":v["poster"],
                     "frame_count":v["frame_count"],"duration":v["duration"],"total_bytes":v["total_bytes"],
                     "rgba8_mib":v["total_rgba8_bytes"]/2**20} for key,v in variants.items()},
                     "validation_passed":True},ensure_ascii=False,indent=2))


if __name__ == "__main__":
    main()
