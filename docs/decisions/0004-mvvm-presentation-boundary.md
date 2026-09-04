# ADR 0004：MVVM 用於 UI/presentation，不統一整個引擎

日期：2026-09-05  
狀態：accepted

## 決策

Unone 採混合架構：ECS + systems 負責高頻遊戲模擬；Luau MVVM 負責 UI、畫面流程、對話、商店、任務面板等 presentation。引擎只提供最小 UI node、binding、observable/command primitive；ViewModel 由遊戲業務端定義。

## 原因

MVVM 的明確 state → projection → view 邊界適合 AI inspect、typed context、command generation 與測試；但把 physics、transform、Entity simulation 也包成 ViewModel 會增加同步、分配與生命週期複雜度，偏離遊戲引擎的必要責任。

## 邊界規則

- View 不直接修改 ECS 或執行遊戲規則。
- ViewModel 是 Luau 的 typed、可序列化 presentation projection。
- Commands 必須有名稱、輸入、前置條件、結果與 diagnostics。
- Binding 必須明確宣告且可清除；不做全域 magic two-way binding。
- 引擎不擁有遊戲的 ViewModel、screen flow 或 domain state schema。

## 重新檢視條件

若三個以上驗證遊戲證明相同 UI binding/command 問題反覆出現，才擴充 engine UI primitive；若只是單一商店、對話或戀愛流程，留在遊戲端。
