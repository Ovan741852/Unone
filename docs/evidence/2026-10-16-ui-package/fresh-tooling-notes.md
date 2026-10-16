# Author-side tooling corrections

These are PowerShell harness failures, separate from CLI results recorded verbatim in `commands.ndjson`.

1. The first attempted empty-index invocation was `. D:/TSProject/UnoneUiPackage-20261016/author-evidence/official-cli.ps1` followed by `Invoke-Official -Arguments @('--project','D:/TSProject/UnoneUiPackage-20261016/project-a','--json','api','search','')`. The shell command returned exit 1 before calling the CLI because the helper's mandatory string array rejected an empty string. Raw shell output:

```text
Invoke-Official:
Line |
   3 |  …  -Arguments @('--project','D:/TSProject/UnoneUiPackage-20261016/proje …
     |                ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     | 無法將引數繫結至參數 'Arguments'，因為它是空的字串。
```

Correction: added `[AllowEmptyString()]` to the helper parameter and retried the same public discovery command successfully (record 12). No SDK change.

2. An initial shell attempt to write `author-games.ps1` embedded single-quoted PowerShell here strings inside another single-quoted here string. That shell call returned exit 1 with an empty output string. The CLI did not run in this failed call. Correction: wrote the script through `apply_patch` and then executed it. The corrected exact authoring script is retained beside this note. Both authored programs passed their first strict analyzer, layout and test gates.

3. The first evidence-summary extraction filtered successful argv containing `prepare`, which also selected the prior `project prepare --help` output. Passing that human help text to `ConvertFrom-Json` returned shell exit 1. The relevant executed filter and expression were:

```powershell
$prepareRecords = $records | Where-Object { $_.arguments -contains 'prepare' -and $_.exit_code -eq 0 }
$result=$record.raw_output | ConvertFrom-Json
```

Raw shell output:

```text
ConvertFrom-Json:
Line |
  13 |      $result=$record.raw_output | ConvertFrom-Json
     |                                   ~~~~~~~~~~~~~~~~
     | 從 JSON 轉換失敗，錯誤: Unexpected character encountered while parsing value: V. Path '', line 0, position 0.
```

Correction: additionally required argv to contain `--target`. Extraction then returned exit 0 and saved both summaries plus frozen hashes. It did not change either source or export.
