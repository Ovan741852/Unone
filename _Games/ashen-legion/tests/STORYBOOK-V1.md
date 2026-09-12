# 森林繪本美術調整 v1

對應 `docs/reviews/2026-09-11-gamedesignos/VISUAL-CAVALRY-V1.zh-TW.md` 的四項檢視。遊戲規則仍在 Luau，本次修改資產、正式 Canvas UI 與遊戲呈現。

## 完成項目

- 森林改為深冷綠陰影與較暖的草地亮面，補齊遠端樹冠、苔地、疏落草花和不規則樹影色塊；石牆與炮台增加冷色對比。25 × 25 正方形碰撞、鏡頭和固定玩家位置維持。
- 正式 UI 使用原創 SVG 製成的金邊旗幟、朱紅選中狀態，以及劍盾、長槍、戰馬、手動、鎖定、自動、貨幣圖示；商店、地圖等頁面共用新材質。短橫向螢幕調整 HUD 大小，仍由官方 Canvas 控制與命中測試，不引入 HTML 遊戲按鈕。
- 普通獎保留既有 3D 金幣噴灑、落地停留與飛回玩家，倍率改成局部有底色的標籤，最多同時四個；全場最多三個主要目標標籤。
- BIG／MEGA／LEGENDARY 使用金框、切角、折疊戰旗與金色字體陰影的 Lottie 演出；三份新動畫均透過官方 `lottie.install` 驗證與安裝。普通獎不能中斷大獎，較低獎級不能蓋掉較高獎級。
- 部隊新增綁在現有動畫骨架上的兵種配色披風、頭飾、盾牌和長柄武器；已有裝備武器繼續顯示。騎兵戰馬加大，士兵坐高配合馬體；怪物保留既有 Blender 造型與動作，小王／次王／大王增加不同色的腳下標记。接觸陰影讓角色更貼地。
- 降低原本過亮的角色補光，增加冷色輪廓光；Bloom 保留，啟用既有 SSAO。釘選匯出 renderer 原本未轉送 `setAO`，由 `finish_export.mjs` 做有明確錨點、可重入的單行 API 接線；沒有修改引擎源碼或重寫 AO 演算法。

## 驗證與證據

- Unone `check --types` 通過。
- 官方 `ui preview --strict`：12 頁、零 findings。只列明具名底圖、圖示與控制項的預期重疊；沒有整體關閉重疊檢查。最終兵種卡片尺寸另重跑 battle strict。
- 實際 Canvas 點擊：主畫面、地圖、選擇、商店買裝、換裝、符文、流派、戰場按住派兵、LOCK/AUTO、篩選、暫停通過。
- `verify-storybook.cjs`：1440 × 900、1280 × 720、844 × 390 截圖與矩形範圍檢查通過；圖示操作不會誤射、零 page errors、零 UI asset diagnostics，渲染指標確認 Bloom 與 AO 均啟用。
- `verify-storybook.cjs --horde`：種子 42 不注入狀態、不射擊，等待自然事件；第 1 波新增 72 隻，場上至少 90 隻怪，目標標籤最多三個，沒有瀏覽器錯誤。這是可見密集場景驗證，並非手機 FPS 或整局效能保證。
- `verify-reward-presentation.cjs`：普通獎局部呈現、BIG、MEGA、LEGENDARY、優先級保護通過。此項使用獨立呈現元件的合成事件，不是實際開獎機率或經濟證據。
- 50 項技能 WASM 案例與三兵種正式連射回歸通過，騎兵 8 秒壽命、20 穿透與雙倍移速保持。

實際戰鬥：`../storybook-battle.png`。自然怪物潮：`../storybook-horde.png`。手機橫向：`../storybook-844x390.png`。大獎元件測試圖：`../storybook-mega-fixture.png`。原始結果：`storybook-browser.json`、`storybook-horde.json`、`storybook-rewards.json`、`formal-layout/summary.json`。

美術生成順序：`build_art.py` → `build-formal-ui.mjs` → `style-rewards.mjs` → `finish_export.mjs`。若重建原始設計動畫，需再執行 `style-rewards.mjs`；不要重新安裝另一版本的引擎來重建這些美術。
