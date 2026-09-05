# Web 缺少可共用的 canonical digest 入口

日期：2026-09-06。狀態：engine_verified / web_source_smoke_verified；package 仍待重新發行。

分類：engine-contract / architecture。來源：roadmap #14 Luna / max 子代理。

## 事實

在 `c2029bf` 所依據的引擎，`EngineRuntime::run` 內部計算 observation digest；
Web snapshot envelope 沒有可直接使用的公開 canonical snapshot digest helper。
Web 顯示若自行複製 hash/serialization 規則，之後可能與 CLI 漂移。
以 `run(0)` 取得 digest 則將唯讀 observation 與 run 行為耦合。

首次回報時子代理停止依賴此契約的接線工作；使用者決策後已恢復並完成。

## 使用者決策

使用者明確答覆：「抽出」。採用共用 Rust snapshot digest 函式，CLI 與 Web
共用，保留原有序列化和 hash 定義。

core helper 與 run report 接線由原 core Luna / max 子代理統一寫入；Web
Luna / max 子代理消費公開函式。主代理已完成實作審查與回歸，見
`docs/devlog/2026-09-06-digest-integration.md`；Claude review 因額度不足待補，
使用者已批准先提交。

公開契約：`unone_engine::observation_digest(&WorldSnapshot)` 回傳
`Result<String, serde_json::Error>`。只讀取傳入 snapshot，使用相同 JSON bytes
與 `sha256:` 小寫 hex 格式；不觸發 tick/run，不改變 seed、frame、trace 或效能統計。
序列化失敗回報錯誤，不把空 buffer 的 hash 當成正常結果。
