param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,

  [string]$ApiUrl = '/api/v1',

  [string]$ImageRepo = 'ghcr.io/lopiv2/invenicum',

  [string]$FrontendPath = '../Invenicum/invenicum',

  [switch]$SkipLatest,

  [switch]$SkipPush
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [scriptblock]$Action
  )

  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Action
}

function Test-CommandAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CommandName
  )

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "No se encontro el comando '$CommandName'. Instalalo y vuelve a intentar."
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Push-Location $repoRoot
try {
  Invoke-Step -Name 'Validando prerequisitos' -Action {
    Test-CommandAvailable -CommandName 'docker'

    if (-not (Test-Path -Path 'Dockerfile.selfhosted')) {
      throw 'No se encontro Dockerfile.selfhosted en la raiz del backend.'
    }

    if (-not (Test-Path -Path $FrontendPath)) {
      throw "No se encontro la ruta del frontend: $FrontendPath"
    }

    docker version | Out-Null
  }

  $versionTag = "$ImageRepo`:$Version"
  $latestTag = "$ImageRepo`:latest"

  $buildArgs = @(
    'build',
    '-f', 'Dockerfile.selfhosted',
    '--build-context', "frontend=$FrontendPath",
    '--build-arg', "API_URL=$ApiUrl",
    '--build-arg', "APP_VERSION=$Version",
    '-t', $versionTag
  )

  if (-not $SkipLatest) {
    $buildArgs += @('-t', $latestTag)
  }

  $buildArgs += '.'

  Invoke-Step -Name "Construyendo imagen $versionTag" -Action {
    & docker @buildArgs
    if ($LASTEXITCODE -ne 0) {
      throw 'El build de Docker fallo.'
    }
  }

  if ($SkipPush) {
    Write-Host ''
    Write-Host 'Build completado. Se omitio push por --SkipPush.' -ForegroundColor Yellow
    Write-Host "Tag creada: $versionTag"
    if (-not $SkipLatest) {
      Write-Host "Tag creada: $latestTag"
    }
    exit 0
  }

  Invoke-Step -Name 'Publicando imagen versionada' -Action {
    & docker push $versionTag
    if ($LASTEXITCODE -ne 0) {
      throw 'El push de la imagen versionada fallo.'
    }
  }

  if (-not $SkipLatest) {
    Invoke-Step -Name 'Publicando imagen latest' -Action {
      & docker push $latestTag
      if ($LASTEXITCODE -ne 0) {
        throw 'El push de la imagen latest fallo.'
      }
    }
  }

  Write-Host ''
  Write-Host 'Release completada correctamente.' -ForegroundColor Green
  Write-Host "Version publicada: $versionTag"
  if (-not $SkipLatest) {
    Write-Host "Tambien se publico: $latestTag"
  }
  Write-Host ''
  Write-Host 'Siguiente paso para usuarios finales:'
  Write-Host 'docker compose -f docker-compose.stack.yml --env-file .env pull'
  Write-Host 'docker compose -f docker-compose.stack.yml --env-file .env up -d'
}
finally {
  Pop-Location
}
