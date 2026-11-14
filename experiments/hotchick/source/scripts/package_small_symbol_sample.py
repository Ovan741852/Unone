"""Package the new small-symbol source, transparent atlases and previews."""
from pathlib import Path
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "artifacts" / "small-symbol-sample"


def main():
    readme = """海王 小 symbol 素材範例

來源：vidu-video-3531056331575112.mp4
用途：小 symbol 微笑／揮手表演的候選素材。
原片1440x1440、24fps、121幀、約5.041667秒，沒有透明通道。

查看
用桌機Chrome或Edge開 preview.html；不需要本機伺服器。
左側為來源MP4對照，右側192/128泡泡全部用WebP sprite逐格播放。
初始停在第0格，點播放後表演，再做預覽用縮小動作。
small-symbol-preview.mp4為已合成背景的觀看示範，不是遊戲透明素材。

素材
atlas-192-01/02.webp、spritesheet-192.json、poster-192.png
atlas-128-01/02.webp、spritesheet-128.json、poster-128.png
兩套均12fps、61格，完整來源時長5.041667秒；末格1/24秒。
192版本約1.87MB壓縮，兩頁RGBA8基礎貼圖約9.379MiB。
128版本約0.92MB壓縮，兩頁RGBA8基礎貼圖約4.254MiB。
記憶體估算不含mipmap、driver與其他資源。
人物保留透明與半透明Alpha；泡泡圓形遮罩、框與縮小由遊戲控制，未烘焙進圖集。
白色泡泡框只是預覽用，不是已定稿UI美術。

來源處理
RVM MobileNetV3 FP32 ONNX去背，保留recurrent state。
先得到512x512 RGBA，再裁x96,y18,w320,h320到頭肩鎖骨附近，縮到192/128。
圓框會裁去一些外側手勢；可根據正式構圖調整crop。
保留完整來源供檢查，不代表正式開獎一定播放5秒。
待機/開獎切段、最終時長和對應女孩仍待確認。
原片不宣稱無縫循環，循環checkbox只供檢查。

重製
需求：FFmpeg、Python、numpy、Pillow、onnxruntime。
官方模型：https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx
python scripts/matte_video_sample.py --input SOURCE.mp4 --output artifacts/small-symbol-sample --model MODEL.onnx --height 512 --ratio 0.8 --rgba-only
python scripts/build_small_symbol_sample.py
python scripts/render_small_symbol_preview.py

manifest.json / sample-report.json保留來源hash、圖集座標、每格時間、裁切與Alpha/時序驗證。
沒有為小symbol產生WebM遊戲素材。來源檔沒有被改動。
"""
    (BASE / "README.txt").write_text(readme, encoding="utf-8-sig")
    files = [file for file in BASE.iterdir() if file.is_file() and file.suffix in (".html", ".webp", ".json", ".png", ".mp4", ".txt", ".jpg")]
    package = ROOT / "artifacts" / "haiwang-small-symbol-sample.zip"
    with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            archive.write(file, file.name)
        for name in ("matte_video_sample.py", "build_small_symbol_sample.py", "render_small_symbol_preview.py", "package_small_symbol_sample.py"):
            archive.write(ROOT / "scripts" / name, "scripts/" + name)
    with zipfile.ZipFile(package) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("ZIP integrity check failed")
    print(json.dumps({"zip": str(package), "bytes": package.stat().st_size, "files": len(files)}, indent=2))


if __name__ == "__main__":
    main()
