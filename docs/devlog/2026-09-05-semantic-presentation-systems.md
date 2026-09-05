# Semantic presentation systems

日期：2026-09-05

## 目的

老虎機需要「能轉、能開獎」之後再加骨骼動畫與特效。Spine 與 Effekseer 都是各平台的 C/C++ runtime；把它們放進 engine core 會讓引擎同時承擔骨骼求值、粒子模擬與四個平台的 renderer，完全不管又會讓遊戲自己維護一份沒人看得到的動畫狀態。

## 實作

- scene entity 新增可選 `animation`（asset/animation/loop/speed），snapshot 帶 `started_frame`。
- `api.animation.play`／`stop`（system `spine`）、`api.effect.spawn`／`stop`（system `effekseer`）；兩者預設關閉，狀態 `host_required`。
- `world.effects` 是目前存在的特效實例；handle 依建立順序決定，同時上限 256 個。
- asset manifest 支援 kind `spine`／`effekseer`，`AssetSpec` 新增 `files` 宣告附屬來源，與 source 打進同一個 bundle。
- `game asset read --id <id> --file <declared file>`；未宣告的檔案回報 `ASSET_FILE_NOT_DECLARED`。
- 測試新增 `animation` 與 `effects` assertion，做完整 JSON equality。
- `api search` 可找到 `animation.play`／`effect.spawn`；`engine.d.luau`、scene schema 與 test schema 同步更新。

## 驗證

```text
cargo clippy --workspace --all-targets -- -D warnings   PASS
cargo test --workspace                                  PASS (新增 2 個 presentation 測試)
slot-machine: check --types / test / asset inspect --strict / bundle pack / asset read  PASS
```

老虎機四個 deterministic test 全部通過，其中兩個直接 assertion 表現狀態：三軸分別在第 31、46、61 frame 由 `spin` 切回 `idle`，中獎時 `effect-1` 在第 61 frame 生成於 (0, 1)。Spine skeleton 與 atlas 都能由已啟用 generation 取出並回報 verified sha256。

## 已知限制

- 沒有任何 host 會播放：native preview、Web runner 與 Android host 都還不會畫 Spine 或 Effekseer。本輪不得說成「支援 Spine／Effekseer」。
- 老虎機的 Spine／Effekseer 資產是明確標示的 placeholder 檔，只用來走通 asset／bundle／archive 契約，不是真實美術資產。
- 動畫事件與「播完通知」都還沒有契約。

## 決策與下一步

此輪採用 Decision 0028。下一步讓 Web runner 先接上 spine-webgl 與 effekseer.js，用同一份 snapshot 播放，再回頭判斷語意層缺什麼。
