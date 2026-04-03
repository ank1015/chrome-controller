param(
  [string]$ExtensionId,
  [string]$ChromeProfile = 'Default'
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoExtensionPath {
  $scriptDir = $PSScriptRoot
  $packageDir = Resolve-Path (Join-Path $scriptDir '..')
  return [pscustomobject]@{
    PackageDir = $packageDir.Path
    DistDir = (Join-Path $packageDir.Path 'dist')
    ChromeDir = (Join-Path $packageDir.Path 'dist\chrome')
    NativeHostScript = (Join-Path $packageDir.Path 'dist\native\host.js')
    LauncherSource = (Join-Path $scriptDir 'HostLauncher.cs')
  }
}

function Get-LoadedExtensionId([string]$chromeDir, [string]$profileName) {
  $prefsPaths = @(
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\$profileName\Secure Preferences"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\$profileName\Preferences")
  )

  foreach ($prefsPath in $prefsPaths) {
    if (!(Test-Path $prefsPath)) {
      continue
    }

    try {
      $json = Get-Content -Raw $prefsPath | ConvertFrom-Json
      $settings = $json.extensions.settings.PSObject.Properties
      foreach ($setting in $settings) {
        $value = $setting.Value
        if ($null -ne $value.path) {
          try {
            $resolvedPath = (Resolve-Path $value.path).Path
            if ($resolvedPath -eq $chromeDir) {
              return $setting.Name
            }
          } catch {
          }
        }
      }
    } catch {
    }
  }

  return $null
}

function Compile-HostLauncher([string]$sourcePath, [string]$outputPath) {
  $source = Get-Content -Raw $sourcePath
  Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $outputPath -OutputType ConsoleApplication
}

function Write-Utf8NoBom([string]$path, [string]$content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $encoding)
}

$paths = Resolve-RepoExtensionPath

if (!(Test-Path $paths.NativeHostScript)) {
  throw "host.js not found at $($paths.NativeHostScript). Run the extension build first."
}

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
  $ExtensionId = Get-LoadedExtensionId -chromeDir $paths.ChromeDir -profileName $ChromeProfile
}

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
  throw "Could not detect the unpacked extension ID from Chrome profile '$ChromeProfile'. Pass -ExtensionId explicitly."
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodePath = $nodeCommand.Source

$installRoot = Join-Path $env:LOCALAPPDATA 'llm-native-host\com.ank1015.llm'
$runtimeDirName = Get-Date -Format 'yyyyMMddHHmmss'
$runtimeDir = Join-Path $installRoot $runtimeDirName
$manifestPath = Join-Path $installRoot 'com.ank1015.llm.json'
$launcherPath = Join-Path $runtimeDir 'host-launcher.exe'
$configPath = Join-Path $runtimeDir 'host-launcher.config'

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Compile-HostLauncher -sourcePath $paths.LauncherSource -outputPath $launcherPath

Write-Utf8NoBom -path $configPath -content ((@(
  "nodePath=$nodePath"
  "scriptPath=$($paths.NativeHostScript)"
) -join [Environment]::NewLine) + [Environment]::NewLine)

$manifest = [ordered]@{
  name = 'com.ank1015.llm'
  description = 'LLM native messaging host'
  path = $launcherPath
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

Write-Utf8NoBom -path $manifestPath -content (($manifest | ConvertTo-Json -Depth 4) + [Environment]::NewLine)

$registryKey = 'HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ank1015.llm'
$registrySubKey = 'Software\Google\Chrome\NativeMessagingHosts\com.ank1015.llm'
$registryHandle = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registrySubKey)
if ($null -eq $registryHandle) {
  throw "Failed to create registry key HKCU\$registrySubKey"
}

try {
  $registryHandle.SetValue('', $manifestPath, [Microsoft.Win32.RegistryValueKind]::String)
} finally {
  $registryHandle.Dispose()
}

Write-Output "Installed native host for Chrome."
Write-Output "  Extension ID: $ExtensionId"
Write-Output "  Node: $nodePath"
Write-Output "  Host script: $($paths.NativeHostScript)"
Write-Output "  Launcher: $launcherPath"
Write-Output "  Manifest: $manifestPath"
Write-Output "  Registry: $registryKey"
Write-Output ''
Write-Output 'Restart Chrome fully and reload the unpacked extension.'
