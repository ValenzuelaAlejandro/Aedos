# PPTX fonts and substitutions

Substitutions are data rather than deck-specific rules. The first installed
family in the CSS stack is retained; if none is available, this table applies.

| Category or pattern | Office fallback |
| --- | --- |
| Serif and decorative serif families | Georgia |
| Generic sans-serif | Arial |
| Display/black | Arial Narrow |
| Monospace/code | Courier New |
| Unknown family without a category | Arial |

Each substitution emits one `font-substitution` warning per family and slide,
including the original and resulting families.
