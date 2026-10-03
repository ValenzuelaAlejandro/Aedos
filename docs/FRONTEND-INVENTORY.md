# Inventario frontend — línea base para Etapa 4

Este inventario se midió en el commit `dcd47d315c2aae960a944f7c330d80ae44070d44`
(fin de Etapa 3). Cada tamaño proviene de `git show <commit>:<archivo> | wc -l`;
el árbol de trabajo de esta medición no tenía cambios de producción. Los rangos
son líneas inclusivas de esos blobs y deberán actualizarse al cerrar cada
subetapa. La meta de Etapa 4 es que ningún archivo de frontend pase de 400
líneas, salvo excepción concreta y documentada.

## Archivos de partida

| Archivo y rango actual | Responsabilidades actuales | Destino previsto |
| --- | --- | --- |
| `src/frontend/scripts/app.js`, 1–4916 | IIFE de bootstrap y estado; globals compartidos; tema/idioma/router; adjuntos y validación; mensajes y progreso; generación de esqueleto y presentación con dos lectores SSE; transiciones y montaje del preview; zoom/fullscreen; slots de imagen; navegación/minimapa; exportación y reset. | Dividir por responsabilidades en `features/chat/`, `features/preview/`, `features/editor/`, `features/export/` y bootstrap. El código que siga en un archivo debe ser una sola responsabilidad. |
| `src/frontend/scripts/outline.js`, 1–1369 | Contenedores de conversación y outline, streaming/parsing de esqueleto, chips, render y eventos del editor de outline, alta/baja/reordenamiento, resumption y sincronización de dropdowns. | `features/outline/`: estado, render, acciones y compatibilidad. El parser SSE común va al cliente HTTP/SSE de 4.1. |
| `src/frontend/editor/editor.js`, 1–2205 | Código ejecutado dentro del iframe: selección, detección semántica de nodos, toolbar, transformaciones, historial, duplicar/copiar/pegar, capas y navegación de teclado; publica acciones en `window` del iframe. | `features/editor/`: selección/semántica, transformaciones, historial y acciones de capa, manteniendo la API pública del iframe. |
| `src/frontend/features/tools/tools.js`, 1–1018 | Inicialización del panel de herramientas del editor, sincronización de selección, inserción de formas/iconos y edición contextual de tipografía, color, tamaño, alineación, bordes, opacidad e imágenes. | `features/editor/tools/`: panel y controles por tipo de propiedad; conservar `window.initTools` y los callbacks consumidos desde el padre. |
| `src/frontend/features/minimap/minimap.js`, 1–515 | Miniaturas, centrado/escala, detección de acento, actualización observada del iframe, selección, drag/drop y sincronización de orden. | `features/editor/minimap/`: render de miniaturas, sincronización y navegación; conservar `window.initMinimap` y los hooks actuales. |
| `src/frontend/mobile/js/bridge.js`, 1–493 | Adaptador táctil a mouse, pinch zoom/pan, overlays móviles, metadatos de slides y contador/dots. | `mobile/bridge/`: gestos, zoom/pan, controles y sincronización; mantener las interfaces que consume `app-mobile.js` y los globals editoriales. |

El corte inicial de `app.js` por zonas para planear los movimientos es: 1–68
(sanitización de salida y conversión GIF); 69–824 (estado, globals, tema,
idioma, router y controles); 825–1154 (adjuntos, drag/drop, contador y
validación); 1155–1478 (progreso, loaders, preview y modo debug); 1479–2103
(generación del outline y acción de proceder); 2104–2956 (generación final,
stream SSE, iframe incremental y errores); 2957–3779 (setup del preview,
interacciones del editor, zoom y fullscreen); 3780–4303 (reemplazo de imágenes
y overlays); 4304–4916 (navegación, minimapa, exportación, reset y cierre del
bootstrap). Estos son límites de planificación; antes de mover un bloque se
vuelven a inspeccionar sus consumidores y dependencias léxicas.

## Lint y tipos antes del movimiento

Comando lint por archivo: `node_modules/.bin/eslint <archivo> --format json`.
Los errores y avisos que siguen son los observados en la línea base, no errores
introducidos por Etapa 4:

| Archivo | Avisos ESLint | Errores ESLint |
| --- | ---: | ---: |
| `scripts/app.js` | 74 | 5 |
| `scripts/outline.js` | 10 | 8 |
| `editor/editor.js` | 34 | 1 |
| `features/tools/tools.js` | 5 | 1 |
| `features/minimap/minimap.js` | 6 | 2 |
| `mobile/js/bridge.js` | 7 | 0 |

`npm run typecheck:ratchet` informó 29 errores totales en el proyecto, todos en
backend o scripts. `tsconfig.json` incluye `src/backend/**/*.js` y
`scripts/**/*.js`, pero no `src/frontend`; por tanto, los diagnósticos de tipo
por cada uno de estos seis archivos están **fuera de cobertura**, no equivalen
a cero errores. Agregar el frontend al typecheck es trabajo de Etapa 6.

## Orden clásico que debe conservarse en Etapa 4

En `src/frontend/index.html`, antes del contenido de la página se cargan
`features/shared/i18n.js`, `features/shared/logger.js`,
`features/minimap/minimap.js`, `features/shared/init.js` y
`features/chat/thinking-panel.js`. Al final del documento se cargan, en este
orden, `features/tools/tools.js`, `editor/editor-ui.js`, `mobile/js/config.js`,
`mobile/js/app-mobile.js`, `scripts/app.js`, `scripts/outline.js` y
`mobile/js/bridge.js`. Los proveedores externos cargados en `<head>` preceden
a esas hojas. Etapa 4 mantiene scripts clásicos, URLs y orden; cada función
movida que conserve consumidores existentes expone temporalmente un wrapper
`window.*` compatible. La migración a `type="module"` pertenece a Etapa 5.

## Límites repetidos — documentar, no centralizar ahora

| Comportamiento | Frontend actual | Backend actual | Nota de seguridad/alcance |
| --- | --- | --- | --- |
| Tema de generación | `app.js`: aviso a partir de 600 caracteres y contador `/600` | `MAX_TOPIC_CHARACTERS = 600` | Conservar el comportamiento y su contrato. |
| Adjuntos | `app.js`: rechaza `size > 10 * 1024 * 1024`; máximo 3 archivos | `MAX_UPLOAD_BYTES = 10 MiB`, `MAX_UPLOAD_FILES = 3`; las rutas además admiten `MAX_UPLOAD_ARRAY_FIELDS = 5` | El límite de la ruta no sustituye el límite real de Multer; el caso exactamente 10 MiB ya está documentado por separado. |
| Slides | `outline.js`: 15 Flash y 8 Pro; `minimap.js` también contiene límite visible 15 | `MAX_FLASH_SLIDES = 15`, `MAX_PRO_SLIDES = 8` | No consolidar ni modificar durante los movimientos. |
| HTML generado | `app.js`: `MAX_STREAM_HTML_CHARS = 2_000_000` | `MAX_EXPORT_HTML_BYTES = 2 MiB` | Caracteres y bytes no son unidades equivalentes; no reemplazar uno por otro. |
| Watchdog SSE | `app.js`: 600000 ms | `SSE_WATCHDOG_MS = 600000` | Conservar valor y ubicación efectiva hasta pruebas de tiempos específicas. |

El inventario no autoriza cambios de lógica, nombres de endpoints, límites,
prompts, apariencia ni dependencias. Antes de cada extracción se caracterizará
el contrato con tests; la lógica se mueve, no se reescribe.
