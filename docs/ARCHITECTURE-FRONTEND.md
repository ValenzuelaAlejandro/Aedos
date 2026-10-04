# Arquitectura del frontend

Aedos sirve una SPA de JavaScript vanilla desde `src/frontend/`, sin bundler.
`index.html` es el bootstrap y declara el orden de CSS, módulos nativos y
scripts clásicos. La separación por carpetas es organizativa; varios helpers
siguen publicando bridges `window.*` para el HTML, el iframe y los scripts
clásicos.

## Mapa

| Ruta | Responsabilidad |
| --- | --- |
| `index.html`, `vercel.json` | Documento SPA, carga de assets y rewrites de hosting. |
| `styles/` | CSS principal dividido en seis segmentos concatenables en orden; `outline.css` mantiene el outline aparte. |
| `features/shared/` | i18n, logger, cliente HTTP/SSE, stores, tema, carga de vendor assets y bootstrap compartido. |
| `features/chat/` | Renderers de chips de chat, panel de razonamiento y servicios de adjuntos. |
| `features/outline/`, `features/skeleton/` | Render de slides de outline e inyección del skeleton. |
| `features/modals/` | Ciclo de vida del modal de error. |
| `features/export/` | Preparación aislada del snapshot de exportación. |
| `features/editor/`, `editor/` | Semántica, historial, geometría, editor del iframe y controles. |
| `features/tools/` | Inserción de formas/iconos y herramientas del editor. |
| `features/minimap/` | Vista, navegación y estado del minimapa. |
| `mobile/` | Shell móvil, estilos, puntos de navegación y bridge con la SPA. |
| `scripts/app.js`, `scripts/outline.js` | Coordinadores de generación/navegación y de outline; siguen siendo los mayores archivos de frontend. |
| `assets/` | Imágenes estáticas. |

## Flujo principal

1. `index.html` carga los estilos y, en orden, el catálogo de vendors, i18n,
   stores, renderers, bridges de editor/móvil y finalmente `app.js` y
   `outline.js`. No reordenar estos scripts por agrupación estética.
2. El chat valida el formulario y guarda estado mediante los stores compartidos.
   `features/shared/http-sse.js` contiene el lector reutilizable; la fachada
   `window.AedosHttpSse` sigue disponible para consumidores clásicos.
3. El flujo de esqueleto usa SSE y `outline.js` conserva el estado de edición,
   chips, acciones y compatibilidad de `window.*`. El render de una slide está
   aislado en `features/outline/slide-renderer.js`.
4. Al generar, el HTML se monta como preview/iframe. `editor/editor.js` se carga
   como módulo nativo dentro del iframe y usa imports relativos para sus helpers
   puros de semántica, historial, geometría e interacción de puntero. Los
   bridges públicos editor, tools y minimap siguen comunicándose entre iframe
   y página padre.
5. Antes de exportar, `features/export/export-snapshot.js` congela/copía el
   estado live con el orden histórico; luego la página llama a PDF/PPTX en el
   backend y consume la URL de descarga.

Los vendors externos están centralizados en
`features/shared/vendor-assets.js`, que inserta tags parser-blocking en el mismo
punto y orden histórico, conservando sus URL y SRI. El Motion CDN continúa en
12.38.0 y el paquete npm resuelto por lockfile en 12.37.0; no se igualaron porque
eso cambiaría la versión realmente cargada.

## Recetas

### Añadir un renderer

Coloca la función pura o factory en `features/<dominio>/`. Conserva exactamente
el HTML/atributos si se sustituye markup existente. Conecta el consumidor desde
su coordinador actual; cuando el consumidor sea clásico, mantén un bridge
pequeño y explícito en `window` en vez de convertir todo el grafo de carga.
Añade test de igualdad de markup/escape y, si la vista es visible, conserva la
baseline visual y la red de seguridad del editor.

### Añadir un store

Coloca estado y mutaciones en `features/shared/` con defaults iguales a los
actuales. El store no debe arrancar listeners ni renderizar UI. Durante la
transición, getters/setters `window.*` deben delegar al mismo estado y probarse
con asignación legacy además de la API nueva. No dupliques límites del backend:
consulta `docs/CONTRACTS.md` y documenta la copia si aún no existe un contrato
compartido.

### Añadir una herramienta del editor

Añade el helper de inserción/transformación a `features/tools/`; recibe como
dependencias el documento/ventana del iframe y la función de selección activa.
Integra controles visuales y ciclo de guardado en `features/tools/tools.js`.
Preserva selección, `saveState`, undo/redo y callbacks hacia el padre. Cubre la
acción con prueba de lifecycle y el flujo `npm run check:editor-safety`.

### Añadir un idioma

Añade traducciones a `features/shared/i18n.js`, manteniendo las claves y el
fallback actual. Comprueba que todos los controles estáticos y dinámicos usan
las mismas claves, que el cambio de idioma actualiza los atributos de
`index.html`, y que `npm run check:editor-safety` conserva el estado de idioma.
No traduzcas ni reescribas prompts de IA desde la capa de i18n.

