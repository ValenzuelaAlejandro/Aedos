(function registerModelCatalog(global) {
    'use strict';

    const catalog = [
        {
            id: 'google/gemini-3-flash-preview',
            apiModelId: 'gemini-3-flash-preview',
            name: 'Gemini 3 Flash',
            descriptionKey: 'models.gemini3Flash.description',
            provider: 'Google',
            brand: 'gemini',
            tier: 'free',
            billing: 'perSlide',
            usagePerSlideUnits: { flash: 1600, pro: 3200 },
            paid: false,
            modes: ['flash', 'pro'],
            maxSlides: { flash: 8, pro: 15 },
        },
        {
            id: 'nvidia/nemotron-3.5-lightning',
            name: 'Nemotron 3.5 Lightning',
            descriptionKey: 'models.nemotron35Lightning.description',
            provider: 'OpenRouter',
            brand: 'nvidia',
            tier: 'light',
            billing: 'perSlide',
            usagePerSlideUnits: { flash: 800, pro: 1600 },
            paid: true,
            modes: ['flash', 'pro'],
            maxSlides: { flash: 8, pro: 15 },
        },
        {
            id: 'openai/gpt-6-luna',
            name: 'GPT-6 Luna',
            descriptionKey: 'models.gpt6Luna.description',
            provider: 'OpenAI',
            brand: 'openai',
            tier: 'standard',
            billing: 'perSlide',
            usagePerSlideUnits: { flash: 1200, pro: 2400 },
            paid: true,
            modes: ['flash', 'pro'],
            maxSlides: { flash: 8, pro: 15 },
        },
        {
            id: 'anthropic/claude-haiku-5.5',
            name: 'Claude Haiku 5.5',
            descriptionKey: 'models.claudeHaiku55.description',
            provider: 'Anthropic',
            brand: 'anthropic',
            tier: 'standard',
            billing: 'perSlide',
            usagePerSlideUnits: { flash: 1200, pro: 2400 },
            paid: true,
            modes: ['flash', 'pro'],
            maxSlides: { flash: 8, pro: 15 },
        },
    ];

    global.MAX_SLIDES_BY_MODE = Object.freeze({ flash: 8, pro: 15 });
    // Pure ranges based on the active mode's maximum, never on the credit balance.
    global.getSlideZones = function getSlideZones(max) {
        const limit = Math.max(1, Math.floor(Number(max) || 1));
        if (limit === 1) return [];
        if (limit === 2) return [{ key: 'short', start: 1, end: 1 }, { key: 'full', start: 2, end: 2 }];
        const first = Math.ceil(limit / 3);
        const second = Math.ceil(2 * limit / 3);
        return [
            { key: 'short', start: 1, end: first },
            { key: 'balanced', start: first + 1, end: second },
            { key: 'full', start: second + 1, end: limit },
        ];
    };
    global.MODEL_CATALOG = Object.freeze(catalog.map(model => Object.freeze(model)));
})(typeof window !== 'undefined' ? window : globalThis);
