# XuperTV Fidelity Port — estado real

Port de reconstrucción de XuperTV 4.34.4 para LG webOS 4.10.2-29
(Chromium 53), 1920×1080.

> Este documento describía una "Fase 1" con una maqueta inspirada en la APK.
> Ese contenido ya no refleja el proyecto y se ha sustituido. El estado real
> está aquí y en los documentos enlazados.

## Base de la reconstrucción

- APK de origen: `analysis/xuppertv/apk/Xuper.apk`, `com.xuper.netxxus`
  4.34.4 (`43404`), SHA-256
  `e70ce12782eec9f43393b69d88e2d243d8812ae38d2acf08856baa877c1ab856`.
- Layouts, drawables, mipmaps, estilos, colores, dimens y strings decodificados
  con JADX en `analysis/xuppertv/decoded/resources/`.
- Actividades analizadas: `WelcomeActivity`, `HomeActivity`,
  `LiveFreeActivity`, `VodDetailsActivity`, `VodSearchActivity`,
  `SettingActivity`.
- Reproductor Android: `IjkVideoView` + `IjkMediaPlayer` (wrappers `yc.*`); sin
  MediaDrm/Widevine/ExoPlayer detectado.
- Navegación Android: TheRouter.

## Estructura

```
webos/fidelity/
├── appinfo.json
├── index.html
├── css/style.css
├── js/app.js
├── config/api.js              catálogo / backend
├── data/catalog.js            muestra local de 6 películas abiertas
├── assets/original/           141 recursos de la APK por categoría
├── assets/catalog/            pósteres de la muestra
├── shots/                     capturas 1920×1080
└── *.md                       documentación del port
```

El IPK que puede aparecer en esta carpeta es un artefacto **anterior**; no
contiene este código. Ver `AUDITORIA_IPK.md`.

## Implementado

- **Bienvenida** (`activity_welcome.xml`): fondo, nombre, versión `v4.99.2` y
  animación de carga de 16 fotogramas.
- **Inicio** (`activity_home.xml`): 7 pestañas con geometría XML, scrim sobre el
  pager, logo de reserva, notificaciones y mosaicos de pósters.
- **TV en vivo** (`fragment_home_live.xml`): vídeo, lista de canales demo,
  fila enfocada, info inferior y botones rápidos.
- **Gratis** (`fragment_freefragment.xml`): cabeceras live/VOD y rejilla de 6
  columnas.
- **Detalle VOD** (`activity_voddetails.xml`): panel izquierdo, ventana de
  vídeo, botones y relacionados.
- **Búsqueda** (`activity_vodsearch.xml` + teclado): teclado, populares,
  resultados y estado vacío.
- **Ajustes** (`activity_setting.xml`): 6 paneles (reproducción, contenido
  adulto, control parental, feedback, actualización, sobre nosotros).
- **Reproductor**: barra live y `<video>` real para VOD.
- **Catálogo**: pipeline completo con muestra local y adaptador para backend
  autorizado.

## Fidelidad

- Geometría derivada de los layouts con la regla AutoLayout
  `design_width 1920 / design_width_in_dp 1280` → **1 dp = 1.5 px**.
- Recursos originales de la APK, con inventario y procedencia
  (`INVENTARIO_RECURSOS.md`).
- Medición real en navegador y comparación documentada en
  `COMPARACION_VISUAL.md`.
- **No** hay comparación píxel a píxel contra capturas de Android TV: no se
  afirma 100 % de fidelidad.
- Las piezas dinámicas (logo, iconos de pestaña, pósteres, QR, logos de canal)
  usan placeholder original o quedan pendientes; no se inventan.

## Pendiente

Ver `DIFERENCIAS_PENDIENTES.md`. Lo principal:

- barra VOD `MFInfoBar`,
- marquesina de botones del detalle,
- episodios de series,
- paneles Account/Purchase,
- flujo de contraseña parental,
- `LiveFreeActivity` como pantalla propia,
- pruebas en el televisor,
- referencia visual de Android TV.

## Empaquetado

Build 1.4.1 (app + servicio, con FFmpeg dentro del IPK):

```
dist/com.webosflux.xuptertv.fidelity_1.4.1_all.ipk   22 429 678 B
SHA-256 EB24581DA813684E12B4C7769EA3F6B475E153E61DEF98E8A523C8E382A8D430
```

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-ipk.ps1
```

El script ejecuta `ares-package` sobre la app **y** el servicio, y después
`tools/fix_ipk_modes.py` para dejar `ffmpeg` en 0755 (Windows guarda 0666 en el
tar). El resultado se instala en **un solo paso**; no hay que copiar el binario
aparte. FFmpeg 7.0.2 armhf estático (GPLv3) y su licencia viajan en
`usr/palm/services/com.webosflux.xuptertv.fidelity.service/`.

El ejecutable no está en git (31,8 MB). Se restaura desde el archivo
vendorizado, sin red:

```powershell
powershell -ExecutionPolicy Bypass -File tools/setup-ffmpeg.ps1
```

`build-ipk.ps1` lo llama solo si falta. SHA-256 del binario:
`0AFBA4A11110E6E402053E0FC14C33A7EB207D7A588688AE87DBA471A0F06C71`.

Instalación en la TV de pruebas (`ares-install` falla en este equipo tras la
subida; el servicio Luna sí instala):

```powershell
node tools\tv_deploy.mjs dist\com.webosflux.xuptertv.fidelity_1.4.1_all.ipk
```

Contiene la app completa (`config/`, `data/`, `assets/original/` y
`assets/catalog/`) más el servicio Node. Excluye capturas, documentación y el
IPK antiguo.

No es una release final: sigue pendiente `MFInfoBar`, la marquesina, los
episodios, la contraseña parental, los paneles Account/Purchase y la
comparación con referencia visual. Ver `PLAN_CORRECCION.md` (fases 1–5).

## Documentos

- `MAPA_PANTALLAS.md`
- `COMPARACION_VISUAL.md`
- `DIFERENCIAS_PENDIENTES.md`
- `PLAN_CORRECCION.md`
- `INVENTARIO_RECURSOS.md`
- `INTEGRACION_PELICULAS.md`
- `AUDITORIA_IPK.md`
- `player.md`
- `FASE4_PRUEBAS.md`
