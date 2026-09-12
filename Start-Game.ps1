param([int]$Port=8190,[switch]$NoBrowser)
& (Join-Path $PSScriptRoot '_Games/ashen-legion/Play.ps1') -Port $Port -NoBrowser:$NoBrowser
