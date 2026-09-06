# 工作包：把一個遊戲輸出成可出貨的網頁

日期：2026-09-06。計畫代理：Claude（主代理）。實作：codex / luna。
基準：`master` 的 `113b6dd`。狀態：`planned`。

## 問題

打開 `http://127.0.0.1:8001/` 現在看到的是一個**開發工具**：一個列出三款遊戲的
入口頁，每個連結用 `?project=/Unone_Games/<game>/` 指向專案目錄。

出貨的遊戲不長這樣。開啟網址就應該**直接是那款遊戲**：沒有專案切換、沒有
query 參數、沒有側欄的 debug 面板。

引擎目前**沒有任何「輸出遊戲」的路徑**。`game` 的子命令有 `verify`、`perf`、
`bundle`、`preview`…，沒有 export。`pack-ai-engine.ps1` 打包的是**引擎**（給
子代理用的 immutable package），不是遊戲。

## 這一個缺口同時解掉三個既有問題

| 既有問題 | export 如何解掉 |
|---|---|
| 三個 host 頁面寫死 `../../target/wasm32-.../unone_web_live_smoke.js`，而 `target/` 是 gitignored，所以乾淨 clone 打開是壞的 | export 把 runtime 複製進輸出目錄，輸出物不依賴 `target/` |
| Web runtime 是 33 MB 的 debug build，repo 裡沒有任何產出 release 的路徑 | export 要求 release build，並回報實際大小 |
| Web runtime 的 crate 叫 `unone-web-live-smoke`，讀起來像丟棄式測試，實際上是唯一的 Web runtime | export 產出的檔案有自己的名字；smoke crate 可以留在原地當 smoke test |

## 契約

```powershell
game --project D:/Projects/Unone_Games/slot-machine export web --output dist/slot-machine
```

輸出目錄是**自包含**的：把它丟到任何靜態伺服器的根目錄，開啟就是那款遊戲。

```
dist/slot-machine/
  index.html            # 就是遊戲，沒有 ?project=、沒有切換器
  runtime/
    unone-engine.js     # release wasm host，名字不是 smoke
    unone-engine.wasm
  content/
    manifest.json       # bundle manifest
    <bundles>           # 已驗證的 content bundle
  export.json           # 輸出清單：來源 commit、每個檔案的 sha256 與大小
```

規則：

- **輸出物不得引用輸出目錄以外的任何路徑。** 有引用就是錯誤，不是警告。
- **`index.html` 不讀 query 參數決定要載哪個遊戲。** 專案是編進去的。
- **debug 產物不得輸出。** 沒有 release runtime 就明確失敗並說要跑哪個腳本，
  不要靜默退回 debug——那正是 33 MB 的來源。
- `export.json` 列出每個檔案的 sha256 與大小，並記錄來源 commit 與是否
  dirty，與 `package-manifest.json` 同一個習慣。

## 開發 host 保持原樣

`web/runner/?project=` 與 `web/presentation/?project=` 是**開發工具**，不改、
不移除。它們要能切換專案、要有語意狀態面板、要能顯示 diagnostics——那是它們
存在的理由。

export 產出的是另一個東西：**沒有面板、沒有切換、沒有 debug 輸出**的遊戲。

兩者共用同一份 host 程式碼，差別在建置時的設定，不要 fork 成兩份實作。實作
者要決定共用的方式（同一份 JS 讀一個編進去的設定，或 export 時做最小的
inline），並在工作包回報選了哪種與為什麼。

## 分段

### 第 1 段：release runtime

`build-web-live.ps1` 目前只建 debug。要有一條產出 release wasm 的路徑，並
記錄前後大小（debug 實測 33 MB）。這一段本身就有價值，與 export 無關的人也
會用到。

若 release build 因為 emscripten 設定失敗，**回報，不要退回 debug**。

### 第 2 段：export 命令

`game export web --output <dir>`，產出上面的結構與 `export.json`。

驗收：把輸出目錄複製到一個全新的位置、用任何靜態伺服器開啟根目錄，遊戲可玩，
且瀏覽器的 network 面板沒有任何 404、沒有任何指向輸出目錄以外的請求。

### 第 3 段：以老虎機驗證

[老虎機工作包](2026-09-06-slot-machine-reference.md)的商品驗收需要這一段：
一個可以交給別人「打開就能玩」的東西。輸出後的實測結果寫進該工作包的
`validation-report.json`。

## 不做

- 不做 CDN、不做壓縮傳輸策略、不做 service worker、不做離線快取。
- 不做 native 或 mobile 的 export。本包只有 Web。
- 不移除或改動現有的開發 host。
- 不在 export 產物裡保留 debug 面板或 `?project=` 切換。

## 待使用者決定

1. **輸出目錄的位置慣例**：放在遊戲專案下（`<game>/dist/`）還是引擎的
   `artifacts/`？我建議前者——輸出物屬於遊戲，不屬於引擎。
2. **是否要求 export 前先跑 `verify`**。我建議要：輸出一個沒通過 gate 的遊戲
   沒有意義。但這會讓 export 依賴 analyzer 等工具鏈，需要確認。
