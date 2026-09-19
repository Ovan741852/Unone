# 技能特效美化 / 2026-09-14

已接入正式遊戲：`http://127.0.0.1:8190/?build=skill-vfx-v1`。

本次屬於遊戲呈現層。Luau 決定觸發、命中、半徑與傷害，Three 只讀取回報；沒有加入 Rust 遊戲規則。

## Skill 試用與安全範圍

- 使用 [Three.js Procedural VFX](https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills/tree/8328fd4b4c6ea70e7aa632d82a6125c75fac4a5c/skills/threejs-procedural-vfx)，固定 commit `8328fd4b4c6ea70e7aa632d82a6125c75fac4a5c`，MIT / Scott Sun。
- 透過 Codex 官方 skill-installer 的 download 模式安裝到本專案；未執行來源 repo 的 npm / npx 安裝器。
- 人工閱讀 SKILL.md、agents/openai.yaml、procedural-vfx-system.md、reentry-plasma.js 與 LICENSE。所選目錄共 30 檔（含補入 LICENSE），逐檔保存 SHA-256，其餘附例做靜態敏感指令／網路存取掃描。命中的 curl 為流體旋度變數／註解，網址為 SDF 維基引用。
- 所讀指令未要求讀取憑證、上傳資料或執行外部命令；附帶範例不進遊戲執行。這不是整個 upstream repo 的全面安全保證。來源鎖定表在 `.agents/skills/threejs-procedural-vfx-source-lock.json`，原始審查下載保留在 `tests/vfx-skill-review/`。
- 實際採用：事件包絡、同源方向、剪影／亮芯／殘留分層、固定 GPU buffer、效果預算、局部亮度階層、無 Bloom 驗證、診斷視圖。未照抄太空尾焰與體積火焰的參數。
- 使用心得：對結構、穩定性與光效預算有幫助；美術造型仍需依本遊戲的低模繪本風格另做並在遊戲中反覆看。

## 已完成

| 類型 | 舊呈現 | 新呈現 |
| --- | --- | --- |
| 雷鏈 | 白色單線 | 固定實際命中兩端的藍白電弧、短分岔、末端亮芯 |
| 碎冰 | 換色圓圈 | 放射冰晶、裂線、碎冰消散 |
| 爆炎 | 換色圓圈 | 酒紅剪影、琥珀火舌、短亮芯、餘燼 |
| 葉旋 | 換色圓圈 | 翠綠葉片、葉脈短光、旋出殘留 |
| 追加斬擊 | 換色圓圈 | 收尖的新月斬痕、酒紅底、金色刃 |
| 震波 | 換色圓圈 | 青綠分段外擴震波、稀疏碎屑 |
| 落地旋轉 | 粗完整圓環 | 隨實際進度旋轉的青白刀光，半徑讀取技能快照 |
| 命中／爆擊 | 一般方塊粒子 | 短斬痕；爆擊加金色星芒與碎光，沿用實際傷害字 |
| 移動拖尾 | 間歇方塊 | 收尖短帶、反彈切斷歷史、空中高度依實際部隊 |
| 技能局部光 | 每種皆強黃光 | 依元素配色、0.32 秒衰減、降低亮度 |

派兵、反彈、回復與出獎碎光有對應呈現。3D 金幣及大獎 Canvas / Lottie 演出保留。被動數值技能仍共用回饋，不代表所有 45 技能均有獨立動畫。

## 驗證

- `verify-skills.mjs`：50 個實際 Unone WASM 技能斷言通過，三兵種正式連射通過。
- `verify-vfx-parity.mjs`：3 兵種各 700 tick，共 60 個採樣点的金錢、接觸、穿透、爆擊、怪物狀態及遊戲階段與修改前一致；新增只讀旋轉半徑／進度／時鐘驗證。
- `verify-vfx-polish.cjs`：深凍結輸入、同時鐘重畫、GPU buffer 重用、300 事件／250 部隊預算、反彈斷尾、過期／跨回合清理、dispose、正式 AUTO 槍兵射擊、暫停、390×844 reduced motion 與零瀏覽器錯誤。
- VFX 最多 2 draw calls、36 個主事件、64 個拖尾儲存槽；桌面最多 48／窄螢幕 24 個部隊取樣；兩批 buffer 共 78,000 頂點上限。超過預算省略視覺，遊戲結算不變。
- 為桌面 Edge 與手機尺寸模擬，未測實體手機或宣稱特定 FPS；其他模型／UI 成本不包含在 2 draw calls 內。

## 影像證據

`tests/vfx-polish/`：

- `before-game.png` / `after-game.png`：正式場景固定時鐘／指定回報比較，非自然同時觸發全部技能。怪物動畫姿態並未逐幀固定。
- `skill-vfx-motion.webm`：正式特效模組的循環美術演示，瀏覽器內注入指定回報，非真實戰鬥錄影。
- `production-spear.png`：正式 AUTO 槍兵實際旋轉命中。
- `production-no-bloom.png`：正式遊戲關閉 Bloom 仍可讀。
- `production-mobile.png`：手機尺寸與減少動態。現有直向鏡頭使場地較小，此次未更動鏡頭／UI 版面。
- `browser-report.json` / `gameplay-parity.json`：機器驗證資料。

QA 注入只存在測試瀏覽器的 route；匯出遊戲不含強制觸發或指定開獎。`main-before.luau` 保存此輪基準供結果比對。
