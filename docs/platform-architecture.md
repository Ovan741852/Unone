# Unone 平台架構、商店與未來方向

本文件是 Unone 的產品級方向文件，將 Editor、AI Workshop、Core、Plugin
SDK、Asset pipeline 與可替換的 Marketplace 放在同一張圖裡。它描述架構
邊界與演進原則，不把尚未完成的 host 能力寫成已支援功能。

## 一句話定位

Unone 是一個 AI-first 的跨平台製作環境：AI 可以理解專案、尋找能力、
組合結果、驗證證據並交給人審核。Core 保持可重現，Plugin 提供能力，
Editor/Workshop 提供工作流；商店只負責分發、授權、金流與創作者收益。

```text
創作者 ──發佈──> Marketplace catalog ──購買/授權──> 專案 lockfile
   ▲                   │ 版本、評價、審核、分潤             │ hash verify
   └──── payout ───────┴──────────────────────────────────┘

AI ── Workshop ──> Editor ── unone.plugin.v1 ──> Core / Host adapters
        │             │                          │
        └ requirements, tasks, evidence           └ runtime / platform APIs
```

## 分層與責任

| 層 | 負責 | 不負責 |
|---|---|---|
| **Game/App Luau** | ViewModel、遊戲規則、狀態、語意 action、流程 | 像素、DPI、UIKit/Android 物件、Rust handle |
| **Unone Core（穩定邊界）** | deterministic tick、Luau VM、輸入邊界、UI/scene/save contract、image asset reference、reusable component tree、驗證、diagnostics、replay | MVVM、UI Manager registry、商店帳戶、定價、遊戲商業規則、Widget theme |
| **Host adapters** | viewport、GPU、鍵盤/IME、clipboard、camera、share、accessibility、平台權限 | 決定 gameplay outcome、假裝缺少的能力存在 |
| **Editor** | 專案/scene tree、inspector、asset browser、preview、logs、package lock | 成為唯一能執行 reusable package 的地方 |
| **AI Workshop** | goal→requirement→capability→package→evidence、任務排程、diff、測試與 release checklist | 隱藏 mutation、取代 source control、默默啟用套件 |
| **Local Plugin SDK** | schema、inspect、generate、validate、test、staging、templates | 第二套 runtime、隱藏全域狀態、未批准的 active-file 寫入 |
| **Marketplace** | catalog、creator identity、license、checkout、payout、refund、moderation、audit | Core runtime authority、強制線上、改寫已鎖定的 package |

Marketplace 可以是 Koncrate，也可以是日後的替代服務。Unone 只依賴
package ID/version、artifact hash、license/entitlement、capabilities 與
可重現來源，不依賴某一個商店品牌或網路服務。

## AI Workshop 的標準流程

1. **Understand**：索引 project、runtime capabilities、asset formats、
   現有 conventions 與 package lock。
2. **Plan**：把自然語言目標拆成 requirements 與 acceptance checks。
3. **Find**：以 capability 搜尋 local plugin 或 marketplace package，不能
   只靠 screenshot 猜 class 名稱。
4. **Inspect**：先讀 manifest、schema、examples、host requirements、
   runtime readiness，再決定是否可用。
5. **Compose**：呼叫 generate，將值與 action 留在 Luau；Plugin 只產生
   可序列化 descriptor。
6. **Verify**：plugin self-test、schema、`game verify`、deterministic
   input/replay、layout、asset hash、host capability probe。
7. **Review**：顯示 diff、warnings、runtime status、permissions、hash、
   失敗原因；使用者明確批准 staging/activation。
8. **Ship**：寫入 lockfile 與 evidence，確保離線仍可由固定 artifact 重建。

Workshop 應保存 `Requirement`、`Capability`、`PackageRef`、
`GeneratedArtifact`、`TestEvidence`、`Decision`、`Release` 等記錄，並包含
輸入、輸出、時間、owner、hash 與 failure reason。

