# Tablas nativas

Un `<table>` real se convierte en `p:graphicFrame` con `<a:tbl>`, `tblGrid`,
filas medidas y estilos explícitos por celda. Se conservan `thead/tbody/tfoot`,
`colspan` mediante `gridSpan`, `rowspan` mediante `rowSpan`/`vMerge`, rellenos,
bordes, alpha, padding, alineación y runs de texto. No se asigna un estilo
predeterminado de Office que pueda cambiar los colores.

Tablas anidadas, tablas dentro de transform/overflow/opacity no trivial o
estructuras que no sean `display:table` deben degradarse a raster del nodo con
`table-fallback`; el fixture actual deja la tabla anidada en el caso de
compatibilidad visual. El PPTX principal conserva tabla editable para las
tablas simples y con merges.

Fixture manual: `tmp/phase5-final-tables.pptx`. Revisar grid de columnas,
cabeceras, celdas alternas, bordes compartidos, celda con `colspan`, celda con
`rowspan`, caption y que la tabla anidada no desplace el resto del slide.
