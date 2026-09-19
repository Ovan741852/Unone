# Koncrate 預覽 bootstrap 交接

由 Koncrate 任務 `01a0a002-992a-7683-8b04-1415559ee26f` 交接，限遊戲本身的載入畫面及錯誤狀態。屬於遊戲 host 的呈現邏輯，沒有新增引擎能力或修改玩法。

`index.html` 在模組圖下載前顯示進度條。未知總量使用不定進度，模型及首屏圖片總量確定後，列出真實已完成／總檔案數。已知檔案完成、首幀尚未準備好時回到不定進度；不捏造整體百分比。

首屏圖片由實際排版及 motion 後的 UI tree 取得，正常動態首屏含 6 個不同圖片（包括螢火微粒）；模型為 89 個（77 裝備、士兵與 11 怪物）。數量由載入器計算，沒有硬編碼成進度。

只向直接的 `window.parent` 發送顯示狀態，`targetOrigin=location.origin`：

```json
{"type":"koncrate-preview-content","state":"error","message":"首屏圖片載入失敗：texture://ui_expedition-keyart-v2"}
```

只有第一次 boot error 發訊號；錯誤文字移除 HTTP(S) URL 並限 220 字。未帶 token 或導航命令，也未新增訊息接收器。另發 `loading`／`ready`，已進遊戲後的 runtime 錯誤不當作 boot error 重送。單獨執行仍保留既有錯誤與重試 UI；messagebox、確認後退出由 Koncrate shell 負責。

驗證：`tools/verify-preview-bootstrap.cjs` 通過模組延遲時進度可見、首屏圖片延遲時真實計數、成功首幀、同源 iframe 中真實圖片 503 失敗、恰好一則 error、無額外欄位、重複錯誤抑制。`tools/verify-first-screen-browser.cjs` 的冷啟動、每请求 80ms 延遲、圖片故障及重試也通過。

證據在 `tests/preview-bootstrap/report.json`、`indeterminate.png`、`known-files.png`、`parent-error.png` 與 `tests/first-screen/browser-report.json`。已重新匯出到 `dist/web`；未替此交接提交 dirty repo。

## 場景與部隊同時準備

原本 renderer 的 onReady 等候 89 個模型完成後，第一次 draw 才開始下載 6 個場景 mesh，mesh 解析後再抓 2 張材質。arena.mesh.json 約 1.87 MB；部隊顯示 89/89 並不代表這 8 份場景資源已開始。

host 現在於模型整備開始後立即建立 renderer 並在載入遮罩後 draw 一次，讓場景、天空及部隊平行下載；仍等待 renderer.ready、全部部隊／獎勵及首屏 UI 圖片一起就緒，才繪製並開放首幀。排除 legacy prototype 實例，不新增額外舊模型請求。第一個正式 draw 使用 dt=0，避免把下載等待時間灌入角色及入場特效；玩法與 UI 入場演出維持原設計。

載入文案新增森林場景與天空、部隊與遠征演出、繪製第一幀三階段；觀測新增 sceneStart、sceneReady、actorsReady、rewardsReady、firstDrawStart、firstDraw。既有不定／真實計數進度與同源 error 訊號不變。

`tests/first-screen/parallel-scene-comparison.json` 保存前後實際 Resource Timing。一次配對本地冷啟動：無延遲 847.8 → 840.7 ms；每請求額外 80 ms 為 2362.1 → 2151.9 ms（減少 210.2 ms）。後者場景在部隊完成前約 998.4 ms 就緒，模型完成至首幀等待從 310.1 降為 104.5 ms。前後皆為同 6 個場景 mesh + 2 張材質，總位元組相同，沒有額外 prototype 模型。這是無頻寬限制的本地樣本，不能聲稱遠端 22–35 秒全部由此修正。

`tools/compare-preview-bootstrap.cjs` 驗證上述請求集合、時序及首幀遮罩。修改後冷啟動／80 ms 延遲、真實圖片 503 + retry、同源 iframe 單次 error 與 ready gating 測試均通過。已重新匯出 dist/web；未 commit。
