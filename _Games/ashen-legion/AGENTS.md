# 森林領主 UI 工作入口

繼承上層 `AGENTS.md` 的分支與引擎／玩法責任規則。

修改本遊戲的介面、素材、排版、互動或響應式前，先讀：

1. [UI-PRODUCTION.md](UI-PRODUCTION.md)：製作流程、驗收門檻與交付格式。
2. [DESIGN.md](DESIGN.md)：現行美術方向與共用元件。
3. 涉及裝備店時，再讀 [商店詳細規格](design-v1/UI-DESIGN-GUIDELINES-20260919.md)；涉及資源／重骰時讀 [經濟規格](tests/CURRENCY-SPLIT.md)。

保留使用者核准方向與既有未提交修改。歷史預覽不是現行規格，測試 fixture 不是自然遊玩證據；沒有執行的驗證不可宣稱通過。不要只手改生成的 `main.luau` UI 區或 `dist/web`，應修改其正式來源。

純文件整理不需重建遊戲；實作變更依製作規範執行對應測試。此入口不授權擴大改版、改其他遊戲、安裝工具或自動 commit／push。
