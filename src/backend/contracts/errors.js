/** Error catalog for the current HTTP and SSE contracts. */

const ERROR_TEXT = Object.freeze({
    QUEUE_FULL_GENERATION: 'The generation queue is full. Please try again in a few seconds.',
    QUEUE_FULL_FINALIZE: 'The PDF generation server is at capacity. Please try again in a few seconds.',
    PRO_TEMPORARILY_PAUSED: 'Pro mode is temporarily paused due to high system load. Please retry shortly or use Flash mode.',
    INVALID_ITEM_TYPE: 'Invalid item type',
    OUTLINE_FAILED: 'Failed to generate outline. Please try again.',
    ITEM_FAILED: 'Failed to generate item. Please try again.',
    API_KEY_MISSING: 'API Key is not configured in .env',
    SKELETON_EMPTY: 'SKELETON_EMPTY: The outline has no slides. Please add at least one slide before generating.',
});

function queueFullGeneration(retryAfterSec) {
    return { error: 'QUEUE_FULL', retryAfterSec, message: ERROR_TEXT.QUEUE_FULL_GENERATION };
}
function queueFullFinalize(retryAfterSec) {
    return { error: 'QUEUE_FULL', retryAfterSec, message: ERROR_TEXT.QUEUE_FULL_FINALIZE };
}
function proTemporarilyPaused(retryAfterSec) {
    return { error: 'PRO_TEMPORARILY_PAUSED', retryAfterSec, message: ERROR_TEXT.PRO_TEMPORARILY_PAUSED };
}
function validationFailed(fields) {
    return { error: 'Validation failed', fields };
}
function invalidTopic(reason) {
    return { error: `Invalid topic: ${reason}` };
}
function sseError(message) {
    return { error: message };
}
function powerPointError(message, contractViolation) {
    return { error: `Error generating PowerPoint: ${message}`, tipo: contractViolation ? 'contract-violation' : undefined };
}
function pdfError(message) {
    return { error: `Error generating PDF: ${message}` };
}

module.exports = { ERROR_TEXT, queueFullGeneration, queueFullFinalize, proTemporarilyPaused, validationFailed, invalidTopic, sseError, powerPointError, pdfError };
