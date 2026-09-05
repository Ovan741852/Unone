param(
    [Parameter(Mandatory = $true)]
    [string]$ApkPath,
    [string]$Serial = ""
)

$ErrorActionPreference = "Stop"
$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
if ($null -eq $adbCommand) { throw "adb is not on PATH." }
$adb = $adbCommand.Source
$apk = [IO.Path]::GetFullPath($ApkPath)
if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw "APK not found: $apk" }

function Wait-ForUnoneActivity([string]$AdbPath, [string]$DeviceSerial) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $activity = (& $AdbPath -s $DeviceSerial shell dumpsys activity activities) -join "`n"
        if ($activity -match '(?m)(topResumedActivity|mResumedActivity)=.*com\.unone\.android/\.UnoneActivity') {
            return $activity
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Unone Android Activity did not reach the foreground within 15 seconds."
}

function Wait-ForUnoneLogEvent([string]$AdbPath, [string]$DeviceSerial, [string]$EventName) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $log = (& $AdbPath -s $DeviceSerial logcat -d) -join "`n"
        if ($log -match "UnoneAndroidHost.*$EventName") {
            return $log
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Android host did not report $EventName through its lifecycle log within 15 seconds."
}

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
$activity = Wait-ForUnoneActivity $adb $Serial
$packagePid = (& $adb -s $Serial shell pidof com.unone.android) -join ""
if ([string]::IsNullOrWhiteSpace($packagePid.Trim())) { throw "Unone Android process is not alive after launch." }
$initialLog = Wait-ForUnoneLogEvent $adb $Serial "project_loaded"

& $adb -s $Serial shell input keyevent 3 | Out-Null
Start-Sleep -Seconds 1
& $adb -s $Serial shell am start -W -n com.unone.android/.UnoneActivity | Out-Null
$resumedActivity = Wait-ForUnoneActivity $adb $Serial
$lifecycleLog = (& $adb -s $Serial logcat -d) -join "`n"
foreach ($event in @("runtime_paused", "runtime_resumed")) {
    if ($lifecycleLog -notmatch "UnoneAndroidHost.*$event") {
        throw "Android host did not report lifecycle event: $event"
    }
}
$log = $lifecycleLog | Select-String -Pattern "FATAL EXCEPTION:|Process: com\.unone\.android|UnsatisfiedLinkError|Fatal signal|libunone_mobile_ffi|libunone_android_host"
if ($log) { throw "Android host log contains a fatal/runtime error:`n$log" }
Write-Output "Android package host smoke passed: $Serial"
