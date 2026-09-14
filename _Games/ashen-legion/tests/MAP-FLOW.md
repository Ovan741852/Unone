# 遠征地圖流程更新 · 2026-09-10

遊戲所有權：地圖階段、前進時間與景點解鎖在 Luau；沿用 Unone 官方 UI，沒有新增 engine 規則。

出征先進入 map，1.5 秒平滑前進一格後才產生景點選項。每關結算的 Next 前往下一站，同一遠征的配裝與金幣沿用；第七關沿用最終勝利流程。地圖與整備不計戰鬥時間。查看地圖不重新抽建築。退出仍是放棄整趟遠征，新增確認，城鎮保留。

新增原創 SVG / PNG 森林路線圖、三種節點、領主棋子，共五組圖。

驗證：19 個 JSON 回歸、Luau 嚴格型別、十一頁官方 strict UI 排版、99 個 RPG fixture、25 個技能 fixture 通過。遠端 HTTPS 官方 Canvas 真實滑鼠操作涵蓋前進、抵達、地圖返回、買裝、裝備、戰鬥及退出取消，無 page error。七站抵達另由 verify-formal-flows.mjs 驗證。舊 release / parity 與 72 局數值報告屬更新前證據，本次沒有重跑完整數值調參。

截圖：formal-ui-map.png、formal-ui-map-arrived.png、formal-ui-choice.png、formal-ui-abandon.png。
