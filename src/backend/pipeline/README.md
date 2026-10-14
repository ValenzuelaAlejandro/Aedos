# Pipeline

Orchestrates generation flows used by HTTP routes. Modules receive dependencies
from `server.js` to preserve initialization, test seams, and SSE contracts
without additional global state.