## Límites y siguientes decisiones

- El outline legacy permanece: `outline.js` todavía usa `outline-edge-tab`,
  `legacy-outline-title-input`, `btn-add-slide-ai`, `outline-empty-state` y
  `outline-slide-count`. No se eliminó porque existen referencias activas en
  JS y el HTML, aunque el contenedor esté oculto.
- ESM nativo ya se usa en capas puntuales; no hay Vite ni paso de build. En la
  medición de siete muestras, la mediana FCP pasó de 108 ms antes de migrar
  editor + HTTP/SSE a 128 ms después (+20 ms, +18.5%). No se atribuye esa
  variación a una causa única ni se revirtió ESM; queda como dato de rendimiento
  a repetir en el mismo entorno antes de añadir un bundler.
- Una migración experimental del renderer a ESM (`df02cd2`) se revirtió en
  `55274ce`: el harness PPTX esperaba `renderSlides`, que el módulo no exponía.
  No se conserva código muerto de ese intento.
- Vite queda como propuesta: antes de aplicarlo hay que probar rutas de Vercel,
  URLs de assets, módulos del iframe y `srcdoc`, sin cambiar apariencia ni
  contrato de hosting. La evidencia actual no justifica introducirlo.
- `app.js`, `outline.js`, `editor.js` y tools/minimap siguen siendo
  coordinadores grandes por estado léxico y ciclo de vida compartidos; sus
  helpers independientes ya están extraídos. Para las medidas exactas por
  commit, véase `docs/HANDOFF.md` y el inventario histórico en
  `docs/FRONTEND-INVENTORY.md`.

## Continuación Etapa 8

La rama `refactor/fase-8e-app` empezó desde el editor verificado de 8d. Se
aislaron las utilidades compartidas y tooltips, manteniendo sus fachadas
`window.*` y puntos de inicialización. El editor ya tenía estado explícito de
puntero, preparación de resize, normalización, drag/resize, destinos snap y
cleanup mouseup en módulos; esta continuación extrajo el cálculo puro de
coincidencia de guías. `editor/editor.js` sigue en 457 líneas: su listener de
movimiento aún coordina normalización, selección, drag, resize e historial con
estado compartido. No se redujo a 300 líneas; los bindings deben separarse en el
punto de registro original y con callbacks tardíos que eviten TDZ.

`scripts/app.js` sigue en 4,492 líneas. El corte del router no se aplicó: el
retorno a home sincroniza generación, transición pendiente, DOM, adjuntos y
draft de outline dentro de un mismo cierre, sin una API explícita probada que
preserve el orden y la identidad de esos recursos. Router, adjuntos, overlays,
navegación, zoom, exportación, preview, chat/renderizado, transiciones, SSE y
orquestación siguen pendientes; véase `docs/HANDOFF.md` para los cortes no
extraídos y los resultados de compuerta.

## Continuación Etapa 9 (parcial)

La rama 9a comenzó a agrupar estado del callback de `app.js` sin mover sus
funciones: `chatState` contiene timers/mensajes del botón de generación y
estado del placeholder/warmup; `navigationState` contiene cooldown y
coordenadas fallback de swipe; `zoomState` contiene límites/paso y el último
modo móvil fallback; `previewUiState` contiene los flags del lifecycle de
minimap/tools y skeleton. Los cambios se dejaron en los puntos originales de
inicialización para conservar orden y capturas de closures. Los bridges
`window.*` se conservaron.

Esto es una migración parcial de estado, no una modularización terminada:
`dom` aún no centraliza las referencias cacheadas y quedan otras familias del
inventario. Tampoco se alcanzaron los objetivos de tamaño de `app.js` o
`editor.js`. Las ramas 9b-app-bloques y 9c-editor quedaron creadas desde
`dc2c832`; no contienen extracciones en esta continuación. El registro por
commit y los límites verificables están en `docs/HANDOFF.md` y
`docs/FRONTEND-INVENTORY.md`.

### Receta de extracción sin adelantar estado

Primero se agrupa una familia de bindings mutables conservando cada valor
inicial y su punto de inicialización. Después, y en un commit distinto, se
extrae un bloque como `createX(ctx)`, pasando stores, `dom` y callbacks tardíos
explícitos. La factory debe instanciarse donde antes se registraban listeners;
no debe resolver selectores anticipadamente ni cambiar el orden de eventos.
Cada módulo debe tener una sola responsabilidad, JSDoc de su contexto/API,
README en su carpeta, menos de 300 líneas y pruebas de equivalencia antes de
pasar `npm run verify:all`.

Las recetas anteriores para renderizador, store, herramienta del editor e
idioma siguen vigentes. En particular, un renderizador nuevo debe tener casos
byte-identical; un store debe ser dueño único del estado y conservar el bridge;
una herramienta debe delegar selección/historial; un idioma debe completar las
claves de `i18n.js` y sus fallbacks. El orden exacto de cortes del coordinador
está en `docs/FRONTEND-INVENTORY.md`.
