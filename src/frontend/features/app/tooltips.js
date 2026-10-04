/** @typedef {{initialize: () => void}} AedosAppTooltips */

(function installAedosAppTooltips(global) {
    /** Register delegated tooltip handlers at the same app-bootstrap point. */
    function initialize() {
        const tip = document.getElementById('js-tooltip');
        if (!tip) return;

        const MARGIN = 8;
        const GAP = 10;

        function showTip(trigger) {
            const text = trigger.dataset.tooltip;
            if (!text) return;
            tip.textContent = text;
            tip.style.left = '0';
            tip.style.top = '0';
            const tr = trigger.getBoundingClientRect();
            const tw = tip.offsetWidth;
            const th = tip.offsetHeight;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const preferAbove = trigger.classList.contains('btn-mode-toggle');
            const spaceAbove = tr.top;
            const spaceBelow = vh - tr.bottom;
            let top;
            if (preferAbove) {
                top = spaceAbove >= th + GAP ? tr.top - th - GAP : tr.bottom + GAP;
            } else {
                top = spaceBelow >= th + GAP ? tr.bottom + GAP : tr.top - th - GAP;
            }
            let left = tr.left + tr.width / 2 - tw / 2;
            left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));
            tip.style.top = top + 'px';
            tip.style.left = left + 'px';
            tip.classList.add('visible');
        }

        function hideTip() {
            tip.classList.remove('visible');
        }

        document.addEventListener('mouseover', function (e) {
            const trigger = e.target.closest('[data-tooltip]');
            if (trigger && trigger.dataset.tooltip && !trigger.disabled) showTip(trigger);
        });
        document.addEventListener('mouseout', function (e) {
            const trigger = e.target.closest('[data-tooltip]');
            if (trigger) hideTip();
        });
        document.addEventListener('mousedown', hideTip);
        document.addEventListener('scroll', hideTip, true);
    }

    /** @type {AedosAppTooltips} */
    global.AedosAppTooltips = Object.freeze({ initialize });
})(window);
