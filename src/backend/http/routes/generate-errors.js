/* eslint-disable complexity */
const { sseError } = require('../../contracts/errors');
const { formatSseEvent } = require('../../contracts/sse');

/**
 * Preserve the generation endpoint's error classification and response map.
 *
 * @param {{error: any, requestId: string, res: any, log: any, classifyError: Function, ErrorCategory: any, markCompleted: Function}} deps
 * @returns {void}
 */
function handleGenerationError({ error, requestId, res, log, classifyError, ErrorCategory, markCompleted }) {
    const spendLimit = ['PAID_PAUSED', 'IP_SPEND_LIMIT', 'REQUEST_SPEND_LIMIT', 'SPEND_GUARD_UNAVAILABLE'].includes(error.message);
    const attemptLimit = error.message === 'REQUEST_ATTEMPT_LIMIT';
    const requestTimeout = ['REQUEST_TIMEOUT', 'REQUEST_TOTAL_TIMEOUT', 'PROVIDER_REQUEST_TIMEOUT'].includes(error.message);
    const providerError = spendLimit || error.message === 'PROVIDER_UNAVAILABLE'
        || error.message === 'USAGE_UNAVAILABLE' || attemptLimit || requestTimeout;
    const isQuotaError = error.message === 'QUOTA_EXHAUSTED';
    const isPipelineError = error.message && (
        error.message.startsWith('STAGE1_') ||
        error.message.startsWith('STAGE2_') ||
        error.message.startsWith('STAGE_TIMEOUT') ||
        error.message.startsWith('STAGE_EMPTY_OUTPUT') ||
        error.message.startsWith('CONTENT_REJECTED')
    );
    const isFlashNoCss = error.message && error.message.startsWith('FLASH_NO_DESIGN_CSS');
    const isOutputTooLarge = error.message === 'GENERATION_OUTPUT_TOO_LARGE';
    const isSlideCountFailure = ['SLIDE_COUNT_EXCEEDED', 'SLIDES_INCOMPLETE_EMPTY',
        'SLIDE_COUNT_CHANGED_BY_SANITIZER'].includes(error.message);

    let userMessage;
    if (error.message === 'PROVIDER_SAFETY') {
        userMessage = 'The selected model could not complete this request because of its safety filters. Please rephrase your request.';
        log.warn(ErrorCategory.PROVIDER, 'Selected model safety block persisted', { requestId });
    } else if (providerError) {
        userMessage = spendLimit
            ? error.message === 'IP_SPEND_LIMIT'
                ? 'This network has reached its daily AI budget. No usage was deducted; please try again after the reset.'
                : 'The AI budget for this request or service is unavailable. No usage was deducted; shorten the request or try again later.'
            : attemptLimit
                ? 'This request reached its safe provider-attempt limit. No usage was deducted; please try again.'
            : requestTimeout ? 'This request reached its maximum processing time. No usage was deducted; please try again.'
                : 'The AI providers are temporarily unavailable. Please try again later.';
        log.warn(ErrorCategory.PROVIDER, 'Provider route unavailable', { requestId, code: error.message });
    } else if (isQuotaError) {
        userMessage = 'The AI service has reached its usage limit. Please try again in a few minutes.';
        log.warn(ErrorCategory.QUOTA, 'All configured models are quota exhausted', { requestId });
    } else if (error.message && error.message.startsWith('STAGE_TIMEOUT')) {
        userMessage = 'The AI took too long to respond. Please try again in a moment.';
        log.error(ErrorCategory.PIPELINE, 'Stage timed out', { requestId, details: error.message });
    } else if (error.message && error.message.startsWith('STAGE_EMPTY_OUTPUT')) {
        userMessage = 'The AI returned an empty response. Please try again in a moment.';
        log.error(ErrorCategory.PIPELINE, 'Stage returned empty output', { requestId, details: error.message });
    } else if (isPipelineError) {
        userMessage = 'The AI had trouble understanding the request. Please try rephrasing or adding more detail.';
        log.error(ErrorCategory.PIPELINE, 'Pipeline generation failed', { requestId, details: error.message });
    } else if (isFlashNoCss) {
        userMessage = 'The AI could not produce a valid design after several attempts. Please rephrase your topic with a bit more detail, or switch to Pro mode for better formatting.';
        log.error(ErrorCategory.PIPELINE, 'Flash generation exhausted retries without design CSS', { requestId, details: error.message });
    } else if (isOutputTooLarge) {
        userMessage = 'The generated presentation is too large. Please use fewer slides or a shorter description.';
        log.warn(ErrorCategory.VALIDATION, 'Generation rejected because the streamed HTML exceeded the size limit', { requestId });
    } else if (isSlideCountFailure) {
        userMessage = error.message === 'SLIDE_COUNT_EXCEEDED'
            ? 'The selected model returned more slides than requested. Nothing was charged; please try again.'
            : 'The selected model could not complete any safe slides. Nothing was charged; please try again.';
        log.warn(ErrorCategory.VALIDATION, 'Generation did not produce a safe requested slide count', {
            requestId, code: error.message
        });
    } else {
        userMessage = 'Something went wrong. Please try again.';
        log.error(classifyError(error, ErrorCategory.UNKNOWN), 'Unhandled generation failure', { requestId, error });
    }

    if (!res.headersSent) {
        res.status(providerError ? 503 : isQuotaError ? 429 : 500).json(providerError
            ? { error: userMessage, code: error.message } : { error: userMessage });
        markCompleted();
    } else {
        res.write(formatSseEvent(providerError ? { ...sseError(userMessage), code: error.message } : sseError(userMessage)));
        res.end();
        markCompleted();
    }
}

module.exports = { handleGenerationError };
