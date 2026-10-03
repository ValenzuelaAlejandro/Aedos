# Smoke test comparativo: `main` vs. Fase 7

Objetivo: verificar manualmente que el uso visible siga igual después de la
modularización frontend/ESM. Las diferencias funcionales esperadas están al
final; no las registres como regresiones.

## Preparación y arranque

Usa dos ventanas de PowerShell. El worktree de `main` vive fuera del checkout
principal; no cambies de rama en el repo de Fase 7.

Ventana A — `main`, puerto 3000:

```powershell
cd C:\Users\Alan\Desktop\Aedos
git worktree add ..\Aedos-main main
cd ..\Aedos-main
npm ci
$env:NODE_ENV = "development"
$env:PORT = "3000"
npm start
```

Ventana B — checkout actual `refactor/fase-7-limpieza`, puerto 3001:

```powershell
cd C:\Users\Alan\Desktop\Aedos
npm ci
$env:NODE_ENV = "development"
$env:PORT = "3001"
npm start
```

Si `node_modules` ya está preparado para ese worktree, omite `npm ci`. La
instalación puede requerir acceso al registro; no forma parte de esta guía de
comparación. Abre `http://localhost:3000` y `http://localhost:3001` en ventanas
separadas, con el mismo viewport, tema, idioma, proveedor, modelo y entradas.
No copies `.env` entre worktrees ni publiques sus valores. Nombres de variables
que puede necesitar la sesión (sin valores):

- Núcleo/proveedor: `NODE_ENV`, `PORT`, `GEMINI_API_KEY`.
- Fallback opcional: `OPENROUTER_API_KEY`.
- Rate limit opcional: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- Origen/URL opcionales: `ALLOWED_ORIGINS`, `APP_URL`.
- Navegador opcional: `PUPPETEER_CACHE_DIR`, `PUPPETEER_EXECUTABLE_PATH`.

Detén ambos servidores con `Ctrl+C` en sus ventanas. Después de detenerlos,
desde `C:\Users\Alan\Desktop\Aedos` elimina el worktree de comparación con
`git worktree remove ..\Aedos-main`.

## Checklist

Para cada paso, marca en ambas columnas `Igual` o `Distinto`; guarda una captura
cuando haya una diferencia. Usa las mismas entradas y archivos en ambos sitios.
La salida generativa puede variar si el proveedor es estocástico: compara el
flujo visible, estructura, controles y posibilidad de completar la acción, no
la igualdad literal del texto generado.

| Paso | Criterio de comparación | `main` | Fase 7 |
| --- | --- | --- | --- |
| Generación Flash | Tema fijo; formulario, progreso, resultado y controles visibles | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Generación Pro | Mismo tema/modelo; mismas etapas, resultado y navegación | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Esquema | Número/orden de diapositivas y campos del outline recibido | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Editar outline | Añadir, borrar y reordenar una diapositiva; editar título y puntos | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Chips del outline | Sugerencias aparecen y se pueden usar | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Generación desde outline | Acción de continuar, progreso y transición a preview | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Adjunto PDF | Cargar el mismo PDF y verificar chip/contexto del archivo | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Adjunto DOCX | Cargar el mismo DOCX y verificar chip/contexto del archivo | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Preview iframe | Se muestra el deck correcto y responde a la navegación | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Selección | Seleccionar texto y forma dentro del editor | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Movimiento y tamaño | Mover y redimensionar un elemento; comparar toolbar y geometría | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Edición de texto | Editar texto y confirmar el cambio en preview/exportación | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Capas | Subir/bajar un elemento y comparar orden visual | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Undo/redo | Deshacer y rehacer la última edición | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Zoom y minimapa | Zoom in/out/reset; navegar diapositivas desde minimapa | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Tema claro/oscuro | Alternar ambos temas en chat y comprobar el preview | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Idioma de interfaz | Cambiar idioma y comparar etiquetas/controles principales | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Exportación PDF | Exportar, abrir el archivo y revisar páginas, texto e imágenes | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Exportación PPTX | Exportar, abrir en PowerPoint/visor compatible y revisar slides | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Vista móvil | Mismo viewport móvil; navegación, controles y minimapa | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Tema vacío | Enviar sin tema; comparar validación y mensaje visible | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Archivo de 11 MB | Subir un archivo de prueba de 11 MB; anotar status y JSON visible | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Cuatro archivos | Subir cuatro adjuntos; anotar status y mensaje visible | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Extensión `.exe` | Intentar subir el mismo archivo no permitido | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |
| Clave inválida | Con un valor de prueba no válido, generar y comparar el error/fallback; no usar una clave de producción | ☐ Igual ☐ Distinto | ☐ Igual ☐ Distinto |

## Diferencias observadas

| Paso | `main` | Fase 7 | Captura |
| --- | --- | --- | --- |
|  |  |  |  |

## Diferencias esperadas — no reportar como regresión

- Cola llena/desconexión: la cola conserva solicitudes válidas tras `req.close`,
  respeta FIFO y devuelve HTTP 429 real cuando se agota su capacidad.
- Sanitización: se eliminan los vectores activos explícitamente cubiertos por
  las pruebas; el contenido inseguro puede diferir respecto a `main`.
- Multer: errores de subida usan JSON `{ "error": "..." }`; tamaño excedido
  responde 413, y cantidad/extensión/nombre inválidos responden 400.
- Dependencias: no se retuvieron cambios de dependencias runtime; los cambios
  de `package.json` entre `main` y Fase 7 son herramientas de desarrollo/test.
  El inventario de auditoría pendiente figura en `docs/KNOWN-ISSUES.md`.
