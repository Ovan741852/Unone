# 九宮格／UI 預算驗證紀錄

日期：2026-09-20；Unone 基底 `39d8ee17c04d9ad141c584313314cdef7ff91b98` 加本次工作區改動。
UnoneUI 契約版本 0.5.0，Core UI contract v2。不是既有已發布 SDK 的能力宣告。
工作區原有其他未提交改動，未代為提交、推送或部署。

## 結果

- 單張 PNG／SVG 的 `image.slice`，Core 只記一個節點；Web Canvas、developer DOM、native 路徑接上。
- 256 硬限制改為共享的 screen 預算；JS／Luau plugin、工具 input schema、Core schema 與 Web host 一致。
- 實際 Luau 發布 3000 個節點成功；未給明確預算時回報超限；失敗發布保留前一畫面。
- 原始 UI 內容／動作未為預算刪除；正式圖框外觀保留，沒有整張拉伸替代九宮格。
- Impeccable 的效能流程用於保留既有外觀及前後量測；一次機械 detector 為空，不等同美術或裝置驗證。另有實際瀏覽器截圖／點擊驗證。

## 實際遊戲差異

對照既有 8190 預覽與此次獨立匯出；数字是當頁的邏輯節點／載入資產數，不是 FPS。

| 畫面 | 舊節點 | 新節點 | 舊載入資產 | 新載入資產 |
| --- | ---: | ---: | ---: | ---: |
| 主選單 | 41 | 17 | 21 | 5 |
| 存檔 | 87 | 33 | 30 | 5 |
| 商店 | 155 | 75 | 65 | 17 |
| 詳情 | 174 | 92 | 65 | 16 |

主選單與商店的非切片節點 ID 未增減。**對照限制：**既有 8190 匯出略落後於作者端，
存檔／詳情還有先前按鈕背景／命中區變化，不能把這兩頁所有差異都歸因於本次修改。
舊切片 PNG 留在作者資產目錄作歷史資料，沒有刪檔；正式 manifest 移除 63 個切片宣告。
現有 export script 仍複製整個美術目錄，因此這不是「交付包縮小 63 張圖」的宣稱。

## 執行過的測試

| 測試 | 結果與範圍 |
| --- | --- |
| Core `cargo test -p unone-engine --lib -j2` | 259 通過，3 個既有 ignored 未當作通過；含預算、九宮格幾何、診斷工作量與生成 schema |
| CLI `cargo test -p unone-cli --bin game -j2` | 54 通過；含正式匯出與已存在的配套測試 |
| Web `node --test web/shared/*.test.mjs` | 26 通過；來源 crop drawImage、失敗診斷／清除、預算 |
| UnoneUI `npm test` | 27 通過 |
| 遊戲 `game --project _Games/ashen-legion test --json` | 回傳 ok=true、無 diagnostics；使用專案宣告的 19 個既有測試 |
| UnoneUI `node tests/luau-contract.mjs <fresh game.exe>` | 真正 Core Luau 執行，3000 節點、超限、保存上一有效畫面、單節點九區域、inspect |
| Native 全部 lib tests | 19 通過，GPU 測試預設 ignored；另明確執行 GPU test 通過 |
| Native release nine-slice test | PNG 與 SVG，各三種尺寸的九區域像素檢查通過；PNG 濾波容許單通道 ±3，Core 幾何斷言不放寬 |
| `scripts/verify-ui-slice-dom.mjs` | 真正 Edge，PNG／SVG × DPR 1/2 × 300×100/100×300 共 8 組；含 resize、無效來源錯誤、3000 DOM 節點／舊錯誤清除 |
| `scripts/verify-ui-slice-browser.mjs` | 最終 WASM 匯出，真實滑鼠 Start→存檔→出發→商店→詳情；4 張截圖、零 asset 診斷／pageerror |
| 遊戲 `verify-all-screens.mjs` | 98 組畫面／狀態通過，使用實際 Luau/WASM 狀態與官方 Canvas；不是自然玩完所有流程 |
| `verify-shop-components.cjs` | 29 組通過，含 4 種 viewport、長文字、購買／重抽、動畫／四角檢查 |
| `verify-shop-accessibility.cjs` | 5 組通過，含鍵盤、模態焦點、Esc、停用商品、touch 點擊與留黑邊座標 |
| 最終 Web release build | 5-frame CLI/WASM parity；缺音效／改物理重力負例會被檢查抓出 |
| 最終交付檔案檢查 | `game-final/export.json` 中 1790 個檔案逐一驗證 bytes 與 SHA-256，零不符；包含現有 exporter 保留的歷史／重複資產，不等於已做包體最佳化 |

