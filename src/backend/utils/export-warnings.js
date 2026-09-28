const EXPORT_WARNING_TYPES = new Set([
    'font-substitution', 'gradient-fallback', 'shadow-fallback', 'filter-fallback',
    'opacity-group', 'radius-approx', 'border-fallback', 'overflow-clipping', 'position-fallback',
    'visibility-fallback', 'pseudo-fallback', 'pseudo-unsupported', 'image-load-failed',
    'image-size-limit', 'table-fallback', 'contract-violation'
]);

function normalizeExportWarning(warning = {}, slide = warning.slide || 0) {
    const tipo = EXPORT_WARNING_TYPES.has(warning.tipo) ? warning.tipo : 'contract-violation';
    return {
        slide: Number(slide) || 0,
        selector: String(warning.selector || warning.asset || 'export'),
        tipo,
        motivo: String(warning.motivo || warning.reason || 'unsupported export feature'),
        fallback: String(warning.fallback || 'continue with best-effort export'),
        ...(warning.de ? { de: warning.de } : {}),
        ...(warning.a ? { a: warning.a } : {})
    };
}

function dedupeExportWarnings(warnings = []) {
    const seen = new Set();
    return warnings.map(warning => normalizeExportWarning(warning)).filter(warning => {
        const key = `${warning.slide}|${warning.selector}|${warning.tipo}|${warning.motivo}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function countExportWarnings(warnings = []) {
    return warnings.reduce((counts, warning) => {
        counts[warning.tipo] = (counts[warning.tipo] || 0) + 1;
        return counts;
    }, {});
}

module.exports = { EXPORT_WARNING_TYPES, normalizeExportWarning, dedupeExportWarnings, countExportWarnings };
