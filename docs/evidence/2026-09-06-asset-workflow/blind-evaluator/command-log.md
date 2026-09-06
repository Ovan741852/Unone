# 完整操作命令與結果索引

工作目錄（所有 game CLI）：C:\Temp\unone-asset-gate-20260906\engine
project：C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評

本表按實際順序記錄 command 與結果摘要；重要 JSON 欄位已收進 validation-report.json，首個操作/首次錯誤的原文在 first-operation-and-first-error.md。

## 讀取與初始化

1. 讀取 task.md 與 engine onboarding candidates（PowerShell Get-Content/Get-ChildItem）。結果：exit 0；完整讀取企劃、README、ai-agent-game-handoff、ai-workflow、asset-workflow 與相關 package docs。
2. powershell -NoProfile -ExecutionPolicy Bypass -File C:\Temp\unone-asset-gate-20260906\engine\scripts\verify-ai-engine-package.ps1 -PackagePath C:\Temp\unone-asset-gate-20260906\engine。結果：package verified。
3. bin/game.exe --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json project init --name 資產維護驗證任務。結果：建立 project.unone.json、scripts/main.luau、scenes/main.scene.json。
4. bin/game.exe --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json project inspect。結果：初始 scaffold exists。
5. bin/game.exe --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json platform capabilities。結果：native/windows/x86_64；verified runtime 含 luau/deterministic/observation/native_wgpu_preview。
6. bin/game.exe --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json api search 建立。結果：命中 entity.spawn、effect.spawn。
7. bin/game.exe --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json api describe entity.spawn。結果：讀到完整參數/side effects/frame semantics。
8. bin/game.exe --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json systems list。結果：列出 world/input/observation/physics2d/camera2d/camera3d/random/ui/save/spine/effekseer。
9. bin/game.exe --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json systems search physics。結果：命中 physics2d，決定關閉 physics2d/camera3d。
10. bin/game.exe --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json asset inspect --strict。結果：空 manifest、無 scene refs 時 ok=true。
11. bin/game.exe --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json check --types。結果：初始 entrypoints passed。
12. bin/game.exe --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 ui preview --strict。結果：首次錯誤 UI_TREE_NOT_PUBLISHED；原文已保留。
13. game asset init --help、bundle pack/inspect/install --help、asset read --help、run --help、verify --help。結果：確認 CLI 參數，不猜測 API。

## 初版 authoring 與發布

