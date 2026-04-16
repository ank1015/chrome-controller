#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$TargetInput
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$EXT_ID = 'lpckahomnighbpahilageendcdpbkfcl'
$HOST_NAME = 'com.ank1015.llm'
$UPDATE_URL = 'https://clients2.google.com/service/update2/crx'

function Get-ChromeExe {
  $candidates = @()

  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')
  }

  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
  }

  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }

  throw 'Chrome binary not found in the usual locations.'
}

function Add-RegistryStringValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Key,

    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  & reg.exe ADD $Key /v $Name /t REG_SZ /d $Value /f | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to write registry value '$Name' under '$Key'."
  }
}

function Set-RegistryDefaultValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Key,

    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  & reg.exe ADD $Key /ve /t REG_SZ /d $Value /f | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to write default registry value under '$Key'."
  }
}

function Clear-ExternalUninstallBlock {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NodePath,

    [Parameter(Mandatory = $true)]
    [string]$PrefsPath,

    [Parameter(Mandatory = $true)]
    [string]$ExtensionId
  )

  if (-not (Test-Path -LiteralPath $PrefsPath -PathType Leaf)) {
    throw "Target profile Preferences file not found: $PrefsPath"
  }

  $js = @'
const fs = require("fs");
const prefsPath = process.argv[2];
const extId = process.argv[3];
const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));

if (!prefs.extensions || typeof prefs.extensions !== "object") {
  prefs.extensions = {};
}

const uninstalls = prefs.extensions.external_uninstalls;
prefs.extensions.external_uninstalls = Array.isArray(uninstalls)
  ? uninstalls.filter((value) => value !== extId)
  : [];

const tmpPath = prefsPath + ".tmp";
fs.writeFileSync(tmpPath, JSON.stringify(prefs));
fs.renameSync(tmpPath, prefsPath);
'@

  $tempScriptPath = Join-Path $env:TEMP "chrome-controller-clear-external-uninstall-$([System.Guid]::NewGuid().ToString('N')).cjs"

  try {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tempScriptPath, $js, $utf8NoBom)

    & $NodePath $tempScriptPath $PrefsPath $ExtensionId
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to update Chrome Preferences: $PrefsPath"
    }
  }
  finally {
    if (Test-Path -LiteralPath $tempScriptPath -PathType Leaf) {
      Remove-Item -LiteralPath $tempScriptPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Install-NativeHost {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NodePath,

    [Parameter(Mandatory = $true)]
    [string]$HostJs,

    [Parameter(Mandatory = $true)]
    [string]$HostInstallDir,

    [Parameter(Mandatory = $true)]
    [string]$HostWrapperPath,

    [Parameter(Mandatory = $true)]
    [string]$HostManifestPath,

    [Parameter(Mandatory = $true)]
    [string]$HostName,

    [Parameter(Mandatory = $true)]
    [string]$ExtensionId
  )

  if (-not (Test-Path -LiteralPath $HostJs -PathType Leaf)) {
    throw "Native host entrypoint not found: $HostJs`nBuild the package first so dist\native\host.js exists."
  }

  if (Test-Path -LiteralPath $HostInstallDir) {
    Remove-Item -LiteralPath $HostInstallDir -Recurse -Force
  }

  $null = New-Item -ItemType Directory -Path $HostInstallDir -Force

  $wrapper = @"
@echo off
"$NodePath" "$HostJs" %*
"@
  Set-Content -LiteralPath $HostWrapperPath -Value $wrapper -Encoding Default

  $manifestObject = [ordered]@{
    name = $HostName
    description = 'LLM native messaging host'
    path = $HostWrapperPath
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
  }

  $manifestJson = $manifestObject | ConvertTo-Json -Depth 5
  Set-Content -LiteralPath $HostManifestPath -Value $manifestJson -Encoding UTF8

  Set-RegistryDefaultValue -Key "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName" -Value $HostManifestPath

  Write-Host 'Installed native messaging host:'
  Write-Host "  extension: $ExtensionId"
  Write-Host "  node:      $NodePath"
  Write-Host "  host.js:   $HostJs"
  Write-Host "  wrapper:   $HostWrapperPath"
  Write-Host "  manifest:  $HostManifestPath"
}

$ChromeExe = Get-ChromeExe
$ChromeDir = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
$LocalState = Join-Path $ChromeDir 'Local State'
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$DistDir = Join-Path $ScriptDir 'dist'
$HostJs = Join-Path $DistDir 'native\host.js'
$HostInstallDir = Join-Path $env:LOCALAPPDATA "llm-native-host\$HOST_NAME"
$HostWrapperPath = Join-Path $HostInstallDir 'run-host.cmd'
$HostManifestPath = Join-Path $HostInstallDir "$HOST_NAME.json"
$ExtensionRegKey = "HKCU\Software\Google\Chrome\Extensions\$EXT_ID"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw 'node was not found in PATH.'
}
$NodePath = $nodeCommand.Source

