# Unone validation matrix

`acceptance-matrix.json` 是遊戲業務端的長期驗收清單，不是 engine runtime 設定。Angry Birds 2D 是中期 capability smoke；最後的 engine acceptance 需要以下七個 `final_gate` 全部為 `passed`：

1. 3D racing
2. Red Alert-style RTS
3. Dota-style idle battle
4. AVG romance
5. auto chess
6. slot machine
7. fish machine

每個 gate 至少需要專案設定、可重播測試、遊戲 README/AI workflow、validation report 與 native/Web/mobile evidence。只存在程式碼、截圖、compile 或單一 happy path 都不能標記 `passed`。

從 engine repo 執行：

```powershell
.\scripts\validate-game-matrix.ps1 -MatrixPath D:/Projects/Unone_Games/validation/acceptance-matrix.json
```

目前命令預期會以非零狀態回報尚未通過的 final gates；這是防止誤報的設計，不是 engine test failure。
