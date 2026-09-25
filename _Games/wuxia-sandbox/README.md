# 雲水鎮 · 江湖百態

40 位有姓名、職業、背景、喜好與社會關係的居民，住在 80 × 64 的小鎮。20 戶住宅、13 個工作／生活場所，以及市集、河道、林地、演武場。

## 目前：NanoJev 人物決策＋封閉經濟

人物「做什麼、對誰做」只接受真正的 NanoJev checkpoint 推論；已移除原本的職業分數、飢餓加權、貧困工作優先、自动謀財／害命／結婚決策。Luau 保留候選定義、世界狀態、合法性與結果結算。沒有模型時初始居民等待；服務中斷後只保留上次已採用指令，不切換規則 AI。

- 本機模型：`C:\Users\liNao\Documents\ComfyUI\NanoJev\checkpoints\NanoJev`，來源 `C-Tianyu/NanoJev` 根目錄 checkpoint，Qwen3-0.6B + attention decision head。
- 權重 SHA-256：`fff62d1412685c1714eaa386acb603f9690371fb3cc8ad03dc41319302597c28`。
- 執行：RTX 5080、FP32 weights / BF16 autocast，沒有 token generation、沒有遠端模型 API。預設依模型原始機率分布抽樣（T=1，seed=42）；可用 `--selection argmax` 做對照。抽樣不是手工修正權重。
- 每人每 120 frames 錯開嘗試提交；每人最多一個未完成請求，按請求時間先後處理。新版逐問題推論，避免一次把多棵決策樹塞進 GPU；預先規劃版兩人一批抽樣約 0.8–1.4 秒、整張 GPU 約 8–10 GB。不保證整輪延遲，更不宣稱每人能在 120 frames 內收到新結果。GPU 推論不阻塞 Luau tick；畫面 FPS 不等於 AI 回應頻率。單例檔案鎖避免啟動兩個模型搶 GPU。
- 角色可見最近四位、十單位內的存活居民；行為與互動對象是兩個模型 Choice 問題。互動效果只在六單位內且每份決策最多一次結算；求婚需雙方模型選擇同意才能成婚。
- UI 標出模型來源、抽樣方式、完整證據中最高五項機率、已採用行為與對象；不把規則摘要說成模型的內心獨白。
- **模型品質限制：** 這份 checkpoint 主要針對導航任務訓練，未做小鎮生活／經濟微調。argmax 實測偏向趕路；T=1 會有不合理或冒險選擇。接通模型、概率合法和重播通過，不等於生活判斷品質已達到「高度真實」。

「小鎮帳本」顯示四類商品（食材／飯食／藥材／日用品）、五個商號與公庫、價格、庫存、產耗及逐筆交易。每人有獨立錢袋、當日／累計收支及五筆收據。錢只在居民、商家、公庫與已故者遺產之間轉移；起始總額 6,415 文。生產要實際工作，做飯會消耗食材；沒錢、沒貨或商家付不出工錢時交易／工作結算會失敗。稅收支應公共工作與急難救濟。沒有銀行、貸款、外貿或實體運貨車；商家補貨以帳戶間交割模擬。

模型使用獨立環境 `NanoJev\.venv-town`：Python 3.12、transformers 5.17.0、safetensors 0.8.0；`comfy-shared-torch.pth` 只讀引用原 ComfyUI 的 torch 2.10.0+cu130。沒有更新原 ComfyUI 套件。重建時先安裝隔離套件再接上該唯讀路徑；不要直接升級 ComfyUI 的 transformers。

## 打開遊戲

### 人物生活與日夜

點角色即可查看心情及狀態原因、NanoJev 已採用的意圖、六項 0–100 數值、錢袋與隨身行囊。心情原因／想法說明是 Luau 狀態與意圖摘要，不是模型生成的內心獨白；原始選項機率仍在「查看決策依據」。

- 每人有符合職業的工具和一份初始乾糧；藥農／醫療職業另有藥材。工具是隨身設定，目前沒有武器加成、耐久或掉落規則。
- 乾糧、藥材、日用品有真正數量。NanoJev 可選擇買入帶走或使用；每份決策最多買／用一件，不能在每次 tick 重複扣除。消耗效果分別為減少 36 飢餓、12 傷勢、45 日用品需求。隨身上限乾糧 3、藥材／日用品各 2。
- 庫存核對包含商家、行囊與已故者遺物：初始總量＋產量−消耗＝商家庫存＋隨身數量。購買帶走是轉移，不是消耗；工具不在商品生產帳中。
- 清晨／白晝／黃昏／夜晚由 Luau 時鐘提供。1× 時每真實秒 8 遊戲分鐘，一天約 3 分鐘；暫停凍結世界時鐘，瀏覽器只依該時鐘調光，不另跑時間。
- 清醒、移動、勞動會累，疲勞也會降低走路速度（最多 30%）。NanoJev 選 `rest` 後先返家，抵達才恢復；白天每遊戲分鐘恢復 0.5 疲勞，夜晚睡眠恢復 0.75。夜晚不強迫所有人休息。睡眠是實際狀態／數值恢復，目前沒有躺床骨骼動畫。
- 時辰、夜晚標記、背包、疲勞和已休息時間已送入模型。不能將有限測試誤稱為模型一定會合理安排作息。

