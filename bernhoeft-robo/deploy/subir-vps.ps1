# Sobe os dois robôs (Bernhoeft e Atlas) e o serviço de PDF para a VPS e roda o instalador de homologação.
# Rodar no PC (Windows), com o Tailscale conectado:
#   powershell -ExecutionPolicy Bypass -File "<pasta do GESDOC>\bernhoeft-robo\deploy\subir-vps.ps1"
# As pastas bernhoeft-robo e atlas-robo são achadas ao lado desta (não dependem de Documents\).
# Só vai código: profile/, out/, node_modules/, .venv e postman/ ficam no PC (dados, sessões e chaves são sensíveis).
# O envio usa "tailscale ssh" (autentica pelo Tailscale; o ssh/scp comum falha na verificação de chave do IP).
# O tailscale ssh precisa de um ssh.exe no PATH: usa o do Git se o do Windows não existir.
param(
  [string]$Vps = 'augusto@100.103.196.93',
  [switch]$Commit
)
$ErrorActionPreference = 'Stop'
$base = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pacote = Join-Path $env:TEMP 'robos-vps.tgz'
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) { $ts = 'C:\Program Files\Tailscale\tailscale.exe' }
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { $env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH }

Write-Host "Empacotando bernhoeft-robo e atlas-robo de $base (sem profile/, out/, node_modules/)..."
& $tar -czf $pacote -C $base `
  --exclude='node_modules' --exclude='profile' --exclude='profile-*' --exclude='out' --exclude='.venv*' `
  --exclude='__pycache__' --exclude='.env' --exclude='*.log' --exclude='postman' `
  bernhoeft-robo atlas-robo
if ($LASTEXITCODE) { throw 'Falha ao empacotar.' }

Write-Host "Enviando para $Vps ..."
cmd /c "`"$ts`" ssh $Vps `"cat > robos-vps.tgz`" < `"$pacote`""
if ($LASTEXITCODE) { throw 'Falha no envio (o Tailscale está conectado?).' }
Remove-Item $pacote

$arg = if ($Commit) { '--commit' } else { '' }
Write-Host 'Instalando na VPS (leva uns 10 min; log em ~/instalar-hml.log na VPS)...'
& $ts ssh $Vps "set -eo pipefail; cd ~ && tar -xzf robos-vps.tgz && rm robos-vps.tgz && bash ~/bernhoeft-robo/deploy/gesdoc/instalar-hml.sh $arg 2>&1 | tee ~/instalar-hml.log | grep -E '^\['"
Write-Host "Instalador terminou com código $LASTEXITCODE (0 = tudo no ar; 4 = faltam segredos no cofre)."
