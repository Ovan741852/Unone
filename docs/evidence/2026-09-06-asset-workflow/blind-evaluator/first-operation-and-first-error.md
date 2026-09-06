# 首個操作與首次錯誤保留

本記錄保留本輪實測的首個操作與首次錯誤；時間以本機 Asia/Taipei 工作階段為準。

## 首個操作

原始命令（在任何遊戲檔案修改前）：

```powershell
$ErrorActionPreference = 'Stop'
$taskPath = 'C:\Temp\unone-asset-gate-20260906\task.md'
$engineRoot = 'C:\Temp\unone-asset-gate-20260906\engine'
Write-Output '=== TASK.md ==='
Get-Content -LiteralPath $taskPath -Raw
Write-Output '=== ENGINE ONBOARDING CANDIDATES ==='
$docs = Get-ChildItem -LiteralPath $engineRoot -Recurse -File -Force | Where-Object {
  $_.Name -match '(?i)(^|README|AGENTS|GETTING|ONBOARD|INTRO|QUICKSTART|START|GUIDE|MANUAL|USAGE|DOC)' -and $_.Extension -match '(?i)^\.(md|txt|rst|json|yaml|yml)$'
} | Sort-Object FullName
if (-not $docs) { Write-Output '(none found)' }
foreach ($d in $docs) {
  Write-Output ("--- " + $d.FullName + " ---")
  Get-Content -LiteralPath $d.FullName -Raw
}
```

結果：成功（exit 0）。完整企劃文字與封裝內入門候選文件被讀取；本步沒有寫入 engine、企劃或遊戲目錄。

## 首次錯誤

原始命令：

```powershell
& '.\bin\game.exe' --project 'C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評' ui preview --strict
```

原始輸出（保留原文）：

```text
[Error] UI_TREE_NOT_PUBLISHED: 遊戲還沒有發布 UI tree
跑了 1 frame 之後 observation 沒有 ui；遊戲要先呼叫 api.ui.setRoot。
```

分類：初始化 scaffold 尚未發布 UI 的前置狀態；不是由無效 asset input 造成，也未把它冒充為最終通過。後續作者明確發布 UI tree 後，重跑 `ui preview --strict` 與 `verify`。

## 後續非產品錯誤

建立 evidence/game 子目錄時另有一次本代理命令 typo：`New-Item -ItemType Directory -LiteralPath ...` 被 PowerShell 拒絕（`New-Item` 不接受該參數）；已改用明確 `-Path` 重跑成功。這不影響首次錯誤的順序，也不是 engine/package blocker。
