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

    const store = Object.freeze({ state });
    global.AedosStores = global.AedosStores || {};
    global.AedosStores.generation = store;

    const legacyProperties = {
        _activeGenController: 'activeController',
        _attachedFiles: 'attachedFiles',
        _backupSkeleton: 'backupSkeleton',
        _pendingGenerateBodyData: 'pendingBodyData',
        _pendingGenerateHeaders: 'pendingHeaders'
    };

    for (const [property, key] of Object.entries(legacyProperties)) {
        const descriptor = {
            get: () => state[key],
            set: (value) => { state[key] = value; }
        };
        if (property !== '_activeGenController') {
            descriptor.configurable = true;
            descriptor.enumerable = true;
        }
        Object.defineProperty(global, property, descriptor);
    }
})(window);
