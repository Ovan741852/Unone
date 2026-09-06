# 工作包：老虎機作為參考遊戲

日期：2026-09-06。計畫代理：Claude（主代理）。實作：codex / luna。
基準：`master` 的 `2cd90d6`。狀態：`planned`（尚未實作）。

## 目的

老虎機是目前最接近完成的驗證遊戲：它已經有 Spine 骨骼、Effekseer 特效、
deterministic 測試、bundle 與真實資產。把它推到**參考遊戲**的程度——也就是
每一項已交付的引擎能力，都在這款遊戲上有一個可重跑的證據。

這不是為了做遊戲，是為了**證明既有能力真的好用**。使用者的要求是「先把完成
用好」：能力清單長但沒有一款遊戲把它們全部用過一遍，就無法分辨「能力可用」
與「能力只是存在」。

## 現況（已量測）

| 項目 | 狀態 |
|---|---|
| `verify` | 4 個 step 通過，但 `layout` 只有預設的開場畫面 |
| 測試 | 4 個 deterministic case |
| 場景 | 3 個 reel entity，**沒有宣告 camera** |
| 資產 | Spine `spineboy-pro.json`、Effekseer `win-ring.efk` |
| `ui_previews` | **未宣告**，因此 win／settled／restored 畫面沒有被 gate 檢查 |
| replay baseline | **不存在** |
| perf baseline | **不存在** |
| native／Android 證據 | **不存在** |

## 已知阻擋：`verify` 的 types step 會間歇性假失敗

實測同一個專案連續執行 `verify` 七次，其中一次 `types` 回報 `failed`，其餘
六次 `passed`；而單獨執行 `game check --types` 是 `ok: true`，`output` 為空。

**這是最高優先，必須先修。** 一個會偶爾假失敗的 gate 會教作者「重跑到綠為
止」，那等於摧毀所有 gate 的意義——包含本工作包要建立的每一項證據。

推測方向（實作者需自行證實，不要照抄）：`check_with_types` 把 analyzer
子行程的任何非零結束碼都當成型別錯誤，沒有分辨「工具本身沒跑起來」與「型別
真的有問題」。Windows 上短時間重複啟動同一個執行檔遇到防毒或檔案鎖時會出現
這種結果。

要求：

1. 先穩定重現（連跑 50 次 `verify`，記錄失敗率與當次完整 diagnostic）。
2. 分辨兩種失敗：工具無法執行 → 自成一個錯誤碼並附 exit code 與 stderr；
   型別真的不過 → 維持 `LUAU_TYPECHECK_FAILED`。
3. 回歸測試：不能只測「跑一次會過」。要能證明工具失敗時不會被誤報成型別錯誤。

修好之前，本工作包的其他段落產出的任何「全綠」證據都不算數。

## 分段

### 第一段：把所有畫面納入 gate

老虎機有 `ready`、`spinning`、`win`、`settled`、`restored` 五種 `message`
狀態，但 `verify` 只畫開場。

- 在 `project.unone.json` 宣告 `ui_previews`，涵蓋至少 `ready`、`spinning`、
  `win`、`restored` 四個畫面，各自提供能真正到達該畫面的 `input_sequence`。
- **每個宣告都必須驗證它真的到達了目標畫面**：`verify` 的 layout step 會列出
  該畫面的節點 id，兩個宣告若列出相同節點，幾乎一定是同一個畫面被跑到兩次。
  憤怒鳥就發生過這件事（宣告的 `win` preview 其實停在 aim 畫面）。實作者必須
  逐一用 `game run` 印出 `view_model.screen` 確認，並把確認結果寫進
  `validation-report.json`。
- `restored` 畫面需要 `load_save`，而 `ui_previews` 目前**沒有** `load_save`
  欄位。若確認需要，這是一個契約缺口：回報而不要繞過（例如不要改用一個
  剛好會產生類似畫面的輸入來假裝）。

### 第二段：補上鏡頭宣告

