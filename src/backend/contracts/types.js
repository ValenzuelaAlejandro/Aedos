/** @typedef {'flash'|'pro'} GenerationMode */

/**
 * @typedef {Object} GenerationRequest
 * @property {unknown} tema - Input is normalized to a string by the handler.
 * @property {GenerationMode|string|undefined} [mode]
 * @property {number|string|undefined} [slides]
 * @property {string|undefined} [idioma] - Legacy language field.
 * @property {string|undefined} [language]
 * @property {string|Object|undefined} [currentSkeleton]
 * @property {UploadedFile[]|undefined} [files]
 */

/** @typedef {GenerationRequest & {language?: string}} SkeletonRequest */

/**
 * @typedef {Object} Skeleton
 * @property {number|undefined} [slide_count]
 * @property {Slide[]} [slides]
 * @property {'proceed'|undefined} [action]
 * @property {boolean|undefined} [rejected]
 * @property {string|undefined} [reason]
 */

/**
 * @typedef {Object} Slide
 * @property {string|undefined} [title]
 * @property {string|undefined} [subtitle]
 * @property {string|undefined} [role]
 * @property {string[]|undefined} [key_points]
 * @property {Object<string, unknown>} [extra]
 */

/**
 * @typedef {Object} OutlineItemRequest
 * @property {'slide'|'point'|string} type
 * @property {unknown} topic
 * @property {Object<string, unknown>} [existingSlides]
 * @property {string} [slideTitle]
 * @property {string} [slideSubtitle]
 * @property {string[]} [existingPoints]
 */

/** @typedef {{item: Object<string, unknown>}} OutlineItemResponse */

/**
 * @typedef {Object} SseEvent
 * @property {boolean|undefined} [queued]
 * @property {number|undefined} [position]
 * @property {string|undefined} [reasoning]
 * @property {string|undefined} [stage]
 * @property {string|undefined} [chunk]
 * @property {Object|undefined} [metadata]
 * @property {boolean|undefined} [heartbeat]
 * @property {boolean|undefined} [done]
 * @property {Skeleton|undefined} [skeleton]
 * @property {string|undefined} [html]
 * @property {string|undefined} [error]
 */

/**
 * @typedef {Object} ExportRequest
 * @property {string} html
 * @property {string|undefined} [title]
 */

/**
 * @typedef {Object} ExportResponse
 * @property {string} [pdfUrl]
 * @property {string} [pptxUrl]
 * @property {string} [error]
 */

/**
 * @typedef {Object} ApiError
 * @property {string} error
 * @property {Object<string, string>|undefined} [fields]
 * @property {number|undefined} [retryAfterSec]
 * @property {string|undefined} [message]
 * @property {string|undefined} [tipo]
 */

/**
 * @typedef {Object} UploadedFile
 * @property {string} fieldname
 * @property {string} originalname
 * @property {string} encoding
 * @property {string} mimetype
 * @property {string} destination
 * @property {string} filename
 * @property {string} path
 * @property {number} size
 */

module.exports = {};
