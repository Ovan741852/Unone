# Issue：engine package 同時裝了兩個版本的引擎

日期：2026-09-05

## 狀態

fixed

## 分類

architecture

## 症狀

`artifacts/unone-engine-package-87d264f` 裡的 `bin/game.exe` 支援 Decision 0030 的 anchor 版面，`web/runtime/unone_web_live_smoke.wasm` **不支援**，但 `package-manifest.json` 宣稱兩者都來自 commit `87d264f` 且 `source_dirty: false`。

一個只拿到這份 package 的子代理因此遇到：`game verify` **四個 gate 全部通過**，但同一個遊戲在 Web host 的 `Game.start` 直接死在
`LUAU_RUNTIME_ERROR: ui.setRoot expects a valid UI tree object: missing field \`rect\``。

更糟的是診斷把它指向錯誤的檔案：`likely_causes` 是「入口腳本的語法或 Engine API 呼叫不符合目前契約」與「腳本在 runtime 使用了不存在的 Entity 或欄位」。照著這個訊息走，作者會去重寫自己的遊戲，永遠不會發現是 host build 落後。子代理最後把 HUD 從 anchor 降級成絕對 rect 才繞過，也就是丟掉 0030 存在的全部理由。

## 根因

`scripts/pack-ai-engine.ps1` 從 `target/wasm32-unknown-emscripten/debug/deps/` 複製 wasm，只檢查**檔案存在**，不檢查它是不是和 CLI 同一版。打包當下那份 wasm 是 16:42 建的，anchor 是 22:46 才進 `ui.rs`——package 帶著一份落後六小時的引擎，還宣稱自己乾淨。

驗證：

```text
game.exe                    top_left=2  bottom_right=2  view_height=2
unone_web_live_smoke.wasm   top_left=0  bottom_right=0  view_height=0
```

## 修正

1. 重建 wasm host（`scripts/build-web-live.ps1`），重建後 `top_left=1 bottom_right=1 view_height=5`。
2. `scripts/verify-ai-engine-package.ps1` 新增 **CLI↔wasm 契約一致性檢查**：CLI 認得的 UI placement 標記，wasm 也必須認得，否則打包直接 throw 並指名要跑哪個腳本。這是 gate，不是文件。

## 回歸測試

拿出問題的那份 package 直接跑新的檢查，如實擋下：

```text
Engine build mismatch: bin/game.exe knows 'top_left' but
web/runtime/unone_web_live_smoke.wasm does not.
Rebuild the Web host with scripts/build-web-live.ps1 before packaging.
```

## 剩餘問題

`verify` 本身仍然只驗證 native build。package 檢查擋得住「打包出錯誤組合」，擋不住「host 有 bug 但契約字串一致」。真正的 host parity gate 仍未做。
