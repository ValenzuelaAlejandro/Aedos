const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

const MIME_BY_EXT = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
};

/** @typedef {{originalname: string, mimetype: string, path: string}} UploadedFile */
/** @typedef {{info: Function, warn: Function}} FileLogger */
/** @typedef {Record<string, string>} ErrorCategories */

/**
 * Parse uploaded files for the skeleton endpoint.
 * @param {Array<UploadedFile>|undefined} files Multer files
 * @returns {Promise<Array<object>|null>} provider file context
 */
async function buildSkeletonFileContext(files) {
    if (!files || files.length === 0) return null;
    const fileContext = [];
    for (const file of files) {
        try {
            const ext = path.extname(file.originalname).toLowerCase();
            const mimeType = MIME_BY_EXT[ext] || file.mimetype;
            if (ext === '.docx' || ext === '.doc') {
                const extracted = await mammoth.extractRawText({ path: file.path });
                fileContext.push({ type: 'text', text: `Content from ${file.originalname}:\n\n${extracted.value}` });
                continue;
            }
            const fileData = fs.readFileSync(file.path);
            const base64Data = fileData.toString('base64');
            const dataUrl = `data:${mimeType};base64,${base64Data}`;
            if (mimeType.startsWith('image/')) {
                fileContext.push({ type: 'image_url', image_url: { url: dataUrl } });
            } else {
                fileContext.push({ type: 'file', file_url: { url: dataUrl } });
            }
        } catch (e) {
            // ignore individual file errors
        } finally {
            fs.unlink(file.path, () => {});
        }
    }
    return fileContext;
}

/**
 * Parse uploaded files for the generation endpoint.
 * @param {Array<UploadedFile>|undefined} files Multer files
 * @param {{requestId: string, log: FileLogger, ErrorCategory: ErrorCategories}} deps logging dependencies
 * @returns {Promise<Array<object>|null>} provider file context
 */
async function buildGenerationFileContext(files, { requestId, log, ErrorCategory }) {
    if (!files || files.length === 0) return null;
    const fileContext = [];
    for (const file of files) {
        try {
            const ext = path.extname(file.originalname).toLowerCase();
            const mimeType = MIME_BY_EXT[ext] || file.mimetype;
            if (ext === '.docx' || ext === '.doc') {
                const extracted = await mammoth.extractRawText({ path: file.path });
                fileContext.push({
                    type: 'text',
                    text: `Content from ${file.originalname}:\n\n${extracted.value}`
                });
                log.info(ErrorCategory.PIPELINE, 'Extracted DOCX as text via mammoth', {
                    requestId,
                    file: file.originalname,
                    chars: extracted.value.length
                });
                continue;
            }
            const fileData = fs.readFileSync(file.path);
            const base64Data = fileData.toString('base64');
            const dataUrl = `data:${mimeType};base64,${base64Data}`;
            if (mimeType.startsWith('image/')) {
                fileContext.push({ type: 'image_url', image_url: { url: dataUrl } });
            } else {
                fileContext.push({ type: 'file', file_url: { url: dataUrl } });
            }
            log.info(ErrorCategory.PIPELINE, 'File encoded as base64', {
                requestId,
                file: file.originalname,
                mimeType,
                sizeKB: Math.round(fileData.length / 1024)
            });
        } catch (e) {
            log.warn(ErrorCategory.FILESYSTEM, 'Failed to read uploaded file', {
                requestId,
                file: file.originalname,
                error: e.message
            });
        } finally {
            fs.unlink(file.path, () => { });
        }
    }
    log.info(ErrorCategory.PIPELINE, 'File context ready for generation', { requestId, count: fileContext.length });
    return fileContext;
}

module.exports = { buildSkeletonFileContext, buildGenerationFileContext };
