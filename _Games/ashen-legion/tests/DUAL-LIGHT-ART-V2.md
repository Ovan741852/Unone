# 模型、左右雙色光與正常透視 — 2026-09-12

本版以使用者提供的奇幻戰場截圖為美術方向：清楚的低模輪廓、奶油白／磚紅角色、暖色高光與紫藍暗部、明亮的戰鬥與開獎特效。最新決定是移除扇形變形，使用正常斜俯視透視。截圖無法證明參考作品實際的 shader 或燈光數量；本版實作的是使用者指定的左右雙色光。

## 實作

- `presentation/scene-lighting.mjs`：左側琥珀光、右側紫藍光、低強度環境補光；左側產生方向陰影。場景使用受光 Toon 材質，取代這個版本播放器預設的 unlit 地面。沿用官方 Bloom／AO；没有修改引擎的著色器或新增 Rust 遊戲規則。
- 日夜改變同一套資產的光色、強度與遠景霧。預設 120 秒一個循環，暫停跟隨遊戲時間。最多四個事件燈只讀已发生的技能／開獎事件。
- `presentation/ink-style.mjs`：三段式明暗、約 1.3 像素的紫褐輪廓。描邊共用幾何與骨架，不另算動作。
- 移除正式遊戲的 fan-view 匯入。鏡頭、滑鼠拾取與標籤全部使用正常透視矩陣。25 × 25 碰撞、固定南側炮台、正式 Canvas UI 維持；手機調整 FOV 和鏡頭位置，不拉伸模型。
- Blender 重製士兵與十一種生物，各自擁有不同輪廓。部隊預設穿上有貼圖的基礎制服；正式付費裝備仍由原本的裝備系統處理。
- Luau 常態開場 32 小怪、2 小王、1 中王；小怪潮最多同時 110 隻小怪，每波最多新增 80 隻。怪物尺寸依階級增大，同一個 `scale` 同時影響既有命中判定。遊走深度擴大，接觸半徑外保留 0.65 的牆邊空隙。Boss 仍於最後 30 秒出現。

## 可修改的美術來源

- `wardrobe/blender/art_v2_common.py`：共用 2048 × 2048 手繪式色塊／臉部 UV atlas。
- `wardrobe/blender/build_soldier_v2.py` → `wardrobe/assets/art-v2/soldier.blend`、`presentation/soldier-v2.glb`。基礎 1,703 三角面、6 個換裝分組、55 骨、8 段動作。
- `wardrobe/blender/build_cast_v2.py` → `assets/creatures/art-v2/*.blend`／`*.glb`。每隻 734–1,614 三角面、9 骨、8 段動作。
- 原有 GLB 保留於原路徑供對照；web 輸出使用 v2 GLB，不包含 Blender 原始檔。
- `presentation/art-lab.html`：開發用對照展示器，可播動作、旋轉、切日夜，及單獨開左光／右光。HTML 控制只用於這個展示工具，正式遊戲沒有 DOM 控制 overlay。

## 實際驗證

- `tools/verify-art-v2.cjs`：14 種展示、每種 8 段動作；骨架頂點有限值、UV／貼圖、骨數與剪輯數檢查通過。
- `tools/verify-dual-light.cjs`：正式遊戲 35 隻開場、自然 110 小怪潮、日夜實拍、左右光單獨切換；沒有狀態注入，沒有 JS／shader 錯誤。
- `tools/verify-spear-pointer.cjs`：桌面、手機橫向、手機直向各 5 個真實點擊；最大落點誤差 0.000002645，飛行中移動滑鼠也不改落點。
- `tools/verify-expedition-ui.cjs`：5 種視窗、65 頁面，正式 Canvas 點擊、買賣、換裝、暫停、自適應與 reduced motion 通過。
- `tools/verify-skills.mjs`：50 個技能檢查、3 兵種正式模擬，逐 tick 經濟／部署／部隊數／牆界守恆通過。
- `tools/verify-crowd.mjs`：有潮與無潮兩種種子、暫停不觸發潮、數量上限與牆邊空隙通過。重新產生這兩個依賴族群數量的 JSON replay；其他既有斷言未放寬。
- `tools/run-json-tests.mjs`：19／19 通過，含破產、倒數、壽命、反彈和倖存退款一次性結算。

## 證據與範圍

- 實機日夜／戰鬥／怪物潮：`tests/dual-light/*.png` 與 `report.json`。
- 同鏡頭左右燈比較：`tests/dual-light/soldier-{day,night}-{both,left,right}.png`。
- 新舊造型對照：`tests/art-v2/*-comparison.png`。
- 這輪驗證美術、輸入、守恆與流程；增加族群密度會改變命中與收入，並不代表已完成新的七關經濟平衡。
- 早期輪廓參考閱讀：[Synty Mini Fantasy Characters](https://syntystore.com/products/polygon-mini-fantasy-characters-pack)、[Fantasy Kingdom](https://syntystore.com/products/polygon-fantasy-kingdom)。沒有匯入或複製其模型、貼圖。

正式試玩：`http://127.0.0.1:8190/?build=dual-light-v1`。
光照展示器：`http://127.0.0.1:8190/presentation/art-lab.html?kind=soldier`。
