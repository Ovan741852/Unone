# Decision 0015：Live Web runtime 以窄 C ABI 跨 Emscripten 邊界

- 日期：2026-09-05
- 狀態：accepted

## Context

snapshot bridge 已驗證 WebGPU renderer 與 pointer normalization，但它不會真的把 browser input 送入 Rust/Luau simulation。`EngineRuntime` 不能直接暴露 Rust 型別、Lua handles 或 `Rc<RefCell<_>>` 給 JavaScript；同時，將 DOM、WebGPU 或 fetch 依賴放入 `unone-engine` 會污染 engine core。

## Decision

建立獨立的 `unone-web-live-smoke` Emscripten binary，透過最小、可觀察的 C ABI 連接 browser host：

- `unone_web_init() -> i32`
- `unone_web_alloc(length) -> *mut u8`
- `unone_web_load_project(ptr, len, seed) -> i32`（raw payload boundary，host 必須保證 pointer/length 有效）
- `unone_web_reload_script(ptr, len) -> i32`（raw payload boundary，host 必須保證 pointer/length 有效）
- `unone_web_set_pointer(x, y, down)`
- `unone_web_tick() -> i32`
- `unone_web_observation_ptr() -> *const u8`
- `unone_web_observation_len() -> usize`

ABI 只傳 primitive 與 UTF-8 JSON：project load 接收 host payload，observation 回傳 `{ project, world }` envelope。runtime ownership、Luau call、fixed timestep 與 world state 留在 Rust engine runtime，WebGPU、animation frame、DOM pointer event 留在 browser host。`tick_with_input` 是 ABI 內部唯一的 input/tick boundary。

第一版 binary 已改由 browser 提供 JSON project payload（project name、Luau source、scene）；頁面另提供一份 source reload fixture。這只證明 host-provided source/scene loader 與 script reload 的 ABI 生命週期，不宣稱 bundle fetch、generation activation 或 storage 已完成。正式通用 API 要等 project bundle source、error transport、generation/reload 與 memory lifetime 都有獨立測試後再提煉。

## Consequences

- browser input 現在能驅動同一份 Rust/Luau runtime，而不是由 JavaScript 偽造 simulation。
- snapshot pointer 在下一次 tick 前有效；host 必須立即 copy JSON bytes，不可保留 engine memory pointer。
- project/script payload pointer 只在對應 call 期間有效；Rust 端以 `unsafe extern "C"` 明確標示這個 FFI 前置條件，host 負責 buffer validity 與 length。
- ABI 中的 Rust `u64`（例如 seed）在 JavaScript 端必須以 `BigInt` 傳入，例如 `42n`；host 不可用可能失去精度的 Number。
- ABI 的錯誤以 return code + JSON error payload 回報，避免把 Rust panic 或內部型別暴露給 AI/host。
- 新增一個 smoke binary 是驗證工具，不是把 Web 平台功能變成 engine core；真實遊戲使用前仍需先完成通用 host loader。
