# Declared engine systems

日期：2026-09-05

## 目的

讓遊戲能宣告「我要用哪些引擎系統」，AI 也能先搜尋再決定。先前每個專案都會付出 2D 物理積分成本，即使老虎機、AVG、自走棋完全沒有剛體；子代理也無法回答不需要的機制能不能關掉、關掉會失去什麼。

## 實作

- `project.unone.json` 新增可選 `systems`：`{"physics2d": false}`；未宣告者使用引擎預設。
- 新增 `systems` 模組：system descriptor（id、summary、status、預設值、是否可關閉、Luau API、observation 欄位、關閉後果、何時該關閉）與 `SystemSettings` 解析。
- CLI `game systems list|search|set`，MCP `unone_systems_list`／`unone_systems_search`／`unone_systems_set`（工具數 15 → 18）。
- 三種設定直接失敗：`SYSTEM_UNKNOWN`、`SYSTEM_NOT_OPTIONAL`、`SYSTEM_NOT_IMPLEMENTED`。
- 關閉 `physics2d` 後 `tick` 不再呼叫 `step_physics`；被關閉系統的 Luau API 仍存在，呼叫時回報 `SYSTEM_DISABLED` 並附重新啟用命令。
- `spine` 與 `effekseer` 以 `not_implemented` 狀態進入清單：有位置、有說明，但不能啟用。

## 驗證

```text
cargo clippy --workspace --all-targets -- -D warnings   PASS
cargo test --workspace                                  PASS (新增 5 個 systems/runtime 測試)
scripts/mcp-smoke.ps1                                   PASS (18 tools)
```

實際套用在老虎機驗證專案：`systems set --id physics2d --enabled false` 寫入 `project.unone.json` 後，三個 deterministic test 仍通過且 observation digest 完全不變（該遊戲本來就沒有剛體），`systems list` 也如實顯示 `physics2d enabled=false source=project`。

## 已知限制

- `api.entity` 的 3D transform 不受 `camera3d` 開關影響；gating 只涵蓋 `api.camera3d`。
- `camera3d` 預設維持開啟，避免既有驗證遊戲在未宣告時改變行為。
- Web/mobile 的記憶體載入入口尚未接收專案 `systems` 宣告，一律使用引擎預設。

## 決策與下一步

此輪採用 Decision 0027。下一步先定義 Spine／Effekseer 的 asset kind 與 host runtime 契約，再談實作；老虎機的視覺轉動與開獎表現會是第一個消費者。
