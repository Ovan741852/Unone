# 遠端模型載入修復 · 2026-09-10

使用者 iPhone 圖片顯示 `遊戲載入失敗：fetch for ...`，全文被 pre 水平截斷。此字串來自 Three FileLoader 的非成功 HTTP 回應；圖片未顯示完整 URL/status，因此不宣稱知道手機那次是哪個模型或精確狀態碼。前一輪實際遠端測試已重現代理 502，Python host 已改 HTTP/1.1 與 backlog 128。

本輪：遊戲角色／裝備 GLB 同時最多下載 4 個；408/429/502/503/504 與網路 fetch 失敗最多嘗試 3 次，404 或模型解析錯誤立即失敗。錯誤畫面在手機寬度下換行、可捲動，不再截掉路徑。沒有變更遊戲規則或使用替代假模型。

`node tools/verify-download-recovery.cjs` 已通过：實際 Tailscale HTTPS、393×852 viewport、攔截 beetle.glb 第一次回 503，第二次成功進主畫面；404 只請求一次並顯示完整可讀錯誤。這是桌面 Edge 的手機尺寸與網路失敗注入，不能等同真 iOS Safari 實機驗收。
