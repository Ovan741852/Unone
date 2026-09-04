# Issue: mobile FFI raw-payload boundary needs explicit ownership checks

日期：2026-09-05  
分類：Tooling / FFI contract  
狀態：resolved

## 觀察

新增 `unone-mobile-ffi` 時，第一版編譯先抓到 raw pointer 轉 UTF-8 `&str` 缺少明確 lifetime；修正後又由 compiler 指出 JSON parser 需要借用 `&[u8]`，不能直接把 owned `Vec<u8>` 當 slice 傳入。

## 判斷

這是 adapter 實作與 FFI ownership 問題，不是 engine architecture 問題。若保留不明確 lifetime，會讓 Kotlin/Swift 傳入資料的生命週期難以被 AI 或 review 判斷；不應用泛型 buffer abstraction 掩蓋它。

## 修正

- 所有 host payload 先在 FFI call 內複製成 owned bytes，避免 observation／runtime 持有 host memory。
- raw pointer helper 改為 `unsafe` 並明確記錄 pointer/length 前置條件。
- native touch 的高頻 path 使用 scalar `set_pointer`／`set_action`，不要求每幀 JSON；JSON `set_input_frame` 保留給 replay 與 automation。
- 加入 compile、native contract tests 與 Android target check，讓 ABI 變更先被 Rust compiler 及 lifecycle regression 捕捉。
