# Issue: UI JSON assertions confused integer and floating-point spellings

日期：2026-09-05  
分類：Test contract / semantic serialization  
狀態：resolved

## 重現

AVG 的 Luau UI rect 使用 `x = 10`。引擎將 Luau number 以 `f64` 序列化成 JSON `10.0`，但 test fixture 的 `10` 會被 `serde_json` 保留為 integer；直接比較 `serde_json::Value` 時，pointer UI test 失敗，雖然座標語意相同。

## 判斷

這不是 AVG hit-test 邏輯，也不是需要把座標型別暴露給遊戲的架構問題；是 UI assertion 越過 typed contract、直接比較 JSON representation 的 test boundary 問題。

## 修正

- `ui.equals` 先通過與 runtime 相同的 `UiTree::from_json` validator。
- assertion 改比較 typed `UiTree`，讓 `10` 與 `10.0` 具有相同座標語意。
- 不放寬一般 observation 的 schema；只有已知的 UI contract 使用 typed comparison。

## 回歸證據

- `unone-engine` UI validation tests 通過。
- AVG `check --types` 與 4 個 test cases 通過。
