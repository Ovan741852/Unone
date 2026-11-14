"""Package the runnable export, measured results and reproduction scripts."""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "artifacts" / "symbol-benchmark"


def main():
    readme = """海王 Unone 多 Symbol 效能比較

快速查看
在原工作區執行 scripts/Start-SymbolBenchmark.ps1，開 http://127.0.0.1:8237/。
若使用解壓後的獨立包，在此目錄執行 python serve.py，再開同一網址。
盤面可切換WebM共用、WebM獨立、WebP圖集及靜態基準，選擇數量與相位。
查看 report.html 可讀本次測試表格、圖表、方法與限制。

執行的是正式Unone Luau runtime及SDK官方Three renderer。
custom factory只附加媒體presentation，數量與路線由Luau控制。
每個條件使用新頁面，N個畫面symbol對應N個Unone world entities。

公平輸入
同源144x256、12fps、60格、5秒透明素材。
WebM VP9 Alpha CRF30；圖集lossless WebP兩頁，共9.3945MiB基礎RGBA8貼圖。
同一支樣例重用，不代表已測多種不同女孩或高解析度滿版影片。

方法與解讀
附帶自動測試是Chrome headless GPU實測，保存實際GL renderer與CDP系統資料。
它不是一般前景視窗或所有設備的通用FPS承諾；可用互動頁在自己的瀏覽器重測。
影片掉幀與盤面FPS分開報告；GPU繪圖加速與影片硬體解碼分開認定。
CPU core-equivalents是此Chrome實例各進程CPU秒數除實際測量秒數。
Chrome進程工作集加總可能重複計入共享頁，不是唯一實體RAM或顯存。
JS heap與WebGL texture數量也不是總GPU或解碼器記憶體。
正式測量期間不截圖、不錄影；截圖為另一次功能檢查。

自動重測（原工作區）
1. scripts/Start-SymbolBenchmark.ps1
2. scripts/Start-BenchmarkBrowser.ps1
3. node scripts/probe_symbol_browser.mjs
4. node scripts/run_symbol_benchmark.mjs --base=http://127.0.0.1:8237/player-v3/ --modes=webm-shared,webm-independent,atlas --counts=1,16,64,128 --repeats=2 --duration=15000 --warmup=5000
5. python scripts/summarize_symbol_benchmark.py --help

runtime/匯出由Unone SDK生成；source目錄保留Luau與媒體wrapper及來源紀錄。
完整原始測量與每次條件在results目錄。正式報告不包含開發期smoke資料。
"""
    (BASE / "README.txt").write_text(readme, encoding="utf-8-sig")
    standalone_server = '''import mimetypes\nfrom http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler\nfrom functools import partial\nfrom pathlib import Path\nfor ext,typ in [(".wasm","application/wasm"),(".mjs","application/javascript"),(".js","application/javascript")]:mimetypes.add_type(typ,ext)\nprint("http://127.0.0.1:8237/",flush=True)\nThreadingHTTPServer(("127.0.0.1",8237),partial(SimpleHTTPRequestHandler,directory=str(Path(__file__).parent))).serve_forever()\n'''
    package = ROOT / "artifacts" / "haiwang-unone-symbol-benchmark.zip"
    with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("serve.py", standalone_server)
        for name in ("index.html", "report.html", "summary.json", "summary.csv", "README.txt"):
            archive.write(BASE / name, name)
        for directory in ("player-v3", "results", "results-static", "results-stagger"):
            location = BASE / directory
            if not location.exists():
                continue
            for file in location.rglob("*"):
                if file.is_file() and file.suffix in (".json", ".html", ".png", ".js", ".mjs", ".wasm", ".webp", ".webm", ".gz", ".css", ".txt", ".LICENSE"):
                    archive.write(file, file.relative_to(BASE).as_posix())
        for file in (ROOT / "benchmark-game").rglob("*"):
            if file.is_file() and file.suffix not in (".pyc",):
                archive.write(file, "source/" + file.relative_to(ROOT / "benchmark-game").as_posix())
        for name in ("cdp-client.mjs", "run_symbol_benchmark.mjs", "probe_symbol_browser.mjs", "serve_symbol_benchmark.py", "Start-SymbolBenchmark.ps1", "Start-BenchmarkBrowser.ps1", "summarize_symbol_benchmark.py", "build_benchmark_assets.py"):
            archive.write(ROOT / "scripts" / name, "scripts/" + name)
    with zipfile.ZipFile(package) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("ZIP integrity check failed")
    print(json.dumps({"package":str(package),"bytes":package.stat().st_size},indent=2))


if __name__ == "__main__":
    main()
