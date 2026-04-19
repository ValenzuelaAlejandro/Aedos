(function initBrowserLogger(global) {
    const LEVEL_PRIORITY = {
        debug: 10,
        info: 20,
        success: 20,
        warn: 30,
        error: 40
    };

    const LEVEL_STYLE = {
        debug: { label: 'DEBUG', icon: '[.]', color: '#5f6b7a' },
        info: { label: 'INFO ', icon: '[i]', color: '#1f78ff' },
        success: { label: 'OK   ', icon: '[+]', color: '#1f9d4c' },
        warn: { label: 'WARN ', icon: '[!]', color: '#a56a00' },
        error: { label: 'ERROR', icon: '[x]', color: '#c62828' }
    };

    function resolveMethod(level) {
        if (level === 'warn') return 'warn';
        if (level === 'error') return 'error';
        return 'log';
    }

    function createLogger(options = {}) {
        const scope = options.scope || 'UI';
        const minLevel = options.minLevel || 'debug';
        const threshold = LEVEL_PRIORITY[minLevel] || LEVEL_PRIORITY.debug;

        function emit(level, category, message, meta) {
            if ((LEVEL_PRIORITY[level] || LEVEL_PRIORITY.info) < threshold) return;

            const style = LEVEL_STYLE[level] || LEVEL_STYLE.info;
            const timestamp = new Date().toISOString();
            const token = `${style.icon} ${style.label}`;
            const cat = category || 'GENERAL';
            const prefix = `${timestamp} ${token} [${scope}] [${cat}] ${message}`;
            const css = `color:${style.color};font-weight:600`;
            const method = resolveMethod(level);

            if (meta !== undefined) {
                console[method](`%c${prefix}`, css, meta);
                return;
            }

            console[method](`%c${prefix}`, css);
        }

        return {
            child(childScope) {
                return createLogger({ scope: `${scope}:${childScope}`, minLevel });
            },
            debug(category, message, meta) { emit('debug', category, message, meta); },
            info(category, message, meta) { emit('info', category, message, meta); },
            success(category, message, meta) { emit('success', category, message, meta); },
            warn(category, message, meta) { emit('warn', category, message, meta); },
            error(category, message, meta) { emit('error', category, message, meta); }
        };
    }

    global.BrowserLogger = {
        createLogger
    };
})(window);