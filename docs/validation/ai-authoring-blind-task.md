# 從封裝自主建立一個小遊戲

你只會收到一份 immutable engine package、本企劃，以及空的 output directory。
企劃和 package 位於 output 之外。只能從包內 CLI/MCP/help/文件/型別學會使用，
不得讀 engine source、其他遊戲、製作計畫或作者測試／review。不要修改 package。

## 遊戲企劃

做一個小型 2D「到達標記」遊戲。玩家從起點向右移動；按住一個語意 action
前進，在時間限制內到達標記就成功，時間到仍未到達就失敗。成功／失敗後停止
移動；提供重新開始的操作。具體速度／距離／時間由你明確寫進遊戲企劃補充，
不可倚賴實際 wall clock；同 seed 與 input sequence 必須可重播。

至少有 player、target 兩個不同 id；可自製簡單 SVG，或從 https://itch.io/game-assets
取得授權明確且目前 host 支援的素材做最小 Web 表現。外部素材須記錄來源、作者、
授權內容／取得日期、署名要求、實際檔案與 hash；付費或授權不明先回報，不自行購買。
此授權僅放開素材來源，不允許讀其他遊戲程式或引擎 source。
畫面能看出目前狀態。無需音效、Spine、3D、native/mobile 新 renderer。
本任務不要求補尚未存在的引擎系統，不能把未測 host 宣稱 passed。

## 需要交付的證據

1. 從零找出建立專案、查看可用機制與跑測試的入口；保留第一批命令與回傳。
   不能把 scaffold 的示範測試當成真正遊戲測試。寫出自己遊戲的成功、失敗、
   停止移動與重新開始案例，證明故意改壞相關遊戲規則時會被測試擋住，再還原。
2. 以有空白／Unicode 的合法 output path 完成流程；產生自己的場景與腳本。
   再次對已存在專案嘗試初始化，確認不會覆寫你已做好的內容，前後 hash 可比。
3. 在自行保存的有效 scene 基礎上測一個未知欄位、一個巢狀錯字與重複 entity id，
   記錄拒絕理由如何指向位置、能否只靠文件修回來。每次由受控樣本恢復，
   不手改 engine/package，不把預期的無效輸入拒絕當產品 blocker。
4. 找不到玩法動詞對應 API 時，記錄如何分辨需要組合既有 primitive，還是
   企劃真的需要不存在的 engine capability；不能自己發明 API 或默默包繞路。
5. 建立並啟用完整內容 generation，證明發佈內容與作者檔案相符、原生本地
   verified read hash 正確；在可用的包內 Web host 實跑並保留新截圖與語意狀態。
   Native-local evidence 不代表 Web storage 或所有平台呈現已驗證。

遇到真正的引擎／文件問題，立即回報 `[BLOCKER]`：第一個命令、完整結果、
可重現步驟、影響範圍、已確認事實與推論。先停受影響步驟，可做其他獨立案例；
不要等交付才集中回報，不要縮小原要求來通過。

最後回報 ready_for_review，包含實際檔案清單、命令/JSON/hash、測試與畫面證據、
第一次卡點和仍未驗證的範圍。你不能自行修改七款正式遊戲的 acceptance matrix。
