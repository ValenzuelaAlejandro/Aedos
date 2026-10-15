# Bloque 3: conteo exacto y liquidación por slides entregadas

Fecha: 14 de octubre de 2026 (America/Tijuana). Cambios locales; no se desplegó
la aplicación.

## Comportamiento

- Flash acepta entre 1 y 8 slides; Pro acepta entre 1 y 15. El backend rechaza
  límites inválidos o incompatibles con el modelo. El slider también recorta el
  rango por el máximo técnico y el saldo restante.
- Las instrucciones del esquema piden el conteo exacto. Si faltan slides, el
  backend completa solo el tramo faltante, en tandas de hasta tres y con un
  máximo de cinco rondas, usando el modelo elegido. Si el HTML final omite
  slides finales, también intenta completar únicamente esas slides.
- Al reparar HTML, primero conserva el documento válido recibido y transmite al
  navegador solo las secciones nuevas. No vuelve a enviar el `<head>`, el CSS ni
  el envoltorio del documento. Si el intento de reparación falla, descarta sus
  fragmentos y mantiene el documento aceptado.
- La cantidad liquidada se calcula después de validar y sanitizar el HTML. Si
  se entregan menos slides que las solicitadas, el ledger confirma solo la
  proporción entregada y comunica el resultado incompleto; claves idempotentes
  evitan una segunda liquidación. Un resultado sin slides válidas falla y
  reembolsa la reserva.
- Las tarifas provisionales son las aprobadas por modelo en el Bloque 2; Pro
  consume exactamente el doble que Flash. Las cifras se comparten entre
  proveedor directo y OpenRouter y no son un cobro al usuario.

Archivos principales de Bloque 3: `src/backend/contracts/limits.js`,
`src/backend/contracts/request-normalizers.js`,
`src/backend/config/model-catalog.js`, `src/backend/pipeline/skeleton.js`,
`src/backend/pipeline/outline-completion.js`, `src/backend/pipeline/stream.js`,
`src/backend/http/routes/generate.js`,
`src/backend/http/routes/generate-output.js`,
`src/backend/http/middleware/generation-credits.js`,
`src/backend/utils/credits-ledger.js`, `src/frontend/features/credits/credits-ui.js`,
`src/frontend/features/credits/credits-slide-view.js`,
`src/frontend/features/generation/skeleton-generation.js` y
`src/frontend/features/generation/final-generation.js`. Pruebas nuevas:
`tests/contracts/slide-count.test.js`,
`tests/contracts/slide-generation.test.js` y
`tests/contracts/stream-repair.test.js`; evidencia visual:
`scripts/capture-block3-ui.js` y `docs/evidence/block3/`.

## Capturas y revisión visual

Se capturaron los cuatro estados (Pro/Flash, claro/oscuro) a 390 y 1440 px. Las
marcas visibles son 15 en Pro y 8 en Flash; las pruebas también verifican la
nota de ajuste al cambiar a Flash. Revisé visualmente los cuatro estados Flash
después del último cambio del slider; los estados Pro conservan la misma escala
y sus 15 marcas se verificaron en el harness. La comprobación manual de Bloque
4, que incluye la legibilidad del texto bajo las orbs en ambos temas, está en
[`BLOCK-4-IMPLEMENTATION.md`](BLOCK-4-IMPLEMENTATION.md).

| Ancho | Tema | Pro | Flash |
| --- | --- | --- | --- |
| 390 px | Claro | ![Pro 390 claro](evidence/block3/block3-pro-390-light.png) | ![Flash 390 claro](evidence/block3/block3-flash-390-light.png) |
| 390 px | Oscuro | ![Pro 390 oscuro](evidence/block3/block3-pro-390-dark.png) | ![Flash 390 oscuro](evidence/block3/block3-flash-390-dark.png) |
| 1440 px | Claro | ![Pro 1440 claro](evidence/block3/block3-pro-1440-light.png) | ![Flash 1440 claro](evidence/block3/block3-flash-1440-light.png) |
| 1440 px | Oscuro | ![Pro 1440 oscuro](evidence/block3/block3-pro-1440-dark.png) | ![Flash 1440 oscuro](evidence/block3/block3-flash-1440-dark.png) |

Las aserciones y dimensiones registradas están en
[`evidence/block3/checks.json`](evidence/block3/checks.json). Sigue pendiente
el fallo de la comprobación visual del editor en el punto `flow-01-landing`;
se reproduce en HEAD sin cambios y está documentado en
[`KNOWN-VISUAL-BASELINE-ISSUE.md`](KNOWN-VISUAL-BASELINE-ISSUE.md). No actualicé
ese baseline.

## Validación ejecutada

- `npm run test:contract`: pasó, incluida la reparación HTML que transmite solo
  las slides faltantes.
- `npm run test:safe`: pasó (43 pruebas).
- `npm run test:provider-fallback`: pasó completo; incluye las suites de
  fallback, red y timeout.
- `npm run test:streaming-ui`: pasó en navegador a 390/1440 px, claro/oscuro;
  el escenario verifica contenido en vivo, descarte del intento fallido,
  visibilidad/restauración del texto de reintento y contraste del texto bajo
  las orbs (17.74:1 claro, 14.30:1 oscuro). El fixture solicita 2 slides para
  cumplir el conteo exacto del Bloque 3.
- `npm run test:provider-network`: pasó (5 pruebas).
- `npm run verify:quality`: pasó las barreras configuradas de lint,
  TypeScript y formato.
- `node scripts/capture-block3-ui.js`: pasó las cuatro dimensiones/temas y
  produjo las ocho capturas.
- `git diff --check`: pasó después de cerrar esta documentación.

Los proveedores y Redis en estas pruebas fueron simulados o aislados. No se
verificó interoperabilidad con cuentas reales ni se desplegó.

## Verificación aún necesaria antes del despliegue

Completar primero los pasos del documento
[`PRODUCTION-VERIFICATION-BLOCK-1.md`](PRODUCTION-VERIFICATION-BLOCK-1.md):
llaves de prueba separadas, un error HTTP real de Gemini con OpenRouter válido,
corte controlado de un stream real, correlación por request/attempt ID, un solo
cobro tras éxito, permisos y persistencia Redis, retención e idempotencia. Ese
documento deja también las entradas concretas que hacen falta y la secuencia de
prueba. No desplegar hasta completar esa verificación y diagnosticar el
incidente de producción a partir de su request ID.

El Bloque 2 está implementado localmente y no desplegado. La tabla vigente,
migración y topes están en [`DECISIONS-BLOQUE-2.md`](DECISIONS-BLOQUE-2.md).
