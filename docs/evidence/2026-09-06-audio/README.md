# 音訊證據（2026-09-06）

這個目錄不是遊戲，是**引擎音訊的證據**。`project/` 是為了測音訊而存在的最小
專案，三個 `.wav` 是為了這次測試合成的純音，不是任何遊戲的資產、也沒有授權
問題。

## 為什麼要有它

老虎機的音效資產還沒取得，但音訊 core 與 Web host 已經完成。沒有這個專案，
「音訊做完了」就只有單元測試支撐，而單元測試證明不了 wasm build 與 CLI 是同
一份行為，也證明不了瀏覽器真的解碼並播放了東西。

## 重現

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone/docs/evidence/2026-09-06-audio/project --json verify
cargo run -p unone-cli -- --project D:/Projects/Unone/docs/evidence/2026-09-06-audio/project --json run --frames 180
```

Web：先 `scripts/build-web-live.ps1`，在 `D:/Projects` 開 `python -m http.server 8001`，
然後開

```
http://127.0.0.1:8001/Unone/web/presentation/?project=/Unone/docs/evidence/2026-09-06-audio/project/
```

`window.unoneHost.audioReport()` 回報解碼了幾個 clip、失敗了哪些、AudioContext
的狀態，以及每個 live loop 當下的 gain。

## 這個專案故意做的事

- `bgm` 是 `exclusive` 且 `fade_in_frames: 30` / `fade_out_frames: 60`，遊戲在
  第 180 幀換第二首曲子——**交叉淡入淡出是引擎算的**，遊戲只呼叫一次 `loop`。
- 每 60 幀放一個 one-shot，證明事件路徑一直活著，而且事件只出現一幀。
- 兩個 test case 用 `audio` assertion 釘住「換曲那一幀發生了什麼」與「兩個
  fade 的起始幀與長度」，看不到畫面也聽不到聲音的人可以據此判斷對錯。

## 結果

`verify` 四個 gate：types / assets / tests 通過，layout 因為沒有 UI 而
`not_applicable`。Web 實測見 [web-crossfade.json](web-crossfade.json)。

## 這裡**沒有**證明的事

- 沒有人真的聽過，也沒有錄音。報告能說的是「解碼成功、node 啟動、gain 與引擎
  宣告一致」，不能說「聽起來對」。
- native preview 與 Android host **完全沒有音訊**。
- 三個 `.wav` 是合成音，不代表任何真實資產格式（例如 ogg、mp3）在 host 上可用。
