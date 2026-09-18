# Legion Fall Web 10,000 單位實跑報告（2026-09-18）

## 結論

本次沒有產生可用的 FPS 數據：目前工作樹版本在瀏覽器初始化 renderer 時即停止，尚未進入戰鬥。這是可重現的啟動阻塞，不應把舊的 60 tick/s 結果當成本次版本的驗證。

## 實驗條件

- 專案：`_Games/legion-fall`
- 匯出：`node _Games/legion-fall/export.mjs`（development player）
- Runtime：release WASM，`source_commit=3a075db2949aeb36aa1b885a5c10256f93ee9ad9`
- 編譯系統：audio、camera2d、camera3d、input、observation、particle、random、save、ui、world
- 瀏覽器：Chrome，headless，1280×720，WebGL SwiftShader
- 匯出 release generation：`5ab995e0a8543a19f1ecdfe5e7c0d763732bac4f471834f122b8420e18d659c5`
- 工作樹：dirty（未提交變更存在）

## 啟動證據

頁面狀態：`THREE.DataTexture is not a constructor`

堆疊指出：

1. `web/renderer/particles.js:20` 呼叫 `new THREE.DataTexture(...)`。
2. Player 使用的 `web/vendor/three/three.player.min.js` 沒有輸出 `DataTexture`（只輸出 `CanvasTexture`、`DepthTexture`、`TextureLoader` 等）。
3. 因 renderer 建立失敗，頁面沒有 `playerFrame`、`battlePerformance` 或 10,000 單位控制項；因此本次 FPS／tick／掉 tick 均為 **N/A**。

這不是「FPS 不足」，而是 renderer bundle 與 particle renderer API 不相容。應先修正 bundle 或使用已包含的 texture 路徑，再重新跑完整 60 秒實驗。

## 最近一次可用基線（非本次版本）

`docs/legion-fall-round4.md` 的先前瀏覽器複測為：完成引擎 tick 5,184（60.0/s）、掉 tick 0、WASM tick+publish p95 15.60 ms、renderer CPU p95 3.40 ms，但繪製間隔 p95 24.3 ms。因此當時也只能判定「模擬 60 tick/s」，不能宣稱穩定 60 FPS。

## 發版門檻

- renderer 初始化成功且無 page error
- 10,000 單位持續至少 60 秒
- tick rate 約 60/s、掉 tick = 0
- RAF／繪製間隔 p95 ≤ 16.67 ms 才能宣稱穩定 60 FPS
- 同時保留 runtime、project、renderer bundle 的版本與雜湊

## 修正後複測

修正兩個發版阻塞後重新匯出：

1. 重建 `web/vendor/three/three.player.min.js`，納入 `DataTexture`。
2. 修正 `_Games/legion-fall/export.mjs`，讓 overlay／recording 從 release base URL 正確解析到 export root。

Chrome 有 GPU 的可見瀏覽器視窗，1280×720，10,000 單位，65 秒：

| 指標 | 實測 |
|---|---:|
| renderer 啟動 | 通過，無 page error |
| 取樣數 | 65 |
| FPS min / median / max | 49 / 57 / 57 |
| frame interval p95 | 17.65 ms |
| RAF interval p95 | 18.0 ms |
| dropped steps | 0 |
| WASM bridge p95 | 4.5 ms |
| renderer CPU p95 | 1.5 ms |
| GPU timer p95（bloom off） | 5.46 ms |
| 戰鬥狀態 | 20 Hz，64.6 秒仍 running |

因此本次修正已恢復可執行與可觀測性，並較舊基線的 24.3 ms p95 改善；但 17.65 ms 仍略高於 16.67 ms，結論是 **接近 60 FPS，尚不能宣稱穩定 60 FPS**。headless SwiftShader 另測會被軟體渲染限制到約 2 FPS，不作硬體能力結論。
