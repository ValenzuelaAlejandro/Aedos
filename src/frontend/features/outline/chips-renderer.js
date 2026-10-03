(function registerOutlineChipsRenderer(global) {
    'use strict';

    /** @typedef {{ text: string, prompt?: string, primary?: boolean, action?: string }} SuggestedChip */
    /** @typedef {{ translate: (key: string, fallback: string) => string }} ChipDependencies */

    /**
     * @param {{ slides?: unknown[], language?: string, suggested_chips?: string[] }} skeletonData
     * @param {ChipDependencies['translate']} translate
     * @returns {SuggestedChip[]}
     */
    function createSuggestedChips(skeletonData, translate) {
        const isEnglish = (skeletonData.language || 'es').toLowerCase().startsWith('en');
        if (Array.isArray(skeletonData.suggested_chips) && skeletonData.suggested_chips.length > 0) {
            const chips = skeletonData.suggested_chips.slice(0, 2).map((chipText) => ({
                text: chipText,
                prompt: chipText,
            }));
            chips.push({
                text: translate('chip_fallback_generate_text', isEnglish ? 'Looks good! Create presentation' : 'Todo listo! Crear presentación'),
                primary: true,
                action: 'generate',
            });
            return chips;
        }

        return [
            {
                text: translate('chip_fallback_add_slide_text', 'Añadir diapositiva relevante'),
                prompt: translate('chip_fallback_add_slide_prompt', 'Sugiéreme y añade una nueva diapositiva relevante y lógica al esquema actual'),
            },
            {
                text: translate('chip_fallback_explain_text', 'Explicar con más detalle'),
                prompt: translate('chip_fallback_explain_prompt', 'Haz que los puntos clave de las diapositivas sean más detallados, informativos y descriptivos'),
            },
            {
                text: translate('chip_fallback_generate_text', 'Todo listo! Crear presentación'),
                primary: true,
                action: 'generate',
            },
        ];
    }

    /**
     * @param {HTMLButtonElement} button
     * @param {SuggestedChip} chip
     * @param {ChipDependencies} dependencies
     */
    function bindChipAction(button, chip, dependencies) {
        button.addEventListener('click', () => {
            if (chip.action === 'generate') {
                dependencies.proceed();
                return;
            }
            dependencies.submitPrompt(chip);
        });
    }

    /**
     * Recreates the delayed suggested-chip row while leaving app actions injectable.
     * @param {HTMLElement} chipsContainer
     * @param {{ slides?: unknown[], language?: string, suggested_chips?: string[] } | null} skeletonData
     * @param {ChipDependencies & {
     *   previousTimeout: number | ReturnType<typeof setTimeout>,
     *   rememberTimeout: (timeout: ReturnType<typeof setTimeout>) => void,
     * }} dependencies
     */
    function renderSuggestedChips(chipsContainer, skeletonData, dependencies) {
        chipsContainer.innerHTML = '';
        if (dependencies.previousTimeout) global.clearTimeout(dependencies.previousTimeout);

        if (!skeletonData || !Array.isArray(skeletonData.slides) || skeletonData.slides.length === 0) return;

        const suggestedChips = createSuggestedChips(skeletonData, dependencies.translate);
        const timeout = global.setTimeout(() => {
            if (!global.document.body.contains(chipsContainer)) return;
            chipsContainer.innerHTML = '';

            suggestedChips.forEach((chip, index) => {
                const button = global.document.createElement('button');
                button.className = `suggested-chip ${chip.primary ? 'chip-primary' : ''}`;
                button.type = 'button';
                button.innerHTML = chip.text;
                bindChipAction(button, chip, dependencies);
                chipsContainer.appendChild(button);

                if (dependencies.animate) dependencies.animate(button, index);
            });
        }, 1000);
        dependencies.rememberTimeout(timeout);
    }

    global.AedosOutlineChipsRenderer = Object.freeze({ renderSuggestedChips });
})(window);
