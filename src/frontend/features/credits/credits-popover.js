(function registerCreditsPopover(global) {
    'use strict';

    function init() {
        const trigger = global.document.getElementById('credits-balance-trigger');
        const popover = global.document.getElementById('credits-popover');
        if (!trigger || !popover) return;
        const close = () => { popover.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
        trigger.addEventListener('click', event => {
            event.stopPropagation();
            const slidePanel = global.document.getElementById('slide-count-panel');
            if (slidePanel) slidePanel.hidden = true;
            global.document.getElementById('slide-count-trigger')?.setAttribute('aria-expanded', 'false');
            global.document.querySelectorAll('.dropdown-menu').forEach(menu => menu.classList.add('hidden'));
            global.document.querySelectorAll('.dropdown-container > button[aria-expanded]').forEach(button => button.setAttribute('aria-expanded', 'false'));
            popover.hidden = !popover.hidden;
            trigger.setAttribute('aria-expanded', String(!popover.hidden));
        });
        popover.addEventListener('click', event => event.stopPropagation());
        global.document.addEventListener('click', close);
        global.document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    }

    global.AedosCreditsPopover = Object.freeze({ init });
})(window);
