# Issue: 3D Racing steering fixture used the wrong distance expectation

日期：2026-09-05  
範圍：業務端 test expectation

## Symptom

30 frames 的 `Right` input 預期 lateral position `1.033`，實際 observation 是 `2.0`。

## Root cause

遊戲端規則是每 frame `4 * (1/60)` 的 lateral movement；30 frames 的可重播結果就是 `2.0`。這是驗收 fixture 的算術錯誤，不是 3D Transform3D contract 或 engine stepping 錯誤。

## Fix

將測試 expectation 改為 `2`，並保留 deterministic digest。若規格未來改變轉向速度，應先更新遊戲端規則與測試，再判斷是否存在 engine-level blocker。
