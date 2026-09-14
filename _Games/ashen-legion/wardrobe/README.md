> 2026-09-10：展示器已改用 Unone 官方 Animator，支援漸變、暫停、進度與單次播完。新增 45 件裝備，頭／身／腳／手／武器實際附著骨架，正式盤面同步。

# 目前版本：方圓頭貼圖公仔

依最新參考改為大方圓頭、短身體、短四肢與圖形化表情。Blender 5.1.1 實作倒角頭型、UV 與 55 骨權重；臉部表情使用貼圖，鼻子保留立體塊面。

- `assets/vinyl/soldier.blend`：可編輯建模主檔，已內嵌 2048×2048 貼圖。
- `assets/vinyl/soldier-animated.blend`：含八組動畫的 Blender 交換檔。
- `assets/vinyl/soldier-animated-textured.glb`：骨架、八組動畫、PNG 貼圖全部內嵌。
- `assets/vinyl/soldier-painted-atlas.png`：獨立貼圖，含表情、縫線、布料、皮革與金屬細節。
- `blender/paint_vinyl_atlas.py`：以繪圖指令繪製原創像素貼圖；不是從參考圖擷取投影，也不是逐筆人工 Texture Paint。
- `blender/build_vinyl_soldier.py`：Blender 建模、UV 分配及蒙皮。UV 顏色區域共用以節省材質；幾何約 6,038 三角面，UV 展開後 18,114 頂點。支援五槽拆裝。
- `tests/verify-vinyl.mjs`：UV 範圍、骨骼权重、八動作、換裝、Mixamo 映射與 GLB 骨架測試。
- `blender/pack_vinyl_glb.py`：把貼圖與已測試的動畫封裝成自含 GLB，處理 glTF 貼圖 V 方向。已再由 Blender 匯入確認 2048 貼圖及八個 Actions。

以下保留前版製作記錄；目前展示器已使用上述貼圖公仔。

# 目前預設角色：Blender 低模繪本 A

依使用者選定 A 方向製作：寬沿灰藍鐵帽、奶油白衣服、霧藍罩衫、暖棕手套與靴子。所有材質使用霧面；模型在 Blender 5.1.1 實際建立並綁到共享 55 骨骨架。這是概念 A 的可動低模原型，尚非逐筆復刻 2D 原畫。

- 可編輯 Blender 主檔：`assets/storybook-a.blend`（T-pose，具 Armature modifier 與權重）。
- Blender 原始匯出：`assets/storybook-a-blender.glb`（綁定姿勢）。
- 展示器動畫匯出：`assets/storybook-a-animated.glb`（8 動作）；`assets/storybook-a-body.obj`。
- 製作腳本：`blender/build_storybook_a.py`，使用既有 `assets/ashen-soldier.glb` 的骨架作為綁定基準，於 Blender 重新建立角色及五槽外觀。
- `assets/storybook-a.mesh.json` 是 Blender 匯出的 bind geometry 和權重；`storybook.mjs` 將它裝到展示器共用 Skeleton。
- 驗證：`node --experimental-loader ./_Games/ashen-legion/wardrobe/tests/loader.mjs _Games/ashen-legion/wardrobe/tests/verify-storybook.mjs`，報告 `tests/storybook-report.json`。
- 本版以部件的剛性蒙皮為主；仍需美術調整極端姿勢的接縫、穿模與握持。沒有改動 Unone Core 或盤面中的士兵。

下面是原始展示器與動畫流程說明；預設外觀已由黑金冥衛換成上述繪本 A。

# 灰燼軍團紙娃娃工坊

執行 `Start-Wardrobe.ps1`，開啟 http://127.0.0.1:8192/ 。第一次啟動會取得固定版本 Three.js 0.179.1；之後可離線使用。這是遊戲專屬角色資產展示器，尚未替換戰鬥盤面的靜態士兵，也沒有修改 Unone Core。

## 操作