if (-not (Test-Path -LiteralPath $LocalState -PathType Leaf)) {
  throw "Chrome Local State not found: $LocalState"
}

$localStateData = Get-Content -LiteralPath $LocalState -Raw | ConvertFrom-Json
$profileData = $localStateData.profile
$active = @($profileData.last_active_profiles)
$lastUsed = $profileData.last_used
$infoCache = $profileData.info_cache

$seen = @{}
$activeClean = New-Object System.Collections.ArrayList
foreach ($profile in $active) {
  if ($profile -and -not $seen.ContainsKey([string]$profile)) {
    $seen[[string]$profile] = $true
    [void]$activeClean.Add([string]$profile)
  }
}

if ($activeClean.Count -eq 0 -and $lastUsed) {
  [void]$activeClean.Add([string]$lastUsed)
}

$mapping = @{}
if ($infoCache) {
  foreach ($prop in $infoCache.PSObject.Properties) {
    $profileDir = [string]$prop.Name
    $meta = $prop.Value

    $displayName = $profileDir
    if ($meta -and $meta.PSObject.Properties.Match('name').Count -gt 0 -and $meta.name) {
      $displayName = [string]$meta.name
    }
    elseif ($meta -and $meta.PSObject.Properties.Match('user_name').Count -gt 0 -and $meta.user_name) {
      $displayName = [string]$meta.user_name
    }

    $mapping[$profileDir] = $displayName
  }
}

$TargetProfile = $null
if ($mapping.ContainsKey($TargetInput)) {
  $TargetProfile = $TargetInput
}

if (-not $TargetProfile) {
  foreach ($profileDir in $mapping.Keys) {
    if ($mapping[$profileDir] -eq $TargetInput) {
      $TargetProfile = $profileDir
      break
    }
  }
}

if (-not $TargetProfile -and $TargetInput) {
  $TargetProfile = $TargetInput
}

if (-not $TargetProfile) {
  throw 'Could not resolve target profile.'
}

$TargetPrefs = Join-Path (Join-Path $ChromeDir $TargetProfile) 'Preferences'
if (-not (Test-Path -LiteralPath $TargetPrefs -PathType Leaf)) {
  throw "Target profile Preferences file not found: $TargetPrefs"
}

Write-Host "Target profile: $TargetProfile"
Write-Host "Target prefs:   $TargetPrefs"
Write-Host "Host.js:        $HostJs"
Write-Host "Host manifest:  $HostManifestPath"

Add-RegistryStringValue -Key $ExtensionRegKey -Name 'update_url' -Value $UPDATE_URL
Write-Host 'Wrote external extension metadata:'
Write-Host "  $ExtensionRegKey"
Write-Host "  update_url=$UPDATE_URL"

$chromeProcesses = Get-Process -Name chrome -ErrorAction SilentlyContinue
if ($chromeProcesses) {
  foreach ($proc in $chromeProcesses) {
    try {
      [void]$proc.CloseMainWindow()
    }
    catch {
    }
  }

  for ($index = 0; $index -lt 30; $index++) {
    if (-not (Get-Process -Name chrome -ErrorAction SilentlyContinue)) {
      break
    }
    Start-Sleep -Milliseconds 200
  }

  Get-Process -Name chrome -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
}

Clear-ExternalUninstallBlock -NodePath $NodePath -PrefsPath $TargetPrefs -ExtensionId $EXT_ID
Write-Host 'Cleared external uninstall block for:'
Write-Host "  extension=$EXT_ID"
Write-Host "  profile=$TargetProfile"

Write-Host 'Installing native messaging host...'
Install-NativeHost `
  -NodePath $NodePath `
  -HostJs $HostJs `
  -HostInstallDir $HostInstallDir `
  -HostWrapperPath $HostWrapperPath `
  -HostManifestPath $HostManifestPath `
  -HostName $HOST_NAME `
  -ExtensionId $EXT_ID

Write-Host "Launching target profile first: $TargetProfile"
$targetArgs = "--profile-directory=""$TargetProfile"" --restore-last-session"
Start-Process -FilePath $ChromeExe -ArgumentList $targetArgs
Start-Sleep -Seconds 2

foreach ($profileDir in $activeClean) {
  if (-not $profileDir) { continue }
  if ($profileDir -eq $TargetProfile) { continue }

  Write-Host "Restoring previously active profile: $profileDir"
  $restoreArgs = "--profile-directory=""$profileDir"" --restore-last-session"
  Start-Process -FilePath $ChromeExe -ArgumentList $restoreArgs
  Start-Sleep -Milliseconds 1200
}

Write-Host ''
Write-Host 'Done.'
Write-Host ''
Write-Host 'What happened:'
Write-Host "- External install registry metadata was written for extension: $EXT_ID"
Write-Host '- Chrome was fully restarted'
Write-Host "- The external-uninstall block was cleared for target profile: $TargetProfile"
Write-Host "- Native messaging host installer was run for extension: $EXT_ID"
Write-Host '- The target profile was reopened first'
Write-Host '- All previously active profiles were restored'
