# Bloque 1: implementación vigente

Estado local al 15-10-2026 (America/Tijuana), sin despliegue. El orden técnico
es Bloque 1 → 4 → 3 → 2. Las decisiones de uso/presupuesto vigentes están
únicamente en [DECISIONS-BLOQUE-2.md](DECISIONS-BLOQUE-2.md).

Se agregó correlación antes de modificar fallback: request ID HTTP estable,
attempt ID por transporte, proveedor, modelo solicitado/efectivo, motivo de
fallback, status/outcome, latencia, tokens y USD. La telemetría no incluye
prompts, adjuntos ni claves y se persiste en Redis con retención acotada.

La respuesta conserva streaming en vivo. Corte, error SSE, timeout o vacío
limpian el contenido parcial de chat/presentación antes del siguiente intento.
Solo cambia el texto existente bajo las orbs a la traducción de
“Reintentando...”; vuelve al estado normal al llegar nuevo contenido.
El reintento OpenRouter usa el mismo modelo y empieza desde cero.
Safety permite un intento adicional. Agotados los caminos, se presenta error
claro; historial y slides no conservan parcial fallido y solo se debita al
completar con éxito.

`npm run test:provider-fallback` cubre 429, 5xx, timeout, vacío, corte, SSE,
safety y OpenRouter disponible/no disponible, con modelo estable y débito único.
`npm run test:streaming-ui` verifica geometría/contraste y el ciclo del aviso
en 390/1440 px claro/oscuro; evidencia en `docs/evidence/block4/`.

La comprobación visual histórica permanece aislada sin modificar imágenes ni
umbrales: [KNOWN-VISUAL-BASELINE-ISSUE.md](KNOWN-VISUAL-BASELINE-ISSUE.md).
La matriz real, Redis remoto, proxy/CDN y diagnóstico del incidente necesitan
los datos externos definidos en [DEPLOY-PLAN.md](DEPLOY-PLAN.md).
La preparación se ejecuta con `npm run verify:preprod`: primero valida todas
las entradas, luego exige attestation de entorno/Redis antes de generar o
escribir. Ver [PRODUCTION-VERIFICATION-BLOCK-1.md](PRODUCTION-VERIFICATION-BLOCK-1.md).
