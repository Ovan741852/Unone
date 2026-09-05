# 2026-09-06 — Roadmap 分工啟動

使用者指定：主代理規劃、Luna / max 子代理製作，有問題必須問使用者。
本輪從乾淨的 master `d7cae90` 開始；目前 roadmap 20 項待辦，七款 final gate
仍是 in_progress，總驗收 not_passed。

已派兩項工作：Web observations/digest 實作、2D transform/layer 契約準備。
模型均明確指定 `gpt-5.6-luna`、`max`。引擎製作與後續 package-only 遊戲盲測
分開派工；目前尚未派出本輪遊戲盲測。

2D scale 對碰撞體的關係曾向使用者提出問題。使用者已答覆「碰撞體獨立設定」，
已記入 Decision 0034，並通知原 Luna / max 子代理開始 core production code。
物理不隨顯示 rotation/scale 改變；本輪測試須分別驗證物理結果與顯示 snapshot。
完整依賴與驗收見 `docs/execution-plan.md`。交接文件同步加入使用者決策步驟。

首次派工尚無新的執行畫面；後续 digest 整合已補實測截圖與回歸，見
`docs/devlog/2026-09-06-digest-integration.md`。

Web 子代理回報 canonical digest 入口不足，已立即詢問使用者。使用者答覆
「抽出」，已指派原 core writer 提供共用 Rust 函式，Web writer 接線。
問題記於 `docs/issues/2026-09-06-web-canonical-digest-entrypoint.md`。

core 子代理指出派工漏列 embedded canonical 型別檔；已補正至其 API/typing
寫入範圍，繼續同步 embedded 與 docs 契約。此為派工路徑更正，沒有新增遊戲規格。
