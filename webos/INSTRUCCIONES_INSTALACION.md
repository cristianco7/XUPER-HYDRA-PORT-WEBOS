# Instrucciones para instalar, probar y desinstalar WebOSFlux

## Requisitos
- LG 43LM6300PDB con webOS 4.10.2-29
- PC conectado a la misma red WiFi que el televisor
- Modo Desarrollador activado en el televisor (Developer Mode)

## Activar Developer Mode
1. Abrir la aplicación LG Content Store / Developer Mode en el televisor (o instalarla desde la tienda si no está presente)
2. Iniciar sesión con cuenta LG Developer
3. Activar Developer Mode
4. El televisor reiniciará

## Configurar ares-cli con el televisor
En el PC:

```bash
ares-setup-device
```

Seguir las instrucciones para añadir el televisor. Anotar la IP del televisor.

Ver dispositivos:
```bash
ares-device-info -d <nombre_dispositivo>
```

## Instalar la aplicación
Desde el directorio `webos/` o desde donde esté el IPK:

```bash
ares-install com.webosflux.xuptertv_1.0.0_all.ipk -d <nombre_dispositivo>
```

## Lanzar la aplicación
```bash
ares-launch com.webosflux.xuptertv_1.0.0_all.ipk -d <nombre_dispositivo>
```

O desde el menú de aplicaciones del televisor buscar "WebOSFlux".

## Desinstalar la aplicación
```bash
ares-install -d <nombre_dispositivo> -r com.webosflux.xuptertv
```

## Probar navegación con control remoto
- Flechas (Arriba/Abajo/Izquierda/Derecha): Navegar entre menús y elementos
- OK/Enter: Seleccionar
- Back/Volver: Salir del reproductor o volver

## Funcionalidades de esta fase
- Pantallas: Inicio, TV en vivo, Películas, Series, Búsqueda, Configuración (con datos de prueba propios)
- Navegación D-pad completa
- Gestión de foco
- Reproductor HTML5 con vídeo público de prueba (sin DRM)
- Sin dependencias externas pesadas, compatible con Chromium 53

## Limitaciones no comprobadas aún
- Reproducción HLS nativa en Chromium 53 de webOS 4 (no se ha probado en televisor real)
- Soporte MSE/DASH (evaluar caso por caso)
- Rendimiento con contenido real
- Comportamiento exacto de teclas en este modelo
- APIs Luna (no utilizadas en esta fase)

## Notas
- NO se ha modificado el APK original
- NO se han copiado recursos propietarios
- NO se han usado endpoints/credenciales del APK
- NO se ha intentado eludir DRM o autenticación
- Instalación NO realizada por el agente - requiere autorización del usuario
