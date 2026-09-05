# Aedos -- Generador de Presentaciones con IA

Aedos es una aplicacion web local/desplegable que transforma un tema o archivos de apoyo en una presentacion editable y descargable en PDF. El flujo actual usa la API directa de Gemini como proveedor principal, OpenRouter como fallback, y Puppeteer para la exportacion final.

Sitio en produccion: [https://aedoslab.xyz](https://aedoslab.xyz)

---

## Tabla de Contenidos

- [Resumen](#resumen)
- [Arquitectura](#arquitectura)
- [Stack](#stack)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Backend](#backend)
- [Frontend](#frontend)
- [Modos de Generacion](#modos-de-generacion)
- [Flujos Principales](#flujos-principales)
- [API](#api)
- [Seguridad y Limites](#seguridad-y-limites)
- [Despliegue](#despliegue)
- [Variables de Entorno](#variables-de-entorno)
- [Desarrollo Local](#desarrollo-local)

---

## Resumen

- Generacion asistida por IA con dos rutas: `flash` y `pro`.
- Flujo de outline previo mediante `POST /generate-skeleton`.
- Edicion completa en cliente: texto, imagenes, formas, iconos, fondo, orden, zoom, undo/redo.
- Soporte de adjuntos: `.pdf`, `.doc`, `.docx`, `.png`, `.jpg`, `.jpeg`, `.webp`.
- Exportacion a PDF 16:9 mediante Puppeteer y postproceso con `pdf-lib`.
- Frontend estatico en Vercel y backend Node.js/Express en Render.

---

## Arquitectura

```text
Usuario (browser)
       |
       v
Frontend estatico (Vercel o Express static)
       |
       +--> POST /generate-skeleton
       +--> POST /generate-outline-item
       +--> POST /generate
       +--> POST /finalize
       +--> GET  /download/:filename
       |
       v
Backend Node.js + Express
       |
       +--> Gemini API (primario)
       +--> OpenRouter (fallback por modelo/etapa)
       +--> Upstash Redis (rate limiting, con fallback en memoria)
       +--> Puppeteer / Chrome Headless (HTML -> PDF)
```

Aspectos importantes:

- El backend sirve tambien el frontend con `express.static` cuando corre standalone.
- En produccion se redirige la URL cruda de Render hacia `aedoslab.xyz`, excepto rutas de API.
- La generacion HTML se transmite al cliente por SSE.
- El HTML final se sanitiza en servidor antes de visualizarse o exportarse.

---

## Stack

| Capa | Tecnologia |
|------|------------|
| Frontend | HTML5, CSS3, JavaScript vanilla |
| Backend | Node.js, Express |
| IA primaria | Google Gemini API (`@google/genai`) |
| IA fallback | OpenRouter |
| PDF | Puppeteer + `pdf-lib` |
| Archivos Word | `mammoth` |
| Rate limiting | Upstash Redis |
| UI/Animaciones | Lucide, GSAP, Motion |
| Hosting | Vercel + Render |

---

## Estructura del Proyecto

```text
Aedos/
+-- docs/
|   +-- README.es.md
|   +-- README.en.md
+-- scripts/
|   +-- install-chrome.sh
+-- src/
|   +-- backend/
|   |   +-- server.js
|   |   +-- prompts/
|   |   |   +-- base.js
|   |   |   +-- pipeline.js
|   |   |   +-- skeleton_prompts.js
|   |   |   +-- stage1-content.js
|   |   |   +-- stage2-design.js
|   |   |   +-- stage3-compositor.js
|   |   +-- utils/
|   |       +-- logger.js
|   |       +-- rate-limiter.js
|   +-- frontend/
|       +-- index.html
|       +-- assets/images/
|       +-- editor/
|       +-- features/
|       |   +-- minimap/
|       |   +-- shared/
|       |   +-- skeleton/
|       |   +-- tools/
|       +-- mobile/
|       +-- scripts/
|       +-- styles/
|       +-- vercel.json
+-- package.json
```

---

## Backend

### Servidor principal

`src/backend/server.js` concentra:

- Configuracion de `dotenv`, Express, CORS y cabeceras de seguridad.
- Rate limiting por modo para `/generate` y por ventana para `/finalize`.
- Colas separadas para generacion de IA y para renders PDF.
- Resolucion de proveedor: Gemini directo primero, OpenRouter despues.
- Manejo de adjuntos con `multer` y extraccion de texto de Word con `mammoth`.
- Streaming SSE de resultados y estados de pipeline.
- Sanitizacion y normalizacion del HTML generado.
- Inicializacion/autorreparacion de Chrome para Puppeteer.

### Sistema de modelos

El enrutamiento actual funciona asi:

- `Gemini` es el proveedor primario si existe `GEMINI_API_KEY`.
- `OpenRouter` es fallback automatico si Gemini falla o no esta configurado.
- Flash, Stage 1, Stage 2 y Stage 3 pueden usar listas/modelos distintos.
- Algunas variantes pueden declararse como exclusivas de Stage 3 con `OPENROUTER_MODELS_STAGE3_ONLY`.

### Rutas de generacion

#### Modo Flash

- Usa `src/backend/prompts/base.js`.
- Genera el HTML completo en una sola llamada.
- Soporta hasta `15` diapositivas.
- Es la ruta mas rapida y menos costosa.

#### Modo Pro

- Usa `src/backend/prompts/pipeline.js`.
- Divide el proceso en 3 etapas:
  1. `stage1-content.js`: outline, narrativa, idioma y estructura.
  2. `stage2-design.js`: direccion visual, paleta y tipografia.
  3. `stage3-compositor.js`: HTML/CSS final.
- Soporta hasta `8` diapositivas.
- La etapa 3 se transmite por SSE.

### Outline asistido

Ademas de generar la presentacion final, el backend expone dos rutas intermedias:

- `POST /generate-skeleton`: crea o revisa el outline completo.
- `POST /generate-outline-item`: genera una diapositiva o un punto adicional para el outline.

Esto permite al frontend mostrar una etapa editable antes de lanzar la composicion final.

### Adjuntos

Tipos permitidos:

- PDF
- DOC/DOCX
- PNG/JPG/JPEG/WEBP

Reglas actuales:

- Hasta `3` archivos por solicitud.
- Hasta `10 MB` por archivo.
- Los `DOC/DOCX` se convierten a texto.
- Los PDF e imagenes se envian al proveedor como `data:` URLs o `inlineData`, segun proveedor.
- En la UI, si hay adjuntos, se fuerza el flujo `pro`.

### Colas y presion del sistema

Valores por defecto:

| Variable | Valor por defecto |
|----------|-------------------|
| `MAX_CONCURRENT_GENERATIONS` | `10` |
| `MAX_QUEUE_DEPTH` | `40` |
| `PRO_PAUSE_ACTIVE_GENERATIONS` | `MAX_CONCURRENT_GENERATIONS - 2` |
| `PRO_PAUSE_QUEUE_DEPTH` | `60%` de `MAX_QUEUE_DEPTH` con minimo `8` |
| `PUPPETEER_MAX_CONCURRENT` | `3` |
| `PUPPETEER_MAX_QUEUE` | `10` |
| `PRESSURE_RETRY_AFTER_SEC` | `30` |

Comportamientos clave:

- Si la cola general se llena, `/generate` devuelve `429 QUEUE_FULL`.
- Si hay demasiada presion, `pro` puede pausarse temporalmente con `503 PRO_TEMPORARILY_PAUSED`.
- Si la cola de PDF se llena, `/finalize` responde `429 QUEUE_FULL`.

### Sanitizacion y postproceso HTML

Antes de devolver o exportar la presentacion, el servidor:

- elimina `<script>` y handlers inline;
- elimina `javascript:` en atributos peligrosos;
- limpia `link`/`@import` duplicados de Google Fonts;
- inyecta las fuentes soportadas y Lucide;
- recorta diapositivas extra por encima del limite del modo;
- corrige casos comunes de HTML/CSS incompleto;
- elimina `overflow: auto/scroll` problematico para PDF;
- guarda artefactos de depuracion en desarrollo.

### Logger

`src/backend/utils/logger.js` define niveles y categorias semanticas como:

- `BOOT`, `CONFIG`, `HTTP`, `SECURITY`, `VALIDATION`
- `QUEUE`, `PROVIDER`, `QUOTA`, `PIPELINE`, `STREAM`
- `SANITIZER`, `PUPPETEER`, `FILESYSTEM`, `NETWORK`, `DOWNLOAD`

---

## Frontend

### Pantallas principales

El frontend (`src/frontend/`) es una SPA con cuatro zonas funcionales:

1. Chat inicial.
2. Editor de outline.
3. Vista previa/editor de diapositivas.
4. Pantalla final de descarga.

### Chat y captura de input

La pantalla inicial incluye:

- textarea con limite de `600` caracteres;
- selector de modo `flash` / `pro`;
- selector de idioma de salida;
- chips de sugerencias;
- carga de archivos por boton o drag-and-drop;
- modal de errores y modal de rechazo.

### Outline editor

El flujo actual no salta directo a la generacion final. Primero construye un outline editable con:

- secciones generadas por IA;
- chips de seguimiento sugeridos;
- insercion manual o asistida de secciones/puntos;
- bloqueo del selector de idioma durante la generacion;
- boton para convertir el outline en presentacion final.

### Editor de diapositivas

El editor permite:

- editar texto directamente;
- agregar/eliminar/duplicar diapositivas;
- insertar texto, imagenes, formas e iconos;
- cambiar fondo, capas, opacidad, bordes y tipografia;
- usar `undo/redo`;
- navegar con minimap;
- abrir modo presentacion;
- exportar a PDF.

### Minimap y panel de herramientas

- `features/minimap/` controla miniaturas, navegacion y reorder.
- `features/tools/` actua como inspector contextual.
- `editor/` gestiona la seleccion, transformaciones y edicion sobre el iframe.

### Soporte movil

`src/frontend/mobile/` agrega:

- barra inferior de navegacion;
- puente de eventos tactiles;
- ajustes responsivos;
- polyfill de drag and drop para touch.

### Idiomas

La interfaz solo esta localizada en:

- `en` por defecto;
- `es` cuando `navigator.language` empieza por `es`.

La generacion de contenido admite mas codigos ISO. En el frontend hay un selector amplio, pero a nivel de API hay dos caminos:

- `language`: parametro actual usado por la UI, pensado para codigos ISO arbitrarios.
- `idioma`: parametro legacy con validacion estricta en `/generate` para `es`, `en`, `fr`, `pt`, `de`.

---

## Modos de Generacion

| Caracteristica | Flash | Pro |
|----------------|-------|-----|
| Flujo | Prompt unico | Pipeline de 3 etapas |
| Velocidad | Alta | Menor |
| Limite de diapositivas | 15 | 8 |
| Calidad visual | Buena | Mas consistente y dirigida |
| Uso recomendado | borradores rapidos | entregables finales y prompts complejos |
| Adjuntos | no ideal | flujo recomendado/forzado por UI |

---

## Flujos Principales

### Outline + generacion

```text
1. Usuario escribe tema y opcionalmente adjunta archivos
2. Frontend envia /generate-skeleton
3. Backend valida input y genera outline JSON
4. Usuario revisa/edita el outline
5. Frontend envia /generate
6. Backend ejecuta Flash o Pipeline Pro
7. El HTML llega por SSE
8. Frontend renderiza en iframe y habilita edicion manual
```

### Exportacion a PDF

```text
1. Usuario pulsa "Download PDF"
2. Frontend envia /finalize con html y title
3. Backend abre una pagina de Puppeteer
4. Espera red/fuentes/iconos y normaliza layout
5. Genera el PDF 29.7cm x 16.7cm
6. Inyecta metadata con pdf-lib
7. Responde con /download/:filename
8. El PDF se borra automaticamente tras 10 minutos
```

---

## API

### `GET /health`

Healthcheck simple. Responde `200 OK`.

### `POST /generate-skeleton`

Genera o revisa el outline de la presentacion.

Formatos soportados:

- `multipart/form-data` si hay archivos.
- JSON simple si no hay archivos.

Campos relevantes:

| Campo | Tipo | Requerido | Descripcion |
|-------|------|-----------|-------------|
| `tema` | string | Si | Tema a procesar |
| `language` | string | No | Codigo objetivo o `auto` |
| `idioma` | string | No | Alias legacy |
| `mode` | string | No | `flash` o `pro` |
| `currentSkeleton` | object/string | No | Outline previo para revision |
| `files` | file[] | No | Hasta 3 archivos |

Respuesta:

- SSE con `chunk`
- evento final `{ done: true, skeleton: ... }`
- o `{ error: ... }`

### `POST /generate-outline-item`

Genera un item puntual para el outline.

Body JSON:

| Campo | Tipo | Requerido | Descripcion |
|-------|------|-----------|-------------|
| `type` | string | Si | `slide` o `point` |
| `topic` | string | Si | Tema principal |
| `existingSlides` | array | No | Contexto para agregar slide |
| `slideTitle` | string | No | Titulo de slide actual |
| `slideSubtitle` | string | No | Subtitulo actual |
| `existingPoints` | array | No | Puntos ya existentes |

Respuesta: `{ item: ... }`

### `POST /generate`

Genera la presentacion HTML final.

Formatos soportados:

- `application/json`
- `multipart/form-data`

Campos principales:

| Campo | Tipo | Requerido | Descripcion |
|-------|------|-----------|-------------|
| `tema` | string | Si | Maximo `600` caracteres |
| `mode` | string | No | `flash` por defecto, o `pro` |
| `slides` | number | No | `1-15`; el backend recorta a `8` en `pro` |
| `language` | string | No | Codigo objetivo usado por la UI actual |
| `idioma` | string | No | Ruta legacy validada contra `es`, `en`, `fr`, `pt`, `de` |
| `skeleton` | object/string | No | Outline aprobado por el usuario |
| `files` | file[] | No | Hasta `3` archivos |

Respuesta:

- SSE con `chunk`
- metadatos `{ metadata: { provider, model } }`
- estados de pipeline
- evento final `{ done: true, html: ... }`

Errores frecuentes:

- `429 QUEUE_FULL`
- `503 PRO_TEMPORARILY_PAUSED`
- `400 SKELETON_EMPTY`
- errores de validacion (`slides`, `idioma`, tema)

### `POST /finalize`

Convierte HTML a PDF.

Body JSON:

| Campo | Tipo | Requerido | Descripcion |
|-------|------|-----------|-------------|
| `html` | string | Si | HTML completo |
| `title` | string | No | Nombre amigable del PDF |

Respuesta: `{ pdfUrl: "/download/..." }`

### `GET /download/:filename`

Descarga un PDF temporal generado por `/finalize`.

Notas:

- valida path traversal;
- acepta query `name` para el nombre descargado;
- no elimina el archivo al primer download; un timer lo limpia despues.

### `GET /__dev__/last-generated`

Disponible solo fuera de produccion. Devuelve `tmp/last_generated.html`.

---

## Seguridad y Limites

### Validacion de entrada

- maximo `600` caracteres en el tema;
- bloqueo de HTML/script/XSS obvio;
- deteccion basica de prompt injection;
- limites de `slides` e idioma;
- validacion de extensiones de archivo permitidas.

### Cabeceras y CSP

El servidor aplica:

- `Strict-Transport-Security`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- `Content-Security-Policy`

### Rate limiting por defecto

| Regla | Valor |
|------|-------|
| Flash diario por IP | 4 |
| Pro diario por IP | 2 |
| Cooldown Flash | 20s |
| Cooldown Pro | 60s |
| Limite global diario | 100 |
| Finalizaciones por 15 min | 10 |

### Protecciones adicionales

- `X-Powered-By` deshabilitado;
- `X-Request-Id` por request;
- auditoria de IPs/proxy;
- sanitizacion de salida antes de renderizar;
- autoeliminacion de PDFs temporales.

---

## Despliegue

### Frontend

- alojado en Vercel como sitio estatico;
- `vercel.json` reescribe rutas de API al backend;
- tambien puede servirse desde Express en entornos simples.

### Backend

- desplegado en Render como servicio Node.js;
- recompone el binario de Chrome desde cache ZIP si Render pierde el ejecutable;
- establece `requestTimeout` de 10 minutos para generaciones largas.

---

## Variables de Entorno

### Requeridas

Al menos una de estas debe existir:

| Variable | Uso |
|----------|-----|
| `GEMINI_API_KEY` | Proveedor primario |
| `OPENROUTER_API_KEY` | Fallback |

### Generales

| Variable | Descripcion |
|----------|-------------|
| `NODE_ENV` | `development` o `production` |
| `PORT` | Puerto HTTP |
| `APP_URL` | Referer enviado a OpenRouter |
| `ALLOWED_ORIGINS` | Lista CSV de origenes CORS en produccion |

### Modelos

| Variable | Descripcion |
|----------|-------------|
| `GEMINI_MODELS_FLASH` | Modelo Gemini para Flash |
| `GEMINI_MODELS_STAGE1` | Modelo Gemini para Stage 1 |
| `GEMINI_MODELS_STAGE2` | Modelo Gemini para Stage 2 |
| `GEMINI_MODELS_STAGE3` | Modelo Gemini para Stage 3 |
| `OPENROUTER_MODELS_FLASH` | CSV de fallback para Flash |
| `OPENROUTER_MODELS_STAGE1` | CSV de fallback para Stage 1 |
| `OPENROUTER_MODELS_STAGE2` | CSV de fallback para Stage 2 |
| `OPENROUTER_MODELS_STAGE3` | CSV de fallback para Stage 3 |
| `OPENROUTER_MODELS_STAGE3_ONLY` | Modelos restringidos a composicion final |

### Colas y limites

| Variable | Descripcion |
|----------|-------------|
| `MAX_CONCURRENT_GENERATIONS` | Generaciones simultaneas |
| `MAX_QUEUE_DEPTH` | Cola maxima de generacion |
| `PRO_PAUSE_ACTIVE_GENERATIONS` | Umbral de pausa para Pro |
| `PRO_PAUSE_QUEUE_DEPTH` | Umbral de cola para pausa Pro |
| `PRESSURE_RETRY_AFTER_SEC` | Hint de reintento al cliente |
| `PUPPETEER_MAX_CONCURRENT` | Renders PDF simultaneos |
| `PUPPETEER_MAX_QUEUE` | Cola maxima de PDF |
| `LIMITS_FLASH_DAILY` | Cupo diario Flash |
| `LIMITS_PRO_DAILY` | Cupo diario Pro |
| `LIMITS_FLASH_COOLDOWN_SEC` | Cooldown Flash |
| `LIMITS_PRO_COOLDOWN_SEC` | Cooldown Pro |
| `GLOBAL_DAILY_GENERATION_LIMIT` | Limite global diario |
| `LIMITS_FINALIZE_MAX` | Finalizaciones por ventana |

### Integraciones y binarios

| Variable | Descripcion |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | URL de Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Token de Redis |
| `PUPPETEER_EXECUTABLE_PATH` | Ruta manual al binario de Chrome |

---

## Desarrollo Local

### Requisitos

- Node.js `>= 20`
- Dependencias de `npm`
- Una API key de Gemini o OpenRouter

### Instalacion

```bash
git clone https://github.com/Aedos-Team/Aedos.git
cd Aedos
npm install
```

### `.env` minimo

```env
NODE_ENV=development
PORT=3000
GEMINI_API_KEY=tu_clave
```

Tambien puedes usar:

```env
OPENROUTER_API_KEY=tu_clave
```

### Ejecucion

```bash
npm run dev
```

o

```bash
npm start
```

La app queda disponible en `http://localhost:3000`.

### Scripts de NPM

| Comando | Descripcion |
|---------|-------------|
| `npm run dev` | Ejecuta `node --watch src/backend/server.js` |
| `npm start` | Ejecuta el servidor sin watch |
| `npm run build` | Ejecuta `scripts/install-chrome.sh` |
| `postinstall` | Intenta instalar Chrome automaticamente |

### Depuracion en desarrollo

Cuando `NODE_ENV=development`:

- se guarda `tmp/last_generated.html`;
- se guardan `tmp/pipeline_debug_*`;
- se guardan ejemplos en `examples/flash/` y `examples/pro/`;
- existe `GET /__dev__/last-generated`.
