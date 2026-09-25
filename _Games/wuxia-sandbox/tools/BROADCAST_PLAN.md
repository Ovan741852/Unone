# 雲水鎮精簡直播工具 — Luna 實作交接

2026-09-19。使用者指定：主代理負責計畫與驗收，Luna 負責實作。

## 目標與範圍

先做一個能準備、預覽、試錄、開播、停止的本機命令列控制器；沿用
`tools/town-broadcast.mjs` 與已安裝的 OBS，不重寫編碼器、不新增控制網站。
第一版仍依賴 OBS，並非完全 OBS-free。這是直播工具，不是引擎或遊戲邏輯。
本輪不要修改 Luau、NanoJev、遊戲畫面或另一位代理的引擎改動。

只有這條路徑：

    雲水鎮 Browser Source + 任務列 + 授權音樂
        → OBS/NVENC → 自訂 RTMPS → 既有 YouTube 公開直播

已確認的公開頁：https://www.youtube.com/watch?v=BXKN16xAD6g
標題：NanoJev 打造武俠小世界。使用者已確認公開開播，但修復過程不得自動
新增另一個公開直播、換頻道或放寬來源。主代理驗證後才恢復既有直播。

**交接後即時更新：**主代理已在 Studio 讀到這個場次的「直播結束」與結束統計。
不能再推流假稱恢復舊場。使用者隨後明確授權「本機試錄沒問題，就直接公開」；
主代理會在以下試錄驗收全數通過後，建立同頻道、同主題的新公開場次。
Luna 的執行權仍限本機實作與試錄，避免兩位代理同時操作公開狀態。

## 已知證據（不是修復完成宣告）

- OBS 32.0.1 在 21:01:16 發生 c0000005，stack 頂端
  `YouTubeAppDock::DispatchYTEvent` → `OBSBasic::StreamingStart`。
- 原始紀錄：`C:/Users/liNao/AppData/Roaming/obs-studio/crashes/Crash 2026-09-19 21-01-17.txt`。
- 遊戲與 NanoJev 當時仍正常。重啟後 OBS 回到「無標題」預設場景，含系統音效
  與麥克風；不能直接推流。
- 音樂約 21:03 才加入，晚於記錄中的崩潰；不要宣稱音樂造成崩潰。
- 改 `rtmp_custom` 是待驗證的避障方式，不宣稱已修復 OBS 內部缺陷。

## Luna 實作範圍

允許修改 `tools/town-broadcast.mjs`、一個最小測試檔、
`tools/BROADCAST_README.md` 與 `tools/live-task.txt`。
可用正式 OBS WebSocket API 修復 WuxiaTown 隔離 profile/collection；僅在
串流、錄影都未啟動時切換。不要動使用者「無標題」場景的來源或音源。
不要直接修改 OBS 正在使用中的 JSON，不安裝套件或升級軟體。
主代理擁有本計畫檔；雙方不要同時編輯實作檔。

### 1. 保留現有入口，補上 prepare 與 preflight

- `prepare`：確認無輸出，確認 WuxiaTown profile/collection 確實存在，透過
  API 切換並讀回確認。遺失時報明確錯誤，不靜默改預設場景。
- 切到 WuxiaTown 後才在記憶體讀取既有串流設定，保留原 key，將 service
  改為 `rtmp_custom`、server 固定 `rtmps://a.rtmps.youtube.com/live2`。
  不輸出 key、不放進 argv、README、測試、Git 或診斷 JSON。
- 來源建立/補回需可重複執行，不重複建立音樂或字幕。可以修復已知安全來源的
  URL、文字、位置、靜音與音量；任何未知來源直接拒絕，不自動刪除。
- 4 個既有畫面來源 + 2 個音樂/授權來源。恢復合法音樂並確保 credit 可見。
- `preflight`：唯讀驗證，回傳簡短、去敏的檢查結果；失敗時非零結束。

### 2. 開播前檢查同時守住內容、音源和目的地

- profile、collection、program scene 都必須為 WuxiaTown。
- 僅接受已知的六個來源名稱與來源型別；逐一核對目前 scene 的項目，拒絕
  未知的 scene/group/巢狀來源，以及桌面、視窗、裝置、麥克風或系統音源。
- Town browser 僅能為 `http://127.0.0.1:8088/`，不可本機任意檔案；無可改變
  畫面的額外 custom CSS。檢查可見性與既定構圖，不讓字幕/黑色背景遮住整頁。
- 任務列只能讀 `tools/live-task.txt`；其他文字須符合既有標題與授權 credit。
- Browser Source 保持 muted。唯一允許出聲的是
  `assets/audio/Guzheng City.mp3`，loop、-24 dB、無監聽回送；核对檔案 SHA256
  `7d117a43cad22ff05b32340f2bd331368c48342f503eab85b1e5c403043d4be6`。
- 音樂來源存在時 credit 必須啟用且有完整作者、來源、CC BY 4.0 與修改資訊。
- 輸出為 1920×1080、30fps；service 僅允許上述自訂 RTMPS，key 非空。
- 純 RTMPS 不會套用 YouTube preset 的 encoder 限制。必須明確固定 H264
  NVENC、CBR 6000 kbps、AAC 160 kbps 與 2 秒關鍵幀，並檢查實際試錄輸出。
- 開播前實際確認 town 頁可讀、native snapshot frame 在前進；失敗明確拒播。
  既有 `stream --confirmed-public` 保留最後人為開播門檻。
- 啟動後檢查 outputActive 和 bytes/duration 有增加；不能因 StartStream 回
  `{}` 就宣稱正在直播。OBS 推流和 YouTube 已接收分開呈現。
