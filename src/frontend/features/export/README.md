# Export feature

`export-snapshot.js` prepares a sanitized-for-export clone of the live preview:
it deselects editor chrome, freezes slide layout, snapshots text measurements,
restores live styles immediately after cloning, and removes transient editor and
carousel UI. The app keeps progress, endpoint selection, download, and error UI.
