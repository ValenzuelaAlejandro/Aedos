const test = require('node:test');
const assert = require('node:assert/strict');

const { extractJson, repairJsonEscapes } = require('../src/backend/prompts/json-extraction');
const enrichSkeletonForStage2 = require('../src/backend/prompts/skeleton-enrichment');
const { runContentStageWithRetry } = require('../src/backend/prompts/stage-runner');

test('JSON extraction keeps fenced/prose handling and repairs invalid string escapes', () => {
  assert.deepEqual(extractJson('prefix ```json\n{"ok":true}\n``` suffix'), { ok: true });
  assert.deepEqual(extractJson(String.raw`{"path":"C:\Users\Alan"}`), { path: 'C:\\Users\\Alan' });
  assert.equal(repairJsonEscapes('{"line":"a\nb"}'), '{"line":"a\\nb"}');
});

test('skeleton enrichment preserves defaults and edited slide fields for Stage 2', () => {
  const result = enrichSkeletonForStage2({
    density: 'high',
    slides: [{ title: 'Edited title', key_points: ['one', '', 'two'] }]
  }, 'Original topic');

  assert.equal(result.topic, 'Original topic');
  assert.equal(result.text_density, 'high');
  assert.equal(result.slide_count, 1);
  assert.equal(result.slides[0].title, 'Edited title');
  assert.deepEqual(result.slides[0].key_points, ['one', 'two']);
  assert.equal(result.slides[0].weight, 'anchor');
});

test('retry helper preserves permanent quota errors without retrying', async () => {
  let calls = 0;
  await assert.rejects(runContentStageWithRetry({
    task: async () => {
      calls++;
      throw new Error('QUOTA_EXHAUSTED');
    },
    maxRetries: 2,
    stageName: 'Stage 1',
    stageKey: 'stage1',
    onStageUpdate: () => assert.fail('permanent quota error must not emit retry state')
  }), /QUOTA_EXHAUSTED/);
  assert.equal(calls, 1);
});
