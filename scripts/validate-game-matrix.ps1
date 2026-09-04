param(
    [string]$MatrixPath = "D:\Projects\Unone_Games\validation\acceptance-matrix.json"
)

$ErrorActionPreference = "Stop"

function New-Diagnostic([string]$Code, [string]$Summary, [string]$Explanation, $Facts) {
    [ordered]@{
        code = $Code
        severity = "ERROR"
        summary = $Summary
        explanation = $Explanation
        facts = $Facts
    }
}

if (-not (Test-Path -LiteralPath $MatrixPath -PathType Leaf)) {
    $result = [ordered]@{
        ok = $false
        status = "invalid"
        diagnostics = @((New-Diagnostic "VALIDATION_MATRIX_NOT_FOUND" "validation matrix not found" "Provide a valid acceptance-matrix.json path." @{ matrix_path = $MatrixPath }))
        games = @()
    }
    $result | ConvertTo-Json -Depth 8
    exit 1
}

try {
    $matrix = Get-Content -LiteralPath $MatrixPath -Raw | ConvertFrom-Json
} catch {
    $result = [ordered]@{
        ok = $false
        status = "invalid"
        diagnostics = @((New-Diagnostic "VALIDATION_MATRIX_INVALID_JSON" "validation matrix is not valid JSON" $_.Exception.Message @{ matrix_path = $MatrixPath }))
        games = @()
    }
    $result | ConvertTo-Json -Depth 8
    exit 1
}

$matrixRoot = Split-Path -Parent $MatrixPath
$gamesRoot = Split-Path -Parent $matrixRoot
$expectedFinalGates = @(
    "3d-racing", "red-alert-rts", "idle-battle", "avg-romance",
    "auto-chess", "slot-machine", "fish-machine"
)
$games = @($matrix.games)
$observations = @()
$diagnostics = @()

foreach ($expectedId in $expectedFinalGates) {
    $gateMatches = @($games | Where-Object { $_.id -eq $expectedId })
    if ($gateMatches.Count -ne 1) {
        $facts = @{ game_id = $expectedId; count = $gateMatches.Count }
        $diagnostic = New-Diagnostic "VALIDATION_GATE_MISSING" "final validation gate is missing" "Each final gate must occur exactly once in the matrix." $facts
        $diagnostics += $diagnostic
    }
}

foreach ($game in $games) {
    # project_path is relative to the games workspace root, while the matrix
    # intentionally lives under its validation subdirectory.
    $projectPath = Join-Path $gamesRoot $game.project_path
    $missing = @()
    foreach ($evidence in @($game.required_evidence)) {
        $evidencePath = Join-Path $projectPath $evidence
        if (-not (Test-Path -LiteralPath $evidencePath)) { $missing += $evidence }
    }
    $isFinal = [bool]$game.required_for_final
    $passed = ($game.status -eq "passed") -and ($missing.Count -eq 0)
    if ($isFinal -and -not $passed) {
        $facts = @{ game_id = $game.id; status = $game.status; missing_evidence = $missing }
        $diagnostic = New-Diagnostic "VALIDATION_GATE_NOT_PASSED" "final validation gate is not passed" "The gate requires status=passed and every required_evidence path; compile or screenshot alone is not sufficient." $facts
        $diagnostics += $diagnostic
    }
    $observations += [ordered]@{
        id = $game.id
        name = $game.name
        role = $game.role
        required_for_final = $isFinal
        status = $game.status
        evidence_complete = ($missing.Count -eq 0)
        missing_evidence = $missing
        project_path = $game.project_path
    }
}

$ok = ($diagnostics.Count -eq 0)
$suggestedActions = @()
if (-not $ok) {
    $suggestedAction = [ordered]@{
        action = "complete_validation_gate"
        description = "Complete replayable tests, README/AI workflow, validation report, and cross-platform evidence for every final gate, then run this command again."
        command = ".\scripts\validate-game-matrix.ps1 -MatrixPath $MatrixPath"
    }
    $suggestedActions = @($suggestedAction)
}
$result = [ordered]@{
    ok = $ok
    status = if ($ok) { "passed" } else { "not_passed" }
    final_gate_count = $expectedFinalGates.Count
    passed_final_gate_count = @($observations | Where-Object { $_.required_for_final -and $_.status -eq "passed" -and $_.evidence_complete }).Count
    diagnostics = $diagnostics
    games = $observations
    suggested_actions = $suggestedActions
}
$result | ConvertTo-Json -Depth 10
exit $(if ($ok) { 0 } else { 1 })
