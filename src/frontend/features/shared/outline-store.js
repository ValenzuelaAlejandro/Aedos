(function registerOutlineStore(global) {
    'use strict';

    /** @typedef {{ skeleton: object | null, mode: string, maxSlides: number, isLoading: boolean, activeContainer: Element | null }} OutlineState */

    /** @returns {OutlineState} */
    function createInitialState() {
        return {
            skeleton: null,
            mode: 'flash',
            maxSlides: 15,
            isLoading: false,
            activeContainer: null
        };
    }

    let state = createInitialState();

    const store = Object.freeze({
        /** @returns {OutlineState} */
        getState() {
            return state;
        },
        /** @param {OutlineState} nextState */
        replaceState(nextState) {
            state = nextState;
            return state;
        },
        /** @returns {OutlineState} */
        clearDraft() {
            state.skeleton = null;
            state.isLoading = false;
            return state;
        }
    });

    global.AedosStores = global.AedosStores || {};
    global.AedosStores.outline = store;

    // Keep the writable legacy property as a compatibility facade.
    Object.defineProperty(global, 'outlineEditorState', {
        configurable: true,
        enumerable: true,
        get: store.getState,
        set: store.replaceState
    });
})(window);
