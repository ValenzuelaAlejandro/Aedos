# Aedos

## Verificación y calidad

La red funcional se ejecuta con `npm run verify:baseline`; la calidad
incremental con `npm run verify:quality`, y ambas juntas con
`npm run verify:all`. Los ratchets de ESLint y TypeScript comparan el estado
actual con sus baselines para impedir que aumenten los problemas existentes.
