(function registerModelCatalog(global) {
    'use strict';

    const catalog = [
        {
            id: 'google/gemini-3-flash-preview',
            apiModelId: 'gemini-3-flash-preview',
            name: 'Gemini 3 Flash',
            provider: 'Google',
            brand: 'gemini',
            tier: 'free',
            billing: 'perPresentation',
            creditsPerPresentation: 10,
            paid: false,
            modes: ['flash', 'pro'],
        },
        {
            id: 'nvidia/nemotron-3.5-lightning',
            name: 'Nemotron 3.5 Lightning',
            provider: 'NVIDIA',
            brand: 'nvidia',
            tier: 'light',
            billing: 'perSlide',
            creditsPerSlide: 2,
            paid: true,
            modes: ['flash', 'pro'],
            maxSlides: { flash: 8, pro: 8 },
        },
        {
            id: 'openai/gpt-6-luna',
            name: 'GPT-6 Luna',
            provider: 'OpenAI',
            brand: 'openai',
            tier: 'standard',
            billing: 'perSlide',
            creditsPerSlide: 3,
            paid: true,
            modes: ['flash', 'pro'],
        },
        {
            id: 'anthropic/claude-haiku-5.5',
            name: 'Claude Haiku 5.5',
            provider: 'Anthropic',
            brand: 'anthropic',
            tier: 'standard',
            billing: 'perSlide',
            creditsPerSlide: 3,
            paid: true,
            modes: ['flash', 'pro'],
        },
    ];

    global.MAX_SLIDES_BY_MODE = Object.freeze({ flash: 15, pro: 8 });
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
