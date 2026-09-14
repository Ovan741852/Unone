# 拖尾與粒子能力檢視 · 2026-09-12

範圍：目前 YesSir 正式匯出的網頁遊戲、其固定 WASM、以及本機 Unone 原生粒子源碼。這次只檢視、實測與整理設計，沒有改遊戲畫面或升級引擎。

## 現況

1. `main.luau:748` 的 `batches.trail` 是炮台與目前瞄準點之間 10 個等分位置，每幀重新計算，全部貼地、固定大小。它是瞄準點列，沒有部隊位置歷史、時間淡出或連續帶狀幾何。遠近瞄準改變時，點距一起變；槍兵的弧線飛行不會反映在這條地面線上。
2. 部隊 `actors.mjs` 只更新目前位置；`storybook-actors.mjs` 畫接地陰影與王腳下光圈，沒有部隊尾跡。
3. `combat-fx.mjs` 是短期事件幾何：閃電 4 段折線，其餘主要為 12 段擴散圓環。它沒有武器骨骼端點歷史，所以旋轉斬沒有真正跟著劍刃的掃掠拖尾。
4. YesSir 目前沒有呼叫 `api.particle.play` / `play_batch`；現有 Luau 火花透過 `instances3d` 發佈。不能把原生粒子 renderer 的限制直接當成目前遊戲效能問題。

## 引擎能力

| 能力 | 查到的支援 |
|---|---|
| JSON 定義與參數驗證 | 有，拒絕未知欄位與不合法值 |
| 種子、固定時間取樣、逐幀預覽 | 有；源碼含相關測試，這次沒有重跑 Rust 全套 |
| 顏色、透明度、大小 | 起點／終點線性插值，無多節點曲線 |
| 速度範圍、散佈、重力、壽命 | 有，屬解析式粒子取樣 |
| 多位置批次、停止、統計 | 固定 WASM 實測存在 play / play_batch / stop / stats |
| 連續帶狀拖尾 | 沒有現成公開 trail API，schema 也沒有 trail 描述 |
| 貼圖／圖集、UV 滾動、寬度曲線 | 原生粒子目前沒有 |
| 跟隨節點、距離採樣、軌跡切斷 | 原生 API 沒有現成控制；遊戲可自行提供採樣位置 |
| 粒子預算 | 64 個活動 handle、4096 預留粒子；計算整個 instance 預留量 |
| 網頁 GPU 批次 | 目前每顆一個 Sprite；實测 1/32/128 顆分別 1/32/128 draw calls |
| 原生桌面 GPU 批次 | 本機 wgpu 源碼已有依兩種混合模式分批，這次未執行該平台基準 |

固定 WASM `source_commit` 為 `147da2e46564e5b52f0ca96e8dd3baa0d79b1738`，manifest 標記 `source_dirty:true`，不能用 commit 單獨代表所有實際內容。API probe 結果：particle=table；play/play_batch/stats/stop=function；trail=nil。

本機 `docs/native-particles.md` 部分描述落後於原生桌面 renderer，例如 GPU instancing；以上以實際源碼與網頁實測分平台陳述，不把舊文件的限制套到所有後端。

## 建議分工與優先順序（待實作）

遊戲端負責觸發時機、兵種風格、採样來源、壽命和效果預算，不把碰撞、傷害與部隊運動移入 Rust。

1. 將瞄準點列明確命名為 aim guide，控制世界空間點距與可視性；槍兵另外顯示落點，不冒充飛行尾跡。
2. 劍兵少量短風痕；槍兵在空中留下短淡青尾跡，旋斬使用武器掃掠弧；騎兵使用短塵尾與穿透瞬間的亮線。怪物潮時減少普通尾跡，保留爆擊／穿透辨識。
3. 建議 Unone 的可重用呈現能力接收 position/time/break 的軌跡點，產生連續 ribbon，支援寬度／RGBA 曲線、世界與局部空間、材質／UV、深度遮擋、停止發射後殘尾消退。軌跡採樣策略可由遊戲選擇，renderer 不決定速度或傷害。
4. 測試高速彈牆折角、瞬移切斷、物件 ID 重用、停止／死亡殘尾、暫停／單步、15/30/60 FPS 外觀、容量上限與批次 draw calls。Web 粒子先補 GPU 批次，再擴大滿場拖尾數量。

## 證據

- [瀏覽器報告](trail-audit/browser-report.json)：真實輸入近／遠瞄準、槍兵飛行；另開隔離 WebGL scene 量測出貨版原生粒子 renderer。
- [槍兵飛行畫面](trail-audit/spear-flight.png)：實際飛行 y=0.943，地面瞄準點仍保持貼地。
- 重現網頁檢查：`node _Games/ashen-legion/tools/audit-trails.cjs`。
- 源碼：`main.luau`、`presentation/combat-fx.mjs`、`dist/web/web/renderer/particles.js`；引擎 `crates/unone-engine/src/particle.rs`、`crates/unone-engine/src/api.rs`、`crates/unone-native-player/src/particles.rs`。
