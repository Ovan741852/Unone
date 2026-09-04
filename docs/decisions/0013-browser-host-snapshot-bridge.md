# Decision 0013：Browser host 先接 engine snapshot，再接 live frame loop

- 日期：2026-09-05
- 狀態：accepted

## Context

`unone-engine` 已能編譯成 Emscripten library，且一次性 Web runtime smoke 已能在瀏覽器執行；但目前沒有把 Rust runtime 的 frame loop、瀏覽器事件與 WebGPU canvas 接在一起的穩定 ABI。若此時把 `wgpu`、瀏覽器 DOM、fetch、Cache Storage 與 Emscripten glue 直接放進 engine core，會同時引入多個尚未驗證的生命週期與平台耦合。

## Decision

第一個 WebGPU host slice 使用 `game run --json` 產出的 `WorldSnapshot` 作為明確 bridge contract：

- engine/CLI 產出可序列化的 world state；
- browser host 擁有 WebGPU adapter/device/canvas 與 render loop；
- browser host 把 pointer event 轉成與 native 相同的 world-space `{ position, down }` semantic frame；
- snapshot 來源、fetch 與後續 storage/cache 政策留在 host，不加入 engine core；
- 以 `scripts/export-web-host-snapshot.ps1` 重新產生 fixture，避免手工複製 state。

這一版明確不宣稱 live WASM game loop、browser input 已驅動 Rust simulation，或 Web storage adapter 已完成。那些需求要在 bridge contract 穩定後，另做可測量的長生命週期切片。

## Consequences

- 可以先獨立驗證 engine snapshot → WebGPU rendering、canvas resize 與 semantic pointer conversion。
- native 與 Web 共用資料契約，而不是共用不適合所有 host 的視窗實作。
- 目前 snapshot 與 runtime 是兩個時間點；不能把本頁的 pointer event 當成遊戲 simulation input。
- 只有當 live loop 的 ABI、reload safe point 與 host ownership 有測試證據後，才把它提煉為正式 Web runtime API。