## Plugin SDK 與 UI contract

Local plugin 使用 `unone.plugin.v1` JSONL：manifest 宣告 ID、semver、
capabilities、permissions、tools 與 input schema；stdin 一行 request、
stdout 一行 structured result，logs 一律走 stderr。建議把讀取與變更拆成
`list/inspect`、`generate/preview`、`validate/test`、`install/apply`，讓 AI
不會把查詢誤當成 mutation。

`unone.ui.v1` 是 UI descriptor contract，與 package version 分開。現在的
UnoneUI 0.4.0 元件狀態如下：

| 元件 | 現況 |
|---|---|
| Text / Label | `ready`，使用 Core `text` |
| Button | enabled 時 `ready`；disabled 會降為無 action 的 text |
| Image | `ready`，使用 stable `asset://` 或 `texture://` ID 與 `fit`；SVG/raster 解碼由 host 決定 |
| Component | `ready`，Core 驗證可遞迴 reusable children；不提供 MVVM 或隱式 layout |
| Toggle | `fallback`，以 `[x]`/`[ ]` button 呈現 |
| IconButton / ProgressBar | `fallback`，文字化且不宣稱原生 icon/bar |
| Panel / Tabs | `composition_only`，由 Editor/host 或 Luau 展開 |
| Input / Dialog / Modal / Tooltip | `host_required`，不得假裝已可執行 |

任何不支援的欄位都要回傳 code、path、具體原因與 structured
`suggested_actions`。descriptor 能序列化不等於 runtime 能執行；生成結果
必須帶 `runtime_status`、`engine_nodes`/projection 與 warnings。

### MVVM observability package

MVVM、UI Manager、reactive 與 binding 都是 optional foundation plugin。只交付
分層而沒有觀測面，AI 會在錯誤時失去定位能力；因此 foundation package 的
capability 應成組包含：

- `ui.test`／`ui.replay_diff`：headless、deterministic、可保存 first divergent
  step 與 descriptor/model digest；
- `ui.debug_snapshot`／`ui.diagnose`：read-only 的 layer、VM、binding、watcher、
  overlay 與 generation 圖，附安全 source map 與具體修復建議；
- `ui.profile`：mount/update/unmount、reactive invalidation、computed 次數、
  descriptor diff、listener/queue 與 host-reported cost 的測量值。

所有結果都要綁定 project/package/artifact hash、screen/component/binding、
generation、replay 與 correlation id。這些工具可以由 Editor facade 統一呈現，
但不能改成隱形 global state，也不能把猜測的效能數字偽裝成跨平台 gate。

## Asset contract

Asset 是可追蹤的 package input，不是不可理解的 blob。每個 asset 至少要
有 `id`、`kind`、source/license、format/MIME、dimensions 或 duration、
coordinate/color-space assumptions、dependencies、sha256、target platforms
與 decoder requirements。

建議目錄：

```text
assets/<asset-id>/source/<original>
assets/<asset-id>/derived/<platform-or-purpose>
assets/<asset-id>/asset.json
```

原始檔不可被 derived 覆蓋；importer 必須報告轉換與保留 provenance。Core
只負責 declaration、archive integrity、hash 與 activation；解碼、GPU
resource lifetime、CDN、cache quota 和平台渲染屬於 host/SDK。現有完整規則
見 [asset-workflow.md](asset-workflow.md) 與 [asset.schema.json](asset.schema.json)。

## SDK 封裝：Plugin、WASM、native

同一份 contract core 應有多個 delivery shell：

```text
contract core (schema / metadata / validation / deterministic projection)
   ├─ JSONL plugin shell   → Editor / Workshop / CLI
   ├─ WASM shell           → browser/editor worker、sandboxed package
   └─ native shell         → Rust/C ABI、offline CI、trusted importer
```

