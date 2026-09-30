# Contribuir a Aedos

## Verificaciones

- `npm run test:safe`: pruebas unitarias aisladas de Windows.
- `npm test`: comando original de Node; en Linux debe ejecutarse sin la
  limitación de `spawn EPERM` de Windows.
- `npm run test:contract`: contratos HTTP y multipart.
- `npm run check:dom`: referencias de IDs estáticos.
- `npm run verify:quality`: lint, type-check y formato con ratchets.
- `npm run verify:baseline`: red de seguridad funcional y visual existente.
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

Mantén la regla orientativa de un archivo = una responsabilidad y procura no
superar 400 líneas por archivo. Esta regla se reporta como warning para poder
mejorar gradualmente sin bloquear la refactorización.