執行 `python tools/check-life.py` 可驗證正式 Luau 道具／疲勞／睡眠／日夜邊界；其合成意圖只測執行，不代表模型品質。新版另有真實 NanoJev 93 次／40 人決策重播通過（`.runtime/nanojev-verification.json`，測試時未混入 UI 暫停操作）。

在專案根目錄執行：

```powershell
& .\tools\start-town.ps1
```

然後開 http://127.0.0.1:8088/ 。這才是遊戲畫面。http://127.0.0.1:55433/ 是 native 開發工具，不是遊戲。

目前架構：Unone native CLI 執行 Luau → 本機橋接 → Unone 現成 Three.js renderer 顯示 mesh + texture。不是另一套 JavaScript 遊戲模擬。CLI 內建 native 預覽仍是 silhouette renderer；此專案沒有把它宣稱為完整 native 材質渲染。

- 左鍵拖曳平移；右鍵或 Shift＋左鍵拖曳旋轉，也可按左下「旋轉」切換左鍵模式。滾輪縮放，WASD／方向鍵平移，Q/E 旋轉；「俯瞰全鎮」回到全景。
- 每個活著的居民頭頂顯示姓名＋行為 icon＋行為；「前往」代表仍在路上。
- 點頭頂姓名或角色，查看模型頭像、職業、身世、情緒、喜好、武學、人際、目的及原因。
- 選取者有金色圈與目前格子路線。「跟隨這位居民」或 F 開始平順跟隨，跟隨時換選其他居民會改跟新人；「定位一次」只拉近一次。拖曳、鍵盤移動或 Esc 回到自由鏡頭，滾輪縮放仍保持跟隨。預設自由鏡頭，不強制追人。
- 「居民名冊」可搜尋全 40 人，包含已故者。
- 「查看決策依據」顯示 NanoJev 機率與已採用結果、上次與下次請求 frame；「小鎮帳本」查看真實帳務。

## 人物價值觀、感情觀與人格

點人物後，姓名下方直接顯示價值優先順序與感情態度；展開「人格特質與內在矛盾」可看自我底線、感情界線、矛盾，以及外向、共情、自律、冒險、敏感、佔有六項 0–100 傾向。這些是 40 份各自編寫、與身世相連的固定角色設定，不是心理診斷；本版不會隨事件自動改變。當下心情、嫉妒、疲勞等仍獨立變動。

正式 Luau 的 `Persona` 同時供應人物面板與每次 NanoJev 的行為／對象問題；沒有以人格數值強制選擇行為。模型實際輸入保留於 receipt 的 `input_state`，可以核對設定是否送入。角色輸入測試包含 40 人差異、資料隔離、無模型時不決策及四鄰居情境的 token 長度；上限 1024，超限拒絕而非截斷。這證明資料有送入，不代表導航訓練的 checkpoint 已能穩定扮演這些人格。

```powershell
& C:/Users/liNao/Documents/ComfyUI/NanoJev/.venv-town/Scripts/python.exe tools/check-persona.py --live
```

驗證留存：`tests/evidence/nanojev-persona-60-inputs.json` 是新版 40 人、60 次真正模型決策，重播全數通過；`persona-verification.json` 記錄另一次對 272 次實際輸入的逐份人格欄位核對。初始候選最長 644 tokens，四鄰居壓力情境 734 tokens；這是有限測例，不是任意長時間存檔的長度保證。

## 邊執行、邊規劃下一步

人物面板分成「正在做」與「接下來打算」。每 120 frames 錯開提交不再依賴目前行為是否完成；NanoJev 同時看到目前行為、走路狀態、執行段進度、已有的預定行動，以及人設／需求／財務／關係。

