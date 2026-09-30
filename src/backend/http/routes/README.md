# HTTP routes

Las fábricas de este directorio registran los endpoints de Express y reciben
las dependencias del bootstrap. El registro se ejecuta desde `server.js` en el
mismo punto y orden que antes; las capas anónimas y los middleware de parsing
son parte del contrato observable.

Los normalizadores de request existentes se mantienen como utilidades de
contrato. No se sustituyen validaciones inline sin comparar previamente sus
resultados, errores y límites contra una tabla de casos equivalentes.
