# Instalación, actualización y desinstalación

Guía para instalar **XuperTV para LG webOS** (`com.webosflux.xuptertv.fidelity`)
en un televisor LG con webOS 4. Probado en un **LG 43LM6300PDB con webOS
4.10.2-29**.

> **¿Solo quieres instalarlo y no te apetece leer?** Usa la guía visual
> [`docs/instalar/index.html`](../docs/instalar/index.html) o el instalador de
> doble clic (`INSTALAR-XUPERTV.bat`). Este documento es la versión técnica.

## Dos caminos

| Camino | Para quién | Qué necesita |
|---|---|---|
| **A. Instalador de doble clic** | cualquiera, sin terminal | Windows 10/11 (SSH ya incluido) |
| **B. ares-cli** | desarrollo y depuración | Node.js + `@webos-tools/cli` |

## A. Instalador de doble clic

1. Consigue la carpeta `XuperTV-instalador-<versión>` (ZIP generado con
   `tools/make-kit.ps1`) y **extráela**.
2. Doble clic en `INSTALAR-XUPERTV.bat`.
3. Escribe la IP del televisor y la clave de *Developer Mode* (la pide dos
   veces: una para copiar el paquete y otra para instalarlo).
4. Espera a `LISTO`. La app se abre sola.

Qué hace por dentro: comprueba el puerto 22, sube el IPK por SCP a
`/media/developer/temp`, llama a `com.webos.appInstallService/dev/install`,
espera a que la versión instalada coincida con la del IPK, verifica que
`ffmpeg` quedó en `0755` y lanza la app con `com.webos.applicationManager/launch`.

Opciones avanzadas del instalador:

```powershell
# sin preguntas
powershell -ExecutionPolicy Bypass -File tools\instalar-tv.ps1 -Ipk dist\app.ipk -TvHost 192.168.1.50

# comprobar el paquete sin tocar la TV
powershell -ExecutionPolicy Bypass -File tools\instalar-tv.ps1 -DryRun
```

## B. Instalación con ares-cli

### Requisitos

- Televisor LG con **webOS 4.0 o superior** conectado a la red.
- PC en la misma red, con **Node.js 18+** y `@webos-tools/cli`:

  ```bash
  npm i -g @webos-tools/cli
  ```

- IPK generado con `tools/build-ipk.ps1` (ver «Compilar» en el README) o
  descargado de la sección *Releases*.
- Modo desarrollador activo en el televisor.

### 1. Activar el modo desarrollador

1. Instala la app **Developer Mode** desde la LG Content Store.
2. Inicia sesión con una cuenta LG Developer y activa el modo.
3. El televisor se reinicia y muestra una IP y un puerto (normalmente 22).

> El modo desarrollador caduca a las 50 horas. Cuando caduca, `ares-install`
> deja de autenticar: vuelve a la app y renueva la sesión.

### 2. Registrar el televisor en ares

```bash
ares-setup-device
```

- `Device name`: por ejemplo `tv`
- `host`: la IP que muestra la app Developer Mode
- `port`: `22`
- `username`: `prisioner` (así, sin la «o»)
- `password`: la clave que muestra la app

Comprueba la conexión e instala la clave SSH (evita pedir contraseña en cada
comando):

```bash
ares-device-info --device tv
ares-novacom --device tv --getkey
```

### 3. Instalar el IPK

```bash
ares-install --device tv dist/com.webosflux.xuptertv.fidelity_1.5.9_all.ipk
ares-launch  --device tv com.webosflux.xuptertv.fidelity
```

El IPK ya contiene la web app, el servicio Luna y el binario FFmpeg: no hay
que instalar nada más en el televisor.

### Si `ares-install` falla después de subir

En algunos webOS 4 el paquete se sube pero los pasos `ls`/`md5` posteriores no
responden y `ares-install` termina con error. Usa el instalador directo del
repositorio (SFTP + Luna):

```bash
# Windows PowerShell
$env:TV_HOST="192.168.1.50"; $env:TV_PASS="tu_clave"
node tools/tv_deploy.mjs dist\com.webosflux.xuptertv.fidelity_1.5.9_all.ipk
```

```bash
# Linux / macOS
TV_HOST=192.168.1.50 TV_PASS=tu_clave \
  node tools/tv_deploy.mjs dist/com.webosflux.xuptertv.fidelity_1.5.9_all.ipk
```

Sube el IPK a `/media/developer/temp/` y llama a
`luna://com.webos.appInstallService/dev/install`. Debe terminar con
`"state":"installed"`.

### 4. Verificar la instalación

Servicio vivo (debe responder `returnValue: true`):

```bash
node tools/tv_luna.mjs luna://com.webosflux.xuptertv.fidelity.service/ping
```

FFmpeg ejecutable (necesario para el «Modo fluido»):

```bash
node tools/tv_exec.mjs "ls -l /media/developer/apps/usr/palm/services/com.webosflux.xuptertv.fidelity.service/ffmpeg"
```

Esperado: `-rwxr-xr-x`. Si sale `-rw-r--r--`, reinstala el IPK generado por
`tools/build-ipk.ps1` (el script reescribe `data.tar.gz` para conservar el
permiso) o ejecuta `chmod 755` sobre esa ruta.

### 5. Actualizar

Instala el nuevo IPK con el mismo comando: reemplaza la versión anterior y
conserva los datos locales (ajustes, historial, listas).

```bash
ares-install --device tv dist/com.webosflux.xuptertv.fidelity_<versión>_all.ipk
```

### 6. Desinstalar

```bash
ares-install --device tv --remove com.webosflux.xuptertv.fidelity
```

## Uso con el mando

| Tecla | Acción |
|---|---|
| Flechas | Navegar entre pestañas, filas, canales y categorías |
| OK / Enter | Seleccionar, reproducir, filtrar categoría |
| Back | Volver; cierra paneles y diálogos |
| Arriba (en el panel de canales) | Abrir el selector con las 38 categorías |
| Izquierda (en TV en vivo) | Abrir el panel de canales |
| Abajo (en VOD) | Abrir «Ajuste de reproducir» |

## Notas

- La app no incluye contenido: usa el catálogo y los canales que devuelve el
  portal en tiempo de ejecución.
- No se modifica el APK original, no se elude DRM ni autenticación y no se
  extraen credenciales de otras aplicaciones.
- Si el televisor cambia de IP, actualiza el dispositivo con
  `ares-setup-device --modify tv`.