場景沒有 `camera`，因此吃的是預設 `view_height: 10`、位置 `(0,0)`。三個 reel
在 x = -2、0、2。實作者要明確宣告一個能框住三軸的鏡頭，並在
`validation-report.json` 記錄「宣告前後 host 畫面的差異」。

這一段的價值不是好看，是證明 [Decision 0031](../decisions/0031-camera-view-extent.md)
的取景契約在一款真實遊戲上是可用的。

### 第三段：建立 baseline 證據

在 `D:/Projects/Unone_Games/slot-machine/validation/` 下建立：

| 檔案 | 內容 |
|---|---|
| `baselines/spin.recording.json` | `game replay record`，用 spin 序列、固定 seed |
| `baselines/perf.md` | `game perf --frames 600` 的完整輸出 |
| `validation-report.json` | 每一條實際執行的命令與真實結果，失敗也要記 |

並示範這兩個工具真的有用：

- 故意改一個賠付數字，跑 `replay diff`，把它指出的**第一個分歧 frame 與欄位**
  貼進報告，然後還原。
- perf 報告要指出 script/observe 的佔比，並說明這款遊戲的成本在哪裡。若發現
  可優化處，優化後附上前後數字；**若沒有可優化處，就如實說沒有**——不要為了
  讓報告好看而製造一個假的優化。

### 第四段：音訊（等音訊工作包落地後）

依 [音訊工作包](2026-09-06-audio.md) 的驗收 gate，老虎機是指定的真實遊戲
證據：拉桿音效、中獎音效、以及一個 `exclusive` 分類的背景音樂（證明換曲時
前一首會淡出）。本段在音訊 core 與 Web host 完成前不能開始。

### 第五段：資產誠實度

目前 reel 用的是 Spine 官方範例 `spineboy`——一個人形，不是老虎機轉輪。它
證明了骨骼動畫管線可用，但它不是這款遊戲的美術。

要求**二選一**，不接受現狀不動：

- 換成真正的轉輪／符號骨骼資產（注意 Spine Editor 授權條件，見
  `web/vendor/README.md`）；或
- 在 `README.md` 明確標示「這是管線示範資產，不是本遊戲美術」，並說明替換
  路徑。

不接受現狀是因為：一個宣稱「參考遊戲」的專案，如果它的主要視覺是另一個遊戲
的範例角色，那份參考價值是假的。

## 不做

- 不加 slot 專用的引擎 API。賠付、轉輪、比倍全部是遊戲端規則。
- 不為了湊能力而硬塞用不到的系統。這款遊戲**正確地**關掉了 `physics2d`，
  不要為了「用過 contacts」而把物理打開。
- 不改引擎契約來遷就這款遊戲。發現契約缺口（例如第一段的 `load_save`）要
  回報，由主代理決定是否另立工作包。

## 驗收

```powershell
game --project D:/Projects/Unone_Games/slot-machine --json verify          # 全綠，含四個 layout:<screen>
game --project D:/Projects/Unone_Games/slot-machine --json asset inspect --strict
game --project D:/Projects/Unone_Games/slot-machine --json perf --frames 600
game --project D:/Projects/Unone_Games/slot-machine replay diff --baseline validation/baselines/spin.recording.json
```

加上 `verify` 連續 50 次全綠（證明第 0 段的間歇失敗已修）。

`validation-report.json` 必須包含每一條命令的真實結果，以及**明確標示尚未
取得的證據**：native 音訊、Android 畫面、Spine／Effekseer 在 native 的呈現，
目前都沒有，不得因為 Web 通過就宣稱跨平台通過。

## 待使用者決定

1. **第五段的資產**：要換真實轉輪美術，還是先標示為管線示範資產？前者需要
   美術來源與授權確認，後者立即可做。
2. **`ui_previews` 是否要支援 `load_save`**（第一段可能撞到）。若要，那是引擎
   契約改動，我另立工作包；若不要，`restored` 畫面就不納入 layout gate，並在
   報告中說明原因。
