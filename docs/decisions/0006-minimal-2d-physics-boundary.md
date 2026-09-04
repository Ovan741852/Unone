# Decision 0006：先做可驗證的最小 2D physics mechanism

## 決策

第一個 physics slice 只提供引擎機制：

- dynamic／static 圓形 RigidBody2D
- gravity、固定 timestep、速度與位置整合
- optional ground plane
- deterministic circle collision resolution
- Luau 的 `getVelocity`、`setVelocity`、`physics.applyImpulse`

Bird、彈弓、trajectory、豬、木箱、關卡規則與勝負條件全部留在 `Unone_Games`。

## 為何現在需要

2D physics 是憤怒鳥驗證的第一個跨遊戲機制，也可重用於平台遊戲、彈珠、碰撞式 UI 或其他物理玩法。沒有它，現有 transform demo 不能證明引擎能承擔真實遊戲。

## 明確不做

本 slice 不預先做 friction、joints、polygon mesh、continuous collision detection、spatial index、network rollback 或完整物理材質系統。若真實驗證遊戲在效能或正確性上被同一問題阻塞，再以測試證據擴充；不在遊戲端各自打補丁。

## 可變更性

Scene 的 physics settings 與 RigidBody2D data 是 source JSON；Luau 只呼叫語意 API。未來替換 solver 時，保留 scene／script 的語意欄位與 observation contract，solver 細節不暴露給遊戲端。若這個 boundary 被兩個遊戲證明錯誤，可直接拆掉重做，沒有舊 API 相容承諾。
