<#
  Instalador de XuperTV para televisores LG webOS 4.

  Pensado para gente sin conocimientos tecnicos: se ejecuta con doble clic en
  INSTALAR-XUPERTV.bat, pregunta la IP del televisor y hace todo lo demas.

  Que hace:
    1. Busca el IPK junto al instalador (o en dist/).
    2. Comprueba que el televisor responde en el puerto 22.
    3. Sube el IPK por SCP a /media/developer/temp.
    4. Lo instala con el servicio de instalacion de webOS (Luna).
    5. Espera a que la version instalada sea la del IPK.
    6. Comprueba que ffmpeg quedo ejecutable (necesario para el Modo fluido).
    7. Abre la app en el televisor.

  No necesita Node.js ni ares-cli: usa el cliente SSH que ya trae Windows 10/11.

  Uso normal:
    Doble clic en INSTALAR-XUPERTV.bat

  Uso avanzado (sin preguntas):
    powershell -ExecutionPolicy Bypass -File instalar-tv.ps1 -Ipk ruta\app.ipk -TvHost 192.168.1.50

  Comprobar sin tocar la TV:
    powershell -ExecutionPolicy Bypass -File instalar-tv.ps1 -DryRun
#>

[CmdletBinding()]
param(
    [string]$Ipk,
    [string]$TvHost,
    [string]$TvUser,
    [int]$Port = 22,
    [switch]$DryRun,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

$AppId      = 'com.webosflux.xuptertv.fidelity'
$SvcId      = 'com.webosflux.xuptertv.fidelity.service'
$AppDir     = "/media/developer/apps/usr/palm/applications/$AppId"
$SvcDir     = "/media/developer/apps/usr/palm/services/$SvcId"
$ConfigFile = Join-Path $PSScriptRoot 'instalar-config.json'
$script:LastExit = 0
$script:Fail = 0

# ---------------------------------------------------------------- apariencia
function Line { Write-Host ('  ' + ('-' * 68)) -ForegroundColor DarkGray }
function Title($t) { Write-Host ''; Write-Host ('  ' + $t) -ForegroundColor White }
function Step($n, $t) { Write-Host ''; Write-Host ("  [$n] " + $t) -ForegroundColor Cyan }
function Ok($t) { Write-Host ('      OK   ' + $t) -ForegroundColor Green }
function Warn($t) { Write-Host ('      !    ' + $t) -ForegroundColor Yellow }
function Fail($t) { Write-Host ('      X    ' + $t) -ForegroundColor Red }
function Info($t) { Write-Host ('           ' + $t) -ForegroundColor Gray }

function Show-Banner {
    Clear-Host
    Write-Host ''
    Write-Host '   ==================================================================' -ForegroundColor Red
    Write-Host '      X u p e r T V   para   L G   w e b O S' -ForegroundColor White
    Write-Host '      Instalador automatico - no hace falta saber informatica' -ForegroundColor DarkGray
    Write-Host '   ==================================================================' -ForegroundColor Red
}

function Pause-End {
    if ($NoPause) { return }
    Write-Host ''
    Read-Host '   Pulsa ENTER para cerrar esta ventana' | Out-Null
}

# ---------------------------------------------------------------- utilidades
function Read-WithDefault($prompt, $default) {
    if ($default) {
        $v = Read-Host ('   ' + $prompt + ' [' + $default + ']')
    } else {
        $v = Read-Host ('   ' + $prompt)
    }
    if ([string]::IsNullOrWhiteSpace($v)) { return $default }
    return $v.Trim()
}

function Test-IPv4($text) {
    if ($text -notmatch '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') { return $false }
    foreach ($n in $Matches[1..4]) { if ([int]$n -gt 255) { return $false } }
    return $true
}

function Test-Port($computer, $tcpPort, $timeoutMs = 3000) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($computer, $tcpPort, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs)) { return $false }
        $client.EndConnect($iar)
        return $true
    } catch {
        return $false
    } finally {
        try { $client.Close() } catch { }
    }
}

