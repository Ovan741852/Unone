# Decision 0005：Luau analyzer 是開發期工具，不進遊戲 runtime

## 決策

Unone 的遊戲 runtime 內嵌 Luau 執行器；完整型別檢查由官方 `luau-analyze` 在開發／CI 階段執行。CLI 提供 `game check` 做 syntax + entrypoint contract，`game check --types` 額外啟動 analyzer。

## 原因

- 型別分析是開發期需求，不應增加 iOS、Android、Web 遊戲 binary 的體積與攻擊面。
- 直接使用官方 analyzer，避免在 Rust 裡重寫或錯誤模擬 Luau type system。
- analyzer 缺失或失敗要有明確 diagnostic；不能因為 runtime 能執行就宣稱型別檢查完成。

## 版本風險

runtime 使用 `mlua` vendored 的 Luau；analyzer 是獨立 executable。兩者語言版本、flag 與標準函式庫設定必須在 CI 固定並記錄，否則可能出現「analyzer 通過、runtime 不接受」或相反的漂移。第一階段只對入口腳本做 adapter；多模組依賴與 generated API contract 會在實際遊戲需要時加入。

## 本機驗證

本次使用官方 Luau 0.734 Windows binary，放在被 `.gitignore` 排除的 `.toolcache/`，對 `minimal-2d/scripts/main.luau` typecheck 通過。這個 binary 不提交到 repository。
