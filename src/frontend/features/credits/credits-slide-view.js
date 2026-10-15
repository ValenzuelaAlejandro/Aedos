(function registerCreditsSlideView(global) {
    'use strict';

    function renderTicks(limit, affordable, normalized) {
        const ticks = global.document.getElementById('slide-count-ticks');
        if (!ticks) return;
        const cuts = new Set(global.getSlideZones(limit).slice(0, -1).map(entry => entry.end));
        const marks = [];
        for (let n = 1; n <= limit; n++) {
            const tick = global.document.createElement('span');
            tick.className = 'slide-count-tick';
            tick.style.setProperty('--tick-height', `${6 + 12 * ((n - 1) / Math.max(1, limit - 1)) + (n % 5 === 0 ? 3 : 0)}px`);
            if (n <= normalized) tick.classList.add('is-active');
            if (n > limit || n > affordable) tick.classList.add('is-disabled');
            if (cuts.has(n)) tick.classList.add('is-zone-end');
            if (n === 1 || n % 5 === 0 || n === limit) {
                const label = global.document.createElement('small');
                label.textContent = String(n);
                tick.append(label);
            }
            marks.push(tick);
        }
        ticks.replaceChildren(...marks);
    }

    global.AedosCreditsSlideView = Object.freeze({ renderTicks });
})(window);
