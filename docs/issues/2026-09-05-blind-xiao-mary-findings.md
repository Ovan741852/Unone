# Issue：小瑪莉盲測揭露的三個契約缺口

日期：2026-09-05

## 狀態

fixed（1、2、3），open（4：bundle install 無法一次啟用整個 generation）

## 分類

engine-contract

## 來源

一個只拿到 `GAME_PLAN.md` 與 immutable engine package 的子代理，在完全不讀引擎原始碼與其他遊戲的情況下做出小瑪莉（`D:/Projects/Unone_Games/xiao-mary`），六個 deterministic 測試全過，並回報下列問題。四項都已在引擎原始碼確認屬實。

## 1. `check --types` 是假的綠燈

`project init` 產生的樣板寫死 `type EngineApi = any`，所以官方 luau-analyze 對引擎 API 完全沒有覆蓋。子代理以負向控制證明 `api.entity.thisApiDoesNotExist(x)` 可以通過 `check --types`。

同時 `docs/engine.d.luau` 缺少 `entity.spawn`，`systems list` 宣稱的 `api.physics.setGravity` 在 runtime 根本不存在：三個真相來源互相漂移。

**修正**：Luau 型別契約移入 `crates/unone-engine/src/engine.d.luau` 成為唯一來源，`project init` 內嵌它（引擎 runtime 沒有 module require，單檔遊戲必須自帶型別），新增 `game api typings [--output]`，並以測試斷言 API 索引的每一項都有型別。`docs/engine.d.luau` 與 engine package 內的副本改為由該命令產生。

**回歸測試**：`api::tests::the_type_contract_covers_every_documented_api`，以及對新專案的負向控制（呼叫不存在的 API 必須讓 `check --types` 失敗）。

## 2. `load_save` 在 `Game.start` 之後才注入

`run_tests` 先 `load_with_seed`（載入時就呼叫 `Game.start`），之後才 `set_save_payload`。因此 `start` 裡 `api.save.get()` 永遠是 `nil`，而且在 `start` 裡呼叫 `api.save.set()` 會被注入靜默覆蓋。子代理有兩個測試因此失敗，且 `observation_digest` 與沒有 save 的情況完全相同，診斷沒有任何線索。

**修正**：新增 `load_with_seed_and_save` 與 `load_source_with_options`，payload 在建立 runtime 時就放進 save slot，`Game.start` 看得到。

**回歸測試**：`runtime::tests::a_restored_save_is_visible_inside_game_start`。

## 3. Web gate 在沒有 GPU 的機器上不可達

`web/runner/main.js` 的 `start()` 是 `init → loadProject → createWebGpuRenderer`；renderer 一 throw 就中斷整個 start，連帶 semantic state、UI layer 與 save store 都不可達，即使它們早就算完了。錯誤是 `{"error":"WebGPU adapter is not available","diagnostic":null}`，沒有 code、facts 或 suggested action。

**修正**：renderer 建立失敗不再致命，改為記錄 `renderer.available=false` 與原因並繼續執行；`renderer?.draw()`。實測在沒有 WebGPU adapter 的瀏覽器上，小瑪莉仍能載入 bundle generation 2、發布 37 節點 UI tree 與 save store。

## 4. `bundle install <id>` 無法一次啟用整個 generation（未修）

每次 install 建立**新的** generation 而非累加，也沒有 `--all`，因此 native 端無法讓 project+script+scene 同時 active。`ai-workflow.md` §4 教的 `bundle install base` 只對 minimal-2d 有效（只有它有 `base` bundle），文件沒有說明這是專案專屬。`BUNDLE_NOT_FOUND` 的 `suggested_actions` 是空的，違反本專案自己的輸出規則。

## 文件與教學更新

`docs/ai-workflow.md` 增補型別契約與 `load_save` 時機；`scripts/pack-ai-engine.ps1` 改為由 CLI 產生型別契約。