第一次最後檢查抓到新增 UI contract 欄位後 schema 未更新，已重生並重跑 Core 全綠，
不是跳過 schema gate。插件 tool manifest 殘留 256 亦已修正，sync gate 現在檢查它。

## 原生容量壓測（release，不是 FPS）

測試尺寸 300×300；大量 2×2 設計單位、可重疊的九宮格面板，每次完整 CPU 重繪。
這是單次基準樣本，不是 p95、不代表真實遊戲場景，不與 debug 建置比較成優化倍率。

| 節點數 | Core 驗證 ms | Native CPU raster ms |
| ---: | ---: | ---: |
| 256 | 0.2743 | 14.0163 |
| 2048 | 2.2143 | 141.1666 |
| 4096 | 5.7064 | 331.9158 |

容量已解鎖，但 native 大量變動 UI 仍受 CPU raster 限制。未變更的 tree 沿用現有快取；
未來若實務大量逐幀面板成為瓶頸，再依這些探針調整增量／GPU UI。沒有宣稱 4096 面板 60 FPS。

## 證據與重跑

本機證據根目錄：`C:/Users/liNao/AppData/Local/UnoneBuildCache/ui-slice-20260920/`。

- `evidence/baseline-report.json`、`evidence/migrated-report.json`：原始對照與截圖。
- `final-evidence/final-report.json` 與 `final-{menu,profiles,shop,detail}.png`：最終匯出確認。
- `dom-evidence/dom-report.json`：DOM 像素／DPI／尺寸測試與截圖。
- `all-ui/report.json`、`shop/components-report.json`、`shop/accessibility-report.json`。
- `release-evidence/native-benchmark.json`、`native-nine-{png,svg}-*.png`。
- 最終 `runtime-final/runtime.json`：WASM SHA-256 `87dc2d715c2c3eaf0c4988d7636daef1236e8350dcdd8bbad07ace80aa13245f`。
- JS SHA-256 `1365a54841b987d6b49697b5b891139332f6c1a56e8f565bd99dd8c06377f418`；WASM 2,664,890 bytes、release、source_dirty=true。
- Luau 真實探針：`C:/Users/liNao/AppData/Local/Temp/unone-ui-contract-8hAiVR/result.json`。

瀏覽器腳本需要 Playwright 與 Edge；DOM 腳本可用 `UNONE_PLAYWRIGHT_MODULE`／
`UNONE_BROWSER_CHANNEL` 指定環境。遊戲腳本以 `GAME_TEST_URL`、`GAME_TEST_EXPORT`、
`GAME_TEST_EVIDENCE` 指向隔離 export／證據目錄，不覆蓋歷史驗收。
Native 以 `UNONE_UI_EVIDENCE_DIR` 指定輸出，再執行：

```text
cargo test --release --manifest-path crates/unone-native-player/Cargo.toml --lib ui::tests::nine_slice_pixels_and_budget_benchmark -- --nocapture
cargo test --manifest-path crates/unone-native-player/Cargo.toml --lib ui::tests::gpu_png_cjk_transparent_button_surface -- --ignored
```

## 未驗證／不能宣称

BlueStacks 只成功讀到 ADB 裝置；開測試頁的命令遭執行環境拒絕，**未完成 Android 實機／模擬器畫面驗證**。
本次也未驗證 iOS／macOS。桌面 Edge 的 DPR／viewport 測試不等於手機 WebView 測試。
未更新 Viewer 安裝程式、正式 SDK 或遠端部署；使用新 API 的專案須帶上此次匹配 runtime。
