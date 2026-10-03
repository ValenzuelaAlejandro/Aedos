(function registerGenerationStore(global) {
    'use strict';

    /** @typedef {{ activeController: AbortController | null, skeletonController: AbortController | null, heroCustomTextActive: boolean, proModeEnabled: boolean, targetLanguage: string, requestedExportFormat: string, sequence: number, activeGeneration: object | null, attachedFiles: File[] | undefined, backupSkeleton: object | undefined, pendingBodyData: BodyInit | undefined, pendingHeaders: HeadersInit | undefined }} GenerationState */

    /** @type {GenerationState} */
    const state = {
        activeController: null,
        skeletonController: null,
        heroCustomTextActive: false,
        proModeEnabled: false,
        targetLanguage: 'auto',
        requestedExportFormat: 'pdf',
        sequence: 0,
        activeGeneration: null,
        attachedFiles: undefined,
        backupSkeleton: undefined,
        pendingBodyData: undefined,
        pendingHeaders: undefined
    };

    global.AedosStores = global.AedosStores || {};
    global.AedosStores.generation = Object.freeze({ state });

    const compatibilityProperties = {
        _activeGenController: 'activeController',
        _attachedFiles: 'attachedFiles',
        _backupSkeleton: 'backupSkeleton',
        _pendingGenerateBodyData: 'pendingBodyData',
        _pendingGenerateHeaders: 'pendingHeaders'
    };

    Object.entries(compatibilityProperties).forEach(([property, key]) => {
        Object.defineProperty(global, property, {
            configurable: true,
            enumerable: true,
            get: () => state[key],
            set: (value) => { state[key] = value; }
        });
    });
})(window);