- 頭、身、腳、手、武器五槽獨立切換，無裝備／鐵衛／黑金冥衛；武器另有長槍。
- 素體與冥衛套裝按鈕一鍵換裝；播放中換裝不重建骨架、不重置動作。
- 骨架透視、線框、拖曳旋轉、滾輪縮放、自動旋轉。
- 基本動作：站立、移動、伸懶腰、攻擊、死亡、出生；另保留奔跑與 T-pose。皆為原創程序示範，可暫停、重播、調速與拖曳時間軸。站立／移動／奔跑循環；伸懶腰／攻擊／死亡／出生單次播放並停在最後一格。
- 匯出 GLB 包含當前装備、蒙皮與動作。預先生成檔案在 `assets/ashen-soldier.glb`。
- `assets/ashen-body-tpose.obj` 為素體 T-pose，也可按「素體 OBJ」下載。

## Mixamo 流程

1. 把素體 OBJ 上傳 Mixamo，以 Auto-Rigger 指定下巴、手腕、肘、膝、胯部；本工具不替使用者登入 Adobe 或上傳檔案。
2. 選擇動作後下載 FBX。首次建議 **With Skin**，可提供明確的 inverse bind matrices；沒有皮膚的 FBX 以靜態骨架變換作為參考姿勢。
3. 展示器按「匯入 FBX 動作」。目前讀取第一組 animation clip，支援標準 Mixamo 命名，最長 180 秒、60 MB。
4. 轉換以來源世界旋轉乘綁定旋轉逆矩陣，保留目標身體比例，髖部高度依比例縮放，移除水平位移以原地展示。非標準名稱會明確列出缺少的骨骼。

已用 Three.js r179 官方範例 `Samba Dancing.fbx` 實測 55/55 骨骼映射及播放。不同姿勢、武器握法與極端动作仍可能需要美術調整；目前沒有腳掌 IK、碰撞防穿模或手指握持求解器。模型是可用於流程驗證的低面數原型，手掌簡化，手指骨架已預留。

## 資產與槽位契約

- Y 向上、+Z 面向前、單位公尺，約 1.96 公尺高；T-pose 為 bind pose。
- 55 根 `mixamorig*` 骨骼，含左右各 15 根手指骨骼。所有裝備沿用同一 Skeleton 與 inverse bind matrices。
- `Body` 是素體；`Equipment_head/body/feet/hands/weapon` 是各槽容器。
- 身體使用 blend weights；硬質護甲以單骨權重跟隨對應部位。每槽替換只 dispose 舊 geometry，共用材質和骨架保留。
- 未來遊戲存檔應保存裝備 ID（例如 `head: royal`），由 Luau 計算屬性與符文。此展示器只處理外觀、資產、動作，不包含費用、傷害或遊戲規則。
- 若接回戰鬥，需要為遊戲渲染端增加通用 glTF 蒙皮與 animation mixer 資產路徑；不可把戰鬥規則搬進 renderer。

## 驗證

從儲存庫根目錄執行：

```powershell
# FBX 只用於本機測試，不打包成遊戲資產。
curl.exe -L 'https://raw.githubusercontent.com/mrdoob/three.js/r179/examples/models/fbx/Samba%20Dancing.fbx' -o _Games/ashen-legion/wardrobe/tests/mixamo-test.fbx
node --experimental-loader ./_Games/ashen-legion/wardrobe/tests/loader.mjs _Games/ashen-legion/wardrobe/tests/verify.mjs
```

檢查所有蒙皮權重總和、骨骼索引、八動作頂點有界性、單次動作停格與重播、播放中各槽替換保持骨架、真實 FBX 轉換、無效 FBX 拒絕、GLB 匯出再讀入骨架及動作。報告 `tests/report.json`。`tests/preview.html` 是僅供開發的真實 FBX 視覺檢查頁，需先取得測試檔。

依賴 Three.js MIT，授權檔位於 `vendor/package/LICENSE`。素體、裝備幾何及程序動作由本專案生成。
