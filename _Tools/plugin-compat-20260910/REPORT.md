# YesSir UI / Shader plugin compatibility inspection

2026-09-10；只做現有 inspect / self-test，未更換 SDK、未改遊戲或重跑長 parity。

| 插件 | 版本 / commit | Manifest / 入口 | 自測 |
|---|---|---|---|
| org.koncrate.unone-ui | 0.4.0 / 8a695dbf19b88840a6bf1fdc0a3c27c87c12fc78 | D:/Projects/UnoneUI/plugin.json / plugin.mjs | 22/22，exit 0 |
| org.koncrate.unone-shader | 0.1.0 / e27e45bc22a0705221dd5de7309c32caf7467bdb | D:/Projects/Unone-shader/plugin.json / plugin.mjs | 核心 4/4、capabilities 5/5，exit 0 |

兩 repo 工作樹乾淨；manifest 與 entry SHA256、CLI 路徑／hash 保存在 summary.json。各 inspect/self-test 完整回應另存同目錄。

剩餘配套問題：

1. 沒有設定 UNONE_PLUGIN_PATHS 時，這次以最新 Core CLI、YesSir game root 發現的只有 Blender / Lottie。UI / Shader 必須在當次 process 明確指定 `UNONE_PLUGIN_PATHS=D:/Projects` 才可 discovery；並非專案自足、已 pin 的安裝。此次只設定子程序環境，沒有更改使用者全域設定。
2. 正式遊戲目前使用 Core 官方 canvas-ui.mjs，UI Components 是 authoring contract 工具；不能把 UI 插件自測等同 native UI 整局驗收。已交付副本 hash `c85035eb90af6694b45fbed9ce027e6dd6b37d880ce146e99cff7f9a2869c332`；目前 Unone checkout 副本為 `c63ed0505d92b9f04a2730c2645431d6297f01af05b720e179fe311c74cd58e4`。來源已更新，遊戲仍保留前次驗證版本；本輪未自動升級。
3. Shader Workshop 是 WGSL 開發工具；這款可玩版本使用 three-webgl / WebGL 著色器與 Bloom/AO，不會在 runtime 載入 shader plugin.mjs。其 self-test 證明工具協定與 capability 判斷可用，不代表已驗證 WebGL 著色器、native SVG 或 native 全遊戲效果。

結論：現有 UI / Shader 工具在明確 discovery root 下可 inspect、自測全過。仍需以版本鎖定或相容組合描述，串起 Core renderer 副本、CLI、runtime 與 authoring plugins；僅插件 semver 不能保證整組一致。