- 模型選動作、對象與時機（`after_current` 做完這段再去／`interrupt_now` 立刻改變）。三者仍是同一 checkpoint 的 Choice 問題，沒有規則替代，但各問題獨立推論，尚非完整多步規劃器。
- Luau 只定義執行段：工作／採集／訓練／狩獵／比武到場 8 次模擬 tick；休息到家 30 遊戲分鐘；等待 15 分鐘；巡路抵達一個點；購買／使用／互動完成一次嘗試。失敗也回報結果，不能讓一次請求無限反覆扣錢或傷人。
- 有一格 `next_plan`；模型可以提前排定或重新修改它。`after_current` 不打斷当前段；中斷也先完成已預留的格子，避免跳動／重疊。沒有下一個計畫時保留目前已批准行動，不額外挑選新意圖。
- 切換行為後，基於上一個行為的未回覆請求失效；死亡／重設清除預定。互動對象死亡時取消該預定並等模型重想；金錢與道具等在執行時再核對。
- 收到預定（`planning_request_id`／`planning_updated_frame`）與真的開始（`decision_request_id`／`thinking_updated_frame`）分開。面板分別比對 active_receipts 與未來計畫的 receipts，不能把未來機率冒充目前行為證據。

`python tools/check-lookahead.py` 是合成輸入的執行測試；真正模型的 202 份 lookahead-v2 決策重播通過，涵蓋 40 人、兩種時機，198 段已開始，資金差額 0。證據在 `tests/evidence/nanojev-lookahead-*`。舊版 60／93／410 份紀錄是歷史證據，沒有 timing 欄位，不能當作 v2 重播；導航／經濟檢查已改用新版紀錄。

## 模型與授權

已實際下載 Kenney Fantasy Town Kit 和 Mini Characters（CC0）。建築不是 primitive cube，40 位角色使用 12 款人物 mesh，頭像使用同款模型的原始預覽圖。來源、雜湊、限制見 assets/SOURCES.md。

目前是低多邊形佔位美術，服裝尚非正式武俠造型；角色會平滑移動與轉向，但尚未接骨骼走路動畫。

素材重建：

```powershell
node tools/build-town.mjs
```

這會重新產生 assets/imported、manifest、scene 和 Luau 的建築／住宅／障礙物常數。不要手改這些生成區塊。

## 世界規則只在 Luau，人物決策使用 NanoJev

scripts/main.luau 處理：需求、模型輸入與結果驗證、格子 A*、佔格／預留、目的地、社會互動效果、合作、謀財、嫉妒、婚姻與傷害結算。tools/nanojev-agent.py 只載入並執行模型、傳回抽樣結果及寫入證據，不維護另一份遊戲世界。

- 每人每 120 frames 錯開檢查提交資格；實際決策等待模型回覆，不保證 120 frames 內完成。
- 數值／關係 30 frames 一次，位移逐 frame 更新。
- 格子 2 單位，41 × 33 節點；避開房屋、攤位、樹木／推車障礙物和非橋段河道。
- 每人保留目前格與正在前往的下一格；遇阻等待，必要時改路，不互相穿越。
- 只有真正抵達目的地後才執行工作、吃飯、休息及附近人際互動。沒有走到時不虛構到達。
- 飢餓、疲勞、餘額、物價、職業、成長背景與關係會進入模型輸入；不再由手寫分數覆蓋模型。

EXTENSIONS.pathfind、onEvent 是業務外掛邊界。決策結果透過既有 InputFrame 布林動作入口，帶居民／世代／請求 frame 的唯一 prefix 回送；Luau 拒絕過期、重複或多選的輸入。原生入口目前不收任意 JSON，因此完整機率保存在 `.runtime/nanojev-status.json`，橋接器只做展示，不覆蓋 Luau 狀態。

viewer/app.js 只做模型呈現、native snapshot 插值、鏡頭、文字及選取 input，不決定居民去哪裡、不執行社會規則。畫面上限約 60 FPS、取樣約 10 Hz，UI 數值依原生 publication 更新。

## 驗證

```powershell
$gameExe='D:\Projects\Unone\target\release\game.exe'
& $gameExe --project . check --types
& $gameExe --project . verify
& $gameExe --project . test
python tools/check-town.py
python tools/check-economy.py
python tools/check-life.py
python tools/check-nanojev.py
node tools/check-camera.mjs
```

check-nanojev.py 需要本機模型與遊戲正在運行，將已被 Luau 確認的真實決策重播。已驗證一份 410 次／40 人／10,318 frames 的紀錄；証據在 tests/evidence。check-town.py 與 check-economy.py 優先使用最新驗證紀錄，沒有時使用該固定紀錄，分別檢查導航與守恆。經濟邊界測試直接執行正式 Luau 函式；離線測試驗證沒有模型便不產生決策。這些是離散取樣與有限情境驗證，不是所有 frame 或模型品質的形式證明。
