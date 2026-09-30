/**
 * Create the startup environment validator without reading env at module load.
 * @param {{log: any, ErrorCategory: any, models: {flash: string, stage1: string, stage2: string, stage3: string, openRouterFlash: string[], openRouterStage1: string[], openRouterStage2: string[], openRouterStage3: string[]}}} deps
 * @returns {Function}
 */
function createEnvironmentValidator({ log, ErrorCategory, models }) {
    return function validateEnvironment() {
        const checks = [
            { key: 'NODE_ENV', value: process.env.NODE_ENV, fallback: 'development' },
            { key: 'PORT', value: process.env.PORT, fallback: '3000' },
        ];

        log.info(ErrorCategory.BOOT, 'Environment validation started');
        checks.forEach(({ key, value, fallback }) => {
            const val = value || fallback;
            if (value) {
                log.info(ErrorCategory.CONFIG, 'Environment variable detected', { key, value: val });
                return;
            }
            log.warn(ErrorCategory.CONFIG, 'Environment variable missing, using fallback', {
                key,
                fallback: val
            });
        });

        if (process.env.GEMINI_API_KEY) {
            log.success(ErrorCategory.CONFIG, 'Gemini direct API key present (primary provider)', {
                flash: models.flash,
                stage1: models.stage1,
                stage2: models.stage2,
                stage3: models.stage3
            });
        } else {
            log.warn(ErrorCategory.CONFIG, 'GEMINI_API_KEY not set — direct Gemini calls will be skipped');
        }

        if (process.env.OPENROUTER_API_KEY) {
            log.success(ErrorCategory.CONFIG, 'OpenRouter API key present (fallback provider)', {
                flash: models.openRouterFlash,
                stage1: models.openRouterStage1,
                stage2: models.openRouterStage2,
                stage3: models.openRouterStage3
            });
        } else {
            log.warn(ErrorCategory.CONFIG, 'OPENROUTER_API_KEY not set — OpenRouter fallback disabled');
        }

        if (!process.env.GEMINI_API_KEY && !process.env.OPENROUTER_API_KEY) {
            throw new Error('At least one of GEMINI_API_KEY or OPENROUTER_API_KEY is required.');
        }
    };
}

module.exports = { createEnvironmentValidator };
