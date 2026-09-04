# Issue：Angry Birds replay fixture 與 test manifest 不一致

- 日期：2026-09-05
- 範圍：validation game／AI workflow
- 狀態：已修正

## 現象

`angry-birds-2d` 的 test manifest 內嵌 `input_sequence`，所以 `game test` 通過；手動 replay 命令引用的 `tests/launch-sequence.json` 卻不存在。

## 判定

這是驗證專案與教學 fixture 的一致性問題，不是 physics 或 runtime architecture 問題。若只看 test 結果，會漏掉 AI 實際操作命令不能重播的問題。

## 修正

新增 `tests/launch-sequence.json`，並在遊戲 README 固定使用同一份 replay fixture。之後若 test 與手動 replay 需要不同案例，應明確命名與各自驗證，不依靠隱含資料。
