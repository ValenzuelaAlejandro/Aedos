/* eslint-disable complexity */

/**
 * Preserve the generation endpoint's error classification and response map.
 *
 * @param {{error: any, requestId: string, res: any, log: any, classifyError: Function, ErrorCategory: any, markCompleted: Function}} deps
 * @returns {void}
 */
function handleGenerationError({ error, requestId, res, log, classifyError, ErrorCategory, markCompleted }) {
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

    let userMessage;
    if (isQuotaError) {
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
    } else {
        userMessage = 'Something went wrong. Please try again.';
        log.error(classifyError(error, ErrorCategory.UNKNOWN), 'Unhandled generation failure', { requestId, error });
    }

    if (!res.headersSent) {
        res.status(isQuotaError ? 429 : 500).json({ error: userMessage });
        markCompleted();
    } else {
        res.write(`data: ${JSON.stringify({ error: userMessage })}\n\n`);
        res.end();
        markCompleted();
    }
}

module.exports = { handleGenerationError };
