# Cierre del exportador HTML → PPTX

Fecha de verificación: 2026-09-28. Renderer de referencia: Microsoft
PowerPoint COM 16.0.10417.20208; cada slide final se exportó con
`Slide.Export(..., 'PNG', 1122, 631)`. Los baseline/final usan el mismo HTML y
los hashes de `tests/fixtures/HASHES.json`.

## Estado

| Bloque | Estado | Evidencia |
|---|---|---|
| Hardening 4.3 | cerrado | `docs/pptx-export-borders-radius.md`, fixture dedicado |
| 4.4 pseudo | cerrado con degradaciones documentadas | `docs/pptx-export-pseudo.md`, runs inline y shapes decorativos |
| 5 imágenes/SVG | cerrado con raster fallback | `docs/pptx-export-images.md`, `pptx-images.html` |
| 6 tablas | cerrado | `docs/pptx-export-tables.md`, `pptx-tables.html` |
| 7 robustez | cerrado | `docs/pptx-export-robustness.md`, warnings/debug/validación |
| Fase 3 | cerrado en Windows | COM, hashes, ZIP/XML, regresiones y stress deck |

La suite terminó en `31/31`. Los cambios del exportador no tocaron las
modificaciones frontend preexistentes del usuario.

## Cambios principales

- `server.js`: modelo intermedio medido, pseudo-runs, imágenes/SVG/canvas,
  tablas, clonación de backgrounds sin texto duplicado, fallbacks aislados,
  debug por request y warnings estructurados.
- `pptx-export.js`: geometry de radios/ellipse, líneas con `prstDash`, alpha,
  `srcRect`, descripciones, tablas nativas, media deduplicado por SHA-256 y
  validación OOXML.
- `export-warnings.js`: catálogo único y conteos en `X-Export-Warnings`.
- `scripts/verify-pptx-export.js`, `render-pptx-com.ps1` y
  `validate-pptx-package.ps1`: reproducción con un comando y COM.

## Métrica COM vs HTML

MAE es `Σ|COM - HTML| / (W×H×3)`, rango `0..255`, en el slide completo salvo
la región indicada. `delta = final - baseline`; negativo acerca al HTML.

| Deck/slide | Baseline | Final | Delta | Región afectada |
|---|---:|---:|---:|---:|
| borders-radius-opacity/1 | 4.903975 | 4.903975 | 0 | 5.357910 → 5.357910 |
| edge-effects/1 | 1.395411 | 1.395411 | 0 | — |
| generality-dark/1 | 5.080892 | 5.342591 | +0.261699 | header localizado; tarjetas 8.998107 → 8.928149 |
| generality-light/1 | 5.469828 | 5.456641 | -0.013187 | — |
| images/1 | 10.088587 | 5.508730 | -4.579857 | 10.589752 → 6.006858 |
| kendrick/1 | 10.512866 | 10.512866 | 0 | — |
| kendrick/2 | 7.556187 | 7.556187 | 0 | — |
| kendrick/3 | 5.456969 | 5.456969 | 0 | — |
| kendrick/4 | 8.668091 | 8.668091 | 0 | — |
| kendrick/5 | 10.840101 | 10.840101 | 0 | — |
| kendrick/6 | 6.342454 | 6.342454 | 0 | — |
| kendrick/7 | 9.303172 | 9.303172 | 0 | — |
| kendrick/8 | 6.354001 | 6.354001 | 0 | — |
| layer-edge/1 | 1.495750 | 1.495750 | 0 | — |
| minimal/1 | 1.196208 | 1.196208 | 0 | — |
| pseudo/1 | 6.465935 | 6.237909 | -0.228026 | 7.064453 → 6.815320 |
| regression-dark/1 | 8.630741 | 8.630741 | 0 | — |
| regression-light/1 | 3.147872 | 3.147872 | 0 | — |
| shadows/1 | 5.213686 | 5.213686 | 0 | — |
| tables/1 | 7.766409 | 7.766409 | 0 | 8.485305 → 8.485305 |

El único delta positivo es `generality-dark`. Está diagnosticado, no oculto: el
header cambió de dos text-shapes mal posicionados a un run inline medido; la
región de tarjetas mejora y el resultado final coincide estructuralmente con
el HTML, pero PowerPoint mide la combinación de runs distinto a Chromium. El
caso queda como diferencia A/C conocida y no como regresión silenciosa.

El stress deck tiene 32 slides: MAE medio baseline/final `3.016648` por slide
en la comparación directa final; el
PPTX pesa aproximadamente `469411` bytes y sus PNG COM `2772518` bytes. No se
observaron faltas de slide ni fugas de página en el servidor.

## Warnings finales

| Deck | Conteo por tipo |
|---|---|
| borders-radius-opacity | radius-approx 2, border-fallback 2, opacity-group 1 |
| edge-effects | opacity-group 1, radius-approx 1, overflow-clipping 1, position-fallback 2, visibility-fallback 1 |
| generality-dark/light | opacity-group 1 cada uno |
| images | radius-approx 6, overflow-clipping 1, opacity-group 1, image-load-failed 3 |
| kendrick | font-substitution 24, radius-approx 1 |
| layer-edge | opacity-group 1, overflow-clipping 1, position-fallback 2, visibility-fallback 1 |
| pseudo | pseudo-fallback 2 |
| regression-dark/light, minimal, tables, stress | 0 |
| shadows | shadow-fallback 2, filter-fallback 1 |

Ninguna sombra, imagen fallida, pseudo complejo o nodo no soportado se descarta
sin warning. El fallback de `object-fit` usa screenshot del nodo ya renderizado;
el `srcRect` nativo se conserva para modelos compatibles y tiene test OOXML.

## Generalidad y limitaciones

El grep del diff del exportador no contiene literales de deck como colores,
selectores o copy. Las menciones de nombres de fuentes están confinadas a la
tabla de datos/fallback y a tests explícitos de sustitución; los prompts de
generación existentes no forman parte de la lógica de exportación. Se
versionaron fixtures claros/oscuros, imágenes, pseudo, tablas, bordes y stress.

Limitaciones deliberadas: fuentes web no embebidas se sustituyen por familias
Office; SVG complejo, canvas, filtros, backgrounds repetidos, radios con
clipping y tablas anidadas pueden rasterizar; `counter/attr/url` en pseudo
emiten warning; no se verificó Keynote, Google Slides ni una máquina sin las
fuentes instaladas. PowerPoint COM abrió todos los PPTX sin aviso de reparar.

## Reproducción

En Windows con Node, Chromium de Puppeteer y PowerPoint instalado:

```powershell
npm run verify:pptx
```

El comando valida hashes, genera todos los fixtures con `?debug=1`, valida el
ZIP/XML/relaciones, y exporta cada slide a PNG por PowerPoint COM en
`tmp/verify-pptx/com/`. La comparación visual histórica reproducible está en
`tmp/phase5-metrics.py`; requiere el Python empaquetado con Pillow.

Para revisión manual están disponibles `tmp/phase5-final-*.pptx`, las carpetas
`tmp/phase5-final-*-powerpoint-render/` y los mapas de celdas en los fixtures:
`pptx-pseudo.html`, `pptx-images.html`, `pptx-tables.html` y
`pptx-borders-radius-opacity.html`.