function Get-IpkCandidate {
    param([string]$explicit)

    if ($explicit) {
        if (-not (Test-Path -LiteralPath $explicit)) { throw "No existe el archivo: $explicit" }
        return (Resolve-Path -LiteralPath $explicit).Path
    }

    $roots = @(
        $PSScriptRoot,
        (Join-Path $PSScriptRoot 'dist'),
        (Split-Path $PSScriptRoot -Parent),
        (Join-Path (Split-Path $PSScriptRoot -Parent) 'dist')
    )
    $seen = @{}
    $list = @()
    foreach ($r in $roots) {
        if (-not $r) { continue }
        if (-not (Test-Path -LiteralPath $r)) { continue }
        foreach ($f in (Get-ChildItem -LiteralPath $r -Filter '*.ipk' -File -ErrorAction SilentlyContinue)) {
            if (-not $seen.ContainsKey($f.FullName)) {
                $seen[$f.FullName] = $true
                $list += $f
            }
        }
    }
    $list = @($list | Sort-Object LastWriteTime -Descending)
    if ($list.Count -eq 0) { return $null }
    if ($list.Count -eq 1) { return $list[0].FullName }

    Title 'Hay varios paquetes .ipk. Elige el numero:'
    for ($i = 0; $i -lt $list.Count; $i++) {
        Info (('{0}) {1}  ({2:N1} MB)') -f ($i + 1), $list[$i].Name, ($list[$i].Length / 1MB))
    }
    $pick = Read-WithDefault 'Numero' '1'
    $idx = 1
    [void][int]::TryParse($pick, [ref]$idx)
    $idx = [Math]::Max(1, [Math]::Min($list.Count, $idx))
    return $list[$idx - 1].FullName
}

function Invoke-Native($exe, [string[]]$arguments) {
    & $exe @arguments
    $script:LastExit = $LASTEXITCODE
}

