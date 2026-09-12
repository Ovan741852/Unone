# 阿罵畫風統一

2026-09-12，主選單主圖與地圖領主肖像改為 `expedition-keyart-v2.png`、`portrait-lord-v2.png`。母版 `quartermaster-v1.png` 未變更，SHA-256 `0383b38ed651b5645e31737d8e8ee9cffdbd39acceb114e96563f73d10d18e5e`。

- `verify-formal-layout.mjs`：官方 Unone UI preview 的 12 種畫面通過 strict 檢查，零 findings。
- `verify-expedition-ui.cjs`：5 種視窗、65 頁面通過；已目視桌面／直向手機主選單與地圖領主肖像。
- 最後將主圖設為 `cover`，避免寬高比改變時拉伸人物；再次以 `verify-storybook.cjs` 驗證最終正式頁面可載入，桌面和橫向手機操作正常。
- `main.luau` 去除正式 UI 區塊後的 SHA-256 前後一致：`d4b76a41507056cb6905b31c65ebee3eedd79fea6ae9580d4d3517f047edbfe4`，本次没有修改戰鬥規則。
- 最終桌面實拍：`tests/illustration-v2-menu.png`。手機／地圖：`tests/expedition-ui/390x844-menu.png`、`tests/expedition-ui/1440x900-map.png`。

使用內建 image_gen；完整提示詞與最終素材來源：`assets/formal-ui/IMAGEGEN-ILLUSTRATION-V2.json`。後續插畫基準：`ART-DIRECTION.md`。
