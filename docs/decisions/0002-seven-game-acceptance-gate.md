# ADR 0002：七種遊戲是引擎的正式驗收 gate

日期：2026-09-05  
狀態：accepted

## 決策

Unone 只有在以下七類遊戲都完成可玩的驗證版本，且各自通過功能、deterministic test、AI 開發閉環、平台 smoke test 與開發紀錄要求後，才算長期目標完成：

1. 3D 賽車
2. 紅色警戒式 RTS
3. 刀塔傳奇式放置戰鬥
4. AVG 戀愛遊戲
5. 自走棋
6. 老虎機
7. 魚機

憤怒鳥 2D 是中期的第一個驗證遊戲，不是最終通過條件。

## 通過證據

每款遊戲要有：可重建專案、主要玩法、至少一條 headless regression test、AI 可操作的 inspect/edit/reload/run/observe/diagnose 閉環、對應平台 smoke test，以及附截圖的 devlog/issue records。

## 原因

七類遊戲涵蓋 2D physics、資料驅動流程、數值模擬、RNG、board rules、大量 Entity、RTS/networking 與 3D/車輛物理。逐項通過才能證明這是遊戲引擎，而不是只適合單一 demo 的腳本框架。

## 重新檢視條件

若某類遊戲的範圍需要重大縮減，必須記錄可接受的「驗證版本」定義與仍未驗證的能力；不能把未完成項目標成通過。