14. apply_patch 建立初版 hero.svg、courtyard.svg、hero-rig.json、hero-rig.atlas、main.scene.json、main.luau、兩個 test files。
15. game asset init --id asset://characters/hero --source assets/characters/hero.svg --kind texture2d --bundle characters。結果：manifest created、hero added。
16. game asset init --id asset://scenes/courtyard --source assets/scenes/courtyard.svg --kind texture2d --bundle environment。結果：courtyard added。
17. game asset init --id asset://characters/hero-rig --source assets/characters/hero-rig.json --kind spine --bundle characters --file assets/characters/hero-rig.atlas。結果：rig primary+companion added。
18. game systems set --id physics2d --enabled false；game systems set --id camera3d --enabled false。結果：兩者均 changed=true。
19. apply_patch 將兩個 tests 加入 project.unone.json。
20. game check --types。結果：passed。
21. game bundle pack。結果：manifest_version=1；content bundles characters/environment 建立。
22. game asset inspect --strict。結果：3 assets、3 refs、無 blockers。
23. game bundle inspect。結果：valid=true，未 active。
24. game bundle install --all。結果：active_generation=1，六 entries 全 available。
25. game asset describe --id asset://characters/hero；game asset read --id asset://characters/hero。結果：selected hero native-local fresh，762 bytes。
26. game asset describe/read hero-rig primary；game asset read hero-rig --file assets/characters/hero-rig.atlas；game asset read courtyard。結果：primary/companion 角色清楚，generation=1。
27. game asset read ... --output evidence/exports/*（hero/courtyard/rig primary/atlas）。結果：exports 建立，與 Get-FileHash 相同。
28. game ui preview --strict；game run --json --frames 0 --seed 42；game test；game verify。結果：layout 無 finding，兩 tests passed，初版 verify 4/4 passed。

## hero bytes、source path 與 generation stages

29. apply_patch 替換 assets/characters/hero.svg 為明顯不同 cyan-lantern SVG。結果：authoring hash f66dc71a...ee0344。
30. game asset inspect --strict；game asset describe hero；game asset read hero。結果：strict ok；describe matches_authoring=false/primary_bytes_match=false；read 回 generation 1 舊 bytes。
31. Move-Item hero.svg 到 assets/characters/hero art/hero revised.svg。結果：old_exists=false、new_exists=true。
32. game asset init --id asset://characters/hero --source assets/characters/hero art/hero revised.svg ...。結果：預期拒絕 ASSET_MANIFEST_DUPLICATE_ID，無 effects。
33. apply_patch 修改 assets/manifest.json 的 hero source path。結果：stable id/kind/bundle unchanged。
34. game asset inspect --strict；game asset describe hero；game asset read hero。結果：authoring path 正確；describe/read 回 BUNDLE_GENERATION_MISMATCH；scene hash unchanged。
35. game bundle pack。結果：manifest_version=2，characters bundle hash 更新，environment unchanged。
36. game bundle inspect；game asset describe hero/read hero。結果：packed but active_generation=1；read fail-closed BUNDLE_GENERATION_MISMATCH。
37. game asset inspect --strict；game bundle install --all。結果：strict ok，active_generation=2。
38. game asset describe/read hero，並 output final hero/courtyard exports。結果：hero 936 bytes、generation=2、matches_authoring=true。

## companion 維護

39. apply_patch 修改 hero-rig.atlas，新增 hero-rig.page，並在 assets/manifest.json 宣告第二 companion。
40. game asset describe/read hero-rig（未 pack）。結果：authoring 三檔可讀、active 舊 spec；companion reads fail-closed BUNDLE_GENERATION_MISMATCH。
41. game bundle pack。結果：manifest_version=3，characters bundle hash 更新。
42. game bundle inspect；game asset describe hero-rig。結果：packed but active_generation=2，describe diagnostics BUNDLE_GENERATION_MISMATCH。
43. game asset inspect --strict；game bundle install --all。結果：strict ok，active_generation=3。
44. game asset describe/read hero-rig primary、atlas、page，並 output exports。結果：三檔 verified、各自 hash/size，matches_authoring=true。

## 失敗案例與恢復

45. baseline game bundle inspect。結果：active_generation=3，六 entries valid/cached。
46. Move-Item hero-rig.page 到 evidence/failure-missing-companion/hero-rig.page.missing。結果：source_exists=false、held_copy_exists=true。
47. game asset inspect --strict。結果：ok=false、ASSET_SOURCE_MISSING、missing_sources=hero-rig.page、ready_for_packaging=false。
48. game bundle pack。結果：ok=false、ASSET_SOURCE_NOT_FOUND；沒有寫入新的 bundle manifest。
49. game bundle inspect；game asset describe hero-rig。結果：manifest_version=3、active_generation=3、active hashes unchanged；authoring page exists=false。
50. Move-Item held companion 回 assets/characters/hero-rig.page。結果：source_exists=true、held_copy_exists=false、hash 恢復 6d51cda...86be0。
51. game asset inspect --strict；game bundle pack；game bundle inspect。結果：strict ok，pack manifest_changed=false/version=3，active_generation=3。

## 最終 native-local gate

52. game project inspect；game check --types；game asset inspect --strict；game bundle inspect。結果：project/tests/assets/bundles all exist/valid；active generation 3。
53. game verify --json。結果：types/assets/layout/tests 均 passed，passed=4、failed=0、not_applicable=0。
54. game run --json --frames 1 --seed 42。結果：3 entities（兩個共用 hero id + background）、3 observations、UI tree、status completed。
55. game asset describe/read hero/courtyard/hero-rig primary/atlas/page。結果：所有 selected asset native-local publication matches_authoring=true，generation=3。
56. PowerShell Get-FileHash/size 盤點 project/script/scene/manifests/SVG/primary/companions/bundles。結果：完整 hash 表已寫 validation-report.json。
57. ConvertFrom-Json validation-report.json。結果：parse=ok、status=ready_for_review、active_generation=3。

## 授權素材

itch.io 本輪未使用；未瀏覽或引入第三方素材，不需作者/授權/署名欄位。兩張 SVG 與 test bytes 均為本輪自製。
