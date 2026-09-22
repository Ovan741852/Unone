# YesSir 遊戲倉庫

2026-09-22：依使用者要求，將既有遊戲工作目錄首次上傳為私人倉庫
`Ovan741852/YesSir`。預設分支沿用 `master`。

本倉庫根目錄對應原來的 `D:\Projects\YesSir\_Games\ashen-legion`，
包含目前工作副本的遊戲原始碼、素材原檔、設計文件及測試證據。
遊戲顯示名稱沿用現有設定。外層 `D:\Projects\YesSir` 的 Unone 遠端不變。

圖片、模型、字型、影片與 bundle 使用 Git LFS；clone 前須安裝 Git LFS，
並以有權存取私人倉庫的 GitHub 帳號登入：

```powershell
git lfs install
git clone https://github.com/Ovan741852/YesSir.git
cd YesSir
git lfs pull
```

`dist`、快取、下載的工具環境、本機執行狀態、Blender 備份及機密檔案不入庫。
生成的 `main.luau` 與其正式來源均保留；後續修改仍應遵守 AGENTS.md。

這次是現有遊戲來源的首次保存，不是引擎拆分或遊戲改版。若要沿用現有
建置工具，可將本倉庫 clone 到相容 Unone 工作目錄的 `_Games/ashen-legion`。
目前 README、Play.ps1 與部分工具仍引用外層 Unone 的 scripts、runtime、
私人插件或 `_Tools`；單獨 clone 不代表已包含引擎、完成建置或可直接預覽。
Viewer 匯入後須另外確認建置能力、AI 授權與成品預覽，不能自動繼承舊授權。

此次未修改玩法數值，也未重新執行遊戲驗收；既有報告保留原日期與適用範圍。
