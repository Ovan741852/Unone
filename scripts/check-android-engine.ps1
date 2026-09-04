param(
    [string[]]$Target = @("aarch64-linux-android", "x86_64-linux-android"),
    [string]$NdkPath = "",
    [string[]]$Package = @("unone-engine", "unone-mobile-ffi")
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($NdkPath)) {
    $androidSdkPath = $env:ANDROID_HOME
    if ([string]::IsNullOrWhiteSpace($androidSdkPath)) {
        throw "ANDROID_HOME is not set; point it at the Android SDK or pass -NdkPath."
    }
    $ndkCandidates = Get-ChildItem -LiteralPath (Join-Path $androidSdkPath "ndk") -Directory |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "toolchains\llvm\prebuilt\windows-x86_64\bin") } |
        Sort-Object Name -Descending
    $NdkPath = $ndkCandidates | Select-Object -First 1 -ExpandProperty FullName
}

if ([string]::IsNullOrWhiteSpace($NdkPath) -or -not (Test-Path -LiteralPath $NdkPath)) {
    throw "No usable Android NDK was found."
}

$llvmBinPath = Join-Path $NdkPath "toolchains\llvm\prebuilt\windows-x86_64\bin"
$arPath = Join-Path $llvmBinPath "llvm-ar.exe"
if (-not (Test-Path -LiteralPath $arPath)) {
    throw "Android NDK LLVM bin directory is missing llvm-ar.exe: $llvmBinPath"
}

$installedTargets = @(rustup target list --installed)
foreach ($androidTarget in $Target) {
    if ($installedTargets -notcontains $androidTarget) {
        throw "Rust target '$androidTarget' is not installed. Run: rustup target add $androidTarget"
    }

    switch ($androidTarget) {
        "aarch64-linux-android" { $clangPrefix = "aarch64-linux-android" }
        "x86_64-linux-android" { $clangPrefix = "x86_64-linux-android" }
        default { throw "Unsupported Android target for this check script: $androidTarget" }
    }

    $apiLevels = foreach ($candidate in (Get-ChildItem -LiteralPath $llvmBinPath -Filter "$clangPrefix*-clang.cmd")) {
        if ($candidate.Name -match "android(\d+)-clang\.cmd$") { [int]$Matches[1] }
    }
    $apiLevel = $apiLevels | Sort-Object -Descending | Select-Object -First 1
    if ($null -eq $apiLevel) {
        throw "No Android clang wrapper found for '$androidTarget' in $llvmBinPath"
    }

    $ccPath = Join-Path $llvmBinPath "$clangPrefix$apiLevel-clang.cmd"
    $cxxPath = Join-Path $llvmBinPath "$clangPrefix$apiLevel-clang++.cmd"
    [Environment]::SetEnvironmentVariable("CC_$($androidTarget.Replace('-', '_'))", $ccPath, "Process")
    [Environment]::SetEnvironmentVariable("CXX_$($androidTarget.Replace('-', '_'))", $cxxPath, "Process")
    [Environment]::SetEnvironmentVariable("AR_$($androidTarget.Replace('-', '_'))", $arPath, "Process")

    foreach ($packageName in $Package) {
        cargo check -p $packageName --target $androidTarget
        if ($LASTEXITCODE -ne 0) {
            throw "Android package check failed for package '$packageName' and target '$androidTarget'."
        }
        Write-Output "Android package target check passed: $packageName / $androidTarget"
    }
    Write-Output "Android target set passed: $androidTarget (NDK $($NdkPath | Split-Path -Leaf), API $apiLevel)"
}
