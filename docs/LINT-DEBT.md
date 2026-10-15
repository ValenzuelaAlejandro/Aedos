# Deuda ESLint previa y control de regresiones

Revisión local del 15-10-2026: 31 avisos restantes, frente a 40 recibidos.
Se corrigieron los nueve avisos en prompts, traducciones y logger tocados por
los bloques. El texto estático de prompts ahora es JSON y las interpolaciones
siguen siendo JavaScript revisado, sin eval; se comprobó igualdad byte a byte
antes/después para los cuatro builders, idiomas y presencia de skeleton.
Los diccionarios EN/ES se cargan antes de i18n, sin cambiar sus textos. La
clasificación del logger conserva el orden de reglas en una tabla.

Los 31 avisos restantes pertenecen a cuerpos de funciones ajenos a estos
cambios: exportador, editor, minimap, herramientas y bootstrap heredados.
Los cambios previos de firmas/tipos no alteran esos algoritmos. Se mantienen
inventariados para evitar refactorizar código ajeno, sin silenciar reglas ni
aumentar máximos permitidos. El código añadido en este cierre no tiene avisos.

| Archivo | Avisos | Reglas |
| --- | ---: | --- |
| `src/backend/utils/pptx-export.js` | 10 | complexity, no-shadow, max-lines |
| `src/frontend/editor/editor-ui.js` | 2 | max-lines-per-function, complexity |
| `src/frontend/features/minimap/minimap.js` | 5 | max-lines-per-function, no-shadow, eqeqeq |
| `src/frontend/features/shared/init.js` | 2 | no-undef |
| `src/frontend/features/tools/tools.js` | 5 | max-lines-per-function, prefer-const, complexity, max-lines |
| `src/frontend/mobile/js/bridge.js` | 2 | max-lines-per-function, no-empty |
| `src/frontend/scripts/app.js` | 4 | max-lines-per-function, no-undef, prefer-const |
| `tests/pptx-export-advanced.test.js` | 1 | no-unused-vars |

El ratchet anterior ignoraba severidad 2, aunque ESLint finalizara con error.
Ahora también compara diagnósticos con un inventario verificado contra HEAD
`f5def545021135a4149ae2476e53ba8a68f9726a`. Cualquier diagnóstico nuevo, incluso
en un archivo nuevo, hace fallar el comando; `--write` no permite añadir
excepciones de error. El inventario conserva únicamente errores actuales
que reproducía esa revisión previa. No se ejecutó código antiguo para medirlo:
solo se analizó su texto con el mismo ESLint/configuración.

| Diagnóstico heredado | Cantidad |
| --- | ---: |
| no-useless-assignment | 5 |
| no-useless-escape | 1 |
| no-control-regex | 2 |
| parser/sourceType | 41 |
| no-redeclare | 10 |

Los errores de parser corresponden a módulos ES analizados por la configuración
legacy como scripts clásicos. Las redeclaraciones son funciones declaradas
también en el catálogo global del linter; las regex de control eliminan o
comprueban controles XML intencionalmente. Asignaciones redundantes y escapes
están en componentes ajenos intactos. Son diagnósticos de lint previos,
no 59 errores TypeScript ni 59 errores nuevos de ejecución.

Por transparencia: `npm run lint` sigue devolviendo error por esa deuda;
`npm run lint:ratchet` acepta solo el inventario previo y rechaza regresiones.
La baseline de avisos se ajustó a 31; no se modificó ninguna baseline visual,
imagen ni umbral. El detalle completo está en
[evidence/quality/lint-debt.json](evidence/quality/lint-debt.json).

<!-- CURRENT-POLICY:START -->
Política vigente generada desde config. No editar las cifras a mano.

Cupo diario UTC por IP: 50 créditos = 50000 unidades. Pro = 2× Flash.

| Modelo | Créditos/slide Flash / Pro | Máximo slides Flash / Pro | Uso de presentación máxima Flash / Pro |
| --- | --- | --- | --- |
| Gemini 3 Flash | 1.6 / 3.2 | 8 / 15 | 25.6% / 96% |
| Nemotron 3.5 Lightning | 0.8 / 1.6 | 8 / 15 | 12.8% / 48% |
| GPT-6 Luna | 1.2 / 2.4 | 8 / 15 | 19.2% / 72% |
| Claude Haiku 5.5 | 1.2 / 2.4 | 8 / 15 | 19.2% / 72% |

Topes nominales USD: request 0.24; IP/día 0.24; global/día 0.25; global/mes 1.
Margen de reserva: 1.25; duración máxima request: 600000 ms.
Mínimo liquidado de chat Flash: 250 unidades; Pro: 500. Para iniciar se exige la reserva completa de tokens, no solo ese mínimo.
<!-- CURRENT-POLICY:END -->
