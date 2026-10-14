# HTTP routes

Factories in this directory register Express endpoints and receive bootstrap
dependencies. Registration runs from `server.js` at its original point and
order; anonymous layers and parsing middleware are part of the observable contract.

`../register-routes.js` preserves global registration order and only assembles
existing factories; it contains no endpoint logic.

Existing request normalizers remain contract utilities. Do not replace inline
validation without first comparing results, errors, and limits against a table
of equivalent cases.
