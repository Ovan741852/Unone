"""Package the generated video and atlas example without caches or RGB frames."""
from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "video-sample"


def main() -> None:
    report = json.loads((OUTPUT / "matting-report.json").read_text(encoding="utf-8"))
    atlases = sorted(OUTPUT.glob("atlas-*.webp"))
    atlas_bytes = sum(path.stat().st_size for path in atlases)
    readme = f"""海王透明影片與 WebP 圖集範例

來源：vidu-video-3530972241983417.mp4
原始規格：1076 x 1926，24 fps，121 幀，約 5.041667 秒，沒有 Alpha。
處理流程：RVM 人像影片去背 -> RGBA PNG 母序列 -> 透明 WebM / WebP atlas。
RVM 使用官方 MobileNetV3 FP32 ONNX v1.0.0，循序保留 recurrent state。
官方來源：https://github.com/PeterL1n/RobustVideoMatting

如何查看
1. 解壓後用桌機 Chrome 或 Edge 開啟 preview.html。
2. 左邊播放透明 WebM，右邊用 Canvas 播放 WebP 圖集。
3. checker-preview.mp4 是已合成棋盤底的觀看預覽，本身沒有透明度。
4. girl-alpha.webm 才是帶真實 Alpha 的影片。

交付規格
WebM：VP9 Alpha、430 x 768、24 fps、無聲、121 幀。
WebM 檔案：{report['webm_bytes']:,} bytes。
WebP：lossless 靜態圖集，12 fps、61 格、每格內容 144 x 256。
兩頁圖集各為 1184 x 1040；每格四邊保留 2 px 透明間隔。
WebP 合計：{atlas_bytes:,} bytes。
兩頁基礎 RGBA8 貼圖約 9.3945 MiB，不含 mipmaps 與驅動額外配置。
spritesheet.json 含分頁、每格座標、來源時間與持續時間；最後一格為 1/24 秒。
WebM 與 WebP 採不同尺寸與幀率，檔案大小只代表這兩組輸出設定。

品質與效能
已確認 WebM 重新解碼有透明與半透明 Alpha，圖集亦保留 Alpha。
已抽查原地、轉身甩髮、舉手畫面並檢查深淺底邊緣。
快速甩髮與動作模糊邊緣仍可能有些微原背景底色，正式素材可再精修。
瀏覽器比較頁使用原生 video 與 Canvas；尚未代表 Unone 內的同播效能。
WebM 適合中、大演出；小型循環圖集可共用貼圖並獨立選格。

重製流程
需求：FFmpeg（含 libvpx-vp9）、Python、numpy、Pillow、onnxruntime。
官方模型下載：
https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx

在專案根目錄，先下載模型，再執行：
python scripts/matte_video_sample.py --input ORIGINAL.mp4 --output artifacts/video-sample --model MODEL.onnx
python scripts/build_sample_atlas.py --input artifacts/video-sample/rgba --output artifacts/video-sample

透明 PNG 序列轉 WebM 的核心命令：
ffmpeg -framerate 24 -start_number 0 -i rgba/frame_%04d.png -an -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 girl-alpha.webm

驗證透明 WebM 時，解碼器必須明確選 libvpx-vp9：
ffmpeg -c:v libvpx-vp9 -i girl-alpha.webm -frames:v 1 -pix_fmt rgba check.png

圖集不是 animated WebP；遊戲根據 JSON 的矩形與時間逐格播放。
圖集只需載入一次，可讓同素材的多顆 symbol 自己選擇播放格數。
預覽與所有轉檔皆保留在此範例目錄，原始 MP4 沒有被改動。
"""
    (OUTPUT / "README.txt").write_text(readme, encoding="utf-8-sig")
    files = [
        "README.txt", "preview.html", "girl-alpha.webm", "spritesheet.json",
        "checker-preview.mp4", "alpha-contact-sheet.jpg", "source-preview.jpg",
        "matting-report.json",
    ] + [path.name for path in atlases]
    manifest = {
        "source_filename": "vidu-video-3530972241983417.mp4",
        "webm": {"width": 430, "height": 768, "fps": 24, "frames": 121,
                 "bytes": report["webm_bytes"], "alpha_verified": True},
        "atlas": {"fps": 12, "frames": 61, "pages": len(atlases),
                  "content_width": 144, "content_height": 256,
                  "compressed_bytes": atlas_bytes, "rgba8_mib": 9.39453125},
        "concurrent_engine_benchmark": False,
        "files": [],
    }
    for name in files:
        path = OUTPUT / name
        manifest["files"].append({"file": name, "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    package = ROOT / "artifacts" / "haiwang-video-sample.zip"
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in files + ["manifest.json"]:
            archive.write(OUTPUT / name, arcname=name)
        for script in ("matte_video_sample.py", "build_sample_atlas.py", "package_video_sample.py"):
            archive.write(ROOT / "scripts" / script, arcname=f"scripts/{script}")
    with zipfile.ZipFile(package) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("ZIP CRC verification failed")
    print(json.dumps({"zip": str(package), "bytes": package.stat().st_size,
                      "webm_bytes": report["webm_bytes"], "atlas_bytes": atlas_bytes}, indent=2))


if __name__ == "__main__":
    main()
