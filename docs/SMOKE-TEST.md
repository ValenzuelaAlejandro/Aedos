# Current application smoke test

Run the app locally with the configured provider and Redis credentials.
Use `npm ci` if dependencies are missing and `npm run dev` to start it.
Open `http://localhost:3000`. Never commit or publish credential values.

## Checklist

Use the same topic and files when comparing runs. Model output can vary;
check the visible flow, structure, controls, and ability to complete actions.

| Action | Check |
| --- | --- |
| Flash generation | Topic validation, progress, generated presentation, and controls |
| Pro generation | Content/design/HTML stage progress and final presentation |
| Outline | Slide count/order, titles, points, and suggested chips |
| Outline editing | Add/delete/reorder a slide; edit titles and points |
| Generate from outline | Approval action, progress, and transition to preview |
| PDF attachment | Upload chip and supporting-file context |
| DOCX attachment | Upload chip and supporting-file context |
| Preview iframe | Correct deck and responsive slide navigation |
| Editor selection | Select text and shapes |
| Move/resize | Element position, size, toolbar, and selection geometry |
| Text editing | Changes appear in preview and export |
| Layers | Bring forward/send backward and verify visual order |
| Undo/redo | Restore the previous edit and reapply it |
| Zoom/minimap | Zoom in/out/reset and navigate from thumbnails |
| Theme | Light/dark controls and preview |
| Interface language | Spanish/English labels and controls |
| PDF export | Download opens with expected pages, text, and images |
| PPTX export | Download opens in a compatible viewer with expected slides |
| Mobile | Same viewport; navigation, drawers, pinch zoom, pan, and swipe |
| Empty topic | Validation and visible message |
| 11 MB test file | Rejection status and JSON error |
| Four attachments | Count limit and visible error |
| Disallowed `.exe` | Upload rejection |
| Invalid test key | Error/fallback behavior without a production credential |
| Invalid model ID | HTTP 422 with `MODEL_NOT_ALLOWED` and no provider call |
| Exhausted test credits | HTTP 402 with `INSUFFICIENT_CREDITS` and no provider call |

## Observations

| Action | Result | Screenshot or error |
| --- | --- | --- |
|  |  |  |

## Existing response behavior

Queue capacity returns HTTP 429 and preserves FIFO; disconnected responses are
removed. Upload size errors use HTTP 413 and JSON `{ "error": "..." }`;
invalid count, extension, or filename errors use HTTP 400. Generated HTML is
sanitized before preview/export. See [contracts](CONTRACTS.md) for exact shapes
and [current limitations](KNOWN-ISSUES.md) for verification limits.
