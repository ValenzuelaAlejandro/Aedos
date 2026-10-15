# Cierre vigente de la auditoría A1–A5

La fuente de decisión actual es [DECISIONS-BLOQUE-2.md](DECISIONS-BLOQUE-2.md).
Este cierre sustituye las tablas y recomendaciones exploratorias de esta
auditoría; no queda una segunda escala activa.

| Área | Decisión y evidencia |
| --- | --- |
| A1: uso gratuito | 50 créditos/IP/día UTC; 1 crédito = 2% = 1,000 unidades internas. UI en porcentaje. Migración y concurrencia verificadas con Redis ACL/RDB/reinicio. |
| A2: slides y Pro | Gemini 1.6/3.2, Haiku/GPT 1.2/2.4, Nemotron 0.8/1.6 créditos/slide Flash/Pro. Flash hasta 8; Pro hasta 15. Todos los máximos caben en un saldo completo. Prueba exhaustiva de UI/backend/ledger. |
| A3: chat | Tokens ponderados, Pro = 2× Flash; estimate marcado si falta usage. Modelo y Pro bloqueados en backend; idioma libre. |
| A4: presupuesto | $0.24/request e IP/día; $0.25/día y $1/mes. Reserva previa y max_price de OpenRouter; exceso crítico con pausa probado en Lua real. |
| A5: abuso y operación | IP no equivale a usuario. 63 IPs pueden agotar el diario; el global limita gasto agregado. Preproducción e incidente histórico pendientes de los cinco datos externos ya definidos. |

La escala inicial se había restaurado por la aprobación provisional anterior,
pero su máximo Gemini Pro no cabía en el cupo. La instrucción del 15-10-2026
autoriza resolverlo: la propuesta 0.4× es ahora la decisión vigente. El cupo no
cambia. Los presupuestos exploratorios anteriores tampoco son defaults activos.

No se ha desplegado ni ejecutado la integración con credenciales reales.
