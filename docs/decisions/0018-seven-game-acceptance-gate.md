# Decision 0018: 七類遊戲作為最終驗收閘門

日期：2026-09-05  
狀態：superseded by [ADR 0002](0002-seven-game-acceptance-gate.md)

> 本記錄與 ADR 0002 是同一天、同一個決策的兩份記錄，內容一致。
> ADR 0002 是英文正本，符合「engine-authored guidance 用英文」的規則，
> 後續引用請指向 0002。此檔保留為歷史記錄，不再獨立維護。

## 決策

Unone 只有在以下七類遊戲都完成可玩的驗證版本，並具備可重播測試、AI 開發閉環、跨平台 smoke、問題回饋與必要證據時，才可宣稱引擎完成：

1. 3D 賽車
2. 紅色警戒式 RTS
3. 刀塔傳奇式放置戰鬥
4. AVG 戀愛遊戲
5. 自走棋
6. 老虎機
7. 魚機

`D:/Projects/Unone_Games/validation/acceptance-matrix.json` 是業務／驗證 workspace 的驗收來源；`D:/Projects/Unone/scripts/validate-game-matrix.ps1` 是唯讀檢查器。任何正式 gate 未通過時，檢查器必須 fail closed，不能用 compile、截圖或 Angry Birds 2D 的中期 smoke 取代。

## 邊界

驗收矩陣與檢查器屬於 validation tooling，不是 Rust engine core。引擎只提供被多個遊戲證明必要的 runtime mechanism、Developer Protocol、測試與語意診斷；每款遊戲的規則、數值、內容、ViewModel、流程與驗收報告留在 `Unone_Games`。

MVVM 仍只放在遊戲端的 UI/presentation boundary。高頻模擬使用 ECS + systems，不為了讓七款遊戲共用而把業務模型或 ViewModel 塞進引擎。

## 變更規格時

若七款遊戲的範圍或驗收條件改變，先更新 matrix schema 與本決策／devlog，再讓檢查器反映新規格；不保留已證明錯誤的 gate 定義，也不為舊矩陣維持相容層。

## 為何現在加入

沒有機器可檢查的 final gate，很容易把中期 demo 誤報成引擎完成，也無法清楚知道下一個阻塞屬於遊戲邏輯、引擎契約、架構或 tooling。矩陣先固定完成標準，實作仍依真實遊戲阻塞逐項增加必要能力。
