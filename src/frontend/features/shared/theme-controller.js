(function registerThemeController(global) {
    'use strict';

    /**
     * @typedef {object} ThemePreviewState
     * @property {HTMLIFrameElement|null} previewIframe
     */

    /** Installs the page and preview theme controls with the legacy behavior. */
    function initialize(previewState) {
        const root = document.documentElement;
        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        const previewThemeToggleBtn = document.getElementById('preview-theme-toggle-btn');

        function applyTheme(theme, animate = false, event = null) {
            const nextTheme = theme === 'light' ? 'light' : 'dark';

            const doChange = () => {
                root.setAttribute('data-theme', nextTheme);
                localStorage.setItem('app_theme', nextTheme);
                const title = (typeof global.__t === 'function')
                    ? global.__t('theme_toggle')
                    : 'Toggle theme';
                if (themeToggleBtn) {
                    themeToggleBtn.setAttribute('aria-label', title);
                }
                if (previewThemeToggleBtn) {
                    previewThemeToggleBtn.setAttribute('aria-label', title);
                }
                // Propagate theme into live preview iframe (if present)
                try {
                    const doc = previewState.previewIframe && (previewState.previewIframe.contentDocument || (previewState.previewIframe.contentWindow && previewState.previewIframe.contentWindow.document));
                    if (doc && doc.documentElement) {
                        doc.documentElement.setAttribute('data-theme', nextTheme);
                    }
                } catch (e) {
                    // ignore cross-origin or not-yet-ready iframe
                }
            };

            if (!animate || !document.startViewTransition) {
                doChange();
                return;
            }

            document.documentElement.classList.add('theme-transitioning');
            const transition = document.startViewTransition(() => {
                doChange();
            });

            transition.ready.then(() => {
                const x = event ? event.clientX : global.innerWidth / 2;
                const y = event ? event.clientY : global.innerHeight / 2;

                // Calculate distance to the furthest corner to ensure full coverage
                const endRadius = Math.hypot(
                    Math.max(x, global.innerWidth - x),
                    Math.max(y, global.innerHeight - y)
                ) + 60; // Extra buffer for mobile toolbars

                document.documentElement.animate(
                    {
                        clipPath: [
                            `circle(0px at ${x}px ${y}px)`,
                            `circle(${endRadius}px at ${x}px ${y}px)`
                        ]
                    },
                    {
                        duration: 700,
                        easing: "cubic-bezier(0.25, 1, 0.5, 1)",
                        pseudoElement: "::view-transition-new(root)"
                    }
                );
            });

            transition.finished.then(() => {
                document.documentElement.classList.remove('theme-transitioning');
            });
        }

        const savedTheme = localStorage.getItem('app_theme') || 'dark';
        applyTheme(savedTheme);

        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', (e) => {
                const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
                applyTheme(current === 'light' ? 'dark' : 'light', true, e);
            });
        }
        if (previewThemeToggleBtn) {
            previewThemeToggleBtn.addEventListener('click', (e) => {
                const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
                applyTheme(current === 'light' ? 'dark' : 'light', true, e);
            });
        }
    }

    global.AedosThemeController = Object.freeze({ initialize });
})(window);
