# Web 缺少可共用的 canonical digest 入口

日期：2026-09-06。狀態：awaiting_user_decision。

分類：engine-contract / architecture。來源：roadmap #14 Luna / max 子代理。

## 事實

在 `c2029bf` 所依據的引擎，`EngineRuntime::run` 內部計算 observation digest；
Web snapshot envelope 沒有可直接使用的公開 canonical snapshot digest helper。
Web 顯示若自行複製 hash/serialization 規則，之後可能與 CLI 漂移。
以 `run(0)` 取得 digest 則將唯讀 observation 與 run 行為耦合。

子代理已停止依賴此契約的接線工作，回報尚無交付程式或實跑測試。

## 已詢問使用者

建議：抽出一個共用 Rust snapshot digest 函式，CLI 與 Web 共用，保留原有
序列化和 hash 定義。替代方案：先暫停 Web digest，完成 2D 工作。

待使用者答覆後再分配 core helper 的唯一寫入者。2D rotation/scale 與
碰撞體獨立設定已另外獲得確認，不受此問題影響。
