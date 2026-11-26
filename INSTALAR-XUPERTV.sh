#!/usr/bin/env bash
# Instalador de XuperTV para televisores LG webOS.
# Version para Linux (port del instalador Windows: instalar-tv.ps1 / INSTALAR-XUPERTV.bat)

AppId='com.webosflux.xuptertv.fidelity'
SvcId='com.webosflux.xuptertv.fidelity.service'
AppDir='/media/developer/apps/usr/palm/applications/com.webosflux.xuptertv.fidelity'
SvcDir='/media/developer/apps/usr/palm/services/com.webosflux.xuptertv.fidelity.service'

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
LegacyConfigFile="${SCRIPT_DIR}/instalar-config.json"
ConfigDir="${XDG_CONFIG_HOME:-${HOME}/.config}/xupertv"
ConfigFile="${ConfigDir}/installer.json"

script_LastExit=0
script_Fail=0
script_KeyPath=''
script_KeyDir=''
script_UseKey=0
script_KeyIsRsa=0
script_DiagLog=''
script_KeyError=''
script_LastTransferError=''
script_RootMode=0
script_UserExplicit=0
REPLY_VALUE=''

# ---------------------------------------------------------------- apariencia
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    C_RED=$'\033[31m'
    C_GREEN=$'\033[32m'
    C_YELLOW=$'\033[33m'
    C_CYAN=$'\033[36m'
    C_WHITE=$'\033[37m'
    C_GRAY=$'\033[90m'
    C_RESET=$'\033[0m'
else
    C_RED=''
    C_GREEN=''
    C_YELLOW=''
    C_CYAN=''
    C_WHITE=''
    C_GRAY=''
    C_RESET=''
fi

Line() { printf '%s  %s%s\n' "$C_GRAY" "$(printf -- '-%.0s' {1..68})" "$C_RESET"; }
Title() { printf '\n  %s%s%s\n' "$C_WHITE" "$1" "$C_RESET"; }
Step() { printf '\n  %s[%s] %s%s\n' "$C_CYAN" "$1" "$2" "$C_RESET"; }
Ok() { printf '      %sOK   %s%s\n' "$C_GREEN" "$1" "$C_RESET"; }
Warn() { printf '      %s!    %s%s\n' "$C_YELLOW" "$1" "$C_RESET"; }
Fail() { printf '      %sX    %s%s\n' "$C_RED" "$1" "$C_RESET"; }
Info() { printf '           %s%s%s\n' "$C_GRAY" "$1" "$C_RESET"; }

Show-Banner() {
    if [[ -t 1 ]]; then printf '\033[2J\033[H'; fi
    printf '\n'
    printf '   %s==================================================================%s\n' "$C_RED" "$C_RESET"
    printf '      %sX u p e r T V   para   L G   w e b O S%s\n' "$C_WHITE" "$C_RESET"
    printf '      %sInstalador automatico - no hace falta saber informatica%s\n' "$C_GRAY" "$C_RESET"
    printf '   %s==================================================================%s\n' "$C_RED" "$C_RESET"
}

