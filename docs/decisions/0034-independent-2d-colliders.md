# Decision 0034：2D 顯示變換與碰撞體獨立設定

日期：2026-09-06。

## 使用者決策

針對 2D rotation/scale 是否同時影響碰撞體，使用者明確答覆：
「碰撞體獨立設定」。此問題已決定，不再列為待確認。

## 契約

- Entity 的位置仍決定物體位於世界的哪裡。
- 2D rotation/scale 控制顯示。它們不得自動修改 rigidbody 的形狀、半徑、
  質量、速度、碰撞解算或 contact 判定。
- 碰撞形狀與尺寸以碰撞體自己的宣告為準。變大或旋轉 sprite 不會讓碰撞體
  自動同步變大或旋轉。
- 未來加入非圓形碰撞體時仍遵守此邊界，並在碰撞體契約中明確宣告所需參數。
- 本決策沒有新增角速度、角動量或旋轉碰撞解算。

## 必要回歸

同一場景、seed、input 與 fixed frames，只改 2D 顯示 rotation/scale，
應保有相同的物理位置、速度、contact 與 ground contact 結果。
顯示變換本身必須出現在 snapshot，且可被 replay/digest 與 host 正確觀測。

顯示變換改變會使包含顯示資料的完整 observation digest 改變；此時不得把
digest 不同誤報成碰撞行為改變。測試應分別比對顯示狀態和物理結果。

## 交付狀態

契約已確認，製作已交給 Luna / max 子代理。core、host 與 package-only
遊戲盲測各自驗收；本決策文件不表示它們已完成。
