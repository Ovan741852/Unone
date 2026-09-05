param(
    [string]$ApkPath = "artifacts/unone-android-host.apk",
    [string]$Serial = ""
)

$ErrorActionPreference = "Stop"
$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
if ($null -eq $adbCommand) { throw "adb is not on PATH." }
$adb = $adbCommand.Source
$apk = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\$ApkPath"))
if (-not (Test-Path -LiteralPath $apk)) { throw "APK not found: $apk" }
if ([string]::IsNullOrWhiteSpace($Serial)) {
    $devices = @((& $adb devices | Select-Object -Skip 1) | Where-Object { $_ -match "^\S+\s+device\s*$" })
    if ($devices.Count -ne 1) { throw "Expected exactly one connected Android device/emulator; pass -Serial explicitly." }
    $Serial = ($devices[0] -split "\s+")[0]
}

& $adb -s $Serial install -r $apk | Write-Output
if ($LASTEXITCODE -ne 0) { throw "APK install failed on $Serial." }
& $adb -s $Serial logcat -c
& $adb -s $Serial shell am force-stop com.unone.android
& $adb -s $Serial shell monkey -p com.unone.android 1 | Write-Output
if ($LASTEXITCODE -ne 0) { throw "Could not launch Unone Android host on $Serial." }
Start-Sleep -Seconds 2
$activity = (& $adb -s $Serial shell dumpsys activity activities) -join "`n"
if ($activity -notmatch '(?m)(topResumedActivity|mResumedActivity)=.*com\.unone\.android/\.UnoneActivity') {
    throw "Unone Android Activity is not in the foreground after launch."
}
$packagePid = (& $adb -s $Serial shell pidof com.unone.android) -join ""
if ([string]::IsNullOrWhiteSpace($packagePid.Trim())) { throw "Unone Android process is not alive after launch." }
$dump = & $adb -s $Serial shell uiautomator dump /sdcard/unone-ui.xml 2>&1
if ($LASTEXITCODE -ne 0) { throw "UIAutomator dump failed: $dump" }
$initialLog = (& $adb -s $Serial logcat -d) -join "`n"
if ($initialLog -notmatch "UnoneAndroidHost.*project_loaded") {
    throw "Android host did not report project_loaded through its lifecycle log."
}

# Exercise the platform lifecycle boundary, not the engine simulation clock:
# backgrounding must pause the session and returning must resume the same app.
& $adb -s $Serial shell input keyevent 3 | Out-Null
Start-Sleep -Seconds 1
& $adb -s $Serial shell am start -W -n com.unone.android/.UnoneActivity | Out-Null
Start-Sleep -Seconds 1
$resumedActivity = (& $adb -s $Serial shell dumpsys activity activities) -join "`n"
if ($resumedActivity -notmatch '(?m)(topResumedActivity|mResumedActivity)=.*com\.unone\.android/\.UnoneActivity') {
    throw "Unone Android Activity did not return to the foreground after resume."
}
$lifecycleLog = (& $adb -s $Serial logcat -d) -join "`n"
foreach ($event in @("runtime_paused", "runtime_resumed")) {
    if ($lifecycleLog -notmatch "UnoneAndroidHost.*$event") {
        throw "Android host did not report lifecycle event: $event"
    }
}
$log = $lifecycleLog | Select-String -Pattern "FATAL EXCEPTION:|Process: com\.unone\.android|UnsatisfiedLinkError|Fatal signal|libunone_mobile_ffi|libunone_android_host"
if ($log) { throw "Android host log contains a fatal/runtime error:`n$log" }
Write-Output "Android APK launch smoke passed: $Serial"