Pause-End() {
    remove_tv_key
    if [[ "$NoPause" == 1 ]]; then return; fi
    read -r -p '   Pulsa ENTER para cerrar esta ventana' _dummy >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------- utilidades
trim() {
    local v="$*"
    v="${v#"${v%%[![:space:]]*}"}"
    v="${v%"${v##*[![:space:]]}"}"
    printf '%s' "$v"
}

add_user() {
    local user="$1" existing
    [[ -n "$user" ]] || return 0
    for existing in "${usuarios[@]}"; do
        [[ "$existing" == "$user" ]] && return 0
    done
    usuarios+=("$user")
}

read_with_default() {
    local prompt="$1" default="${2:-}"
    local v=''
    if [[ -n "$default" ]]; then
        read -r -p "   $prompt [$default]" v || v=''
    else
        read -r -p "   $prompt" v || v=''
    fi
    v="$(trim "$v")"
    if [[ -z "$v" ]]; then v="$default"; fi
    REPLY_VALUE="$v"
}

test_ipv4() {
    [[ "$1" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
    local i
    for i in 1 2 3 4; do
        if (( 10#${BASH_REMATCH[$i]} > 255 )); then return 1; fi
    done
    return 0
}

test_port() {
    local host="$1" port="$2" t="${3:-3}"
    timeout "$t" bash -c "exec 3<>/dev/tcp/$host/$port" >/dev/null 2>&1
}

get_local_ipv4() {
    # Rellena el array LOCAL_IPS con entradas "ip|prefix".
    LOCAL_IPS=()
    local out line ip prefix e dup default_ifaces
    default_ifaces="$(ip -4 route show default 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}' | sort -u | tr '\n' ' ')"
    if [[ -n "$default_ifaces" ]]; then
        out="$(ip -4 -o addr show scope global 2>/dev/null | awk -v devs="$default_ifaces" 'BEGIN {n=split(devs,d," "); for(i=1;i<=n;i++) allowed[d[i]]=1} allowed[$2] {split($4,a,"/"); print a[1] "|" a[2]}')"
    else
        out="$(ip -4 -o addr show scope global 2>/dev/null | awk 'NF >= 4 {split($4,a,"/"); print a[1] "|" a[2]}')"
    fi
    if [[ -z "$out" ]]; then
        out="$(hostname -I 2>/dev/null | tr ' ' '\n' | awk 'NF {print $1 "|24"}')"
    fi
    if [[ -z "$out" ]] && command -v python3 >/dev/null 2>&1; then
        out="$(python3 -c 'import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(("192.0.2.1",80)); print(s.getsockname()[0]+"|24"); s.close()' 2>/dev/null)"
    fi
    while IFS='|' read -r ip prefix; do
        [[ -z "$ip" ]] && continue
        [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
        [[ "$prefix" =~ ^[0-9]+$ ]] || prefix=24
        if [[ "$ip" == 127.* || "$ip" == 169.254.* ]]; then continue; fi
        dup=0
        for e in "${LOCAL_IPS[@]}"; do
            [[ "$e" == "$ip|${prefix:-24}" ]] && dup=1
        done
        if [[ $dup -eq 0 ]]; then
            LOCAL_IPS+=("$ip|${prefix:-24}")
        fi
    done <<< "$out"
    return 0
}

get_network_number() {
    # Devuelve el numero de red (int) de un IPv4 calculado con la mascara.
    local ip="$1" prefix="${2:-24}"
    local -a o=()
    IFS='.' read -r -a o <<< "$ip"
    local n=$(( (10#${o[0]}) * 16777216 + (10#${o[1]}) * 65536 + (10#${o[2]}) * 256 + (10#${o[3]}) ))
    local mask=$(( (2 ** (32 - prefix)) - 1 ))
    echo $(( n & ~mask ))
}

int_to_ip() {
    local n="$1"
    printf '%d.%d.%d.%d' $(( (n >> 24) & 255 )) $(( (n >> 16) & 255 )) $(( (n >> 8) & 255 )) $(( n & 255 ))
}

test_same_lan() {
    # Devuelve 0 si la TV esta en la misma red que este PC.
    local ip="$1"
    test_ipv4 "$ip" || return 1
    local entry l lprefix lnum inum
    for entry in "${LOCAL_IPS[@]}"; do
        l="${entry%%|*}"
        lprefix="${entry##*|}"
        inum="$(get_network_number "$ip" "$lprefix")"
        lnum="$(get_network_number "$l" "$lprefix")"
        if [[ "$inum" == "$lnum" ]]; then return 0; fi
    done
    return 1
}

find_ssh_hosts() {
    # Escribe por stdout lineas "IP PORT" de los aparatos con el SSH del modo
    # desarrollador abierto (puertos 22 y 9922) en la red local.
    python3 - "${LOCAL_IPS[@]}" <<'PY'
import concurrent.futures
import ipaddress
import socket
import sys

networks = set()
local_ips = set()
for value in sys.argv[1:]:
    address, _, prefix = value.partition("|")
    try:
        interface = ipaddress.ip_interface(f"{address}/{prefix or '24'}")
    except ValueError:
        continue
    local_ips.add(str(interface.ip))
    networks.add(interface.network)

targets = set()
for network in networks:
    if network.num_addresses > 4096:
        network = ipaddress.ip_network(f"{network.network_address}/20", strict=False)
    targets.update(str(ip) for ip in network.hosts() if str(ip) not in local_ips)

def probe(address):
    open_ports = []
    for port in (22, 9922):
        try:
            with socket.create_connection((address, port), timeout=0.45):
                open_ports.append(port)
        except OSError:
            pass
    if open_ports:
        return address, 9922 if 9922 in open_ports else open_ports[0]
    return None

with concurrent.futures.ThreadPoolExecutor(max_workers=128) as pool:
    for result in pool.map(probe, targets):
        if result:
            print(*result)
PY
    return 0
}

find_ssh_port() {
    local candidates=("$@") c
    for c in "${candidates[@]}"; do
        if [[ "$c" =~ ^[0-9]+$ ]] && test_port "$TvHost" "$c" 2; then
            echo "$c"
            return 0
        fi
    done
    return 1
}

select_tv_from_scan() {
    if [[ ${#LOCAL_IPS[@]} -eq 0 ]]; then
        Fail 'No encuentro la red de este ordenador.'
        Info 'Comprueba que el PC tiene WiFi o cable conectado.'
        return 1
    fi
    Title 'Buscando la TV en tu red (unos segundos)...'
    Info 'Solo funciona si el Modo Desarrollador esta activo en la TV.'
    local found=()
    mapfile -t found < <(find_ssh_hosts)
    if [[ ${#found[@]} -eq 0 ]]; then
        Warn 'No he encontrado ningun aparato con el modo desarrollador abierto.'
        Info 'Abre la app "Developer Mode" en la TV y comprueba que esta activada.'
        Info 'Despues escribe B otra vez, o copia la IP a mano.'
        return 1
    fi
    local hit=''
    if [[ ${#found[@]} -eq 1 ]]; then
        Ok "Encontrado: ${found[0]}"
        read_with_default 'Es tu televisor? (s/n)' 's'
        if [[ "$REPLY_VALUE" =~ ^[nN] ]]; then return 1; fi
        hit="${found[0]}"
    else
        Title 'He encontrado varios aparatos. Cual es tu televisor?'
        local i
        for i in "${!found[@]}"; do
            Info "$((i + 1)) ${found[$i]}"
        done
        read_with_default 'Numero' '1'
        local pick="$REPLY_VALUE"
        local idx=1
        [[ "$pick" =~ ^[0-9]+$ ]] && idx=$((10#${pick}))
        if (( idx < 1 || idx > ${#found[@]} )); then idx=1; fi
        hit="${found[$((idx - 1))]}"
    fi
    TvHost="${hit%% *}"
    Port="${hit##* }"
    return 0
}

# ---------------------------------------------------------------- ssh
declare -A SshOptionCache=()
SSH_OPTS=()
AUTH_OPTS=()

test_ssh_option() {
    local opt="$1"
    if [[ -n "${SshOptionCache[$opt]+x}" ]]; then
        if [[ "${SshOptionCache[$opt]}" == 1 ]]; then return 0; fi
        return 1
    fi
    local ok=0
    ssh -G -o "$opt" 127.0.0.1 >/dev/null 2>&1 && ok=1
    SshOptionCache["$opt"]="$ok"
    [[ "$ok" == 1 ]]
}

get_pubkey_alg_name() {
    # OpenSSH 8.5 cambio PubkeyAcceptedKeyTypes por PubkeyAcceptedAlgorithms.
    local name=''
    local cand
    for cand in PubkeyAcceptedAlgorithms PubkeyAcceptedKeyTypes; do
        if test_ssh_option "$cand=+ssh-rsa"; then name="$cand"; break; fi
    done
    if [[ -z "$name" ]]; then
        local vout
        vout="$(ssh -V 2>&1)"
        if [[ "$vout" =~ ^OpenSSH[_\-]*([0-9]+)\.([0-9]+) ]]; then
            local major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}"
            if (( 10#$major > 8 )) || { (( 10#$major == 8 )) && (( 10#$minor >= 5 )); }; then
                name='PubkeyAcceptedAlgorithms'
            else
                name='PubkeyAcceptedKeyTypes'
            fi
        fi
    fi
    printf '%s' "$name"
}

get_ssh_opts() {
    # Las TV LG con webOS 4 llevan OpenSSH 6.1: solo ssh-rsa y SHA-1, que los
    # clientes OpenSSH modernos rechazan por defecto. Se reactivan SOLO para esta
    # conexion.
    SSH_OPTS=()
    local opt
    local -a defaults=(
        'StrictHostKeyChecking=accept-new'
        'ConnectTimeout=20'
        'ServerAliveInterval=15'
        'PreferredAuthentications=publickey,keyboard-interactive,password'
        'NumberOfPasswordPrompts=3'
        'HostKeyAlgorithms=+ssh-rsa'
        'KexAlgorithms=+diffie-hellman-group14-sha1'
        'MACs=+hmac-sha1'
    )
    local d
    for d in "${defaults[@]}"; do
        if test_ssh_option "$d"; then SSH_OPTS+=(-o "$d"); fi
    done
    local pubname
    pubname="$(get_pubkey_alg_name)"
    if [[ -n "$pubname" ]]; then
        if test_ssh_option "$pubname=+ssh-rsa"; then SSH_OPTS+=(-o "$pubname=+ssh-rsa"); else SSH_OPTS+=(-o "$pubname=ssh-rsa"); fi
    fi
    return 0
}

scp_legacy=0
check_scp_legacy() {
    # scp 9+ usa SFTP por defecto; las TV webOS 4 solo entienden el scp antiguo
    # (-O). Se mira la version del cliente antes de usarlo.
    local vout
    vout="$(ssh -V 2>&1)"
    if [[ "$vout" =~ ^OpenSSH[_\-]*([0-9]+)\.([0-9]+) ]]; then
        local major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}"
        if (( 10#$major < 9 )); then scp_legacy=1; fi
    fi
    return 0
}

get_auth_args() {
    AUTH_OPTS=()
    if [[ $script_UseKey == 1 && -n "$script_KeyPath" ]]; then
        AUTH_OPTS=(-i "$script_KeyPath" -o IdentitiesOnly=yes -o BatchMode=yes -o NumberOfPasswordPrompts=0)
        local pubname
        pubname="$(get_pubkey_alg_name)"
        if [[ -n "$pubname" ]]; then AUTH_OPTS+=(-o "$pubname=ssh-rsa"); fi
    fi
    return 0
}

run_ssh() {
    # $@ = comando remoto (ej: "true" o "sh /tmp/xuper-instalar.sh").
    # Al final deja LAST_EXIT y LAST_OUT con el resultado.
    local -a args=("${SSH_OPTS[@]}")
    get_auth_args
    args+=("${AUTH_OPTS[@]}" -p "$Port" "${TvUser}@${TvHost}" "$@")
    local out rc=''
    if [[ $script_UseKey == 1 && -n "$script_KeyPath" ]]; then
        out="$(ssh "${args[@]}" 2>&1)"; rc="$?"
    else
        out="$(sshpass -d 3 3<<<"$tvPass" ssh "${args[@]}" 2>&1)"; rc="$?"
    fi
    LAST_OUT="$out"
    LAST_EXIT="$rc"
    return 0
}

get_ssh_diagnosis() {
    # BatchMode nunca pide contrasena, asi que se puede capturar la salida sin
    # riesgo de esconder el prompt. Sirve para distinguir red de autenticacion.
    local out rc=''
    out="$(ssh -o BatchMode=yes -o NumberOfPasswordPrompts=0 -o ConnectTimeout=8 -p "$Port" -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=publickey,keyboard-interactive,password "${TvUser}@${TvHost}" 'true' 2>&1)"
    rc="$?"
    LAST_OUT="$out"
    LAST_EXIT="$rc"
    return 0
}

explain_ssh_error() {
    local t="$1"
    if [[ "$t" == *'Permission denied'* || "$t" == *'Authentication failed'* || "$t" == *'Too many authentication'* ]]; then
        Fail 'La contrasena no es correcta, o el Modo Desarrollador ha caducado.'
        Info 'Abre la app "Developer Mode" en la TV y mira la clave que muestra ahora.'
        return
    fi
    if [[ "$t" == *'timed out'* || "$t" == *'No route to host'* || "$t" == *'Connection refused'* || "$t" == *'Network is unreachable'* || "$t" == *'Could not resolve'* ]]; then
        Fail 'No consigo hablar con el televisor.'
        Info 'Comprueba que la TV esta encendida, en la MISMA red WiFi que este PC'
        Info 'y que la IP es la que muestra la app Developer Mode.'
        return
    fi
    if [[ "$t" == *'Host key verification failed'* ]]; then
        Fail 'La TV cambio su huella de seguridad.'
        Info 'Borra su linea en: '"${HOME}"'/.ssh/known_hosts'
        return
    fi
    Fail 'No se pudo completar la conexion con el televisor.'
    Info 'Reinicia la TV, vuelve a activar el Modo Desarrollador y repite.'
}

send_file_to_tv() {
    # Prueba SFTP, SCP y finalmente un flujo cat sobre SSH para TV sin SFTP.
    local localPath="$1" remotePath="$2" pass="$3"
    script_LastTransferError=''
    local batch rc out quotedRemote remoteCommand
    batch="$(mktemp /tmp/xuper-sftp-XXXXXX.txt)"
    printf 'put "%s" "%s"\nquit\n' "$localPath" "$remotePath" > "$batch"
    local -a sftpArgs=(-P "$Port" "${SSH_OPTS[@]}" "${AUTH_OPTS[@]}" -b "$batch" "${TvUser}@${TvHost}")
    if [[ $script_UseKey == 1 && -n "$script_KeyPath" ]]; then
        out="$(sftp "${sftpArgs[@]}" 2>&1)"; rc="$?"
    else
        out="$(sshpass -d 3 3<<<"$pass" sftp "${sftpArgs[@]}" 2>&1)"; rc="$?"
    fi
    rm -f "$batch"
    if [[ $rc -eq 0 ]]; then return 0; fi
    script_LastTransferError="$out"

    local -a scpArgs=(-P "$Port")
    if [[ $scp_legacy -eq 1 ]]; then scpArgs=(-O -P "$Port"); fi
    scpArgs+=("${SSH_OPTS[@]}" "${AUTH_OPTS[@]}" "$localPath" "${TvUser}@${TvHost}:${remotePath}")
    if [[ $script_UseKey == 1 && -n "$script_KeyPath" ]]; then
        out="$(scp "${scpArgs[@]}" 2>&1)"; rc="$?"
    else
        out="$(sshpass -d 3 3<<<"$pass" scp "${scpArgs[@]}" 2>&1)"; rc="$?"
    fi
    if [[ $rc -eq 0 ]]; then return 0; fi

    script_LastTransferError+=$'\n'"$out"
    if [[ $scp_legacy -ne 1 ]]; then
        local -a legacyScpArgs=(-O -P "$Port" "${SSH_OPTS[@]}" "${AUTH_OPTS[@]}" "$localPath" "${TvUser}@${TvHost}:${remotePath}")
        if [[ $script_UseKey == 1 && -n "$script_KeyPath" ]]; then
            out="$(scp "${legacyScpArgs[@]}" 2>&1)"; rc="$?"
        else
            out="$(sshpass -d 3 3<<<"$pass" scp "${legacyScpArgs[@]}" 2>&1)"; rc="$?"
        fi
        if [[ $rc -eq 0 ]]; then return 0; fi
        script_LastTransferError+=$'\n'"$out"
    fi

    quotedRemote="$(python3 -c 'import shlex,sys; print(shlex.quote(sys.argv[1]))' "$remotePath")" || return 1
    remoteCommand="cat > $quotedRemote"
    if [[ $script_UseKey == 1 && -n "$script_KeyPath" ]]; then
        out="$(ssh "${SSH_OPTS[@]}" "${AUTH_OPTS[@]}" -p "$Port" "${TvUser}@${TvHost}" "$remoteCommand" < "$localPath" 2>&1)"
        rc=$?
    else
        out="$(sshpass -d 3 3<<<"$pass" ssh "${SSH_OPTS[@]}" "${AUTH_OPTS[@]}" -p "$Port" "${TvUser}@${TvHost}" "$remoteCommand" < "$localPath" 2>&1)"
        rc=$?
    fi
    if [[ $rc -eq 0 ]]; then return 0; fi
    script_LastTransferError+=$'\n'"$out"
    return 1
}

remove_tv_key() {
    if [[ -n "$script_KeyDir" && -d "$script_KeyDir" ]]; then
        rm -rf "$script_KeyDir" 2>/dev/null
    fi
    script_KeyDir=''
    script_KeyPath=''
    script_UseKey=0
}

read_tv_password() {
    REPLY_VALUE=''
    if [[ ! -t 0 ]]; then
        Fail 'La clave requiere una terminal interactiva.'
        return 1
    fi
    IFS= read -r -s -p '   Clave de la TV (no se ve al escribir): ' REPLY_VALUE || REPLY_VALUE=''
    printf '\n'
}

get_tv_key() {
    # $1 = ip, $2 = passphrase. Deja script_KeyPath / script_KeyIsRsa / script_KeyError.
    script_KeyError=''
    if ! test_port "$1" 9991 4; then
        script_KeyError='La TV no abre el puerto 9991 (KEY SERVER).'
        return 1
    fi
    remove_tv_key
    local dir path
    dir="$(mktemp -d /tmp/xuper-tvkey-XXXXXX)"
    path="${dir}/webos_rsa"
    local bajada=0 i=0
    while (( i < 3 )); do
        i=$((i + 1))
        if curl -fsS --max-time 15 -o "$path" "http://$1:9991/webos_rsa" 2>/dev/null; then
            if [[ -s "$path" && "$(stat -c%s "$path" 2>/dev/null)" -gt 100 ]]; then bajada=1; break; fi
        fi
        if (( i -lt 3 )); then sleep 2; fi
    done
    if [[ $bajada -ne 1 ]]; then
        if [[ -z "$script_KeyError" ]]; then script_KeyError='La TV no entrego su llave de seguridad.'; fi
        return 1
    fi
    if ! head -n 5 "$path" | grep -q 'PRIVATE KEY'; then
        script_KeyError='Lo que publica la TV no es una llave valida.'
        return 1
    fi
    chmod 600 "$path"
    script_KeyDir="$dir"
    if head -n 5 "$path" | grep -q 'ENCRYPTED'; then
        # ssh-keygen descifra el PEM sin abrir ningun prompt (por eso no se cuelga
        # como pasaba al pasar la clave cifrada a ssh -i).
        ssh-keygen -p -m PEM -P "$2" -N '' -f "$path" >/dev/null 2>&1
        if [[ $? -ne 0 ]]; then
            script_KeyError='La clave no abre la llave de la TV (passphrase incorrecta).'
            return 1
        fi
    fi
    local pub
    pub="$(ssh-keygen -y -f "$path" 2>&1)"
    if ! echo "$pub" | grep -q '^ssh-'; then
        script_KeyError='La llave de la TV no se pudo leer despues de descifrarla.'
        return 1
    fi
    script_KeyIsRsa=0
    [[ "$pub" == ssh-rsa* ]] && script_KeyIsRsa=1
    script_KeyPath="$path"
    return 0
}

test_key_auth() {
    # $1 = keyPath, $2 = user, $3 = isRsa. Comprueba que la TV acepta esa llave.
    local keyPath="$1" user="$2" isRsa="$3"
    local -a args=("${SSH_OPTS[@]}" -i "$keyPath" -o IdentitiesOnly=yes -o BatchMode=yes -o NumberOfPasswordPrompts=0)
    if [[ "$isRsa" == 1 ]]; then
        local pubname
        pubname="$(get_pubkey_alg_name)"
        if [[ -n "$pubname" ]]; then args+=(-o "$pubname=ssh-rsa"); fi
    fi
    args+=(-p "$Port" "$user@$TvHost" 'true')
    local out rc=''
    out="$(ssh "${args[@]}" 2>&1)"; rc="$?"
    LAST_OUT="$out"
    LAST_EXIT="$rc"
    return "$rc"
}

test_tv_password() {
    local pass="$1" user="$2" out rc
    local -a args=("${SSH_OPTS[@]}" -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1 -p "$Port" "${user}@${TvHost}" true)
    out="$(sshpass -d 3 3<<<"$pass" ssh "${args[@]}" 2>&1)"
    rc=$?
    script_LastAuthError="$out"
    return "$rc"
}

get_key_auth_debug() {
    # Si la llave se descifra pero la TV no la autoriza, esto dice por que.
    # Guarda la salida completa en un archivo para poder enviarla.
    local keyPath="$1" user="$2"
    local -a args=("${SSH_OPTS[@]}" -vvv -i "$keyPath" -o IdentitiesOnly=yes -o BatchMode=yes -o NumberOfPasswordPrompts=0 -p "$Port" "$user@$TvHost" 'true')
    local pubname
    pubname="$(get_pubkey_alg_name)"
    if [[ -n "$pubname" ]]; then args+=(-o "$pubname=ssh-rsa"); fi
    local out rc=''
    out="$(ssh "${args[@]}" 2>&1)"; rc="$?"
    LAST_OUT="$out"
    LAST_EXIT="$rc"
    local logPath
    logPath="$(mktemp /tmp/diagnostico-xupertv-XXXXXX.txt)"
    {
        printf 'XuperTV - diagnostico de la llave de seguridad\n'
        printf 'TV      : %s@%s:%s\n' "$user" "$TvHost" "$Port"
        printf 'Fecha   : %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        printf 'Huella  : %s\n' "$(ssh-keygen -lf "$keyPath" 2>&1 | tr -d '\r')"
        printf 'Version : %s\n' "$(ssh -V 2>&1)"
        printf '\n'
        printf '%s\n' "$out"
    } > "$logPath"
    script_DiagLog="$logPath"
    return 0
}

get_ipk_version() {
    # Lee la version real del IPK (data.tar.gz -> appinfo.json).
    local path="$1" txt
    txt="$(ar p "$path" data.tar.gz 2>/dev/null | tar -xzOf - "usr/palm/applications/$AppId/appinfo.json" 2>/dev/null)"
    if [[ "$txt" =~ \"version\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
        printf '%s' "${BASH_REMATCH[1]}"
    fi
    return 0
}

# ---------------------------------------------------------------- configuracion
get_saved_tv_passphrase() {
    return 0
}

save_installer_config() {
    mkdir -p "$ConfigDir"
    {
        printf '{\n'
        printf '    "host": "%s",\n' "$TvHost"
        printf '    "user": "%s",\n' "$TvUser"
        printf '    "port": %s\n' "$Port"
        printf '}\n'
    } > "$ConfigFile"
    chmod 600 "$ConfigFile"
}

clear_saved_tv_passphrase() {
    mkdir -p "$ConfigDir"
    {
        printf '{\n'
        printf '    "host": "%s",\n' "$TvHost"
        printf '    "user": "%s",\n' "$TvUser"
        printf '    "port": %s\n' "$Port"
        printf '}\n'
    } > "$ConfigFile"
    chmod 600 "$ConfigFile"
}

# ---------------------------------------------------------------- programa
Ipk=''
TvHost=''
TvUser=''
Port=0
DryRun=0
NoPause=0
while (($#)); do
    case "$1" in
        -Ipk|--ipk)
            (($# >= 2)) || { Fail "Falta el valor para $1."; exit 2; }
            Ipk="$2"; shift 2 ;;
        -TvHost|--tv-host)
            (($# >= 2)) || { Fail "Falta el valor para $1."; exit 2; }
            TvHost="$2"; shift 2 ;;
        -TvUser|--tv-user)
            (($# >= 2)) || { Fail "Falta el valor para $1."; exit 2; }
            TvUser="$2"; shift 2 ;;
        -Port|--port)
            (($# >= 2)) || { Fail "Falta el valor para $1."; exit 2; }
            Port="$2"; shift 2 ;;
        -DryRun|--dry-run) DryRun=1; shift ;;
        -NoPause|--no-pause) NoPause=1; shift ;;
        -h|--help)
            printf 'Uso: %s [-Ipk ARCHIVO.ipk] [-TvHost IP] [-TvUser USUARIO] [-Port PUERTO] [-DryRun] [-NoPause]\n' "$0"
            exit 0 ;;
        *)
            Fail "Opcion desconocida: $1"
            exit 2 ;;
    esac
done
if [[ ! "$Port" =~ ^[0-9]{1,5}$ ]]; then
    Fail 'Puerto invalido.'
    exit 2
fi
Port=$((10#$Port))
if (( Port > 65535 )); then
    Fail 'Puerto invalido.'
    exit 2
fi
if [[ -n "$TvUser" ]]; then
    script_UserExplicit=1
    if [[ "$TvUser" == root ]]; then script_RootMode=1; fi
fi

Show-Banner

# ---------------------------------------------------------- 1. requisitos
Step 1 'Comprobando este ordenador'
if ! command -v ssh >/dev/null 2>&1 || ! command -v scp >/dev/null 2>&1 || ! command -v ssh-keygen >/dev/null 2>&1; then
    Fail 'Este Linux no tiene el cliente SSH instalado.'
    Info 'Instala el cliente OpenSSH y sshpass:'
    Info '  sudo apt install openssh-client sshpass   (Debian/Ubuntu)'
    Info '  sudo dnf install openssh-clients sshpass   (Fedora)'
    Info '  sudo pacman -S openssh sshpass            (Arch)'
    Pause-End
    exit 1
fi
if ! command -v sshpass >/dev/null 2>&1; then
    Fail 'Este Linux no tiene el cliente sshpass instalado (necesario para escribir la clave).'
    Info 'Instala: sudo apt install sshpass'
    Pause-End
    exit 1
fi
if ! command -v sftp >/dev/null 2>&1; then
    Fail 'Este Linux no tiene el cliente sftp instalado.'
    Info 'Instala: sudo apt install openssh-client'
    Pause-End
    exit 1
fi
if ! command -v tar >/dev/null 2>&1; then
    Fail 'Este Linux no tiene tar instalado.'
    Info 'Instala: sudo apt install tar'
    Pause-End
    exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
    Fail 'Este Linux no tiene curl instalado (necesario para descargar la llave).'
    Info 'Instala: sudo apt install curl'
    Pause-End
    exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
    Fail 'Este Linux no tiene Python 3 instalado (necesario para buscar la TV en la red).'
    Info 'Instala: sudo apt install python3'
    Pause-End
    exit 1
fi
if ! command -v ar >/dev/null 2>&1; then
    Fail 'Este Linux no tiene ar instalado (necesario para leer paquetes .ipk).'
    Info 'Instala: sudo apt install binutils'
    Pause-End
    exit 1
fi
if ! command -v timeout >/dev/null 2>&1; then
    Fail 'Falta el comando timeout, necesario para comprobar la conexion.'
    Info 'Instala coreutils con el gestor de paquetes de tu distribucion.'
    Pause-End
    exit 1
fi
check_scp_legacy
Ok 'Cliente SSH disponible'

# ---------------------------------------------------------- 2. el paquete
Step 2 'Buscando el paquete de la aplicacion (.ipk)'
IpkOut=''
if [[ -n "$Ipk" ]]; then
    if [[ ! -f "$Ipk" ]]; then
        Fail "No existe el archivo: $Ipk"
        Pause-End
        exit 1
    fi
    IpkOut="$Ipk"
fi
if [[ -z "$IpkOut" ]]; then
    list=()
    declare -A seen=()
    roots=(
        "$SCRIPT_DIR"
        "$SCRIPT_DIR/dist"
        "$SCRIPT_DIR/.."
        "$SCRIPT_DIR/../dist"
    )
    root=''
    for root in "${roots[@]}"; do
        [[ -d "$root" ]] || continue
        while IFS= read -r -d '' f; do
            if [[ -z "${seen[$f]:-}" ]]; then
                seen["$f"]=1
                list+=("$f")
            fi
        done < <(find "$root" -maxdepth 1 -name '*.ipk' -type f -print0 2>/dev/null)
    done
    if [[ ${#list[@]} -eq 0 ]]; then
        Fail 'No encuentro ningun archivo .ipk.'
        Info 'El .ipk tiene que estar EN LA MISMA CARPETA que este instalador.'
        Info 'Si lo estas abriendo desde dentro del ZIP, primero extrae la carpeta.'
        read_with_default 'Escribe la ruta completa del .ipk' ''
        v="$REPLY_VALUE"
        if [[ -n "$v" && -f "$v" ]]; then
            IpkOut="$v"
        else
            Pause-End
            exit 1
        fi
    fi
    if [[ ${#list[@]} -eq 1 ]]; then
        IpkOut="${list[0]}"
    else
        Title 'Hay varios paquetes .ipk. Elige el numero:'
        i=0
        for i in "${!list[@]}"; do
            Info "$((i + 1)) ${list[$i]##*/}  ($(du -h "${list[$i]}" | cut -f1))"
        done
        read_with_default 'Numero' '1'
        pick="$REPLY_VALUE"
        idx=1
        [[ "$pick" =~ ^[0-9]+$ ]] && idx=$((10#${pick}))
        if (( idx < 1 || idx > ${#list[@]} )); then idx=1; fi
        IpkOut="${list[$((idx - 1))]}"
    fi
fi
ipkItem="$(basename "$IpkOut")"
Ok "$ipkItem  ($(du -h "$IpkOut" | cut -f1))"

# ---------------------------------------------------------- 3. la TV
cfg_host=''
cfg_user=''
cfg_port=''
configToRead=''
if [[ -f "$ConfigFile" ]]; then
    configToRead="$ConfigFile"
elif [[ -f "$LegacyConfigFile" ]]; then
    configToRead="$LegacyConfigFile"
fi
if [[ -n "$configToRead" ]]; then
    cfg_host="$(sed -n 's/.*"host"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$configToRead")"
    cfg_user="$(sed -n 's/.*"user"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$configToRead")"
    cfg_port="$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$configToRead")"
fi

Step 3 'Datos del televisor'
Info 'La IP y la clave las muestra la app "Developer Mode" en la pantalla de la TV.'
Info 'Al activar el modo la TV se reinicia, y entonces la IP PUEDE CAMBIAR.'
get_local_ipv4
if [[ ${#LOCAL_IPS[@]} -gt 0 ]]; then
    local_ips_str=''
    e=''
    for e in "${LOCAL_IPS[@]}"; do
        local_ips_str+="${e%%|*} "
    done
    Info "Este ordenador esta en: $local_ips_str"
fi
detectedPort=0

if [[ -z "$TvHost" ]]; then
    def=''
    if [[ -n "$cfg_host" ]]; then def="$cfg_host"; fi
    if [[ -n "$def" ]]; then Info "La ultima vez funciono con $def. Pulsa Enter para repetirla."; fi
    intentos=0
    while [[ -z "$TvHost" ]]; do
        read_with_default 'IP del televisor (o B para buscarla)' "$def"
        v="$REPLY_VALUE"
        if [[ -z "$v" || "${v,,}" =~ ^(b|buscar|busca)$ ]]; then
            intentos=$((intentos + 1))
            if (( intentos > 2 )); then
                Fail 'No consigo dar con la IP del televisor.'
                Info 'Mira la app "Developer Mode" en la TV y escribe la IP a mano.'
                Pause-End
                exit 1
            fi
            if ! select_tv_from_scan; then
                continue
            fi
            continue
        fi
        if ! test_ipv4 "$v"; then
            Fail 'Eso no parece una IP. Ejemplo: 192.168.1.50'
            Info 'Si no sabes cual es, escribe B y la busco yo en tu red.'
            continue
        fi
        TvHost="$v"
    done
fi

if [[ -z "$TvUser" ]]; then
    Info 'Tipo de TV:  1) Modo Desarrollador (lo normal)   2) TV con root'
    read_with_default 'Elige 1 o 2' '1'
    if [[ "$REPLY_VALUE" == 2 ]]; then
        TvUser='root'
        script_RootMode=1
        script_UserExplicit=1
    fi
fi

if [[ "$(test_ipv4 "$TvHost"; echo $?)" == 0 ]]; then
    if ! test_same_lan "$TvHost"; then
        Warn "La TV ($TvHost) no esta en la misma red que este PC (${LOCAL_IPS[*]})."
        Info 'Conecta el TV y el PC al mismo router/WiFi y repite (ojo con la WiFi de invitados).'
        read_with_default 'Continuar de todas formas? (s/n)' 'n'
        if [[ "$REPLY_VALUE" != 's' && "$REPLY_VALUE" != 'S' ]]; then
            Pause-End
            exit 1
        fi
    fi
fi

# ---------------------------------------------------------- 4. conexion
Step 4 'Comprobando la conexion'

if (( Port <= 0 )); then
    candidates=()
    if [[ $script_RootMode == 1 ]]; then
        candidates+=(22)
        if (( detectedPort > 0 )); then candidates+=(detectedPort); fi
        if [[ -n "$cfg_port" ]]; then candidates+=("$cfg_port"); fi
        candidates+=(9922)
    else
        candidates+=(9922)
        if (( detectedPort > 0 )); then candidates+=(detectedPort); fi
        if [[ -n "$cfg_port" ]]; then candidates+=("$cfg_port"); fi
        candidates+=(22)
    fi
    raw_candidates=("${candidates[@]}")
    declare -A cand_seen=()
    candidates=()
    for c in "${raw_candidates[@]}"; do
        if [[ "$c" =~ ^[0-9]+$ ]] && (( c > 0 )) && [[ -z "${cand_seen[$c]:-}" ]]; then
            cand_seen["$c"]=1
            candidates+=("$c")
        fi
    done
    if [[ $DryRun == 1 ]]; then
        Port="${candidates[0]}"
        Info "Puerto: $Port (o el 22; se detecta al conectar)"
    else
        Port="$(find_ssh_port "${candidates[@]}")"
        if [[ -z "$Port" ]]; then Port="${candidates[0]}"; fi
        if test_port "$TvHost" "$Port" 2; then
            Ok "El SSH de la TV escucha en el puerto $Port"
        else
            Warn "El SSH de la TV no responde en el puerto $Port."
        fi
    fi
fi

if [[ $DryRun == 1 ]]; then
    Info 'Modo de prueba: no se comprueba la red.'
else
    while true; do
        if test_port "$TvHost" "$Port" 3; then Ok 'El televisor responde'; break; fi
        Warn "El televisor no responde en $TvHost:$Port."
        Info 'Suele ser una de tres cosas: la TV esta apagada, la IP ha cambiado,'
        Info 'o la TV y el PC estan en redes distintas.'
        if [[ ${#LOCAL_IPS[@]} -gt 0 ]]; then
            local_ips_str=''
            e=''
            for e in "${LOCAL_IPS[@]}"; do
                local_ips_str+="${e%%|*} "
            done
            Info "Este PC esta en: $local_ips_str"
        fi
        cambiado=0
        for otro in 9922 22; do
            if [[ "$otro" != "$Port" ]] && test_port "$TvHost" "$otro" 1; then
                Ok "Pero responde en el puerto $otro: uso ese."
                Port="$otro"
                cambiado=1
                break
            fi
        done
        if [[ $cambiado == 1 ]]; then continue; fi
        Title 'Que quieres hacer?'
        Info '1) Escribir otra IP'
        Info '2) Buscar la TV en la red (recomendado)'
        Info '3) Salir'
        read_with_default 'Elige 1, 2 o 3' '2'
        pick="$REPLY_VALUE"
        if [[ "$pick" == 3 ]]; then Pause-End; exit 1; fi
        if [[ "$pick" == 1 ]]; then
            read_with_default 'IP del televisor' ''
            nueva="$REPLY_VALUE"
            if test_ipv4 "$nueva"; then
                TvHost="$nueva"
                Port="$(find_ssh_port 9922 22)"
                        if [[ -z "$Port" ]]; then Port=9922; fi
            else
                Fail 'Eso no parece una IP.'
            fi
            continue
        fi
        if ! select_tv_from_scan; then
            continue
        fi
    done
fi

userLabel="$TvUser"
if [[ -z "$userLabel" ]]; then userLabel='se detecta al conectar'; fi
Ok "TV: $TvHost:$Port  usuario: $userLabel"

get_ssh_opts
get_auth_args

if [[ $DryRun == 1 ]]; then
    Title 'DRY RUN (no se toca la TV)'
    Info "IPK     : $IpkOut"
    Info "Version : $(get_ipk_version "$IpkOut")"
    dryRunUser="$TvUser"
    if [[ -z "$dryRunUser" ]]; then dryRunUser='se detecta al conectar'; fi
    Info "TV      : $dryRunUser@$TvHost:$Port"
    Info "Destino : /media/developer/temp/$(basename "$IpkOut")"
    Pause-End
    exit 0
fi

# ---------------------------------------------------------- 5. copiar
Step 5 'Copiando la aplicacion al televisor'
if [[ $script_RootMode == 1 ]]; then
    Info 'Escribe la contrasena SSH de Homebrew Channel.'
    Info 'Si nunca la cambiaste, normalmente es: alpine'
else
    Info 'Escribe la clave que muestra la app "Developer Mode" en la TV.'
    Info 'La clave no se guarda; tendras que escribirla de nuevo en futuras actualizaciones.'
fi
Info 'No se ve nada mientras escribes: es normal.'
printf '\n'

tvPass=''
savedTvPass=''
if [[ $script_RootMode != 1 ]]; then
    savedTvPass="$(get_saved_tv_passphrase)"
fi
usingSavedPass=0
intentosPass=0
while [[ -z "$tvPass" ]]; do
    intentosPass=$((intentosPass + 1))
    if (( intentosPass > 3 )); then
        Fail 'La TV no acepta ninguna de las claves escritas.'
        if [[ $script_RootMode == 1 ]]; then
            Info 'Comprueba que SSH Server este activado en Homebrew Channel.'
            Info 'Usa la contrasena SSH configurada alli (por defecto: alpine).'
        else
            Info 'Abre la app "Developer Mode" en la TV y mira la clave de ahora.'
            Info 'Si pone KEY SERVER en ON, esa misma clave desbloquea la llave de la TV.'
            Info 'Si la sesion esta caducada, renovadla (dura 50 horas) y repite.'
        fi
        Pause-End
        exit 1
    fi
    usingSavedPass=0
    if [[ -n "$savedTvPass" ]]; then
        tvPass="$savedTvPass"
        savedTvPass=''
        usingSavedPass=1
        Info 'Usando la clave guardada en este PC...'
    else
        read_tv_password
        tvPass="$REPLY_VALUE"
    fi
    if [[ -n "$tvPass" ]]; then tvPass="$(trim "$tvPass")"; fi
    if [[ -z "$tvPass" ]]; then
        Fail 'La clave no puede estar vacia.'
        tvPass=''
        continue
    fi
    Info 'Comprobando la clave con la TV...'
    usuarios=()
    if [[ $script_UserExplicit == 1 ]]; then
        add_user "$TvUser"
    else
        if [[ "$script_RootMode" != 1 && "$cfg_user" != root ]]; then add_user "$cfg_user"; fi
        if [[ "$script_RootMode" == 1 ]]; then
            add_user "${TvUser:-root}"
        else
            add_user 'prisoner'
            add_user 'prisioner'
        fi
    fi
    authOk=0
    authUser=''
    authIter=0
    for u in "${usuarios[@]}"; do
        authIter=$((authIter + 1))
        if (( authIter > 4 )); then break; fi
        if [[ -n "$u" ]] && test_tv_password "$tvPass" "$u"; then
            authOk=1
            authUser="$u"
            break
        fi
    done
    if [[ $authOk -eq 1 ]]; then
        TvUser="$authUser"
        script_UseKey=0
        Ok "La TV acepta la clave (usuario $TvUser)"
    elif [[ $script_RootMode != 1 ]]; then
        Info 'No la acepta como contrasena. Probando la llave de seguridad...'
        keyPath=''
        keyRound=1
        while (( keyRound <= 3 )) && [[ $authOk -ne 1 ]]; do
            if (( keyRound > 1 )); then
                Info "La TV aun sincroniza su llave. Solicito una nueva (${keyRound}/3)..."
                sleep 4
            fi
            if get_tv_key "$TvHost" "$tvPass"; then
                keyPath="$script_KeyPath"
                kauthOk=0
                kuser=''
                for u in "${usuarios[@]}"; do
                    if [[ -n "$u" ]] && test_key_auth "$script_KeyPath" "$u" "$script_KeyIsRsa"; then
                        kauthOk=1
                        kuser="$u"
                        break
                    fi
                done
                if [[ $kauthOk -eq 1 ]]; then
                    authOk=1
                    TvUser="$kuser"
                    script_KeyPath="$script_KeyPath"
                    script_UseKey=1
                    Ok "La TV acepta la llave de seguridad (KEY SERVER, usuario $TvUser)"
                    break
                fi
            fi
            keyRound=$((keyRound + 1))
        done
        if [[ $authOk -ne 1 && -n "$keyPath" ]]; then
            Fail 'La clave es correcta, pero la TV rechazo tres llaves nuevas.'
            Info "Cuentas probadas: ${usuarios[*]}"
            if [[ -n "$script_LastAuthError" ]]; then
                firstLine=''
                while IFS= read -r l; do
                    if [[ "$l" == *'denied'* || "$l" == *'refused'* || "$l" == *'reset'* || "$l" == *'closed'* || "$l" == *'Too many'* ]]; then
                        firstLine="$l"
                        break
                    fi
                done <<< "$script_LastAuthError"
                if [[ -n "$firstLine" ]]; then Info "La TV respondio: $firstLine"; fi
            fi
            dbgLogPath=''
            dbg=''
            if ((${#usuarios[@]})); then
                dbgUser="${usuarios[${#usuarios[@]}-1]}"
                dbg="$(get_key_auth_debug "$script_KeyPath" "$dbgUser")"
            fi
            if [[ -n "$dbg" ]]; then
                Info 'Detalle tecnico:'
                printf '%s\n' "$dbg"
            fi
            if [[ -n "$script_DiagLog" ]]; then
                Info "Diagnostico guardado en: $script_DiagLog"
                Info 'Envia ese archivo si necesitas ayuda.'
            fi
            Pause-End
            exit 1
        elif [[ -n "$script_KeyError" ]]; then
            Warn "No se pudo usar la llave de la TV: $script_KeyError"
        fi
    fi
    if [[ $authOk -ne 1 ]]; then
        Fail 'La TV ha rechazado esa clave.'
        if [[ $usingSavedPass == 1 ]]; then Warn 'La clave guardada ya no sirve. Se elimino y se pedira una nueva.'; clear_saved_tv_passphrase; fi
        if [[ $script_RootMode == 1 ]]; then
            Info 'Comprueba SSH Server en Homebrew Channel y la contrasena root.'
        else
            Info 'Escribela otra vez con cuidado: no se ve al escribir.'
        fi
        if [[ $script_RootMode != 1 && $intentosPass -ge 2 ]]; then
            Info 'Tiene que ser la que muestra la app Developer Mode, tal cual.'
        fi
        tvPass=''
    fi
done
get_auth_args
printf '\n'

remoteDir='/media/developer/temp'
remoteIpk="$remoteDir/$(basename "$IpkOut")"
if ! send_file_to_tv "$IpkOut" "$remoteIpk" "$tvPass"; then
    diag="$(get_ssh_diagnosis)"
    if [[ "$diag" == *'timed out'* || "$diag" == *'No route to host'* || "$diag" == *'Connection refused'* || "$diag" == *'Network is unreachable'* || "$diag" == *'Could not resolve'* ]]; then
        explain_ssh_error "$diag"
        Pause-End
        exit 1
    fi
    Warn 'No pude escribir en /media/developer/temp. Pruebo en /tmp...'
    remoteIpk="/tmp/$(basename "$IpkOut")"
    if ! send_file_to_tv "$IpkOut" "$remoteIpk" "$tvPass"; then
        Fail 'No pude copiar la aplicacion al televisor.'
        if [[ -n "$script_LastTransferError" ]]; then
            linea=''
            while IFS= read -r l; do
                linea="$l"
            done < <(printf '%s\n' "$script_LastTransferError" | tail -n 2)
            if [[ -n "$linea" ]]; then Info "La TV respondio: $linea"; fi
        fi
        explain_ssh_error "$(get_ssh_diagnosis)"
        Pause-End
        exit 1
    fi
fi
Ok 'Paquete copiado'

# ---------------------------------------------------------- 6. instalar
Step 6 'Instalando en el televisor'
Info 'No cierres esta ventana. Puede tardar entre 30 segundos y 2 minutos.'
printf '\n'

expectedVersion="$(get_ipk_version "$IpkOut")"
Info "Version que se va a instalar: $expectedVersion"

installJsonPath="$remoteDir/xuper-install.json"
launchJsonPath="$remoteDir/xuper-launch.json"
remoteShPath="$remoteDir/xuper-instalar.sh"
installJson="$(python3 -c 'import json,sys; print(json.dumps({"id":sys.argv[1],"ipkUrl":sys.argv[2],"subscribe":True}))' "$AppId" "$remoteIpk")"
launchJson="$(python3 -c 'import json,sys; print(json.dumps({"id":sys.argv[1]}))' "$AppId")"

remoteScript='#!/bin/sh
APP=@@APPDIR@@
SVC=@@SVCDIR@@
EXPECT=@@VERSION@@
JSON=@@JSON@@
APPID=@@APPID@@
LOG="${JSON}.log"

echo ""
echo "   >> Cerrando instancia previa si esta abierta..."
luna-send-pub -n 1 -f luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$APPID\"}" >/dev/null 2>&1
echo "   >> La TV esta instalando el paquete..."
luna-send-pub -i -f luna://com.webos.appInstallService/dev/install "$(cat "$JSON")" > "$LOG" 2>&1 &
PID=$!
i=0
V=""
while [ $i -lt 75 ]; do
  V=$(sed -n '\''s/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'\'' "$APP/appinfo.json" 2>/dev/null | head -n 1)
  if [ "$V" = "$EXPECT" ]; then break; fi
  if [ $((i % 5)) -eq 0 ]; then printf "."; fi
  sleep 2
  i=$((i + 1))
done
printf "\n"
kill "$PID" 2>/dev/null
if [ "$V" != "$EXPECT" ]; then
  if grep -q '\''"downgrade"[[:space:]]*:[[:space:]]*true'\'' "$LOG" 2>/dev/null; then
    echo "   >> La TV rechazo el paquete como una version anterior."
    echo "   >> Comprueba la version instalada o elimina la version previa."
  fi
  echo "   >> La TV no confirmo la instalacion (encontrada: ${V:-ninguna})"
  echo "   ---- respuesta del televisor ----"
  tail -n 12 "$LOG" 2>/dev/null | sed '\''s/^/      /'\''
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
ls-control scan-services >/dev/null 2>&1
echo "   >> Abriendo XuperTV en el televisor..."
luna-send-pub -n 1 -f luna://com.webos.applicationManager/launch "$(cat @@LAUNCH@@)" > /dev/null 2>&1
exit 0
'
remoteScript="$(python3 -c '
import shlex,sys
text=sys.stdin.read()
for marker,value in zip(
    ("@@APPDIR@@","@@SVCDIR@@","@@VERSION@@","@@JSON@@","@@APPID@@","@@LAUNCH@@"),
    sys.argv[1:],
):
    text=text.replace(marker,shlex.quote(value))
sys.stdout.write(text)
' "$AppDir" "$SvcDir" "$expectedVersion" "$installJsonPath" "$AppId" "$launchJsonPath" <<<"$remoteScript")"

tmpDir="$(mktemp -d /tmp/xuper-inst-XXXXXX)"
localSh="${tmpDir}/xuper-instalar.sh"
localJson="${tmpDir}/xuper-install.json"
localLaunch="${tmpDir}/xuper-launch.json"
printf '%s' "$remoteScript" > "$localSh"
printf '%s' "$installJson" > "$localJson"
printf '%s' "$launchJson" > "$localLaunch"

filesOk=1
for f in "$localSh" "$localJson" "$localLaunch"; do
    leaf="$(basename "$f")"
    if ! send_file_to_tv "$f" "$remoteDir/$leaf" "$tvPass"; then filesOk=0; break; fi
done
if [[ $filesOk -ne 1 ]]; then
    explain_ssh_error "$(get_ssh_diagnosis)"
    rm -rf "$tmpDir"
    Pause-End
    exit 1
fi

run_ssh "sh $remoteShPath"
installExit="$LAST_EXIT"

rm -rf "$tmpDir"
remove_tv_key

Line
if [[ $installExit -eq 0 ]]; then
    printf '\n'
    Ok 'LISTO. XuperTV esta instalada en tu televisor.'
    printf '\n'
    Info 'En la TV aparece en la barra de inicio como "XuperTV".'
    Info 'Si no la ves, apaga y enciende la TV y mira en "Mis aplicaciones".'
    Info ''
    Info 'Para ACTUALIZAR: vuelve a ejecutar este mismo instalador.'
    Info 'Para DESINSTALAR: manten pulsado el boton sobre el icono de la app en la TV.'
    save_installer_config
else
    printf '\n'
    Fail 'La instalacion no termino bien.'
    Info 'Copia el mensaje de arriba y pasalo a quien te dio el archivo.'
    Info 'Prueba tambien a reiniciar la TV y repetir.'
    script_Fail=1
fi

Pause-End
exit "$script_Fail"
