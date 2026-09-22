# 同一專案 Web / Native 快速切換

狀態：Luna 實作完成；主代理已通過 Core、Windows GPU、Manager 與 Viewer 完整切換驗收，BlueStacks TEST App 的 Web 預覽亦通過。未發布／更新正式 Viewer。2026-09-19。詳見 [驗收紀錄](../evidence/2026-09-19-preview-target-switch.md)。

## 定位與範圍

通用製作／啟動工具，不是 gameplay primitive。Unone CLI 負責 runtime 相容性、同步、產物與啟動描述；Koncrate Unone plugin／host 管理本機程序生命週期與授權，Viewer 是同一 API 的薄介面。AI 不需要 Viewer 才能產生及啟動兩種產物。

本輪完成同一專案 Web ↔ Windows Native 的本機啟動切換。手機繼續使用 Web 預覽，不提供 native 桌面串流；Android 原生打包沿用現有出口，iOS native 未實作，不冒充可用。切換是重新啟動，不承諾跨 VM 的執行中存檔遷移。HTML-only／Spine 等限制照實顯示，不偷偷降級或刪掉專案設定。

## Core 合約（Luna Core 實作）

1. 新增 `game --sdk <trusted-sdk> --project <project> --json project prepare --target web|windows --output <new-directory>`；可選 `--runtime-id`、`--development`，與現有 SDK export 一致。
2. 先只讀檢查目標、SDK/runtime/variant/系統與 presentation 相容性；通過才沿用 `project sync` 的 pack → verify → activation，再沿用 SDK export。失敗不宣告 ready，不覆蓋既有 output。避免另寫一套 runtime 選擇規則。
3. JSON 回傳契約 `unone.project-prepare.v1`：status、target、project/output、sync/export 證據、runtime 選擇，以及 `launch`。Web launch：`kind: static, root, entry: index.html`；Windows：`kind: native, executable_source: sdk-runtime, executable, args: [--root, <output>], cwd`。互動預覽使用可信 SDK 的共用 runtime；輸出作資料載入，獨立交付的 export 仍包含相同雜湊的 runtime。不可相信遊戲自訂 shell。
4. 非零退出與具體 diagnostic code / reason / recovery。支援機器發現：CLI help、文件、現有 MCP/Scout 適用的 discovery；不要額外改 engine gameplay。
5. 沒改引擎不重新編譯 Rust；使用預編 runtime。正確性先於 cache；若無完整內容指紋，不能以 mtime 當快取命中。

## Viewer 合約（Luna Viewer 實作）

1. 遵循 Koncrate-Editor AGENTS 與 UI skill。Unone 專用邏輯只放 `plugins/koncrate/unone`。延用現有 project identity、local authorization、preview lifecycle 與隔離 origin，不開任意命令／任意路徑 endpoint。
2. 本機專案顯示一個清楚的目標選擇（Web／Windows Native）與啟動、停止、重新啟動、目前狀態；不增重複分頁。既有遠端 Web 流程維持，Native 明示「在來源電腦開啟」，不回傳假的 browser URL，不對手機宣称可觀看 native。
3. API 輸入只接受已授權 project ID、allowlisted target/action；runtime/SDK 路徑來自本機可信設定，不接受 HTML 指定程式路徑。執行需沿用或新增等價的明確本地授權，靜態分享不授予執行權。
4. 呼叫上述 Core prepare；可先對契約測試，最終必須使用真 CLI 驗收。輸出位於 host 自有專案範圍的全新 generation 目錄；UI 不接觸任意磁碟路徑。
5. 受管理的 native child process：bounded stderr、exit/error、cancel/stop、shutdown/revoke，不能留孤兒、不能使用 shell:true。不得用 CLI 舊 debug silhouette preview 代替正式 native player。
6. 每專案切換序列化／拒絕競態；成功啟動候選後才停止舊 session，失敗保留原 session。新 native 成功至少需要可觀察的 renderer-ready，而不是只 spawn 成功；若現有 player 無 ready 訊號，回報給主代理協調最小 protocol。
7. status/query 可供 AI 操作且錯誤具體；MCP/Scout/Viewer tools 沿用現有 discovery。

## 驗收

- Core：target/runtime 缺失、native unsupported systems、verify failure、existing-output 拒絕；不能破壞舊 generation。
- Host：Web → Native → Web，stop/restart、重複點擊、prepare 中 cancel、程序崩潰、撤銷／退出；權限與路徑測試。
- 真實 Windows：使用同一簡單專案開啟 Web 與正式 wgpu native，取得兩端畫面與 runtime／內容證據。
- BlueStacks：既有手機 Web 預覽至少 emulator smoke；不能把 native 在 Windows 開窗算成 Android native 驗收。
- 保留命令、結果、截圖、未驗證邊界；跨 backend 色差獨立追蹤，不宣稱本輪已消除。
- 不自動 commit/push/deploy，不改分支；保留工作樹既有修改。

## 驗收後架構修訂：共用 SDK host

Windows 實測在 executable canonical 路徑超過 260 字元時，describe 與
headless 正常，但圖形初始化會 fast-fail；相同 binary 置於短路徑，搭配
長的專案資料 root/cwd 則正常。標準 longPathAware manifest 未消除圖形
初始化問題。現有證據指向圖形系統讀取 executable 路徑的限制，尚未用
crash dump 確認是哪個外部模組。

永久調整為「SDK runtime 是程式、專案 generation 是資料」：不以縮短專案
路徑／隱藏別名繞過。Core 與 Viewer 都核對固定 SDK scope 和相同雜湊，
SDK 本身安裝過深時需在啟動前回報具體原因。這也避免从可編輯的專案
目錄啟動 runtime，獨立 export 能力不變。
