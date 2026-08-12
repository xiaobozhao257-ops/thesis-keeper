$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"
$environmentFile = Join-Path $projectRoot "environment.rqdata.yml"

function Read-DotEnvValue([string]$key) {
  if (-not (Test-Path -LiteralPath $envFile)) { return "" }
  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$([regex]::Escape($key))=" } | Select-Object -Last 1
  if (-not $line) { return "" }
  return ($line -split "=", 2)[1].Trim()
}

if (-not (Get-Command conda -ErrorAction SilentlyContinue)) {
  throw "未检测到 conda。请先安装 Anaconda/Miniconda，并重新打开 PowerShell。"
}

$environmentName = Read-DotEnvValue "RQDATA_CONDA_ENV"
if (-not $environmentName) { $environmentName = "thesis-keeper-rqdata" }
$knownEnvironments = (conda env list --json | ConvertFrom-Json).envs
$environmentExists = $knownEnvironments | Where-Object { (Split-Path $_ -Leaf) -eq $environmentName }

if ($environmentExists) {
  conda env update -n $environmentName -f $environmentFile --prune
} else {
  conda env create -f $environmentFile
}

$licenseKey = Read-DotEnvValue "RQSDK_LICENSE_KEY"
if ($licenseKey) {
  conda run -n $environmentName rqsdk license -l $licenseKey
  conda run -n $environmentName rqsdk license info
  Write-Host "RQSDK 已安装并配置许可证。"
} else {
  Write-Host "RQSDK 已安装；RQSDK_LICENSE_KEY 仍为空，暂不配置许可证。"
}

conda run -n $environmentName python -c "import rqdatac; print('rqdatac import ok')"
