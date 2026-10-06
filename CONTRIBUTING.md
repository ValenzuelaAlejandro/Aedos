# Contribuir a Aedos

## Runtime

Aedos requiere Node.js `>=22.8.0`: las pruebas comparten estado entre archivos
con `--experimental-test-isolation=none` (nombre usado por Node 22; Node 24 lo
mantiene como alias). `.nvmrc` selecciona la línea 22; CI comprueba 22.x y 24.x
y ejecuta una prueba de compatibilidad del flag antes de la suite.

## Verificaciones

- `npm run test:safe`: pruebas unitarias aisladas de Windows.
- `npm test`: comando original de Node; en Linux debe ejecutarse sin la
  limitación de `spawn EPERM` de Windows.
- `npm run test:contract`: contratos HTTP y multipart.
- `npm run test:rate-limit-evaluators` y `npm run test:prompts-modules`:
  caracterización pura de las dos extracciones backend de Etapa 7.
- `npm run check:dom`: referencias de IDs estáticos.
- `npm run verify:quality`: lint, type-check y formato con ratchets.
- `npm run verify:baseline`: red de seguridad funcional y visual existente.
- `npm run check:baseline:visual`: compara seis capturas sin red externa, con
  animaciones desactivadas y providers de prueba.
- `npm run check:baseline:mutations`: verifica que cambios visuales reales se
  detecten y que un comentario CSS y un cambio cubierto no provoquen fallos.
- `npm run verify:all`: ambas familias de verificación.
- `npm run baseline:export`: regenera manualmente el manifiesto PPTX comprometido;
  este comando escribe `tests/baseline/exports/manifest.json`.
- `npm run check:baseline:export`: genera los paquetes y el manifiesto en un
  directorio temporal y los compara con la baseline comprometida, sin escribir
  en `tests/`.

Si un ratchet falla, revisa el reporte generado en `tmp/`, determina si el
cambio es intencional y actualiza la baseline correspondiente sólo después de
revisar el diff. Para regenerarlas de forma explícita usa
`node scripts/lint-ratchet.js --write` o
`node scripts/typecheck-ratchet.js --write`.

Si el total disminuye, conserva esa reducción y cambia el baseline a la baja en
un commit separado del cambio de código; ejecuta `npm run verify:all` también
después de ese commit. No bajes ratchets para ocultar diagnósticos nuevos. Las
medidas de tamaño que se reportan en una refactorización deben salir del blob
commiteado (`git show <commit>:<archivo> | wc -l`), no de un conteo del working
tree.

## Baseline visual

Regenera las capturas sólo cuando un cambio intencional y revisado altera una
vista que debe ver el usuario (estructura, estilo, layout o estado de UI). No
regeneres la baseline para hacer pasar una diferencia que no hayas explicado.

1. Ejecuta `npm run baseline:visual`. Puppeteer captura desktop claro/oscuro,
   móvil, modal de error, outline editable y preview de presentación en iframe.
   El runner bloquea requests externos, desactiva animaciones y usa el seam de
   providers de prueba; no necesita credenciales ni llamadas a proveedores.
2. Revisa cada PNG nuevo/modificado en `tests/baseline/screenshots/` y el diff
   con Git. Conserva todas las vistas no afectadas sin cambios.
3. Ejecuta `npm run check:baseline:visual`,
   `npm run check:baseline:mutations` y `npm run verify:all`.

La comparación usa pixelmatch threshold `0.03`, máximo `0.01%` de píxeles
distintos y una segunda métrica: distancia euclidiana RGB máxima de 20 por
mosaico de 32×32. `tests/baseline/visual-config.json` no contiene máscaras;
mantén esa lista vacía salvo que exista una región realmente dinámica, con
motivo documentado y un rectángulo mínimo. El endpoint local del botón de
depuración se fija en 404 y las animaciones se neutralizan para que esos estados
no añadan ruido a la captura.

El diagnóstico de la mutación del fondo está en
[`docs/visual-baseline-diagnosis/README.md`](docs/visual-baseline-diagnosis/README.md).

Mantén la regla orientativa de un archivo = una responsabilidad y procura no
superar 400 líneas por archivo. Esta regla se reporta como warning para poder
mejorar gradualmente sin bloquear la refactorización.

Para módulos nuevos de backend, la guía de cierre pide una responsabilidad,
JSDoc/typedefs, README de carpeta cuando aplique y objetivo de 300 líneas. No
separes literales/plantillas de prompts ni serializadores PPTX sin demostrar
equivalencia exacta y sin conservar el orden observable.