- 本版不做無限自動重啟。斷線/崩潰回報失敗，不切回桌面或預設音源。
- 錯誤及診斷一律去敏；測試需驗證模擬 key 不會出現在輸出中。

### 3. 保留直接截圖與本機試錄

- 不需要 computer use 截 OBS 桌面。用既有 GetSourceScreenshot，輸出到
  `.runtime/town-broadcast-preview.png`。
- `record` 也必須通過內容/音源檢查，不要求使用者開播才能試錄。
- Luna 可以做本機試錄，不得自行開始/停止公開直播或操作 YouTube Studio。
- 實作後回報：修改檔案、實際執行的測試、目前 OBS 來源/串流狀態與未驗證項。

## 驗收門檻

1. 語法與小型離線測試：正確設定接受；wrong profile/collection、未知來源、
   巢狀來源、錯 URL、未靜音、錯音樂/credit、錯目的地全部拒絕。
2. prepare 連續執行兩次，來源仍只有六個，舊 key 保留且沒出現在紀錄。
3. 截圖人工檢查：只有雲水鎮＋任務列＋credit；沒有桌面/其他分頁/帳戶資料。
4. 本機試錄至少 30 秒，確認 video/audio streams、畫面在動、音樂有實際非零
   電平且沒有麥克風/系統音源。只收到「媒體播放中」不足以證明錄影有音訊。
5. 舊 broadcast 已結束。主代理在試錄通過後，依最新明確授權建立同頻道、
   同主題的新公開直播；不變更公開範圍或來源，不在試錄失敗時開播。
6. 開播後至少觀察 2 分鐘：OBS bytes/duration 持續增加、無新 crash file，
   Studio 收到串流；再做 10 分鐘持續運作驗證才稱為通過初步穩定性檢查。
   未完成的項目必須標示待驗證，不能把短暫開播叫作「完全穩定」。

## 已有資源

- Installed OBS: `C:/Program Files/obs-studio/bin/64bit/obs64.exe`。
- 設定根：`C:/Users/liNao/AppData/Roaming/obs-studio`。
- Authenticated WebSocket: localhost:4455；現有 helper 安全讀取設定取得密碼。
- WuxiaTown profile 及 scene collection 已存在；service.json 內是機密 key。
- Town: http://127.0.0.1:8088/；native diagnostics: http://127.0.0.1:55433/。
- 音樂及授權：`assets/audio/Guzheng City.mp3`、`assets/audio/ATTRIBUTION.md`。
- 任務字幕要如實顯示「直播工具修復／Luna 實作」，不能假稱戰鬥已完成。

## 方案依據與備案

### 主代理公開驗收（2026-09-19 21:48 台北）

- 最終本機試錄：`C:/Users/liNao/Videos/2026-09-19 21-33-47.mp4`，38.33 秒，
  H264 1920×1080 / 30fps、AAC 48k stereo；I-frame 每 2 秒。
  實際音訊 mean -46.7 dB / peak -25.9 dB；抽幀確認僅小鎮、任務列及音樂授權。
- OBS 21:37 開始推流，主代理在 Studio 點擊公開開播後，確認「直播／極佳」，
  並實際播放公開觀看頁，核對小鎮畫面。
- 新公開場：https://www.youtube.com/watch?v=ymdeYHk1I3k 。舊場 BXKN16xAD6g 已結束。
- 21:47:59 OBS outputActive=true，duration=637766ms、bytes=491429934；
  與 21:43 的 370433ms / 285439487 bytes 相比持續增加。最新 crash 仍是 21:01:17。
- 通過本機試錄與超過 10 分鐘的初步運作檢查，不代表長時間完全穩定或 OBS 根因已修復。
  六個安全來源保持不變，錄影停止，公開直播持續。

### 主代理第一輪驗收紀錄

- 已獨立執行 `preflight` 與 6 個離線測試，當時全通過。
- `.runtime/2026-09-19 21-26-49.mkv` 長 46.12 秒，H264 1080p30 / AAC48k
  stereo；實際音訊 mean -42.9 dB / max -24.6 dB，並非靜音。
- 5 秒和 35 秒抽幀確認只有小鎮與任務/授權列，人物位置與時間前進。
- 但後續 21-28-46 試錄的實際 I-frame 時間為 0.021、8.354、16.688、25.021、
  33.354 秒，因此**尚未通過公開直播編碼驗收**。Luna 正修正為 2 秒。
- 為此允許 Luna 在 stream/record 均停止且 encoder JSON 尚未使用時，
  只建立/保留修改 WuxiaTown 的 `streamEncoder.json`，用正式 API 設定
  Advanced output 並重新載入。不可修改其他 profile、不可直接 kill OBS。

官方 API 支援自訂 RTMP service 的 server/key 設定：
https://github.com/obsproject/obs-websocket/blob/master/src/requesthandler/RequestHandler_Config.cpp

官方 YouTube dock 原始碼（供檢查 service gating；不能以 master 取代本機版本證據）：
https://github.com/obsproject/obs-studio/blob/32.0.1/frontend/docks/YouTubeAppDock.cpp

主代理已核對 32.0.1 的 IngestionStarted：只有 IsYouTubeService(service) 為真才
呼叫 DispatchYTEvent。這支持「清除 YouTube preset service、用 custom RTMPS」
的避障推論；不是已驗證穩定性或內部 crash 根因修復的證明。

如果純 RTMPS 仍在同一路徑崩潰，保留 evidence 並回報主代理。下一版才評估
專用瀏覽器渲染＋FFmpeg。不要先用桌面擷取、每幀截圖管線、改驅動或重裝整套
去繞過問題；這些都不是本版計畫。也不要繞過先前對下載版 OBS 啟動的限制。
