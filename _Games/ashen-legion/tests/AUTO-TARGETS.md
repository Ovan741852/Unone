# AUTO 怪物選單 · 2026-09-12

入口：`http://127.0.0.1:8190/?build=fire-toggles-v1`。LOCK、AUTO 是獨立開關，沒有手動選項；兩個都關時按住戰場派兵。

- 十種怪物可複選；馬是坐騎，沒有列入攻擊目標。卡片顯示真實模型縮圖、類型、場上數量；未出現的種類可預先勾選。
- 全選、清空、只選小怪（四種）、只選王（四種）、只選奇遇（聚寶甲蟲／金鈴狸）。快捷鍵會取代草稿，之後可繼續逐隻增減。
- 開啟時暫停目前單人戰鬥。按「開始自動」提交草稿；空選擇無法提交，直接發送語意 action 也無法繞過。
- 自動瞄準最近的指定種類，目標死亡／消失後重新選取。場上沒有勾選種類時等待，不派兵；自然生成後恢復自動射擊。已發射部隊仍遵守原本碰撞／穿透，可能打到其他怪物；LOCK 保持只傷害指定目標。
- AUTO 關閉時點擊會開設定，確認才開啟；AUTO 開啟時再點直接關閉。修改勾選走獨立「選擇目標」按鈕（`Auto_settings`）；取消／Esc 保留兩個開關與原設定。「關閉 AUTO」只關 AUTO。
- LOCK 可獨立開／關，開啟後點怪物鎖定並射擊。LOCK + AUTO 同時開：AUTO 尋找勾選種類，LOCK 使新派部隊只傷害該鎖定目標。關其中一個保留另一個；兩個都關才停止自動派兵。既有部隊保留發射時的鎖定設定。
- 選擇與開關跨回合保留，新遠征重設全選並關閉兩個開關。未加入存檔偏好或未來多人暫停協定。`fireMode` 僅是舊快測的相容 observation，以 `lockEnabled`／`autoEnabled` 為準；舊 `Mode_manual` 保留為快測關閉兩項的 action，正式 UI 沒有該按鈕。
- 正式 UI 走 Luau `api.ui.setRoot` 與官方 Canvas，橫向五欄兩列、直向兩欄五列。JS 僅處理排版、同一命中樹的進場動態、按壓效果與輸入清理。沒有新增引擎能力或 Rust 遊戲規則。

## 資產與程式

`main.luau` 的 `autoSpecies` 是可選種類和群組來源，`autoInput` 處理草稿、暫停與提交，`targeting` 檢查已提交的種類。`ui/formal-ui.luau` 產生正式介面；用 `tools/build-formal-ui.mjs` 重建並嵌入 main。

十張 `assets/formal-ui/target-*.png` 由 `tools/build-target-portraits.cjs` 渲染正式 `assets/creatures/art-v2/*.glb`，使用遊戲描邊和左右暖／冷色光。勾選與卡框有可編輯 SVG。獨立快測只鏡射正式 UI 的語意控制，不另寫一套選怪規則。

## 驗證證據

- `auto-targets-runtime.json`：正式 WASM、真實輸入，八項情境；包含等到最後 30 秒大王自然出生、選定種類／重新選怪、取消草稿、按住不重複切換、空選擇阻擋、停止、一般暫停與 LOCK。每幀檢查金幣、成本、部隊與邊界守恆。
- `fire-toggles.json`：七項開關情境，驗證可同時啟用、互不關閉、取消／停止不影響 LOCK、長按只觸發一次、兩項關閉後停止派兵。另用只讀觀察檢查實際部隊的 targetId；LOCK + AUTO 綁定目標，AUTO 單開不綁定。
- `auto-targets-browser.json`：五種尺寸 1440×900、844×390、390×844、768×1024、320×568；真實 Canvas／觸控操作、縮圖載入、無按鈕重疊、開關無誤射、空選擇禁用、缺少目標等待、動態與縮放。對應畫面 `auto-targets-<尺寸>.png`。
- `tools/verify-skills.mjs`：50 項技能檢查及三兵種透過 AUTO 選單派兵，通過守恆與接觸檢查。
- `tests/current-results.json`：前一版 AUTO 圖卡實作的 19 個回歸重播紀錄；本次開關驗證以上述專項與技能測試為準。
- `tests/formal-layout/summary.json`：Unone CLI strict UI preview，含 AUTO 全選／空選擇畫面；檢查越界與非宣告重疊。
- `tests/expedition-ui/report.json`：既有 65 個頁面／尺寸樣本、購物、配裝、暫停和 motion 回歸通過。
- `../../../_Tools/fishing-quicktest/evidence/auto-selection.json`：獨立快測入口實際點選、提交一種怪物、重新開啟還原勾選、停止自動通過。

重現：先執行 `node tools/build-formal-ui.mjs`、`node tools/finish_export.mjs`，再執行 `node tools/verify-auto-targets.mjs` 與 `node tools/verify-auto-ui.cjs`。模型縮圖重建需遊戲靜態服務提供 GLB 與 Three 模組。
