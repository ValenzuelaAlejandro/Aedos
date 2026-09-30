# Traspaso — refactorización Aedos

## Cadena de ramas

Hashes observados localmente antes de este documento:

| Orden | Rama | Hash |
|---:|---|---|
| 1 | `refactor/fase-0-red-seguridad` | `d1f07114376c17e408bb6fc7c91d21287d4d9974` |
| 2 | `refactor/fase-0b-cierre-huecos` | `8f53dfe068f7a89a06587b9de19684be0453f8a2` |
| 3 | `refactor/fase-1-calidad-base` | `3c962717bc458a30b4230edfef766d874afb9da1` |
| 4 | `refactor/fase-2-contratos` | `a7df061b21f3778db10505854725617e65110c7d` |
| 5 | `refactor/fase-3a-backend-base` | `6d05d8307f0210901586cb95bbc83fecc13cb043` |
| 6 | `refactor/fase-3a-bis-extraccion` | `2f0569fafe9ff0ac089fa90b4e978ec0f70b2951` |
| 7 | `refactor/fase-3b1-colas-export` | `5e75fc16b6ad09bcea3d6da0dd558b63c1a0fc3a` |
| 8 | `refactor/fase-3b2-pipeline-rutas` | `21b238af9d8c41ccdfad6efa32b77c3ccf17be31` |
| 9 | `refactor/fase-3c-cierre-backend` | `ff967744dfb10e24c07ce3a85108c50b3a690532` |
| 10 | `refactor/fase-3c-fix` | `3d8399fd6c7905194543cb585f7fc29efbad117d` |

El commit de estas notas actualizará el hash de `refactor/fase-3c-fix`; consultar `git rev-parse HEAD` para el valor definitivo.

## Estado

- Backend refactorizado; `src/backend/server.js` tiene 424 líneas.
- Métricas reportadas para esta fase: lint 179 y typecheck 30.
- No se modificaron `src/`, `tests/` ni baselines para este cierre.
- Se revisó `.github/workflows/ci.yml`: `push` y `pull_request` no tienen filtro de ramas.
- No se ha confirmado una ejecución de GitHub Actions para estas ramas.

## Verificación

Comando: `npm run verify:all` (ejecutado el 2026-09-30 en Windows). No terminó correctamente: las suites `test:safe` (36 pruebas), `test:contract` (25), `test:provider-network` (3) y `test:provider-timeout` (1) llegaron a sus resultados de pase; al terminar `test:provider-timeout`, el proceso Node abortó con `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94` (código de salida PowerShell `-1073740791`). En esa ejecución Puppeteer también registró `spawn EPERM` al intentar iniciar Chrome. Por tanto, `verify:all` queda pendiente de una ejecución completa exitosa en un entorno compatible.

## Riesgos aceptados / known issues

- Ciclo de vida de cola y `req.close`.
- Sanitización con casos aún por revisar.
- Multer puede responder 500.
- Sin fallback midstream después de comenzar el stream.
- `npm audit` reportó 12 vulnerabilidades; no ejecutar `audit fix` sin revisar.
- Puppeteer puede inicializarse al importar módulos.
- No se ha realizado smoke test con proveedores reales.
- GitHub Actions todavía no se ha observado correr para estas ramas.

## Hueco de cobertura visual

El baseline visual no detecta cambios pequeños de forma fiable: el cambio global de fondo rojo pasó con 80/80/17/0 píxeles distintos. No tomar un pase visual aislado como prueba de ausencia de regresiones visuales.

## Pendientes para continuar

1. Ejecutar smoke test manual controlado con proveedores reales.
2. Crear/usar la rama de integración después de acordar su base.
3. Resolver los known issues priorizados.
4. Completar Fase 0c.
5. Completar Fase 4 del frontend.
6. Repetir `npm run verify:all` en un entorno compatible con Puppeteer y Windows/Linux CI, y observar Actions.
