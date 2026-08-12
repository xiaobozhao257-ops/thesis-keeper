$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"
$serverFile = Join-Path $projectRoot "services\rqdata_bridge\server.py"

function Read-DotEnvValue([string]$key) {
  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$([regex]::Escape($key))=" } | Select-Object -Last 1
  if (-not $line) { return "" }
  return ($line -split "=", 2)[1].Trim()
}

if (-not (Get-Command conda -ErrorAction SilentlyContinue)) {
  throw "未检测到 conda。请先安装 Anaconda/Miniconda。"
}

$environmentName = Read-DotEnvValue "RQDATA_CONDA_ENV"
if (-not $environmentName) { $environmentName = "thesis-keeper-rqdata" }

conda run --no-capture-output -n $environmentName python $serverFile --host 127.0.0.1 --port 8765
