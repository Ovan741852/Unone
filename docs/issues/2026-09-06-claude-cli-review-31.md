# Claude CLI review 31

日期：2026-09-06。狀態：completed，無新增可行動 P1/P2。

範圍為 immutable `4a128d7..c187df8` asset corrections；使用 Claude CLI
readonly plan mode、無 session persistence、只允許 git show/diff/rev-parse/grep/ls-tree。
程序 exit 0，未修改檔案、未跑測試或編譯。

版本：2.1.260。命令選項：`claude -p <bounded readonly diff review prompt>
--permission-mode plan --permission-prompts none --no-session-persistence
--output-format text --safe-mode --strict-mcp-config --disable-slash-commands
--tools Bash --allowedTools "Bash(git show *)" "Bash(git diff *)"
"Bash(git rev-parse *)" "Bash(git grep *)" "Bash(git ls-tree *)"`。
Prompt 指定最多5項 introduced P1/P2、禁止改檔/建置/測試，並要求保留既定
subset replacement（非 implicit union）契約。無新增建議需採納或駁回。

審查核對 active AssetSpec 與 token、file diagnostics 去重、pack 寫入前檢查、
install report 在 generation 寫入前驗證、Web graph validation 與 corrupt pointer
fail-closed、required bundles 欄位，以及 subset replacement 不隱含 union。
未發現此 diff 引入的具體 P1/P2。不代表未變更 helper 完整重審或執行驗證。

限制：Claude 有讀 diff 中既有 review/docs 以辨識已知問題，並表示再沿實作核對；
因此這是定期 source review，不是隔離盲評。原始輸出保留於本次工具執行紀錄；
本文是摘要，不冒充逐字 transcript。
