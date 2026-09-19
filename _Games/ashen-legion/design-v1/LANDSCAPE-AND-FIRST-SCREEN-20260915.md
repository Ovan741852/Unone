# 強制橫版與首屏載入

遊戲主入口只使用橫版。直向視窗由 browser host 將整個 stage 順時針旋轉 90 度，沒有轉向提示、確認、orientation lock 或 fullscreen 權限要求。戰場、Canvas UI、姓名／傷害／金幣、大獎、輪盤與寶箱都在同一個 stage。橫直切換保留當局，釋放按住輸入；原本的手動暫停狀態保持。

螢幕點擊先反算為 stage 的橫向座標，再交給官方 Canvas UI hit test、LOCK 距離比對與相機射線。世界投影回傳橫向畫布像素；`ashen.projectClientPoint()` 提供實際瀏覽器座標。Safe area 隨旋轉重新映射。

所有變更都是本遊戲的瀏覽器呈現與載入整合；沒有新增引擎能力、變更 Luau 遊戲規則或碰撞場地。

## 首屏

依 Koncrate 任務回報，一併修正自訂 host 的空白等待及逐張出圖：HTML 提供即時載入狀態、經過秒數及錯誤後重新載入。模型 manifest 同時讀取，89 個部隊／怪物／裝備模型以共用上限 6 的佇列與 runtime 並行準備，仍全部準備好才開放操作。

讀取 runtime 的真正初始 UI tree，只預解碼該畫面的 6 張圖。將已解碼圖片交給官方 Canvas UI resolver，第一幀資產狀態全部 ready、完成繪製後，才設定 `data-ready=true`、發出 `ashen-ready` 並拿掉載入層。沒有修改官方 renderer / canvas-ui 的實作。

## 證據

- `tools/verify-landscape-browser.cjs`：390×844 自動旋轉、真實 touch 選單／槍兵發射／AUTO、旋轉保留戰鬥與暫停、放開停止射擊、安全邊距、1440×810、所有效果圖層。槍兵測試瞄準 (3,2)，實際約 (2.9999992,2.0000005)。另以凍結 receipt 檢查 BIG WIN、LEGENDARY WIN 與輪盤的旋轉尺寸。
- `tools/verify-first-screen-browser.cjs`：全新 browser context、正常與每請求模擬 80 ms 延遲、ready 時 6 圖全數完成且未重抓、77 裝備／11 creature 完整、缺少首屏圖時顯示錯誤及重試成功。報告在 `tests/first-screen/browser-report.json`。
- 使用 Koncrate 相同 `audit-export.cjs` 的模擬伺服器重新量測：每請求 80 ms、無限頻寬，ready 約 3,193 ms；前次 audit 約 4,199 ms。這是本機模擬，不能推論實際手機或 WAN 速度。本次 ready 還包含完整首屏繪製。169 requests，約 13.507 MiB；沒有宣稱減少首屏下載總量。
- 尚未處理 GLB 重複內嵌 atlas、圖片重新壓縮、依場景延遲模型載入；目前仍完整載入模型，避免進入戰鬥缺少 actor。

已重新產生 `dist/web`；本次沒有 commit 或 push。
