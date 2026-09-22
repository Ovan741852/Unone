# Wuxia Sandbox performance smoke

日期：2026-09-19

專案：`_Games/wuxia-sandbox`
目的：區分「demo gameplay 慢」與「preview／工具 host 慢」。

## 實測

### Headless release

`target/release/game.exe --project _Games/wuxia-sandbox --json perf --frames 1200 --seed 42`

- 54 entities、21 UI nodes、19 observations
- mean frame：`0.163 ms`
- median frame：`0.116 ms`
- p95 frame：`0.192 ms`
- frames over 16.667 ms budget：`0`
- slowest frame：`1.925 ms` at frame `180`
- phase total：script `57.533 ms`、physics `0.078 ms`、observe `77.487 ms`、serialize `60.405 ms`

這次加入關係圖與同場事件後，script phase 仍只有 `0.048 ms/frame`；600-frame deterministic smoke 產生 102 段關係、98 次合作、6 次謀財、4 次吃醋、2 對結婚與 1 起害命。主要成本仍是 observation／canonical serialize，而不是 Luau 行為本身。

### Native preview release smoke

`target/release/game.exe --project _Games/wuxia-sandbox --json preview`

- current 40-person build successfully resolved the SVG palette (`256x16`)
- preview still reports flat-rectangle rendering; this is a presentation limitation, not the Luau simulation path

## 結論

本 demo 的 Luau NPC simulation 不是目前的 lag source。先前使用的是 `target/debug/game.exe`，並且開著 native tools panel；Unone 文件也明確提醒 panel 會輪詢並有 inspection/rendering overhead。實際遊戲感受應使用 release player，測量時關閉 panel；需要面板時再開。

## 給 Unone 的最小優化建議

1. `preview` 增加 `--no-tools`，或讓 `--tools-port 0` 的語意明確表示「不啟動／不輪詢 companion panel」，避免使用者看到 debug panel 就誤判遊戲 FPS。
2. preview 視窗內直接顯示 `runtime_ms / render_ms / dropped_steps / build profile`，不要要求使用者另外開 localhost panel 才能判斷卡頓。
3. 開發面板預設採 adaptive polling：無互動時降低頻率，按下 Profile／Console／工具時才提高；面板 collapsed 時完全停止 polling。
4. native preview 目前回報「textures decoded」但仍畫 flat rectangles；應在啟動畫面清楚標示「semantic／flat preview」，避免使用者把 preview 畫面或卡頓誤認成最終 3D renderer 表現。
5. 保留目前 headless `perf` 的 phase breakdown；它已足夠證明這個案例不是 gameplay bottleneck，不需要先為 NPC 加 cache、thread 或 Rust rewrite。
6. 如果多個遊戲都需要相同的 UI pointer-to-node picking，再提供 engine-level hit-test primitive；目前單一遊戲用 `getScreenPointerPosition()` 在 Luau 命中自己的宣告 rect，成本低且可 replay。

不建議目前為這個 40-NPC slice 引入 jobs／多執行緒或把 Luau 規則搬到 Rust；現有量測顯示低頻 Luau 批次與 staggered decision 已遠低於 frame budget。若未來把人口提高到數百、或加入真正的障礙物導航，再以 profile 結果決定是否把可重用的導航 primitive 放進 engine。
