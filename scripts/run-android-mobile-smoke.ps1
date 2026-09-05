param(
    [string]$Target = "x86_64-linux-android",
    [string]$NdkPath = "",
    [string]$Serial = ""
)

$ErrorActionPreference = "Stop"

$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
if ($null -eq $adbCommand) {
    throw "adb is not on PATH; connect an Android SDK platform-tools directory first."
}
$adb = $adbCommand.Source
if ([string]::IsNullOrWhiteSpace($Serial)) {
    $devices = @((& $adb devices | Select-Object -Skip 1) | Where-Object { $_ -match "^\S+\s+device\s*$" })
    if ($devices.Count -eq 0) {
        throw "No connected Android device or emulator. Start an AVD or pass -Serial."
    }
    if ($devices.Count -gt 1) {
        throw "More than one Android device is connected; pass -Serial explicitly."
    }
    $Serial = ($devices[0] -split "\s+")[0]
}

if ([string]::IsNullOrWhiteSpace($NdkPath)) {
    $androidSdkPath = $env:ANDROID_HOME
    if ([string]::IsNullOrWhiteSpace($androidSdkPath)) { $androidSdkPath = $env:ANDROID_SDK_ROOT }
    if ([string]::IsNullOrWhiteSpace($androidSdkPath)) {
        $androidSdkPath = Split-Path (Split-Path $adb -Parent) -Parent
    }
    $NdkPath = Get-ChildItem -LiteralPath (Join-Path $androidSdkPath "ndk") -Directory |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "toolchains\llvm\prebuilt\windows-x86_64\bin") } |
        Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ([string]::IsNullOrWhiteSpace($NdkPath) -or -not (Test-Path -LiteralPath $NdkPath)) {
    throw "No usable Android NDK was found."
}

switch ($Target) {
    "x86_64-linux-android" { $clangPrefix = "x86_64-linux-android" }
    "aarch64-linux-android" { $clangPrefix = "aarch64-linux-android" }
    default { throw "Unsupported Android smoke target: $Target" }
}
$llvmBinPath = Join-Path $NdkPath "toolchains\llvm\prebuilt\windows-x86_64\bin"
$apiLevel = Get-ChildItem -LiteralPath $llvmBinPath -Filter "$clangPrefix*-clang.cmd" |
    ForEach-Object { if ($_.Name -match "android(\d+)-clang\.cmd$") { [int]$Matches[1] } } |
    Sort-Object -Descending | Select-Object -First 1
if ($null -eq $apiLevel) { throw "No Android clang wrapper found for $Target." }
$ccPath = Join-Path $llvmBinPath "$clangPrefix$apiLevel-clang.cmd"
$cxxPath = Join-Path $llvmBinPath "$clangPrefix$apiLevel-clang++.cmd"
$targetKey = $Target.Replace('-', '_').ToUpper()
[Environment]::SetEnvironmentVariable("CC_$($Target.Replace('-', '_'))", $ccPath, "Process")
[Environment]::SetEnvironmentVariable("CXX_$($Target.Replace('-', '_'))", $cxxPath, "Process")
[Environment]::SetEnvironmentVariable("AR_$($Target.Replace('-', '_'))", (Join-Path $llvmBinPath "llvm-ar.exe"), "Process")
[Environment]::SetEnvironmentVariable("CARGO_TARGET_${targetKey}_LINKER", $ccPath, "Process")

cargo build -p unone-mobile-android-smoke --target $Target
if ($LASTEXITCODE -ne 0) { throw "Android smoke harness build failed for $Target." }
$binary = Resolve-Path "target/$Target/debug/unone-mobile-android-smoke"
$remote = "/data/local/tmp/unone-mobile-android-smoke"
$sharedLibrary = Join-Path $llvmBinPath "..\sysroot\usr\lib\$clangPrefix\libc++_shared.so"
if (-not (Test-Path -LiteralPath $sharedLibrary)) {
    throw "Android NDK shared C++ runtime was not found: $sharedLibrary"
}
$remoteLibraryDir = "/data/local/tmp/unone-mobile-smoke-libs"
& $adb -s $Serial shell mkdir -p $remoteLibraryDir
if ($LASTEXITCODE -ne 0) { throw "adb mkdir failed for $Serial." }
& $adb -s $Serial push $sharedLibrary "$remoteLibraryDir/libc++_shared.so" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "adb push libc++_shared.so failed for $Serial." }
& $adb -s $Serial push $binary.Path $remote | Out-Host
if ($LASTEXITCODE -ne 0) { throw "adb push failed for $Serial." }
& $adb -s $Serial shell chmod 755 $remote
if ($LASTEXITCODE -ne 0) { throw "adb chmod failed for $Serial." }
$output = & $adb -s $Serial shell "LD_LIBRARY_PATH=$remoteLibraryDir $remote"
if ($LASTEXITCODE -ne 0) { throw "Android smoke harness failed on $Serial.`n$output" }
$output | Write-Output
Write-Output "Android mobile host smoke passed: $Target / $Serial"
