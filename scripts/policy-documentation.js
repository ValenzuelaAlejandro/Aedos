'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { MODEL_CATALOG } = require('../src/backend/config/model-catalog');
const { DAILY_USAGE_UNITS, UNITS_PER_CREDIT, MIN_START_USAGE_UNITS } = require('../src/backend/config/usage-policy');
const { spendConfig } = require('../src/backend/config/provider-spend');
const START = '<!-- CURRENT-POLICY:START -->';
const END = '<!-- CURRENT-POLICY:END -->';
const documents = ['DECISIONS-BLOQUE-2.md', 'DEPLOY-PLAN.md', 'FINAL-REVIEW.md', 'LINT-DEBT.md',
    ...fs.readdirSync(path.resolve(__dirname, '../docs')).filter(file => /^PRODUCTION-VERIFICATION-BLOCK-.*\.md$/.test(file))];
function policyBlock() {
    const caps = spendConfig({});
    const rows = Object.values(MODEL_CATALOG).map(model => {
        const { flash, pro } = model.usagePerSlideUnits;
        return `| ${model.name} | ${flash / UNITS_PER_CREDIT} / ${pro / UNITS_PER_CREDIT} | ${model.maxSlides.flash} / ${model.maxSlides.pro} | ${flash * model.maxSlides.flash / DAILY_USAGE_UNITS * 100}% / ${pro * model.maxSlides.pro / DAILY_USAGE_UNITS * 100}% |`;
    });
    return [START, 'Política vigente generada desde config. No editar las cifras a mano.', '',
        `Cupo diario UTC por IP: ${DAILY_USAGE_UNITS / UNITS_PER_CREDIT} créditos = ${DAILY_USAGE_UNITS} unidades. Pro = 2× Flash.`,
        '', '| Modelo | Créditos/slide Flash / Pro | Máximo slides Flash / Pro | Uso de presentación máxima Flash / Pro |',
        '| --- | --- | --- | --- |', ...rows, '',
        `Topes nominales USD: request ${caps.maxRequestReservationUsd}; IP/día ${caps.perIpDailyUsd}; global/día ${caps.dailyUsd}; global/mes ${caps.monthlyUsd}.`,
        `Margen de reserva: ${caps.reservationMargin}; duración máxima request: ${caps.maxRequestDurationMs} ms.`,
        `Mínimo liquidado de chat Flash: ${MIN_START_USAGE_UNITS} unidades; Pro: ${MIN_START_USAGE_UNITS * 2}. Para iniciar se exige la reserva completa de tokens, no solo ese mínimo.`,
        END].join('\n');
}
if (require.main === module) {
    if (!process.argv.includes('--write')) throw new Error('Use --write to synchronize policy documentation.');
    for (const name of documents) {
        const file = path.resolve(__dirname, '../docs', name);
        let content = fs.readFileSync(file, 'utf8');
        content = content.includes(START) ? content.replace(new RegExp(`${START}[\\s\\S]*?${END}`), policyBlock())
            : content.trimEnd() + '\n\n' + policyBlock() + '\n';
        fs.writeFileSync(file, content);
    }
}
module.exports = { policyBlock, documents, START, END };
