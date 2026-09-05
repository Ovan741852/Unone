# Decision 0023: generic Web game runner is a host adapter, not engine core

日期：2026-09-05  
狀態：accepted（3D Racing / RTS / Fish browser smoke）

## Context

`web/live/` 已驗證 bundle generation、IndexedDB cache、script hot reload 與 rollback，但它使用固定 smoke project。若每款驗證遊戲各自複製一份 Web loader，會造成 platform drift，也無法證明同一個 WASM runtime 能消費實際 game project。

## Decision

新增 `web/runner/` generic host：

- host 讀取遊戲端 `project.unone.json`、entry Luau 與 main scene。
- host 將 payload 交給既有 `unone_web_load_project`，不另建一套 simulation。
- host 每 frame 送完整 `InputFrame`；Rust/Wasm 用同一個 `tick_with_input` contract。
- host 消費 `WorldSnapshot` 的 2D/3D entity、semantic observation 與最小 UI tree。
- runner 以每個 project 獨立的 IndexedDB save store 做 durable host smoke；遊戲 schema/version/migration 仍由遊戲端，production storage 仍由平台 host。
- Web 端 3D 目前只渲染無 asset 依賴的 debug cubes，與 native preview 同屬 runtime contract evidence，不宣稱 production renderer。

## Why the input API changed

scalar pointer setter 只夠既有 pointer smoke，不能讓 RTS 的 `Select`、Fish 的 `Shoot` 或 Racing 的 `Accelerate` 透過 browser button/keyboard 重播。因此 Web ABI 新增 bounded JSON `unone_web_set_input_frame`；舊 scalar setter 保留給 focused pointer smoke，不在 engine core 另建 Web-specific gameplay API。

## Consequences

- 七款正式遊戲可以使用同一個 browser runner 做可視化 smoke；有 `bundle_manifest` 的專案會共用 content-addressed generation、IndexedDB cache 與 engine verifier。
- Web runner 只負責 project-root source URL resolution、fetch/storage adapter 與 host lifecycle；不處理 CDN、OPFS 大檔策略或 production asset streaming。
- 3D Racing 已驗證 manifest version 1→2、只變更 script hash、project/scene 仍沿用 cache，並在同一個 runtime 執行 script hot reload。
- Web bridge 的 runtime/load/reload failure 會保留結構化 `Diagnostic`；這改善 AI 可診斷性，但不等於遊戲內容或平台 final gate 通過。
- 這項證據仍不能把 final gates 改成 passed，因為完整遊戲規則、跨平台 game host、production bundle content update、production storage policy 與 mobile package/device smoke 尚未齊全。
