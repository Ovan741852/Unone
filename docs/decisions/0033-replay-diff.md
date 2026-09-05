# Decision 0033：回歸要指名 frame 與欄位，不只是 digest 變了

日期：2026-09-05

## 背景

`observation_digest` 是這個引擎最強的正確性工具，但它作為**回歸報告**是最弱的形式：它只說「有東西不一樣」，不說第幾格、哪個欄位、從什麼變成什麼。作者只能手動二分搜尋。

引擎手上握有每一個 frame 的完整 observation，所以它可以直接回答真正的問題。

## 決定

新增錄製與重播比對：

- `game replay record --output <path> [--frames --seed --input-sequence]`：跑一次並保存每個 frame 的 observation 與 digest。
- `game replay diff --baseline <path>`：用錄製的 seed 與輸入重播現在的專案，回報**第一個開始不同的 frame**，以及該格所有差異欄位的 dotted path 與新舊值。
- MCP `unone_replay_diff`。

三個設計決定：

1. **只對第一個分歧 frame 做欄位比對。** 之後每一格都會繼承這個差異，全部列出只會把原因埋在雜訊裡。
2. **錄製檔不含任何 wall-clock 時間。** 效能量測刻意不進 snapshot（Decision 0032），所以換一台慢的機器不會被誤判成回歸。
3. **差異上限 40 個欄位**，超過的計數但不列出，避免一個結構性改動產生無法閱讀的報告。

## 邊界

它比對的是 observation：world、UI、observations、effects。它不比對 trace、save payload 或效能。它不做 bisect，也不判斷差異是好是壞——「這是修好還是改壞」需要引擎不知道的意圖。

## 原因

- 「第 59 格、`entities.reel-3.animation.animation` 從 `run` 變 `idle`」可以直接行動；「digest 不同」不行。
- 這是 deterministic 執行本來就該換到的紅利：因為重播保證一致，任何差異都必然來自改動本身。

## 已知限制與下一步

- 錄製檔保存每一格的完整 observation，大型場景的長 run 檔案會很大。目前沒有壓縮或抽樣。
- 沒有 bisect：它指出第一個分歧點，不會自動找出是哪一次提交造成的。
