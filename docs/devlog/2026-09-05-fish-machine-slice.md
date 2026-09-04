# Fish Machine validation slice

日期：2026-09-05

這一輪建立 Fish Machine business slice，使用既有 2D transform、pointer、fixed tick、observation、UI/save transport；Luau 負責瞄準、魚移動、血量、捕獲、獎勵、coins、ViewModel、UI 與 save schema。沒有新增 `Fish`、`Cannon`、`Capture` 或 arcade 專用 engine API。

`check --types` 與 3 個 deterministic tests 通過：單發捕獲、兩魚 replayable capture、versioned save restore。這證明即時瞄準與捕獲的第一個閉環可留在遊戲端；完整魚種／武器／倍率／房間規則、真實 asset、bundle、跨平台 host 與 durable save 仍未完成，因此矩陣只更新為 `in_progress`。
