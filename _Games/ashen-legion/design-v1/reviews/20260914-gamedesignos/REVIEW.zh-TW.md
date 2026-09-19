# GameDesignOS 實際套用：新版戰鬥回饋檢視

## 樣本範圍

3 張 skill-vfx-v1 正式遊戲截圖（桌面、有／無 Bloom、390×844 模擬手機），輔以來源碼與自動化 QA；沒有真人試玩紀錄，也未走完 20 分鐘。

- 可判斷：靜態資訊層級、手機尺寸中的場地與控制配置、刀光在有／無 Bloom 時的可見性、來源碼所定義的標籤顯示規則。
- 不可判斷：主觀爽感或操作手感、真人辨識率與疲勞、20 分鐘節奏、養成通關難度、留存、付費與真實四人競爭體驗。
- 關鍵未知：實體手機可點擊性、怪物潮峰值下文字辨識率、新人是否理解破防不等於中獎、技能組合來源能否被玩家辨認。

## 採用結論

可以參考，而且已在本輪實際使用 analyzer → 問題卡 → optimizer 的流程。GitHub HEAD 與專案 9 月 11 日檢查版本均為 `ada4bf9e60c2c90a4c84866e4bfd191e3767d164`；82 個已安裝檔案全部相符。沿用已檢查的兩包 Markdown skill。

[先前安全範圍](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/SECURITY.zh-TW.md)；本輪結果見 `security-recheck.json`。没有把整套 runtime 或外部模型 host 當作已通過認證。

本輪路由為 `ux_ui`，輔助 `problem_diagnosis`，診斷包 `none`。品類採肉鴿構築，僅借用 ARPG 的回饋可讀性鏡頭；固定發射的遊戲不套用走位閃避。

## 實機證據與判斷

### E001 — 場內中央至下方

![E001](D:/Projects/YesSir/_Games/ashen-legion/tests/vfx-polish/production-spear.png)

**可見事實：** 三條帶怪物名字的「未開獎」標籤與傷害字、旋轉刀光同時出現在戰鬥區。

**設計含義：** 小怪未中獎資訊需要被理解，但重複姓名條可能分散玩家辨認命中與獎額的注意力；尚未證明真人疲勞。

**下一步：** 建立本機 B 樣式：未鎖定且非即將破防的小怪不顯示完整未開獎姓名條；其他未開獎提示最多一條。保留實際未中獎狀態、目標狀態與獎額。

**置信度：** 靜態觀察 0.94；主觀體驗仍待驗證。

### E002 — 全幅及底部控制區

![E002](D:/Projects/YesSir/_Games/ashen-legion/tests/vfx-polish/production-mobile.png)

**可見事實：** 390×844 畫面中場地集中在中央小區域；上下存在大塊非戰鬥區域，兵種名與價格靠近按鈕下缘。

**設計含義：** 直向畫面應獨立設計構圖，保全整場不等於能清楚辨識所有小怪；尚未證明實體手機誤點。

**下一步：** 獨立做直向構圖版本，縮減上方說明區留白並增加戰鬥區；維持正方形碰撞與固定玩家位置，重新驗證四面牆可見及點選投射落點。

**置信度：** 靜態觀察 0.94；主觀體驗仍待驗證。

### E003 — 下半部旋轉命中

![E003](D:/Projects/YesSir/_Games/ashen-legion/tests/vfx-polish/production-no-bloom.png)

**可見事實：** 關閉 Bloom 的畫面仍有清晰的青白旋轉弧，傷害值與金幣數字同時可見。

**設計含義：** 刀光在無 Bloom 時仍可見，有清楚形狀作支撐；後續應以此為最低可讀性基準，不能由此推定所有技能都好辨認。

**下一步：** 所有新技能同時保存開／關 Bloom 與怪潮畫面。

**置信度：** 靜態觀察 0.94；主觀體驗仍待驗證。

## 優先問題

| 優先 | 問題 | 證據 | 最小改動 |
| --- | --- | --- | --- |
| P1 | 非目標小怪的「名字 · 未開獎」重複佔用戰鬥焦點。 | E001 | 建立本機 B 樣式：未鎖定且非即將破防的小怪不顯示完整未開獎姓名條；其他未開獎提示最多一條。保留實際未中獎狀態、目標狀態與獎額。 |
| P1 | 手機尺寸中場地偏小，底部兵種價格較擁擠。 | E002 | 獨立做直向構圖版本，縮減上方說明區留白並增加戰鬥區；維持正方形碰撞與固定玩家位置，重新驗證四面牆可見及點選投射落點。 |

## 這次實際編譯出的對照測試

模式：`quick_ed_triage`；證據：`L1_static_assets / partial_evidence`；理論狀態：`design_hypothesis`。

目前玩家是否過度刺激是待驗假設。先測「同時命中數隻小怪後，重複未開獎姓名條是否妨礙辨識」；不從截图推導 20 分鐘節奏或養成通關難度。

主變因：**非目標未開獎訊息的資訊層級**。鏡頭另做一輪，避免互相混淆。

- A：當前顯示規則。
- B：非目標小怪不顯示完整未開獎姓名條；其他未開獎提示最多一條。保留目標破防、真實獎額與爆擊。
- 狀態：本機候選規格已整理；B 變體尚未實作，沒有真人 A/B 結果。

驗證三項：

- **non_target_miss_label_peak**：每個渲染影格中非目標完整未開獎姓名條數；B 目標 0，其他未開獎提示 <=1。資料狀態：planned。
- **critical_feedback_integrity**：對照同輸入的實際獎額與目標狀態；0 次誤報中獎、0 次關鍵狀態遺漏。資料狀態：existing observations, new comparison planned。
- **two_second_readback**：至少 5 位未參與製作的試玩者，10 組平衡 A/B 圖；辨識命中／未開獎／開獎與當前目標，記錄逐人正確率與耗時。資料狀態：not_collected。

通過／回退條件：

- pass：技術門全過，且至少 4/5 試玩者的關鍵辨識正確率不下降；只能標為方向性候選。
- observe：資料不足或主觀偏好相反時保留 A，補一輪樣本。
- rollback：任何真獎額／目標狀態遺失、假中獎誤解或輸入命中失配即回到 A。
- kill：B 降低正確率且無可定位修正原因，停止此變體。

## 如何接到快測

先用相同種子、兵種、裝備與輸入序列，對照 `s.rewards`、`s.lotteryResults`、`s.targetId` 和 `labels.inspect()`。補上非目標 miss 標籤計數後，保存桌面／手機及怪潮段的峰值與截圖，再做小樣本辨識。這些新增計數與 B 變體仍是待做項，现有正确性测试不冒充体验测试。

永久採用方式：[GAMEDESIGNOS-WORKFLOW.md](D:/Projects/YesSir/_Games/ashen-legion/design-v1/GAMEDESIGNOS-WORKFLOW.md)。本輪 JSON 包含 `analysis.json`、`evidence-index.json`、`ed-handoff.json`、`ed-triage.json`，可直接給後續修改與快測使用。

執行 `python _Games/ashen-legion/tools/verify-design-review.py` 驗證上游 schema、證據引用、來源完整性及已安裝 skill。
