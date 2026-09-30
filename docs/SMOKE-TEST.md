# Smoke test manual de backend

Objetivo: comparar `main` y `refactor/fase-3c-cierre-backend` en dos puertos
distintos, sin anotar claves, tokens ni valores secretos. Ejecutar cada
instancia con su configuración normal y usar sólo un entorno autorizado.

## Preparación

1. Arrancar `main` y esta rama en puertos distintos con `npm start` o `npm run dev`.
2. Abrir cada URL en una ventana/incógnito separado y limpiar datos de sesión.
3. Usar el mismo tema, idioma, modo y fixture en ambas instancias.
4. Comparar también los logs de orden: arranque, Puppeteer, rutas y exportación.

## Checklist

- Flash: escribir un tema normal, generar esqueleto, editar outline y generar.
- Pro: repetir el flujo y confirmar los eventos de etapas en el mismo orden.
- Esquema + edición: generar un skeleton, modificar título/puntos y continuar.
- Adjuntos: repetir con un PDF y con un DOCX; confirmar que el contexto y el
  resultado final son equivalentes.
- Preview/editor: comprobar iframe, selección, mover, undo/redo y herramientas.
- Exportación PDF: descargar, abrir, comprobar páginas, dimensiones y texto.
- Exportación PPTX: descargar, abrir en PowerPoint/visor compatible y comprobar
  que las diapositivas y warnings visibles sean equivalentes.
- Error provocado: usar un tema rechazado o un límite inválido y comparar
  status, cuerpo, mensaje y si la UI vuelve a un estado utilizable.

## Criterio de resultado

Marcar **igual** si ambos lados conservan endpoint, status, payload, orden SSE,
contenido visible, archivo descargado y mensajes esperados. Marcar **distinto**
si cambia cualquier status, campo, texto, orden de evento, límite, timing de
arranque observable o artefacto descargado; adjuntar la ruta y una descripción,
nunca secretos. Esta lista es manual y no sustituye `npm run verify:all`.
