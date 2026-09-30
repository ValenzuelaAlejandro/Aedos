# HTTP middleware

Este directorio contiene middleware de transporte registrado por `server.js`.

Cada módulo expone una fábrica pequeña y recibe sus dependencias explícitamente
para conservar el orden de registro, los nombres observables de Express y los
efectos secundarios existentes. Los módulos no registran middleware por sí
mismos ni ejecutan configuración al importarse.
