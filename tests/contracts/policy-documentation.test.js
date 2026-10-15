'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { parse } = require('dotenv');
const { MODEL_CATALOG } = require('../../src/backend/config/model-catalog');
const { DAILY_USAGE_UNITS, UNITS_PER_CREDIT } = require('../../src/backend/config/usage-policy');
const { spendConfig } = require('../../src/backend/config/provider-spend');
const root = path.resolve(__dirname, '../..');

test('every release document carries the exact current config and rejects obsolete active policy numbers', () => {
    const { documents, policyBlock, START, END } = require('../../scripts/policy-documentation');
    for (const file of documents) {
        const content = fs.readFileSync(path.join(root, 'docs', file), 'utf8');
        const actual = content.slice(content.indexOf(START), content.indexOf(END) + END.length);
        assert.equal(actual, policyBlock(), file);
        assert.doesNotMatch(content, /(?:Gemini\s+4\/8|GPT\s+3\/6|Nemotron\s+2\/4|\$0\.75)/i, file);
        const rates = { Gemini: [1.6, 3.2], Haiku: [1.2, 2.4], GPT: [1.2, 2.4], Nemotron: [0.8, 1.6] };
        for (const match of content.matchAll(/\b(Gemini|Haiku|GPT|Nemotron)(?:\s*(?:\/|y)\s*GPT)?\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g)) {
            assert.deepEqual([Number(match[2]), Number(match[3])], rates[match[1]], `${file}: inconsistent prose price`);
        }
    }
});

test('review and lint debt report the current ratchet warning count', () => {
    const { totalWarnings } = require('../baseline/lint-baseline.json');
    for (const file of ['FINAL-REVIEW.md', 'LINT-DEBT.md']) {
        assert.match(fs.readFileSync(path.join(root, 'docs', file), 'utf8'), new RegExp(`${totalWarnings} avisos`));
    }
    const report = require('../../docs/evidence/quality/verification-results.json');
    assert.equal(report.checks.find(check => check.command === 'npm run verify:quality').legacyWarnings, totalWarnings);
});

test('untrusted environment prices and request fields cannot restore an old slide scale', async () => {
    const { spawnSync } = require('node:child_process');
    const probe = spawnSync(process.execPath, ['-e', `
        const assert=require('node:assert/strict');
        const {USAGE_PER_SLIDE_UNITS}=require('./src/backend/config/usage-policy');
        assert.deepEqual(USAGE_PER_SLIDE_UNITS['google/gemini-3-flash-preview'],{flash:1600,pro:3200});
        assert.ok(Object.isFrozen(USAGE_PER_SLIDE_UNITS['google/gemini-3-flash-preview']));
    `], { cwd: root, env: { ...process.env, GEMINI_FLASH_CREDITS: '4', GEMINI_PRO_CREDITS: '8', DAILY_CREDITS: '50', USAGE_PER_SLIDE_UNITS: '8000' }, encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const { quoteModel } = require('../../src/backend/http/middleware/generation-credits');
    assert.equal(quoteModel(MODEL_CATALOG['google/gemini-3-flash-preview'], 15, 15, 'pro'), 48000);
});

test('current decision/review tables exactly match executable prices, slide maxima and daily percentages', () => {
    const labels = { gemini: 'Gemini', anthropic: 'Haiku', openai: 'GPT', nvidia: 'Nemotron' };
    const number = value => Number(value.toFixed(4));
    for (const file of ['docs/DECISIONS-BLOQUE-2.md', 'docs/FINAL-REVIEW.md']) {
        const content = fs.readFileSync(path.join(root, file), 'utf8');
        for (const model of Object.values(MODEL_CATALOG)) {
            const prices = model.usagePerSlideUnits;
            const flash = prices.flash * model.maxSlides.flash;
            const pro = prices.pro * model.maxSlides.pro;
            const expected = `| ${labels[model.brand]} | ${prices.flash / UNITS_PER_CREDIT} | ${prices.pro / UNITS_PER_CREDIT}`
                + ` | ${number(flash / UNITS_PER_CREDIT)} créditos · ${number(flash / DAILY_USAGE_UNITS * 100)}%`
                + ` | ${number(pro / UNITS_PER_CREDIT)} créditos · ${number(pro / DAILY_USAGE_UNITS * 100)}% |`;
            assert.ok(content.includes(expected), `${file} is inconsistent for ${model.id}`);
        }
    }
});

test('documented environment example preserves safe executable budget defaults', () => {
    const defaults = spendConfig({});
    const sample = spendConfig(parse(fs.readFileSync(path.join(root, '.env.example'))));
    for (const field of ['dailyUsd', 'monthlyUsd', 'perIpDailyUsd', 'maxRequestReservationUsd',
        'reservationMargin', 'maxRequestDurationMs']) assert.equal(sample[field], defaults[field], field);
    assert.ok(defaults.maxRequestReservationUsd <= defaults.perIpDailyUsd);
    assert.ok(defaults.perIpDailyUsd <= defaults.dailyUsd, 'The per-IP daily cap must not exceed the global daily cap.');
    assert.ok(defaults.maxRequestReservationUsd <= defaults.dailyUsd, 'The per-request reservation must not exceed the global daily cap.');
});
