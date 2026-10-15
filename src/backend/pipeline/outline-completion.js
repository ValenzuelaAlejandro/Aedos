'use strict';

const { buildStage1CompletionPrompt } = require('../prompts/stage1-content');
const { countTokens } = require('../config/usage-policy');

// eslint-disable-next-line complexity -- One reader owns reset, metadata, usage and live content semantics for a single attempt.
async function readModelResult(result, onChunk, prompt = '') {
    let text = '', usage = null;
    for await (const item of result.stream) {
        if (item?.type === 'reset') { text = ''; onChunk?.({ type: 'reset', stage: 'stage1', attempt: item.attempt }); continue; }
        if (item?.type === 'metadata') continue;
        if (item?.type === 'usage') { usage = item.usage || null; continue; }
        if (item?.type === 'reasoning') { onChunk?.(item); continue; }
        const chunk = typeof item === 'string' ? item : item?.text;
        if (typeof chunk === 'string') { text += chunk; onChunk?.({ type: 'content', text: chunk }); }
    }
    if (!text.trim()) throw new Error('STAGE_EMPTY_OUTPUT');
    return { text, inputTokens: usage?.inputTokens ?? countTokens(prompt),
        outputTokens: usage?.outputTokens ?? countTokens(text), estimated: !usage?.reported };
}

// eslint-disable-next-line complexity -- Bounded repair rounds keep slide-index validation and token-budget settlement atomic.
async function completeOutlineSlides({ contentJson, requestedSlides, rawInput, targetLanguage, callModel,
    fileContext, extractJson, selectedModel, onChunk = null, onUsage = null, tokenBudget = null, maxRounds = 2 }) {
    if (!Array.isArray(contentJson?.slides)) throw new Error('STAGE1_INVALID: missing slides');
    let slides = contentJson.slides.slice(0, requestedSlides).map((slide, index) => ({ ...slide, index: index + 1 }));
    for (let round = 0; round < maxRounds && slides.length < requestedSlides; round += 1) {
        const present = new Set(slides.map(slide => slide.index));
        const missing = Array.from({ length: requestedSlides }, (_, i) => i + 1).filter(index => !present.has(index));
        const prompt = buildStage1CompletionPrompt(rawInput, slides, missing, targetLanguage);
        const promptTokens = countTokens(prompt);
        const remainingInput = tokenBudget ? tokenBudget.inputTokens - tokenBudget.usedInputTokens : Infinity;
        const remainingOutput = tokenBudget ? tokenBudget.outputTokens - tokenBudget.usedOutputTokens : Infinity;
        if (promptTokens > remainingInput || promptTokens > 12_288 || remainingOutput < 1) throw new Error('CHAT_CONTEXT_LIMIT');
        const result = await callModel(prompt, fileContext, { selectedModel, expectedOutput: 'outline',
            expectedSlides: missing.length, maxOutputTokens: Math.min(remainingOutput, 4096) });
        const completed = await readModelResult(result, onChunk, prompt);
        const parsed = extractJson(completed.text);
        if (!Array.isArray(parsed?.slides)) continue;
        const missingSet = new Set(missing);
        const candidates = parsed.slides.filter(slide => missingSet.has(Number(slide?.index)));
        const normalized = candidates.length
            ? candidates.map(slide => ({ ...slide, index: Number(slide.index) }))
            : parsed.slides.slice(0, missing.length).map((slide, index) => ({ ...slide, index: missing[index] }));
        const byIndex = new Map(slides.map(slide => [slide.index, slide]));
        for (const slide of normalized) if (!byIndex.has(slide.index)) byIndex.set(slide.index, slide);
        const nextSlides = [...byIndex.values()].sort((a, b) => a.index - b.index);
        if (nextSlides.length > slides.length) {
            if (tokenBudget && (tokenBudget.usedInputTokens + completed.inputTokens > tokenBudget.inputTokens
                || tokenBudget.usedOutputTokens + completed.outputTokens > tokenBudget.outputTokens)) throw new Error('CHAT_CONTEXT_LIMIT');
            tokenBudget?.record?.(completed);
            onUsage?.(completed);
        }
        slides = nextSlides;
    }
    if (slides.length !== requestedSlides) throw new Error(`STAGE1_INCOMPLETE: expected ${requestedSlides} outline slides, received ${slides.length}`);
    return { ...contentJson, slide_count: requestedSlides, slides };
}

module.exports = { completeOutlineSlides, readModelResult };