Contract core 必須 deterministic、dependency-light、沒有 OS/UI handles。
WASM/native 可以加速 validation、layout projection、asset decoding 或
preview，但不能把 gameplay rules 從 Luau 搬進 Core。三種 shell 要共用
schema、error code、capability model 與 migration table。

- WASM 適合作為 marketplace 不信任套件的預設隔離執行環境。
- native 適合可信任的離線工具鏈或效能敏感 importer，需保留 permission、
  signing、review 與 sandbox 邊界。
- JSONL plugin 是目前的 reference integration；等 ABI 穩定後才固定 WASM
  component/native FFI packaging。

每個 build artifact 要攜帶 package ID/version、contract version、target、
feature flags、toolchain 與 source/artifact hashes；project lockfile 選定
唯一 artifact，不能因 marketplace 暫時離線而破壞已安裝專案。

## 商店、金流與創作者收益

平台方提供 catalog、搜尋、checkout、entitlement、退款、稅務/支付整合、
creator analytics、moderation、檢舉與支援。創作者提供 package、license、
相容版本、支援政策與更新；依透明的 revenue-share 規則取得 payout。
分潤比例可以調整，不能因此改變 `unone.plugin.v1` 或 runtime behavior。

公開商店前的最低安全線：

- publisher identity、簽章與 immutable package versions；
- malware/license scanning、reproducible build metadata；
- review、report、takedown、refund、appeal；
- entitlement cache 與離線使用策略；
- 高風險 tool 的 permission/confirmation；
- deprecation 與 security advisory。

商店只發布 immutable package；Editor 安裝的是鎖定 hash，不能每次啟動時
從遠端取得未審核的新內容。

## Roadmap

### Now

- Core deterministic/replay/diagnostics、normalized UI placement、asset
  declaration/bundle/verification。
- local plugin discovery、inspect、generate、validate、staging。
- UnoneUI common component contract；ready/fallback/composition/host-required
  都以機器可讀狀態回報。
- Editor/Workshop 架構與 evidence 文件。

### Next

- Plugin/Luau fallback 與 host capability bridge（toggle/disabled、text-input、IME、focus），不修改 Core；
- MVVM foundation 的 `ui.test`、`ui.debug_snapshot`、`ui.profile`、replay diff 與 source-map diagnostics，讓 AI 能追蹤 binding/reload 成本與錯誤來源；
- host capability handshake（accessibility、camera、share 等）；
- Editor preview 與 runtime 共用 descriptor，並加入 package lock/migrations；
- Workshop requirement/evidence graph、asset provenance UI、衝突 diff；
- portable SDK 的 WASM/native component boundary prototype。

### Later

- Plugin/host 實作 Panel、ProgressBar、Tabs、Dialog、Tooltip、focus navigation、
  style tokens，最後投影到既有 Core transport；
- public catalog、creator portal、checkout/payout、signed artifacts、offline
  entitlement；
- iOS/Android/Web/Desktop host capability parity；
- AI profiling、accessibility audit、asset optimization、release automation。

## 不變的設計原則

1. Gameplay/business rules 留在 Luau；本產品方向凍結 Core，新增能力只進
   Plugin SDK、Luau 或 host adapter。
2. Editor、Workshop、Marketplace 都可替換；專案由 lockfile/cache 保持可重現。
3. Contract version 與 package version 分離，任何 breaking change 都有 migration。
4. Composition 可以先交付，但一定標明 composition-only，不能偽裝成 native widget。
5. 所有 mutation 可 review、可 hash、可追蹤，能恢復時就保留可恢復路徑。

## 相關文件

- [Plugin protocol](plugin-protocol.md)
- [Portable Core SDK](portable-sdk.md)
- [AI workshop priorities](ai-workshop-priorities.md)
- [AI workflow](ai-workflow.md)
- [UI Manager / MVVM architecture proposal](ui-mvvm-architecture.md)
- [Asset workflow](asset-workflow.md)
- [UnoneUI component architecture](../../UnoneUI/docs/platform-vision.md)
