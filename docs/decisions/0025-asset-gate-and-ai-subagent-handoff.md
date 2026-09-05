# Decision 0025: explicit asset gate and isolated AI game handoff

## Context

AI 需要知道 asset inspect 的 warning 是否阻止打包，也需要能只靠 engine build output 與一份企劃開始製作遊戲。模糊的 warning、沒有 schema 或讀其他遊戲實作，會讓不同 agent 各自發明 host workaround。

## Decision

- asset inspect 是 authoring advisory，回傳 ready_for_packaging、結構化 blockers 與 static_reference_scope facts。
- asset inspect --strict 與 bundle pack 是 canonical static asset gate；未解決的主場景 reference、source 或 manifest contract 會 ok=false。
- manifest version 固定為 1；asset kind 目前只有 texture2d、mesh3d。新增 kind 必須先更新 engine/host contract，不接受 typo 或未知版本的靜默 fallback。
- asset init 是唯一最小的 manifest bootstrap/append tool；它不建立、猜測或下載 source。
- AssetManifest/AssetSpec 是跨平台資料 contract。filesystem discovery、canonical path、CLI/MCP inspect 與 init 是 developer-tool operation；Web/mobile host 不需要走 project filesystem。
- 每一個子代理只拿 immutable engine package 與一份 game plan。遇到 API、文件、host、跨遊戲或架構 blocker 必須立即回報主代理並留下 blocker record，再繼續不受影響的工作。

## Rejected

- 讓每個 host 自己解析 warning severity。
- 把 AssetManager、CDN、GPU resource lifetime、遊戲 catalog 或遊戲規則放進 engine core。
- 用另一款遊戲的 Luau 當 implicit SDK。
