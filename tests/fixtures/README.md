# PPTX generality fixtures

These two fixtures are permanent, versioned smoke cases independent of the
Kendrick deck:

| Fixture | Coverage |
| --- | --- |
| `pptx-generality-light.html` | light background, editable list and native table |
| `pptx-generality-dark.html` | dark background, native diagonal gradient, box shadow and pseudo-element decorations |

The dark fixture intentionally keeps the pseudo-elements in the source so a
future pseudo-content pass can be measured without changing the fixture.
