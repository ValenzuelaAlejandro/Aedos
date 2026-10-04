# Orden local de publicación de ramas

Esta lista representa el orden topológico observado en los refs locales el
2026-10-03. `main` (`02cc2daba769b169afe417e87e6d2dbd8b224f20`) es solo la base y
no se publica con este procedimiento. No se ejecutó ningún push durante esta
tarea. Antes de subir, confirma que cada rama esté limpia y que el hash local
siga coincidiendo con el hash revisado; publica una por una en este orden.

| # | Rama | Hash local observado | Comando para publicación manual |
| ---: | --- | --- | --- |
| 1 | `refactor/fase-0-red-seguridad` | `d1f07114376c17e408bb6fc7c91d21287d4d9974` | `git push -u origin refactor/fase-0-red-seguridad` |
| 2 | `refactor/fase-0b-cierre-huecos` | `8f53dfe068f7a89a06587b9de19684be0453f8a2` | `git push -u origin refactor/fase-0b-cierre-huecos` |
| 3 | `refactor/fase-1-calidad-base` | `3c962717bc458a30b4230edfef766d874afb9da1` | `git push -u origin refactor/fase-1-calidad-base` |
| 4 | `refactor/fase-2-contratos` | `a7df061b21f3778db10505854725617e65110c7d` | `git push -u origin refactor/fase-2-contratos` |
| 5 | `refactor/fase-3a-backend-base` | `6d05d8307f0210901586cb95bbc83fecc13cb043` | `git push -u origin refactor/fase-3a-backend-base` |
| 6 | `refactor/fase-3a-bis-extraccion` | `2f0569fafe9ff0ac089fa90b4e978ec0f70b2951` | `git push -u origin refactor/fase-3a-bis-extraccion` |
| 7 | `refactor/fase-3b1-colas-export` | `5e75fc16b6ad09bcea3d6da0dd558b63c1a0fc3a` | `git push -u origin refactor/fase-3b1-colas-export` |
| 8 | `refactor/fase-3b2-pipeline-rutas` | `21b238af9d8c41ccdfad6efa32b77c3ccf17be31` | `git push -u origin refactor/fase-3b2-pipeline-rutas` |
| 9 | `refactor/fase-3c-cierre-backend` | `ff967744dfb10e24c07ce3a85108c50b3a690532` | `git push -u origin refactor/fase-3c-cierre-backend` |
| 10 | `refactor/fase-3c-fix` | `67d248bcdf976c726d73f930353ba683f8cd3808` | `git push -u origin refactor/fase-3c-fix` |
| 11 | `refactor/fase-3d-visual-baseline` | `08fce9cba6c7c1f6c09ccf050c2d44171f90c540` | `git push -u origin refactor/fase-3d-visual-baseline` |
| 12 | `refactor/fix-cola` | `c133384fd80845a3159193e636072ce11b802458` | `git push -u origin refactor/fix-cola` |
| 13 | `refactor/fix-sanitizacion` | `42987acaf87bbfe1e8b3deef38893f119cca1a7e` | `git push -u origin refactor/fix-sanitizacion` |
| 14 | `refactor/fix-multer` | `459c932f60a87e921739ed9f07d3714db30d2495` | `git push -u origin refactor/fix-multer` |
| 15 | `refactor/fix-audit` | `3114bdeb86095a6dcdb675fb1cdd84f0e6a71488` | `git push -u origin refactor/fix-audit` |
| 16 | `refactor/fase-0c-editor-red` | `dcd47d315c2aae960a944f7c330d80ae44070d44` | `git push -u origin refactor/fase-0c-editor-red` |
| 17 | `refactor/fase-4-frontend-modular` | `020f50b799b2f0b9b8aec5baf76e4dc1fc19f388` | `git push -u origin refactor/fase-4-frontend-modular` |
| 18 | `refactor/fase-4a-http-sse` | `b68ef58dea625c3d51aeb0ad8797160e8efe42e1` | `git push -u origin refactor/fase-4a-http-sse` |
| 19 | `refactor/fase-4b-stores` | `91ab3e3f2ab5677adbdc8de9482ca5e1646d3671` | `git push -u origin refactor/fase-4b-stores` |
| 20 | `refactor/fase-4c-renderers` | `b9f666b855cf465dc6bb00d78b119d8f45975493` | `git push -u origin refactor/fase-4c-renderers` |
| 21 | `refactor/fase-4d-editor` | `2fd866ae59d18e26dfef231b5dd260d9dcf2be26` | `git push -u origin refactor/fase-4d-editor` |
| 22 | `refactor/fase-5-esm` | `19d6dab545ac9bae9a7b638b01e6bc40e9ab6c9f` | `git push -u origin refactor/fase-5-esm` |
| 23 | `refactor/fase-6-tipos` | `3e466ce92df4e93dbb4c679b76943fdf0cedb9b3` | `git push -u origin refactor/fase-6-tipos` |
| 24 | `refactor/fase-7-limpieza` | `e221fd7295397fa9d69ee2fa161effb62d2bfd13` (antes del commit de este documento) | `git push -u origin refactor/fase-7-limpieza` |
| 25 | `refactor/fase-8a-red-estable` | `565a8f0d296fa85b1ec92ba1a08c24dc7c74c9e6` | `git push -u origin refactor/fase-8a-red-estable` |
| 26 | `refactor/fase-8b-inventario` | `a1cd537d6190c81aeb8027c378e7c31a0d5bb9f7` | `git push -u origin refactor/fase-8b-inventario` |
| 27 | `refactor/fase-8c-outline` | `d730eeabf3d144f5d71273b1dc0b3abffcd3dc75` | `git push -u origin refactor/fase-8c-outline` |
| 28 | `refactor/fase-8d-editor` | `97168e4f54f1d6f704a0700f9d5d43b608882d53` | `git push -u origin refactor/fase-8d-editor` |
| 29 | `refactor/fase-8e-app` | `bb44e47` (código verificado; el commit documental posterior actualiza la punta) | `git push -u origin refactor/fase-8e-app` |

El último hash de `fase-7-limpieza` cambia al commit de estos documentos; para
ese valor final usa `git rev-parse refactor/fase-7-limpieza`. No usar `--force`,
no publicar tags y nunca incluir `main` en la lista de push.

La Etapa 8e puede avanzar al añadir documentación de cierre; comprueba siempre
su hash publicable final con `git rev-parse refactor/fase-8e-app`.
