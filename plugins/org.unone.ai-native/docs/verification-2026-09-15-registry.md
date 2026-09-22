# 評測紀錄與失效判定：2026-09-15 驗收

結果：`org.unone.ai-native` 0.2.0 的登錄／歷史／版本失效機制完成本機回歸。
本次沒有建立任何真實插件的新 AI-native 分數，也沒有把 09-11 的歷史評測偽裝成新版通過。
原來十題 rubric/權重/評分上限不變。Core runtime 與 Viewer GUI 本輪未修改。

## 可檢查的證據

- [regression-001.capture.json](registry-2026-09-15-regression-001.capture.json)：真正 recorder 輸出，含完整 TAP、選定 15 個程式／測試檔案指紋與 probe 指紋。
- 開始 `2026-09-15T09:57:57.519Z`；Windows x64，Node v24.14.1；1,543.641 ms。
- **40/40 pass，0 failed／skipped**；exit 0，無 timeout、output truncation 或 capture 期間 source 變更。
- [registry.test.mjs](../test/registry.test.mjs) 是 17 個新增測試，原評測／discovery 的 23 個回歸保留。
- 全部寫入測試使用新建 OS temp fixture；沒有操作真帳號、付費模型、網路、原企劃或使用者的評測目錄。

## 「真的有效」的驗收，不只看有檔案

| 固定案例 | 觀察到的結果 |
| --- | --- |
| REG-001 登錄／查詢 | 保存原分數、scope/version/environment、評分器指紋，四種時間意義分開 |
| REG-002 過期負對照 | 合成 fixture 原保存 result.index 仍是 100；改 source 後 status.score=null、needs_revalidation，列出 source.mjs 和實際/預期 hash |
| REG-003 無版本號更新也改了內容 | subject hash 改變仍會失效；不只比版本字串 |
| REG-004 未達標／未知 | 失敗 capture 支持的 25 分保持 needs_work；全未知保持 insufficient_evidence / null，不變綠 |
| REG-005 原碼以外的依賴 | manifest、capture、probe、report 遺失都待重驗；另在測試專屬複本更新評分器版本，也清除目前通過狀態 |
| REG-006 遺失回覆重試 | 原 ID 再請求 created=false，原始 bytes/time 不變，source 已漂移也不冒充重驗成功 |
| REG-007 並發 | 五個相同 ID 同意圖只一個 created=true；兩個不同報告搶同 ID 只一個成功，另個明確 conflict |
| REG-008 寫入與範圍 | host 未 opt-in 拒絕；payload 無法授權；路徑穿越／Windows reserved names／向外 junction 被拒，外部目錄沒有新增檔案 |
| REG-009 損壞紀錄 | checksum 不一致，不提供可信歷史分數；API value=null 與具體修復方法 |
| REG-010 公開流程 | 真 Node CLI 與 stdio：recommend → describe → register → status → 改壞 source → 待重驗；不只 mock 內部函式 |

上述 100／25 是**刻意合成的 validator fixture**，不是 AI-native 插件自身評分。
有效性結論是避免舊成績誤用、重複寫入和混淆時間；不推論提高真實 AI 成功率、節省 token 或商業可用性。

## 現有 Unone host 實際相容

實際執行：

```powershell
node scripts/verify-host.mjs --host C:/Users/liNao/AppData/Local/UnoneValidation/target/debug/game.exe --project D:/Projects/Unone
```

回覆 `UNONE_AI_NATIVE_HOST_SMOKE_OK`：pluginVersion=0.2.0、4 個 bootstrap tools；
catalog 十題、historyRead=true、registryWriteDenied=true、staleRejectedAndRepaired=true。
此命令唯讀（只在自己的 temp 保存請求 JSON），沒有在 Unone 專案新增 assessment。
CLI binary SHA-256：`fc022e0058b9b4e29eff9f2ab0b07d3899242aee8fd1e8f1513813b8d9f906b5`。
另跑 `node cli.mjs test` passed；「插件的認證紀錄 分數時間」實際推薦 history，再推薦 status。

## 下次重跑

在插件目錄：

```sh
npm test
node cli.mjs test
```

要保存下一次完整證據，使用 README recorder，script 為 `scripts/verify-registry.mjs`，
root 為本插件目錄，subject 依 regression-001.capture.json 的清單列出，output **必須是新的路徑**。
先審閱腳本／測試是否仍只操作合成 fixture。不能重用舊 output 或只修改舊 hash。
原 capture 可用 snapshot 核對 subject/probe 是否仍一致；改動後先跑新 capture 再更新驗收記錄。

## 尚未聲稱完成

陌生 subagent 盲體驗、正式插件重評、macOS／Android／iOS、Viewer badge、商店同步／簽章、
背景自動掃描與 release CI 接線。`.unone/` 是本機且被 Git 忽略；需明確備份，不當成已上傳。
hash 不是第三方認證；選定檔案以外的新增檔／依賴也不在 freshness 保證內。
本輪未 commit/push、部署或更新使用者已安裝的 Viewer。
