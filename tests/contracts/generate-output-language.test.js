'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureDocumentLanguage } = require('../../src/backend/http/routes/generate-output');

test('HTML language is normalized to the requested supported language', () => {
    assert.equal(ensureDocumentLanguage('<html><body></body></html>', 'es'), '<html lang="es"><body></body></html>');
    assert.equal(ensureDocumentLanguage('<html lang=""><body></body></html>', 'en'), '<html lang="en"><body></body></html>');
    assert.equal(ensureDocumentLanguage('<html lang="fr" dir="ltr"><body></body></html>', 'es'), '<html dir="ltr" lang="es"><body></body></html>');
});
