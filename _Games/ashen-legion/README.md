# 森林領主 · Unone 漁機肉鴿

目前可玩版、使用方式與驗證範圍見 [RUNTIME-STATUS.md](RUNTIME-STATUS.md)。歷史 90 秒版數值已淘汰，保留於 README-legacy.md，不可作為現版規格。

在專案根目錄執行 `./Start-Game.ps1` 開啟正式遊戲。已匯出版本包含官方 Animator、Lottie、Blender 士兵與怪物、換裝及九流派。

- 遊戲：http://127.0.0.1:8190/
- 快測：執行 `node _Tools/fishing-quicktest/serve.mjs`，開啟 http://127.0.0.1:8194/
- 紙娃娃：http://127.0.0.1:8192/
- 怪物動畫：http://127.0.0.1:8190/presentation/creature-lab.html

所有遊戲規則在 main.luau。presentation 只讀取 observation 播動畫及粒子。更新規則後執行 `node _Games/ashen-legion/tools/finish_export.mjs` 同步匯出，再跑 verify-rpg.mjs、verify-skills.mjs 及 run-json-tests.mjs。

美術與技能總索引：[design-v1/delivery-manifest.json](design-v1/delivery-manifest.json)。技能規格：[design-v1/BUILDS-V2.md](design-v1/BUILDS-V2.md)。數值快測：[BALANCE-REPORT-V2.md](../../_Tools/fishing-quicktest/evidence/BALANCE-REPORT-V2.md)。
