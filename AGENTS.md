# Regla crítica: reproducción y Modo Fluido

La reproducción es una zona protegida. No modificar, reemplazar, simplificar
ni eliminar código de reproducción salvo que el usuario diga explícitamente:
**"modificar reproducción"** o **"modificar Modo Fluido"**.

Para cambios visuales (menús, CSS, pantallas, foco, textos o diseño), editar
solamente los recursos visuales necesarios. No tocar estas rutas ni cambiar su
comportamiento:

- `webos/fidelity/js/app.js`: `streamMode`, `forceRelay`, `resolveSmooth`,
  `restartCurrentPlayback`, `playUrl`, seek y cambio de episodio.
- `webos/services/com.webosflux.xuptertv.fidelity.service/index.js`: rutas
  `resolve` y `resolveSmooth`, y la condición que llama `relay.register`.
- `webos/services/com.webosflux.xuptertv.fidelity.service/ffmpeg-relay.js`.
- `webos/services/com.webosflux.xuptertv.fidelity.service/ffmpeg`.

Contrato obligatorio:

- **Normal** usa el proxy directo.
- **Modo Fluido** usa obligatoriamente `resolveSmooth` y una URL local
  `http://127.0.0.1:8787/s/<token>.mp4`.
- Al instalar o actualizar la IPK, comprobar que `ffmpeg` conserva permiso
  ejecutable (`chmod 755 .../service/ffmpeg`). El empaquetador puede perderlo.

Antes de entregar cualquier cambio que afecte la app, comprobar:

1. `node --check` de los JavaScript modificados.
2. Que el modo fluido siga enviando `forceRelay` y llame `resolveSmooth`.
3. Que el servicio siga registrando `resolveSmooth` y llame `relay.register`.
4. Que el binario `ffmpeg` siga presente y ejecutable en la TV después de
   instalar.

Si una tarea visual requiere tocar una de esas rutas, detenerse y pedir
autorización explícita al usuario antes de hacerlo.
