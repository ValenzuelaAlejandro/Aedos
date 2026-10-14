# HTTP middleware

This directory contains transport middleware registered by `server.js`.

Each module exposes a small factory and receives dependencies explicitly to
preserve registration order, observable Express names, and existing side
effects. Modules do not register middleware themselves or run configuration
when imported.
