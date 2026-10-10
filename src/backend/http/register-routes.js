const { registerEntryRoutes } = require('./routes/entry');
const { registerGenerationRoutes } = require('./routes/generation-endpoints');
const { registerFinalizeRoutes } = require('./routes/finalize');
const { registerDownloadRoute } = require('./routes/download');

/**
 * Register the backend routes in the frozen bootstrap order.
 * @param {any} deps route dependencies assembled by the server bootstrap
 * @returns {void}
 */
function registerBackendRoutes(deps) {
    registerEntryRoutes({ app: deps.app, tmpDir: deps.TMP_DIR, isDevelopment: deps.IS_DEVELOPMENT });

    registerGenerationRoutes({
        app: deps.app,
        upload: deps.upload,
        maxUploadArrayFields: deps.MAX_UPLOAD_ARRAY_FIELDS,
        checkGenerationPressure: deps.checkGenerationPressure,
        checkRateLimits: deps.checkRateLimits,
        handleGenerateSkeleton: deps.handleGenerateSkeleton,
        handleGenerateOutlineItem: deps.handleGenerateOutlineItem,
        generationQueue: deps.generationQueue,
        runPipeline: deps.runPipeline,
        runFlashGenerationWithRetry: deps.runFlashGenerationWithRetry,
        tryModelsFlash: deps.tryModelsFlash,
        tryModelsStage1Thinking: deps.tryModelsStage1Thinking,
        tryModelsStage2Thinking: deps.tryModelsStage2Thinking,
        tryModelsStage3Thinking: deps.tryModelsStage3Thinking,
        buildPrompt: deps.buildPrompt,
        buildGenerationFileContext: deps.buildGenerationFileContext,
        sanitizeTema: deps.sanitizeTema,
        invalidTopic: deps.invalidTopic,
        validationFailed: deps.validationFailed,
        ERROR_TEXT: deps.ERROR_TEXT,
        MAX_PRO_SLIDES: deps.MAX_PRO_SLIDES,
        MAX_FLASH_SLIDES: deps.MAX_FLASH_SLIDES,
        setSseHeaders: deps.setSseHeaders,
        log: deps.log,
        ErrorCategory: deps.ErrorCategory,
        fs: deps.fs,
        path: deps.path,
        TMP_DIR: deps.TMP_DIR,
        devLog: deps.devLog,
        classifyError: deps.classifyError,
        consumeModelStream: deps.consumeModelStream,
        sanitizeGeneratedHtml: deps.sanitizeGeneratedHtml,
        injectLayoutSafetyNet: deps.injectLayoutSafetyNet,
        sanitizerLog: deps.sanitizerLog,
        IS_DEVELOPMENT: deps.IS_DEVELOPMENT,
        extractPresentationTitle: deps.extractPresentationTitle,
        buildFileStemFromTitle: deps.buildFileStemFromTitle,
        resolveUniqueHtmlPath: deps.resolveUniqueHtmlPath,
        EXAMPLES_FLASH_DIR: deps.EXAMPLES_FLASH_DIR,
        EXAMPLES_PRO_DIR: deps.EXAMPLES_PRO_DIR
    });

    registerFinalizeRoutes({
        app: deps.app,
        checkFinalizePressure: deps.checkFinalizePressure,
        checkFinalizeLimits: deps.checkFinalizeLimits,
        finalizeQueueState: deps.finalizeQueueState,
        pptxFinalizer: deps.pptxFinalizer,
        pdfExporter: deps.pdfExporter,
        maxExportHtmlBytes: deps.MAX_EXPORT_HTML_BYTES,
        downloadTtlMs: deps.DOWNLOAD_TTL_MS,
        log: deps.log,
        puppeteerLog: deps.puppeteerLog,
        classifyError: deps.classifyError,
        ErrorCategory: deps.ErrorCategory
    });
    registerDownloadRoute({ app: deps.app, tmpDir: deps.TMP_DIR, log: deps.log, classifyError: deps.classifyError, ErrorCategory: deps.ErrorCategory });
}

module.exports = { registerBackendRoutes };
