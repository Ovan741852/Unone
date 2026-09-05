# Decision 0027：遊戲宣告要用哪些引擎系統

日期：2026-09-05

## 背景

引擎的系統一直是隱性的：每個專案都會付出 2D 物理積分成本，即使是老虎機、AVG、自走棋這種完全沒有剛體的遊戲；反過來，`api.camera3d` 這種只有 3D 專案需要的能力，也對所有遊戲永遠存在。子代理只拿到 engine package 與企劃時，無法回答「這個遊戲需要哪些系統」「不需要的能不能關掉」「關掉會失去什麼」。

## 決定

`project.unone.json` 新增可選的 `systems` object，值是每個 system id 對應 `true` 或 `false`：

```json
{
  "name": "SlotMachineValidation",
  "systems": { "physics2d": false }
}
```

引擎擁有 system 清單、預設值，以及關閉後實際會改變什麼。未宣告的 system 使用引擎預設。

新增 operation：

- `game systems list` / `unone_systems_list`：列出每個 system 的 id、summary、status、預設值、是否可關閉、擁有的 Luau API 與 observation 欄位、關閉後的後果，以及目前生效值與來源（`default` 或 `project`）。
- `game systems search "<用途>"` / `unone_systems_search`：依語意找 system，和 `api search` 同一個習慣。
- `game systems set --id <id> --enabled <bool>` / `unone_systems_set`：只寫入該遊戲自己的 `project.unone.json`。

三種設定會直接失敗，不會靜默通過：

- `SYSTEM_UNKNOWN`：引擎沒有這個 id；typo 不會被當成「關掉某個系統」。
- `SYSTEM_NOT_OPTIONAL`：`world`、`input`、`observation` 是 runtime 的必要部分。
- `SYSTEM_NOT_IMPLEMENTED`：只有契約、沒有實作的 system 不能啟用（目前是 `spine`、`effekseer`）。

關閉的效果是真的：

- `physics2d` 關閉後，`tick` 不再呼叫 `step_physics`，剛體維持 scene 初始值。
- 被關閉系統的 Luau API 仍存在，但每次呼叫都會回報 `SYSTEM_DISABLED`，並附上重新啟用的命令。刻意不把 table 移除，因為 `attempt to index nil` 對作者沒有資訊。

## 邊界

`systems` 是「引擎提供的機制要不要跑」，不是遊戲設定檔。遊戲數值、關卡、內容 catalog、難度、營運開關仍留在遊戲端。engine 不提供 per-entity 或 runtime 動態開關；一個 system 在整個 session 內只有一個狀態，讓 deterministic replay 與 digest 比對仍然成立。

## 原因

- 讓「這個遊戲不需要物理」變成可宣告、可驗證的事實，而不是靠註解或口頭約定。
- 讓 AI 能先 search 再決定，而不是猜引擎有什麼。
- 讓尚未實作的能力（Spine、Effekseer）有明確位置與明確拒絕，而不是散在文件裡的願望。

## 已知限制與下一步

- `api.entity` 的 3D transform 目前不受 `camera3d` 開關影響；gating 只涵蓋 `api.camera3d`。
- `camera3d` 預設維持開啟，避免既有驗證遊戲在沒有宣告的情況下改變行為；純 2D 專案應明確關閉。
- 記憶體載入的 host 入口（Web/mobile 的 `load_source`）目前一律使用引擎預設，尚未接收專案的 `systems` 宣告。
- `spine` 與 `effekseer` 只有 descriptor，下一步要先定義 asset kind 與 host runtime 契約，再談實作。
