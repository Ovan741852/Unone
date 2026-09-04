# Issue: 3D Racing fixture exposed Windows JSON path separator error

日期：2026-09-05  
範圍：業務端 fixture / project config，不是 engine architecture

## Symptom

第一次執行 3D Racing test 時，engine 回傳 `PROJECT_CONFIG_INVALID`，原因是 `project.unone.json` 的 `test_files` 使用 Windows 反斜線但沒有 JSON escape。

## Root cause

測試檔路徑是 JSON 字串，`tests\accelerate-camera.test.json` 中的 `\a` 被當成無效 JSON escape。這是 fixture 格式問題，不是 ProjectPaths 的 path resolution 或 runtime 架構問題。

## Fix

改用 portable JSON path separator `/`。ProjectPaths 仍在 host 端依平台 join，遊戲端不需要知道平台差異。

## Prevention

新 project/test manifest 一律使用 `/`；若 validator 再遇到 invalid JSON，先保留 engine 的 `PROJECT_CONFIG_INVALID` facts/source，再修正業務端檔案，不在 engine 加入對無效 JSON 的相容解析。
