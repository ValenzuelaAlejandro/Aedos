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
            id: 'apodex/apodex-1.1-mini:free',
            name: 'Apodex 1.1 Mini',
            provider: 'Apodex',
            brand: 'apodex',
            tier: 'free',
            billing: 'perSlide',
            creditsPerSlide: 1,
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

    global.MODE_SLIDE_LIMIT = Object.freeze({ flash: 15, pro: 8 });
    global.MODEL_CATALOG = Object.freeze(catalog.map(model => Object.freeze(model)));
})(typeof window !== 'undefined' ? window : globalThis);
