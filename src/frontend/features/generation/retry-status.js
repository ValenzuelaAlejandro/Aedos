(function registerRetryStatus(global) {
    'use strict';
    const words = {
        es: { retry: 'Reintentando...', outline: 'Creando esquema…', slides: 'Generando presentación…', analyze: 'Analizando contenido…' },
        en: { retry: 'Retrying...', outline: 'Building your outline…', slides: 'Generating presentation…', analyze: 'Analyzing content…' },
        fr: { retry: 'Nouvelle tentative...', outline: 'Création du plan…', slides: 'Génération de la présentation…', analyze: 'Analyse du contenu…' },
        pt: { retry: 'Tentando novamente...', outline: 'Criando estrutura…', slides: 'Gerando apresentação…', analyze: 'Analisando conteúdo…' },
        de: { retry: 'Erneuter Versuch...', outline: 'Gliederung wird erstellt…', slides: 'Präsentation wird erstellt…', analyze: 'Inhalt wird analysiert…' },
        it: { retry: 'Nuovo tentativo...', outline: 'Creazione della struttura…', slides: 'Generazione della presentazione…', analyze: 'Analisi del contenuto…' },
        zh: { retry: '正在重试...', outline: '正在创建大纲…', slides: '正在生成演示文稿…', analyze: '正在分析内容…' },
        ja: { retry: '再試行中...', outline: '構成を作成中…', slides: 'プレゼンテーションを生成中…', analyze: '内容を分析中…' },
        ru: { retry: 'Повторная попытка...', outline: 'Создание плана…', slides: 'Создание презентации…', analyze: 'Анализ содержания…' },
        ar: { retry: 'جارٍ إعادة المحاولة...', outline: 'جارٍ إنشاء المخطط…', slides: 'جارٍ إنشاء العرض التقديمي…', analyze: 'جارٍ تحليل المحتوى…' }
    };
    function text(code, key) { return (words[code] || words.en)[key]; }
    function language(state, emitted) {
        return state.targetLanguage && state.targetLanguage !== 'auto' ? state.targetLanguage : emitted || global.currentLang || 'en';
    }
    /** A retry changes only the existing status text, until new content arrives. */
    function create({ getLanguage, normal = 'outline', setText }) {
        let retrying = false;
        return {
            reset() { retrying = true; setText(text(getLanguage(), 'retry')); },
            content() { if (retrying) { retrying = false; setText(text(getLanguage(), normal)); } },
            get retrying() { return retrying; }
        };
    }
    /** Dispose the failed iframe and pending writes; late messages retain its old source. */
    function resetPreview({ previewState, previewMarkupBuffer, previewContainer, document, setTimeout, clearTimeout }) {
        previewMarkupBuffer.clearTimer();
        previewMarkupBuffer.markClosed();
        const old = previewState.previewIframe;
        const fresh = old.cloneNode();
        old.parentNode.replaceChild(fresh, old);
        previewState.previewIframe = fresh;
        previewState.generatedHtml = '';
        previewState.totalSlides = 0;
        previewState.currentSlide = 0;
        for (const id of ['minimap-list', 'slide-dots']) document.getElementById(id)?.replaceChildren();
        previewContainer.classList.add('is-awaiting-first-slide');
        const iframeDoc = fresh.contentDocument || fresh.contentWindow.document;
        return { iframeDoc, previewMarkupBuffer: global.AedosPreview.createPreviewMarkupBuffer({ iframeDoc, setTimeout, clearTimeout }) };
    }
    global.AedosStreamRetry = { text, language, create, resetPreview };
})(window);
