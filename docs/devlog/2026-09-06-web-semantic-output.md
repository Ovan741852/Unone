# Web runner semantic output

roadmap #14 的 Web runner 現在把引擎語意狀態完整暴露給 host：

- Web ABI snapshot envelope 保留 `project`、`world`、`save_payload`，並新增 Rust `observation_digest`。
- `write_snapshot` 對傳入的同一個 `WorldSnapshot` 呼叫 `unone_engine::observation_digest`；沒有在 Web/JavaScript 重造 hash，也沒有用 `run(0)` 取得指紋。
- tick 使用 `EngineRuntime::tick_with_input` 回傳的 snapshot 直接發布，避免再次 observe 造成 frame/digest 不一致；load、save injection 與 reload 各自只發布其當下 snapshot。
- generic runner 的 semantic output 顯示完整 `world.observations`、snapshot `frame` 與 Rust digest；空 observations 保持 `{}`。原有 project、generation/assets/input/save 顯示不變，DOM 狀態輸出仍使用 `textContent`。
- 失敗 reload 維持結構化 diagnostic，不偽造 digest；舊 runtime 可繼續 tick。

本輪回歸涵蓋 Web ABI 的 load/tick/reload frame、完整 observations、digest 格式、changed state digest 變更、成功 reload 同 frame digest 保持、失敗 reload diagnostic，以及 Web envelope 與 engine public run report 的 parity。另有無 GPU/DOM runtime 依賴的 semantic projection regression。

## 驗證

- `cargo fmt --check -p unone-web-live-smoke`：PASS。
- `cargo test -p unone-web-live-smoke -- --nocapture`：PASS，4 tests。
- `node web/runner/semantic-output.test.mjs`：PASS，Node v24.14.1；純 semantic projection 不需要 GPU、DOM 或 IndexedDB。
- `node --check web/runner/main.js` 與 `node --check web/runner/semantic-output.test.mjs`：PASS。
- `git diff --check`（本輪 Web 檔案）：PASS。

Node v24.14.1 不接受舊的 `--experimental-default-type=module` 旗標；regression 改用 `.mjs` 直接執行，結果相同且已通過。

尚未在本輪宣稱 Emscripten/WASM rebuild、實際 browser page 或 WebGPU parity；由主代理負責獨立整合驗證與 review。
