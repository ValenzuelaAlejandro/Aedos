(function registerModelCatalog(global) {
    'use strict';

    const catalog = [
        {
            id: 'google/gemini-3-flash-preview',
            apiModelId: 'gemini-3-flash-preview',
            name: 'Gemini 3 Flash',
            provider: 'Google',
            icon: '✨',
            tier: 'free',
            creditsPerSlide: 3,
            paid: false,
            modes: ['flash', 'pro'],
        },
        {
            id: 'apodex/apodex-1.1-mini:free',
            name: 'Apodex 1.1 Mini',
            provider: 'OpenRouter',
            icon: '🧠',
            tier: 'free',
            creditsPerSlide: 3,
            paid: false,
            modes: ['flash', 'pro'],
        },
        {
            id: 'dots-studio/dots-3-note-preview:free',
            name: 'Dots 3 Note Preview',
            provider: 'OpenRouter',
            icon: '🟣',
            tier: 'free',
            creditsPerSlide: 3,
            paid: false,
            modes: ['flash', 'pro'],
        },
        {
            id: 'nvidia/nemotron-3.5-lightning',
            name: 'Nemotron 3.5 Lightning',
            provider: 'NVIDIA',
            icon: '⚡',
            tier: 'light',
            creditsPerSlide: 4,
            paid: true,
            modes: ['flash', 'pro'],
        },
        {
            id: 'openai/gpt-6-luna',
            name: 'GPT-6 Luna',
            provider: 'OpenAI',
            icon: '🌙',
            tier: 'standard',
            creditsPerSlide: 6,
            paid: true,
            modes: ['flash', 'pro'],
        },
        {
            id: 'anthropic/claude-haiku-5.5',
            name: 'Claude Haiku 5.5',
            provider: 'Anthropic',
            icon: '🍃',
            tier: 'standard',
            creditsPerSlide: 6,
            paid: true,
            modes: ['flash', 'pro'],
        },
    ];

    global.MODEL_CATALOG = Object.freeze(catalog.map(model => Object.freeze(model)));
})(typeof window !== 'undefined' ? window : globalThis);
