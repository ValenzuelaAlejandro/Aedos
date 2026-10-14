# Native tables

A real `<table>` becomes a `p:graphicFrame` with `<a:tbl>`, `tblGrid`,
measured rows, and explicit cell styles. It preserves `thead/tbody/tfoot`,
`colspan` through `gridSpan`, `rowspan` through `rowSpan`/`vMerge`,
fills, borders, alpha, padding, alignment, and text runs. No default Office
style is assigned that could change colors.

Nested tables, tables inside nontrivial transform/overflow/opacity, or
structures without `display:table` must degrade to a node raster with
`table-fallback`. The current fixture keeps the nested table in its visual
compatibility case. The main PPTX retains editable simple and merged tables.

Manual fixture: `tmp/phase5-final-tables.pptx`. Review column grid, headers,
alternating cells, shared borders, `colspan`, `rowspan`, caption, and
whether the nested table shifts the rest of the slide.
