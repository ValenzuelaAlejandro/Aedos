# Aedos -- Generador de Presentaciones con IA

Aedos es una aplicacion web que permite a los usuarios generar presentaciones academicas y profesionales en formato PDF de manera automatica, utilizando modelos de lenguaje (LLM) a traves de la API de OpenRouter. El usuario escribe un tema en lenguaje natural, la IA genera diapositivas completas en HTML/CSS, y el sistema las convierte a PDF mediante un navegador headless (Puppeteer).

Sitio en produccion: [https://aedoslab.xyz](https://aedoslab.xyz)

---

## Tabla de Contenidos

- [Arquitectura General](#arquitectura-general)
- [Stack Tecnologico](#stack-tecnologico)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Backend](#backend)
  - [Servidor Principal](#servidor-principal)
  - [Sistema de Generacion (Prompts)](#sistema-de-generacion-prompts)
  - [Rate Limiting](#rate-limiting)
  - [Logger](#logger)
- [Frontend](#frontend)
  - [Interfaz Principal](#interfaz-principal)
  - [Editor de Diapositivas](#editor-de-diapositivas)
  - [Minimap](#minimap)
  - [Panel de Herramientas](#panel-de-herramientas)
  - [Soporte Movil](#soporte-movil)
  - [Internacionalizacion (i18n)](#internacionalizacion-i18n)
- [Modos de Generacion](#modos-de-generacion)
- [Flujo de Datos](#flujo-de-datos)
- [Endpoints de la API](#endpoints-de-la-api)
- [Seguridad](#seguridad)
- [Infraestructura de Despliegue](#infraestructura-de-despliegue)
- [Variables de Entorno](#variables-de-entorno)
- [Desarrollo Local](#desarrollo-local)

---

## Arquitectura General

```
Usuario (navegador)
       |
       v
  Vercel (Frontend estatico)
       |
       | rewrites: /generate, /finalize, /download, /health
       v
  Render (Backend Node.js + Express)
       |
       +---> OpenRouter API (LLMs: Gemini, Kimi, etc.)
       +---> Upstash Redis (rate limiting persistente)
       +---> Puppeteer / Chrome Headless (conversion HTML -> PDF)
```

Aedos utiliza una arquitectura de frontend-backend desacoplada. El frontend se sirve como contenido estatico en Vercel, que redirige las rutas de API hacia el backend desplegado en Render. El backend coordina la generacion de contenido con modelos de IA, aplica sanitizacion de seguridad al HTML generado, y convierte el resultado final a PDF usando Puppeteer.

---

## Stack Tecnologico

| Capa           | Tecnologia                                                      |
|----------------|------------------------------------------------------------------|
| Frontend       | HTML5, CSS3 (vanilla), JavaScript (vanilla)                      |
| Backend        | Node.js, Express.js                                              |
| IA / LLM       | OpenRouter API (Gemini 2.5 Flash Lite, Kimi K2.6, y otros)      |
| PDF            | Puppeteer (Chrome headless)                                      |
| Rate Limiting  | Upstash Redis (con fallback en memoria)                          |
| Hosting FE     | Vercel                                                           |
| Hosting BE     | Render                                                           |
| Iconos         | Lucide Icons (via CDN)                                           |
| Animaciones    | GSAP, Motion (vanilla)                                           |
| Fuentes        | Google Fonts (23 familias precargadas)                           |

---

## Estructura del Proyecto

```
Aedos/
+-- .env                         # Variables de entorno (no se sube a Git)
+-- .gitignore                   # Archivos excluidos del repositorio
+-- package.json                 # Dependencias y scripts de NPM
+-- src/
|   +-- backend/
|   |   +-- server.js            # Servidor Express principal (~1800 lineas)
|   |   +-- prompts/
|   |   |   +-- base.js          # Prompt monolitico para modo Flash
|   |   |   +-- pipeline.js      # Orquestador del pipeline de 3 etapas (Pro)
|   |   |   +-- stage1-content.js    # Etapa 1: Extraccion de contenido
|   |   |   +-- stage2-design.js     # Etapa 2: Direccion creativa/visual
|   |   |   +-- stage3-compositor.js # Etapa 3: Generacion de HTML final
|   |   +-- utils/
|   |       +-- logger.js        # Sistema de logging estructurado con colores
|   |       +-- rate-limiter.js  # Rate limiting con Redis/memoria
|   +-- frontend/
|       +-- index.html           # Pagina principal (SPA)
|       +-- vercel.json          # Configuracion de despliegue en Vercel
|       +-- scripts/
|       |   +-- app.js           # Logica principal del frontend (~155KB)
|       +-- styles/
|       |   +-- style.css        # Estilos globales (~74KB)
|       +-- editor/
|       |   +-- editor.js        # Motor del editor de diapositivas
|       |   +-- editor-ui.js     # Interfaz del editor
|       |   +-- editor.css       # Estilos del editor
|       +-- features/
|       |   +-- minimap/
|       |   |   +-- minimap.js   # Panel de miniaturas de diapositivas
|       |   |   +-- minimap.css  # Estilos del minimap
|       |   +-- tools/
|       |   |   +-- tools.js     # Panel de propiedades / inspector
|       |   |   +-- tools.css    # Estilos del panel de herramientas
|       |   +-- shared/
|       |   |   +-- i18n.js      # Sistema de internacionalizacion (ES/EN)
|       |   |   +-- logger.js    # Logger del frontend
|       |   |   +-- init.js      # Inicializacion compartida
|       |   |   +-- base.css     # Estilos base compartidos
|       |   |   +-- lucide-init.js  # Inicializacion de iconos Lucide
|       |   +-- skeleton/
|       |       +-- skeleton-injector.js  # Esqueletos de carga
|       +-- mobile/
|       |   +-- css/
|       |   |   +-- index.css            # Estilos moviles principales
|       |   |   +-- style-mobile-overrides.css  # Sobrecargas moviles
|       |   +-- html/
|       |   |   +-- bottom-nav.html      # Navegacion inferior movil
|       |   |   +-- mode-select.html     # Selector de modo movil
|       |   |   +-- touch-capture-overlay.html
|       |   +-- js/
|       |       +-- app-mobile.js        # Logica movil
|       |       +-- bridge.js            # Puente desktop-movil
|       |       +-- config.js            # Configuracion movil
|       +-- assets/
|           +-- images/
|               +-- favicon.svg          # Favicon SVG
|               +-- og-image.png         # Imagen para Open Graph
+-- examples/                   # Ejemplos generados (solo desarrollo)
+-- tmp/                        # Archivos temporales (PDFs, debug)
```

---

## Backend

### Servidor Principal

El archivo `server.js` es el nucleo del backend. Gestiona:

- **Servidor Express**: Configuracion de CORS, cabeceras de seguridad, servir archivos estaticos, y manejo de peticiones HTTP.
- **Sistema de Colas**: Control de concurrencia para generaciones de IA con colas separadas para generacion (`/generate`) y finalizacion (`/finalize`). Los parametros son configurables:
  - `MAX_CONCURRENT_GENERATIONS`: Maximo de generaciones simultaneas (por defecto 10).
  - `MAX_QUEUE_DEPTH`: Profundidad maxima de la cola (por defecto 40).
  - `PUPPETEER_MAX_CONCURRENT`: Maximo de renderizados PDF simultaneos (por defecto 3).
- **Redirecciones**: En produccion, las peticiones que llegan a la URL cruda de Render (`*.onrender.com`) se redirigen al dominio canonico (`aedoslab.xyz`), excepto las rutas de API.
- **Sanitizacion de HTML**: Todo el HTML generado por la IA pasa por un proceso de sanitizacion que elimina scripts, event handlers en linea, URLs de JavaScript, y etiquetas de Google Fonts duplicadas. Ademas, se inyectan recursos verificados (Google Fonts y Lucide Icons).
- **Gestion de Puppeteer**: Inicializacion de un navegador Chrome headless con auto-reparacion del binario en Render (extraccion desde ZIP cuando el cache pierde el binario).

### Sistema de Generacion (Prompts)

El sistema de prompts tiene dos rutas de generacion:

#### Modo Flash (Prompt Unico)

Definido en `prompts/base.js`. Un solo prompt masivo (~400 lineas) que incluye:
- Instrucciones de seguridad y rol del sistema
- Configuracion JSON embebida en un comentario HTML (`<!-- CONFIG ... -->`)
- Definiciones CSS completas con variables, clases reutilizables y patrones de layout
- 12 patrones de layout predefinidos (Cover, Cards-2, Cards-3, Split, Stats, Steps, Quote, Timeline, Conclusion, Text, Editorial, Comparison)
- Catalogo de iconos permitidos de Lucide
- Reglas de validacion final

El modelo recibe un unico prompt y genera tanto la configuracion como el HTML completo de una sola vez.

#### Modo Pro (Pipeline de 3 Etapas)

Orquestado por `prompts/pipeline.js`:

1. **Etapa 1 -- Extraccion de Contenido** (`stage1-content.js`):
   - Analiza el input del usuario y extrae contenido estructurado.
   - Produce un JSON con: tema, audiencia, tono, densidad de texto, estructura narrativa, y el arreglo de diapositivas.
   - Incluye un campo `visual_world` con `real_world_analog` que describe un artefacto fisico concreto que evoca el tema (e.g., "poster de tour de heavy metal en papel negro satinado").
   - Detecta el idioma del input y genera todo el contenido en ese idioma.
   - Maximo 8 diapositivas por pipeline.

2. **Etapa 2 -- Direccion Creativa** (`stage2-design.js`):
   - Recibe el JSON de la Etapa 1 y genera decisiones de diseno visual.
   - Produce: paleta de colores, par tipografico, mood global, y directivas de layout por diapositiva.
   - El `real_world_analog` de la Etapa 1 guia todas las decisiones visuales.

3. **Etapa 3 -- Compositor HTML** (`stage3-compositor.js`):
   - Recibe el contenido de la Etapa 1 y el diseno de la Etapa 2.
   - Genera el documento HTML/CSS final completo listo para renderizar.
   - Esta etapa se transmite en streaming (SSE) al cliente.

Cada etapa puede utilizar modelos de IA distintos, configurados via variables de entorno (`OPENROUTER_MODELS_STAGE1`, `OPENROUTER_MODELS_STAGE2`, `OPENROUTER_MODELS_STAGE3`).

### Rate Limiting

Implementado en `utils/rate-limiter.js`. Utiliza Upstash Redis como almacen persistente con un fallback en memoria para cuando Redis no esta disponible.

**Limites por modo:**

| Parametro                    | Flash     | Pro       |
|------------------------------|-----------|-----------|
| Generaciones diarias por IP  | 4         | 2         |
| Cooldown entre generaciones  | 20s       | 60s       |
| Limite diario global         | 100       | 100       |

**Limites de finalizacion (PDF):**

| Parametro                    | Valor     |
|------------------------------|-----------|
| Maximo por ventana de 15 min | 10        |

El sistema tambien incluye un mecanismo de auditoria de IP que detecta si todas las peticiones en produccion provienen de una sola direccion IP (indicando un problema de configuracion de proxy).

### Logger

`utils/logger.js` implementa un logger estructurado con:

- Niveles: `debug`, `info`, `success`, `http`, `warn`, `error`, `fatal`
- Colores ANSI para terminal
- Categorias de error semanticas: `BOOT`, `CONFIG`, `HTTP`, `SECURITY`, `VALIDATION`, `QUEUE`, `PROVIDER`, `QUOTA`, `MODEL`, `PIPELINE`, `STREAM`, `SANITIZER`, `PUPPETEER`, `FILESYSTEM`, `NETWORK`, `DOWNLOAD`
- Serializacion de metadatos con clipping de strings largos
- Soporte para loggers hijos con scopes jerarquicos

---

## Frontend

### Interfaz Principal

El frontend es una Single Page Application (SPA) construida con HTML, CSS y JavaScript vanilla. La interfaz tiene tres secciones principales:

1. **Pantalla de Chat** (`#chat-screen`): Pantalla inicial donde el usuario escribe el tema de su presentacion. Incluye:
   - Campo de texto con contador de caracteres (maximo 600)
   - Toggle de modo Flash/Pro
   - Boton de generacion

2. **Vista Previa / Editor** (`#preview-container`): Espacio de trabajo completo para editar la presentacion generada. Incluye:
   - Encabezado con controles de navegacion, zoom, undo/redo, modo presentacion, y descarga PDF
   - Panel de miniaturas (minimap) a la izquierda
   - Visor de diapositivas en el centro (iframe)
   - Panel de herramientas/propiedades a la derecha
   - Barra flotante de herramientas para agregar elementos

3. **Resultado** (`#result-container`): Pantalla de confirmacion tras la generacion del PDF.

### Editor de Diapositivas

El editor (`editor/editor.js`, ~95KB) permite:

- Edicion directa de texto dentro de las diapositivas
- Agregar, eliminar y duplicar diapositivas
- Agregar elementos: texto, imagenes, formas geometricas, iconos
- Deshacer/rehacer cambios (undo/redo)
- Zoom y ajuste de vista
- Modo presentacion a pantalla completa
- Arrastrar y soltar elementos
- Edicion de propiedades de fondo (color, gradientes)

### Minimap

El minimap (`features/minimap/`) muestra miniaturas de todas las diapositivas en un panel lateral. Permite:

- Navegacion rapida entre diapositivas haciendo clic
- Reordenamiento por arrastre (drag and drop)
- Duplicacion y eliminacion de diapositivas via menu contextual
- Indicadores de posicion (dots) en el encabezado

### Panel de Herramientas

El panel de herramientas (`features/tools/`, ~51KB de JS) es un inspector de propiedades contextual que cambia segun el elemento seleccionado:

- **Texto**: Tamano de fuente, alineacion, color, seleccion de fuente (23 familias disponibles)
- **Imagen**: Reemplazo de imagen, radio de borde, opacidad
- **Icono**: Color del icono, catalogo de iconos por categorias (Esenciales, Comunicacion, Negocios, Multimedia, Tecnologia, Social, Navegacion, Naturaleza, Objetos)
- **Forma**: Color de relleno, color de borde (Cuadrado, Circulo, Diamante, Triangulo, Hexagono, Capsula)
- **Avanzado**: Traer al frente, enviar al fondo, duplicar, eliminar

### Soporte Movil

El sistema movil (`mobile/`) adapta la interfaz para dispositivos tactiles:

- Navegacion inferior con botones de diapositiva anterior/siguiente
- Sobrecargas CSS para layouts responsivos
- Puente (`bridge.js`, ~21KB) que traduce eventos tactiles a interacciones del editor
- Polyfill de HTML5 Drag and Drop para pantallas tactiles

### Internacionalizacion (i18n)

El sistema de i18n (`features/shared/i18n.js`) soporta dos idiomas:

- **Ingles (en)**: Idioma por defecto para navegadores no hispanos
- **Espanol (es)**: Detectado automaticamente si el navegador usa `es-*`

La deteccion es automatica basada en `navigator.language`. Las traducciones se aplican al DOM usando atributos `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`, y `data-i18n-val`.

---

## Modos de Generacion

| Caracteristica          | Flash                        | Pro                              |
|-------------------------|------------------------------|----------------------------------|
| Tiempo aproximado       | ~20 segundos                 | ~2 minutos                       |
| Proceso                 | Un solo prompt monolitico    | Pipeline de 3 etapas             |
| Diapositivas maximas    | 15                           | 8                                |
| Modelos por defecto     | Gemini 2.5 Flash Lite        | Etapas 1 y 2: Gemini 2.5 Flash Lite, Etapa 3: Kimi K2.6 |
| Calidad de diseno       | Buena                        | Alta (diseno derivado de artefacto fisico) |
| Generaciones diarias    | 4 por IP                     | 2 por IP                        |

---

## Flujo de Datos

### Generacion de Presentacion

```
1. Usuario escribe tema en el frontend
2. Frontend envia POST /generate con { tema, mode, slides, idioma }
3. Backend valida y sanitiza el input
4. Rate limiter verifica limites por IP y modo
5. Peticion entra en la cola de concurrencia
6. (Flash) Se construye un prompt unico y se envia a OpenRouter
   (Pro) Se ejecuta el pipeline de 3 etapas secuencialmente
7. La respuesta de la IA se transmite en SSE (Server-Sent Events)
8. Backend sanitiza el HTML en cada chunk y al final
9. Frontend recibe los chunks y renderiza en el iframe
10. Usuario puede editar la presentacion en el editor
```

### Descarga de PDF

```
1. Usuario hace clic en "Descargar PDF"
2. Frontend envia POST /finalize con { html, title }
3. Backend sanitiza el HTML y abre una pagina en Puppeteer
4. Puppeteer renderiza el HTML con fuentes, iconos y estilos de impresion
5. Se genera el PDF con dimensiones 29.7cm x 16.7cm (16:9)
6. Backend responde con la URL de descarga
7. Frontend redirige al usuario a GET /download/:filename
8. El archivo PDF se auto-elimina despues de 10 minutos
```

---

## Endpoints de la API

### `GET /health`

Endpoint de verificacion de estado. Retorna `200 OK`.

### `POST /generate`

Genera una presentacion en HTML a partir de un tema.

**Body (JSON):**

| Campo    | Tipo   | Requerido | Descripcion                                  |
|----------|--------|-----------|----------------------------------------------|
| `tema`   | string | Si        | Tema de la presentacion (max 600 caracteres)  |
| `mode`   | string | No        | `"flash"` (defecto) o `"pro"`                 |
| `slides` | number | No        | Numero de diapositivas (1-15, defecto 5)      |
| `idioma` | string | No        | Idioma: `es`, `en`, `fr`, `pt`, `de`          |

**Respuesta:** Stream SSE con chunks de HTML y estados del pipeline.

### `POST /finalize`

Convierte HTML a PDF.

**Body (JSON):**

| Campo   | Tipo   | Requerido | Descripcion                       |
|---------|--------|-----------|-----------------------------------|
| `html`  | string | Si        | HTML completo de la presentacion  |
| `title` | string | No        | Titulo para el nombre del archivo |

**Respuesta:** `{ pdfUrl: "/download/..." }`

### `GET /download/:filename`

Descarga un PDF generado. El parametro `name` en query string define el nombre del archivo descargado.

### `GET /__dev__/last-generated` (Solo desarrollo)

Retorna el ultimo HTML generado para depuracion.

---

## Seguridad

### Sanitizacion de Input

- Deteccion de inyeccion HTML/XSS: etiquetas HTML, `javascript:`, event handlers inline, `eval()`, `document.cookie`, `window.location`, `fetch()`, `innerHTML`
- Deteccion de prompt injection: "ignore previous", "system prompt", "act as", "reveal your", etc.
- Limite de 600 caracteres por tema

### Sanitizacion de Output

- Eliminacion de bloques `<script>` del HTML generado
- Eliminacion de event handlers en linea (`onclick`, `onload`, etc.)
- Eliminacion de URLs `javascript:` en atributos `href`, `src`, `action`
- Eliminacion de etiquetas `<link>` de Google Fonts duplicadas
- Eliminacion de metatags CSP del HTML generado (se configuran a nivel de servidor)
- Inyeccion controlada de solo recursos verificados

### Cabeceras de Seguridad

El servidor aplica las siguientes cabeceras en todas las respuestas:

- `Strict-Transport-Security` (HSTS)
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (deshabilita camara, microfono, geolocalizacion, pagos)
- `Content-Security-Policy` (restriccion de origenes para scripts, estilos, fuentes, imagenes, frames)

### CORS

- En produccion: solo origenes listados en `ALLOWED_ORIGINS`
- En desarrollo: `localhost:3000`, `localhost:5173`, `127.0.0.1:3000`
- Validacion estricta: requiere HTTPS, sin trailing slash, sin wildcards

### Proteccion Adicional

- Cabecera `X-Powered-By` deshabilitada
- IDs de peticion unicos (`X-Request-Id`) para trazabilidad
- Proteccion contra path traversal en descargas
- Auto-eliminacion de PDFs despues de 10 minutos
- Auditoria de diversidad de IPs en produccion

---

## Infraestructura de Despliegue

### Vercel (Frontend)

El frontend se despliega en Vercel como contenido estatico. La configuracion en `vercel.json` define:

- **Rewrites**: Las rutas `/generate`, `/finalize`, `/download`, `/health`, y `/__dev__` se redirigen al backend en Render (`https://aedos.onrender.com`).
- **Cabeceras de seguridad**: CSP, HSTS, X-Frame-Options, etc. se aplican a nivel de CDN.
- **URLs limpias**: Habilitadas con `cleanUrls: true`.

### Render (Backend)

El backend se despliega en Render como un servicio web Node.js.

Consideraciones especificas:

- **Puppeteer en Render**: Render puede perder el binario de Chrome del cache de disco entre deploys. El servidor detecta esto automaticamente y extrae el binario desde el ZIP cacheado sin necesidad de descarga.
- **Cold starts**: Render puede dormirse tras periodos de inactividad. El endpoint `/health` permite configurar un keep-alive externo.
- **Timeout de requests**: Configurado a 10 minutos para generaciones de IA largas.

---

## Variables de Entorno

| Variable                        | Requerida | Descripcion                                         |
|---------------------------------|-----------|-----------------------------------------------------|
| `OPENROUTER_API_KEY`            | Si        | Clave de API de OpenRouter                          |
| `NODE_ENV`                      | No        | `development` o `production` (defecto: development) |
| `PORT`                          | No        | Puerto del servidor (defecto: 3000)                 |
| `ALLOWED_ORIGINS`               | Prod      | Origenes CORS permitidos separados por coma         |
| `UPSTASH_REDIS_REST_URL`        | No        | URL de la instancia de Upstash Redis                |
| `UPSTASH_REDIS_REST_TOKEN`      | No        | Token de autenticacion de Upstash Redis             |
| `OPENROUTER_MODELS_FLASH`       | No        | Modelos para modo Flash (CSV)                       |
| `OPENROUTER_MODELS_STAGE1`      | No        | Modelos para Etapa 1 del pipeline (CSV)             |
| `OPENROUTER_MODELS_STAGE2`      | No        | Modelos para Etapa 2 del pipeline (CSV)             |
| `OPENROUTER_MODELS_STAGE3`      | No        | Modelos para Etapa 3 del pipeline (CSV)             |
| `OPENROUTER_MODELS_STAGE3_ONLY` | No        | Modelos restringidos exclusivamente a Etapa 3 (CSV) |
| `MAX_CONCURRENT_GENERATIONS`    | No        | Generaciones simultaneas maximas (defecto: 10)      |
| `MAX_QUEUE_DEPTH`               | No        | Profundidad maxima de cola (defecto: 40)            |
| `PUPPETEER_MAX_CONCURRENT`      | No        | Renderizados PDF simultaneos maximos (defecto: 3)   |
| `PUPPETEER_MAX_QUEUE`           | No        | Cola maxima de Puppeteer (defecto: 10)              |
| `LIMITS_FLASH_DAILY`            | No        | Limite diario Flash por IP (defecto: 4)             |
| `LIMITS_PRO_DAILY`              | No        | Limite diario Pro por IP (defecto: 2)               |
| `LIMITS_FLASH_COOLDOWN_SEC`     | No        | Cooldown Flash en segundos (defecto: 20)            |
| `LIMITS_PRO_COOLDOWN_SEC`       | No        | Cooldown Pro en segundos (defecto: 60)              |
| `PRO_PAUSE_ACTIVE_GENERATIONS`  | No        | Umbral de generaciones activas para pausar Pro (defecto: 8) |
| `PRO_PAUSE_QUEUE_DEPTH`         | No        | Umbral de profundidad de cola para pausar Pro (defecto: 24) |
| `GLOBAL_DAILY_GENERATION_LIMIT` | No        | Limite diario global de generaciones (defecto: 100) |
| `LIMITS_FINALIZE_MAX`           | No        | Maximo de finalizaciones en ventana (defecto: 10)   |
| `PUPPETEER_EXECUTABLE_PATH`     | No        | Ruta personalizada al binario de Chrome             |
| `APP_URL`                       | No        | URL de la aplicacion para cabecera HTTP-Referer     |

---

## Desarrollo Local

### Requisitos

- Node.js >= 20.0.0
- Chrome/Chromium (instalado automaticamente por Puppeteer)

### Instalacion

```bash
git clone https://github.com/Aedos-Team/Aedos.git
cd Aedos
npm install
```

### Configuracion

Crea un archivo `.env` en la raiz del proyecto:

```env
OPENROUTER_API_KEY=sk-or-...
NODE_ENV=development
PORT=3000
```

### Ejecucion

```bash
# Desarrollo (con hot-reload)
npm run dev

# Produccion
npm start
```

El servidor estara disponible en `http://localhost:3000`.

### Scripts de NPM

| Comando        | Descripcion                                              |
|----------------|----------------------------------------------------------|
| `npm run dev`  | Inicia el servidor con `--watch` para auto-recarga       |
| `npm start`    | Inicia el servidor en modo produccion                    |
| `npm run build`| Instala el binario de Puppeteer (para despliegue)        |

### Depuracion

En modo desarrollo (`NODE_ENV=development`):

- El ultimo HTML generado se guarda en `tmp/last_generated.html`
- Los artefactos del pipeline se guardan en `tmp/pipeline_debug_*`
- Los ejemplos generados se guardan en `examples/flash/` y `examples/pro/`
- El endpoint `/__dev__/last-generated` sirve el ultimo HTML generado
