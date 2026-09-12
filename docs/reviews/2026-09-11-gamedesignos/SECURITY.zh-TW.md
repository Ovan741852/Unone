# GameDesignOS 安全檢查與採用範圍

結論：**可以在 YesSir 使用這次選定的兩個 Markdown SKILL。沒有將整套 runtime 或附帶腳本視為已通過安全認證。**

來源：[DY-2026/GameDesignOS](https://github.com/DY-2026/GameDesignOS/tree/ada4bf9e60c2c90a4c84866e4bfd191e3767d164)，固定 commit `ada4bf9e60c2c90a4c84866e4bfd191e3767d164`，檢查日 2026-09-11。SKILL frontmatter 為 `1.3.0-candidate`。

## 檢查證據

- 透過 GitHub API 取得未截斷的檔案樹，再下載該 commit 的 archive。解壓前檢查路徑不會逸出目錄，且沒有 symlink。
- 467 個檔案逐一核對 Git blob SHA-1；選定的 82 個檔案另記 SHA-256。安裝後 82 個檔案全部與檢查版本相符。
- 檢視 SKILL 指令、agent metadata、需要使用的 references／templates，以及套件依賴、建置、同步、網路和檔案操作入口；對 repository 文字掃描命令執行、憑證、外傳、刪除及指令覆寫模式。
- 選定兩包共有 53 個 Markdown、11 個 JSON、8 個 YAML、10 個範例圖片，沒有 Python、JavaScript、shell、DLL 或 executable。`agents/openai.yaml` 只包含顯示名稱、描述和預設 prompt。
- 這是靜態檢查與使用範圍限制，未逐行形式驗證整個 runtime，也未安裝依賴或執行第三方程式做沙箱動態分析。

詳細來源鎖定與檔案雜湊：[source-lock.json](D:/Projects/YesSir/.agents/skills/gamedesignos-source-lock.json)。可重跑的完整性檢查位於本機 `.toolcache/gamedesignos-audit/verify-source.mjs`，`--installed` 會驗證安裝內容。

## 有副作用的部分

| 部分 | 實際行為 | 本次處理 |
| --- | --- | --- |
| `scripts/private_translation_workflow/` | 從環境變數讀 MiniMax／Hailuo key，將文件內容 POST 到指定或 MiniMax endpoint；部分流程有輸出覆寫／清理 | 沒有安裝或執行，沒有提供專案內容給這些 API |
| `examples/hosts/openai_compatible.py` | 預設產生含完整 prompt 的本機 preview；`--execute` 可向環境變數指定 endpoint 發送；接受 http 或 https | 沒有使用這個 host，沒有建立額外模型帳號或金鑰 |
| `scripts/sync_global_skill.py` | 執行驗證程式，移動既有全域 skill 成備份，刪除同步暫存目錄，再安裝到 OpenCode 全域位置 | 沒有執行；使用既有 Codex installer 的 `--dest` 安裝到專案 |
| `setup.py` 與 Python runtime | build hook 複製資源並刪除 build 內舊資料；runtime 可寫 workspace、打包／覆寫輸出 | 沒有跑 `pip install`、setup 或 runtime CLI |
| `pyproject.toml` | runtime 依賴為 `PyYAML>=6.0`、`jsonschema>=4.20`；build 為 `setuptools>=68`、`wheel`，只有下限，沒有完整鎖版本 | 本次 Markdown 使用方式不需要這些安裝，不對未解析依賴聲稱無漏洞 |
| analyzer 工具安裝指南 | 含 `winget install Gyan.FFmpeg` 和 `pip install --user yt-dlp`，供缺少影片工具時使用 | 本次使用截圖、程式與執行結果，不需要額外工具安裝 |

這些是需要辨識的功能與權限邊界，**不是發現惡意程式的證據**。可定位原始碼：[翻譯 API](https://github.com/DY-2026/GameDesignOS/blob/ada4bf9e60c2c90a4c84866e4bfd191e3767d164/scripts/private_translation_workflow/minimax_pdf_translate.py)、[外部模型 host](https://github.com/DY-2026/GameDesignOS/blob/ada4bf9e60c2c90a4c84866e4bfd191e3767d164/examples/hosts/openai_compatible.py)、[全域同步](https://github.com/DY-2026/GameDesignOS/blob/ada4bf9e60c2c90a4c84866e4bfd191e3767d164/scripts/sync_global_skill.py)、[套件依賴](https://github.com/DY-2026/GameDesignOS/blob/ada4bf9e60c2c90a4c84866e4bfd191e3767d164/pyproject.toml)。

## YesSir 採用方式

- `.agents/skills/game-experience-analyzer`：畫面與玩法證據、問題卡、驗證方案。
- `.agents/skills/game-experience-density-optimizer`：把有證據的體驗問題縮成單一變因的實驗。
- 透過既有 `skill-installer` helper，明確指定上述 commit 與專案 `.agents/skills`；沒有修改使用者全域 skill，也沒有改動 YesSir 的 AGENTS.md。
- 保留上游 MIT License。範例圖片只作 SKILL 參考，沒有挪入遊戲資產或公開發布。
- 本輪直接讀取已核對的 SKILL 使用；後續回合可從專案 skill 目錄載入。更新版本時重新檢查與核對，沒有加入自動更新流程。
- SKILL 的 Human Gate 沒有阻止這次已授權的本機安裝與專案檢視。此次完成的是檢視報告與可重現證據，沒有替使用者批准正式上線實驗。

## 使用後評價

適合保留。它對這個專案最有幫助的是：把「畫面看得到」「程式測得到」「只是設計假設」分清楚，要求問題對應證據及驗收方法。實際發現見 [專案檢視](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/REVIEW.zh-TW.md)。

有兩個使用限制：schema 偏重影片／截圖，原始碼和模擬紀錄需要另外保留來源類型；ED 公式是設計啟發式，不能當成經驗驗證的科學量表。這次沒有把機器快測推成玩家勝率、留存或主觀爽感。