function Get-SshDiagnosis {
    # BatchMode nunca pide contrasena, asi que se puede capturar la salida sin
    # riesgo de esconder el prompt. Sirve para distinguir red de autenticacion.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $a = @('-p', "$Port") + $script:SshOpts + @(
            '-o', 'BatchMode=yes', '-o', 'NumberOfPasswordPrompts=0',
            '-o', 'ConnectTimeout=8', "$TvUser@$TvHost", 'true'
        )
        $out = & ssh @a 2>&1 | ForEach-Object { '' + $_ }
        return ($out -join "`n")
    } catch {
        return ''
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Explain-SshError($text) {
    $t = '' + $text
    if ($t -match 'Permission denied|Authentication failed|Too many authentication') {
        Fail 'La contrasena no es correcta, o el Modo Desarrollador ha caducado.'
        Info 'Abre la app "Developer Mode" en la TV y mira la clave que muestra ahora.'
        return
    }
    if ($t -match 'timed out|No route to host|Connection refused|Network is unreachable|Could not resolve') {
        Fail 'No consigo hablar con el televisor.'
        Info 'Comprueba que la TV esta encendida, en la MISMA red WiFi que este PC'
        Info 'y que la IP es la que muestra la app Developer Mode.'
        return
    }
    if ($t -match 'Host key verification failed') {
        Fail 'La TV cambio su huella de seguridad.'
        Info 'Borra su linea en: ' + (Join-Path $env:USERPROFILE '.ssh\known_hosts')
        return
    }
    Fail 'No se pudo completar la conexion con el televisor.'
    Info 'Reinicia la TV, vuelve a activar el Modo Desarrollador y repite.'
}

function Get-IpkVersion($path) {
    # Lee la version real del IPK (data.tar.gz -> appinfo.json).
    $tmpDir = Join-Path $env:TEMP ('xuper-ipk-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    try {
        New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
        & tar -xf $path -C $tmpDir 'data.tar.gz' 2>$null
        $dataTar = Join-Path $tmpDir 'data.tar.gz'
        if (-not (Test-Path -LiteralPath $dataTar)) { return '' }
        $txt = (& tar -xzOf $dataTar "usr/palm/applications/$AppId/appinfo.json" 2>$null) -join "`n"
        $m = [regex]::Match($txt, '"version"\s*:\s*"([^"]+)"')
        if ($m.Success) { return $m.Groups[1].Value }
        return ''
    } catch {
        return ''
    } finally {
        Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------- programa
Show-Banner

# ---------------------------------------------------------- 1. requisitos
Step '1/6' 'Comprobando este ordenador'
$sshCmd = Get-Command ssh -ErrorAction SilentlyContinue
$scpCmd = Get-Command scp -ErrorAction SilentlyContinue
if (-not $sshCmd -or -not $scpCmd) {
    Fail 'Windows no tiene el cliente SSH instalado.'
    Info 'Ve a Configuracion > Aplicaciones > Caracteristicas opcionales'
    Info 'y anade "Cliente OpenSSH". Despues vuelve a ejecutar este instalador.'
    Pause-End
    exit 1
}
Ok 'Cliente SSH disponible'

# ---------------------------------------------------------- 2. el paquete
Step '2/6' 'Buscando el paquete de la aplicacion (.ipk)'
try {
    $ipkPath = Get-IpkCandidate -explicit $Ipk
} catch {
    Fail $_.Exception.Message
    Pause-End
    exit 1
}
if (-not $ipkPath) {
    Fail 'No encuentro ningun archivo .ipk.'
    Info 'El .ipk tiene que estar EN LA MISMA CARPETA que este instalador.'
    Info 'Si lo estas abriendo desde dentro del ZIP, primero extrae la carpeta.'
    $manual = Read-WithDefault 'Escribe la ruta completa del .ipk' ''
    if ($manual -and (Test-Path -LiteralPath $manual)) {
        $ipkPath = (Resolve-Path -LiteralPath $manual).Path
    } else {
        Pause-End
        exit 1
    }
}
$ipkItem = Get-Item -LiteralPath $ipkPath
Ok ($ipkItem.Name + '  (' + ('{0:N1}' -f ($ipkItem.Length / 1MB)) + ' MB)')

# ---------------------------------------------------------- 3. la TV
$cfg = $null
if (Test-Path -LiteralPath $ConfigFile) {
    try { $cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json } catch { $cfg = $null }
}

Step '3/6' 'Datos del televisor'
Info 'La IP y la clave las muestra la app "Developer Mode" en la pantalla de la TV.'
if (-not $TvHost) {
    $def = ''
    if ($cfg -and $cfg.host) { $def = [string]$cfg.host }
    do {
        $TvHost = Read-WithDefault 'IP del televisor' $def
        if (-not (Test-IPv4 $TvHost)) { Fail 'Eso no parece una IP. Ejemplo: 192.168.1.50' }
    } while (-not (Test-IPv4 $TvHost))
}

if (-not $TvUser) {
    Info 'Tipo de TV:  1) Modo Desarrollador (lo normal)   2) TV con root'
    $choice = Read-WithDefault 'Elige 1 o 2' '1'
    if ($choice -eq '2') { $TvUser = 'root' } else { $TvUser = 'prisioner' }
}

Ok ('TV: ' + $TvHost + ':' + $Port + '  usuario: ' + $TvUser)

# ---------------------------------------------------------- 4. conexion
Step '4/6' 'Comprobando la conexion'
if ($DryRun) {
    Info 'Modo de prueba: no se comprueba la red.'
} elseif (-not (Test-Port $TvHost $Port 3000)) {
    Warn ('El televisor no responde en ' + $TvHost + ':' + $Port + '.')
    Info 'Si la TV esta apagada o en otra red, esto no va a funcionar.'
    $go = Read-WithDefault 'Intentar de todas formas? (s/n)' 's'
    if ($go -match '^[nN]') { Pause-End; exit 1 }
} else {
    Ok 'El televisor responde'
}

$script:SshOpts = @(
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=20',
    '-o', 'ServerAliveInterval=15'
)

$remoteDir = '/media/developer/temp'
$remoteIpk = "$remoteDir/" + $ipkItem.Name
$expected = Get-IpkVersion $ipkPath
if (-not $expected) { $expected = 'desconocida' }

if ($DryRun) {
    Title 'DRY RUN (no se toca la TV)'
    Info ('IPK     : ' + $ipkPath)
    Info ('Version : ' + $expected)
    Info ('TV      : ' + $TvUser + '@' + $TvHost + ':' + $Port)
    Info ('Destino : ' + $remoteIpk)
    Pause-End
    exit 0
}

# ---------------------------------------------------------- 5. copiar
Step '5/6' 'Copiando la aplicacion al televisor'
Info 'Te va a pedir la contrasena DOS veces. Es normal.'
Info 'Escribe la clave que muestra la app Developer Mode (no se ve al escribir).'
Write-Host ''

$scpArgs = @('-P', "$Port") + $script:SshOpts + @($ipkPath, ($TvUser + '@' + $TvHost + ':' + $remoteIpk))
Invoke-Native 'scp' $scpArgs
if ($script:LastExit -ne 0) {
    $diag = Get-SshDiagnosis
    if ($diag -match 'timed out|No route to host|Connection refused|Network is unreachable|Could not resolve') {
        Explain-SshError $diag
        Pause-End
        exit 1
    }
    Warn 'No pude escribir en /media/developer/temp. Pruebo en /tmp...'
    $remoteDir = '/tmp'
    $remoteIpk = "$remoteDir/" + $ipkItem.Name
    $scpArgs = @('-P', "$Port") + $script:SshOpts + @($ipkPath, ($TvUser + '@' + $TvHost + ':' + $remoteIpk))
    Invoke-Native 'scp' $scpArgs
    if ($script:LastExit -ne 0) {
        Explain-SshError (Get-SshDiagnosis)
        Pause-End
        exit 1
    }
}
Ok 'Paquete copiado'

# ---------------------------------------------------------- 6. instalar
Step '6/6' 'Instalando en el televisor'
Info 'No cierres esta ventana. Puede tardar entre 30 segundos y 2 minutos.'
Write-Host ''

Info ('Version que se va a instalar: ' + $expected)

$installJson    = '{"id":"' + $AppId + '","ipkUrl":"' + $remoteIpk + '","subscribe":true}'
$launchJson     = '{"id":"' + $AppId + '"}'
$installJsonPath = $remoteDir + '/xuper-install.json'
$launchJsonPath  = $remoteDir + '/xuper-launch.json'
$remoteShPath    = $remoteDir + '/xuper-instalar.sh'

$remoteScript = @'
#!/bin/sh
APP="@@APPDIR@@"
SVC="@@SVCDIR@@"
EXPECT="@@VERSION@@"
JSON="@@JSON@@"
LOG="/tmp/xuper-install.log"

echo ""
echo "   >> La TV esta instalando el paquete..."
luna-send-pub -i -f luna://com.webos.appInstallService/dev/install "$(cat $JSON)" > "$LOG" 2>&1 &
PID=$!

i=0
V=""
while [ $i -lt 75 ]; do
  V=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$APP/appinfo.json" 2>/dev/null | head -n 1)
  if [ "$V" = "$EXPECT" ]; then break; fi
  if [ $((i % 5)) -eq 0 ]; then printf "."; fi
  sleep 2
  i=$((i + 1))
done
printf "\n"
kill $PID 2>/dev/null

if [ "$V" != "$EXPECT" ]; then
  echo "   >> La TV no confirmo la instalacion (encontrada: ${V:-ninguna})"
  echo "   ---- respuesta del televisor ----"
  tail -n 12 "$LOG" 2>/dev/null | sed 's/^/      /'
  echo "   --------------------------------"
  exit 3
fi

echo "   >> Instalada la version $V"

PERMS=$(ls -l "$SVC/ffmpeg" 2>/dev/null | cut -c1-10)
echo "   >> ffmpeg en la TV: ${PERMS:-no encontrado}"
case "$PERMS" in
  *x*) : ;;
  *)
    chmod 755 "$SVC/ffmpeg" 2>/dev/null
    PERMS=$(ls -l "$SVC/ffmpeg" 2>/dev/null | cut -c1-10)
    echo "   >> ffmpeg corregido: ${PERMS:-no encontrado}"
    ;;
esac

echo "   >> Abriendo XuperTV en el televisor..."
luna-send-pub -n 1 -f luna://com.webos.applicationManager/launch "$(cat @@LAUNCH@@)" > /dev/null 2>&1
exit 0
'@

$remoteScript = $remoteScript.Replace('@@APPDIR@@', $AppDir).Replace('@@SVCDIR@@', $SvcDir).Replace('@@VERSION@@', $expected).Replace('@@JSON@@', $installJsonPath).Replace('@@LAUNCH@@', $launchJsonPath)
$remoteScript = $remoteScript -replace "`r`n", "`n"

$tmp = Join-Path $env:TEMP ('xuper-inst-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$localSh     = Join-Path $tmp 'xuper-instalar.sh'
$localJson   = Join-Path $tmp 'xuper-install.json'
$localLaunch = Join-Path $tmp 'xuper-launch.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($localSh, $remoteScript, $utf8)
[System.IO.File]::WriteAllText($localJson, $installJson, $utf8)
[System.IO.File]::WriteAllText($localLaunch, $launchJson, $utf8)

$scpArgs = @('-P', "$Port") + $script:SshOpts + @(
    $localSh, $localJson, $localLaunch,
    ($TvUser + '@' + $TvHost + ':' + $remoteDir + '/')
)
Invoke-Native 'scp' $scpArgs
if ($script:LastExit -ne 0) {
    Explain-SshError (Get-SshDiagnosis)
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Pause-End
    exit 1
}

$sshArgs = @('-p', "$Port") + $script:SshOpts + @(($TvUser + '@' + $TvHost), ('sh ' + $remoteShPath))
Invoke-Native 'ssh' $sshArgs
$installExit = $script:LastExit

Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue

Line
if ($installExit -eq 0) {
    Write-Host ''
    Write-Host '   LISTO. XuperTV esta instalada en tu televisor.' -ForegroundColor Green
    Write-Host ''
    Info 'En la TV aparece en la barra de inicio como "XuperTV".'
    Info 'Si no la ves, apaga y enciende la TV y mira en "Mis aplicaciones".'
    Info ''
    Info 'Para ACTUALIZAR: vuelve a ejecutar este mismo instalador.'
    Info 'Para DESINSTALAR: manten pulsado el boton sobre el icono de la app en la TV.'
    try {
        $save = [pscustomobject]@{ host = $TvHost; user = $TvUser; port = $Port }
        ($save | ConvertTo-Json) | Set-Content -LiteralPath $ConfigFile -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch { }
} else {
    Write-Host ''
    Fail 'La instalacion no termino bien.'
    Info 'Copia el mensaje de arriba y pasalo a quien te dio el archivo.'
    Info 'Prueba tambien a reiniciar la TV y repetir.'
    $script:Fail = 1
}

Pause-End
exit $script:Fail
