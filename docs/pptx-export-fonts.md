# Fuentes y sustituciones PPTX

Las sustituciones se mantienen como datos, no como reglas específicas de un
deck. La primera familia instalada de la pila CSS se conserva; si ninguna está
disponible se consulta esta tabla:

| Categoría o patrón | Fallback Office |
| --- | --- |
| serif y familias serif decorativas | Georgia |
| sans-serif genérico | Arial |
| display/black | Arial Narrow |
| monospace/code | Courier New |
| familia desconocida sin categoría | Arial |

Cada sustitución emite un warning único por familia y slide con tipo
`font-substitution`, incluyendo la familia original y la resultante.
