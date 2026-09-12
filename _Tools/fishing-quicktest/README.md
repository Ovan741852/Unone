# 漁機快測 · Unone

獨立本機網頁工具，直接載入森林領主的正式 WASM／Luau 及 Blender／Animator／Lottie 資產。雙擊 Start.cmd 或執行 `node _Tools/fishing-quicktest/serve.mjs`，開啟 http://127.0.0.1:8194/ 。Node.js 與支援 WebGL2 的瀏覽器即可使用，已匯出遊戲位於 ../../_Games/ashen-legion/dist/web。

## 操作

六個情境均以正常輸入快進，可暫停後接手；怪物潮用種子 2。選兵種、按住連射、LOCK／AUTO、小怪／王篩選、購買與穿裝均送 InputFrame。按鈕不在每幀重建，避免按下／放開跨幀遺失。獲獎 Lottie 限定在場景內，不擋側欄。

回歸列表為 19 個現行案例。舊 90 秒及保底通關案例已留在遊戲 tests/legacy-90sec，沒有當成新規則通過。正常速度試玩後可填三題評分，匯出逐幀輸入、種子、腳本指紋與筆記；重播限 120,000 幀／50 MB，必須相同 scriptHash。

數值比較可選九流派、三兵種裸裝基線或單一策略，1／3／10 個連續種子。策略 v4 會購物、裝備、研究、附魔、使用藥水及開箱；劍兵先取得低價穿透，再補流派技能。每局最多 90,000 幀，截斷要明確列 censored，不能算勝敗。

## CLI 整局與城鎮養成

從工作區根目錄執行：

```powershell
node _Tools/fishing-quicktest/balance-cli.mjs 3 91 survival,thunder,rebound sample-builds
node _Tools/fishing-quicktest/balance-cli.mjs 8 201 cyclone sample-campaign campaign
```

格式為：種子數、起始種子、逗號分隔策略 ID、報告名稱，最後可加 campaign。後者保存每個策略各自的真實城鎮存檔，下一次出征先用建設金購買升級；不編造金幣、裝備或命中。JSON 寫到 evidence。更多策略：momentum、cleave、frost、frenzy、embers，以及 sword／spear／cavalry 裸裝基線。

[現版數值報告](evidence/BALANCE-REPORT-V2.md) 分開列不同操作策略與城鎮進度，不能混成玩家勝率。初始經濟、裝備成本、旋轉倍率、小怪破防成長均已實際調整；所有怪物仍可抽空。

## 檢查

`node --test _Tools/fishing-quicktest/replay.test.mjs`：重播格式、未知斷言、上限和指紋。`verify-browser.mjs` 使用 Playwright／Edge，驗 19 案例、重播匯出再匯入觀察相同，以及正常速度 AUTO。若執行環境無預設 Playwright，設定 PLAYWRIGHT_MODULE 為已安裝模組的完整路徑。

伺服器僅 GET 且預設監聽 loopback；資料來源可指定另一份相同遊戲專案。場景 adapter 專供這款遊戲，未做原生 EXE，也不是任意 Unone 遊戲通用模擬器。四人網路壓測尚不在此版本範圍。
