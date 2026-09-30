# Backend config

`env.js` reads the numeric/runtime environment values used during bootstrap
and returns a plain configuration object. It does not load dotenv; startup
keeps that responsibility and timing in `server.js`. Add a setting by
registering its name/default in `contracts/config-defaults.js`, reading it in
`loadEnvConfig`, and adding equivalence cases before changing the consumer.

`models.js` resolves provider model lists and reasoning at the same bootstrap
position where the server previously initialized them.
