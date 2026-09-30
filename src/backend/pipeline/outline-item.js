/**
 * Build the outline-item generation route handler.
 * @param {{[key: string]: any}} deps pipeline dependencies and contract constants
 * @returns {Function} Express route handler
 */
function createOutlineItemHandler(deps) {
    const {
        buildAddSlidePrompt,
        buildAddPointPrompt,
        tryModelsStage1,
        extractJson,
        ERROR_TEXT,
        log,
        ErrorCategory
    } = deps;

    return async function handleGenerateOutlineItem(req, res) {
        const requestId = req.requestId || 'n/a';
        try {
            const { type, topic, ...context } = req.body;
            let prompt = '';

            if (type === 'slide') {
                prompt = buildAddSlidePrompt(topic, context.existingSlides);
            } else if (type === 'point') {
                prompt = buildAddPointPrompt(topic, context.slideTitle, context.slideSubtitle, context.existingPoints);
            } else {
                return res.status(400).json({ error: ERROR_TEXT.INVALID_ITEM_TYPE });
            }

            const rawOutputResponse = await tryModelsStage1(prompt, null);
            let rawOutput = '';
            for await (const chunk of rawOutputResponse.stream) {
                rawOutput += chunk;
            }

            let itemJson;
            try {
                itemJson = extractJson(rawOutput);
            } catch (e) {
                // eslint-disable-next-line preserve-caught-error
                throw new Error(`Failed to parse AI output as JSON: ${e.message}`);
            }

            if (!itemJson || typeof itemJson !== 'object') {
                throw new Error('Invalid AI response format for outline item');
            }
            if (!itemJson.title) itemJson.title = '';
            if (!itemJson.role) itemJson.role = 'concept';
            if (!Array.isArray(itemJson.key_points)) itemJson.key_points = [];

            res.json({ item: itemJson });
        } catch (err) {
            log.error(ErrorCategory.PIPELINE, 'Failed to generate outline item', { requestId, error: err.message });
            res.status(500).json({ error: ERROR_TEXT.ITEM_FAILED });
        }
    };
}

module.exports = { createOutlineItemHandler };
