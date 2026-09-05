# Bundle pack output 與 authoring input 衝突

日期：2026-09-06。狀態：candidate_delivered / regression_pending；
限定 source review 已覆核，尚未回歸通過。

## 重現與影響

主代理在獨立產生的 probe，以候選提交 `4a128d7` 的 CLI 執行
`bundle pack --output assets/manifest.json`。該檔原本是有效的 authoring asset
manifest，指令卻 exit 0 / ok=true，將它覆寫成 version 2 bundle manifest，
並改 project config。新 bundle metadata 對 asset-manifest 的 hash 仍為覆寫前
的值，既損失宣告又產生自相矛盾的發佈內容。

[完整結構化證據](../evidence/2026-09-06-asset-workflow/output-collision-before.json)。
只動到主代理自己的暫存專案；沒有改動 Unone_Games 或使用者的作者檔案。
另測 `--output scripts/main.luau` 被 JSON parse 拒絕且 script hash 不變，
不得把那個 negative control 寫成已重現 script 覆寫。

## 判斷與最小修正

這是 pack 共用寫入邊界的 P1 資料完整性問題，不是遊戲業務邏輯。
路徑位於專案內並不代表它適合當 generated output；需在任何寫入前檢查
output manifest、archives／相關 staging 路徑與 authoring inputs 不重疊。
由原 bundle owner Euclid（Luna/max）處理，主代理不擴張成全引擎 IO 重寫。
原 owner 靜態核對 `4a128d7^`（`04af786`）確認此缺陷已存在；
不是本輪新引入，但直接破壞 authoring 權威，因此納入修正。

回歸須確認拒絕後 config、asset manifest、source 等保持原樣，未產生部分
pack outputs；正常重打包仍成功。D 槽空間決策未完成前僅修改程式與測試，
暫不啟動大型 build。

候選 patch 已加入 `BUNDLE_OUTPUT_COLLISION` 與完整檔案樹 before/after 回歸，
包括 staging、大小寫、Unix link alias、未建立的目錄／檔案衝突。
尚未編譯／執行，不將已寫測試視為通過。

獨立 code reviewers 的固定目標仍為 `4a128d7`；沒有把此反例事先提供给他們。
