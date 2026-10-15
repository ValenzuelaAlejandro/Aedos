const translations = window.AedosTranslations;

window.currentLang = navigator.language.startsWith('es') ? 'es' : 'en';

window.__t = function (key, defaultText = null) {
    let result = key;
    if (translations[window.currentLang] && translations[window.currentLang][key]) {
        result = translations[window.currentLang][key];
    } else if (translations['en'][key]) {
        result = translations['en'][key];
    } else if (defaultText !== null) {
        result = defaultText;
    }
    return result;
};

function applyI18nToDom() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.innerHTML = window.__t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const text = window.__t(key);
        el.setAttribute('data-tooltip', text);
        el.removeAttribute('title'); // Prevent native browser tooltips which cause flicker
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = window.__t(key);
    });
    document.querySelectorAll('[data-i18n-val]').forEach(el => {
        const key = el.getAttribute('data-i18n-val');
        el.value = window.__t(key);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        el.setAttribute('aria-label', window.__t(el.getAttribute('data-i18n-aria-label')));
    });
}



window.__applyTranslations = applyI18nToDom;
window.__setUiLanguage = function (language) {
    if (!translations[language]) return;
    window.currentLang = language;
    document.documentElement.lang = language;
    applyI18nToDom();
    window.dispatchEvent(new CustomEvent('aedos:language-changed', { detail: { language } }));
};

// Initialize DOM elements with translations
document.addEventListener('DOMContentLoaded', () => {
    applyI18nToDom();
});
