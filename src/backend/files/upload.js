const path = require('path');
const multer = require('multer');
const {
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_FILES,
    ALLOWED_UPLOAD_EXTENSIONS
} = require('../contracts/limits');

const TMP_DIR = path.join(__dirname, '..', '..', '..', 'tmp');

/**
 * Convert expected multipart upload failures to the project's JSON error shape.
 * Unknown errors remain available to Express's default error handling.
 * @param {Error & {code?: string, field?: string}} error
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function handleUploadError(error, req, res, next) {
    const code = error.code;
    if (code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 10 MB.' });
    }
    if (code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ error: error.message });
    }
    if (error instanceof multer.MulterError) {
        const message = code === 'LIMIT_FILE_COUNT'
            ? 'Too many files. Maximum is 3.'
            : 'Invalid file upload.';
        return res.status(400).json({ error: message });
    }
    return next(error);
}

const upload = multer({
    dest: TMP_DIR,
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: MAX_UPLOAD_FILES
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
            /** @type {Error & {code?: string}} */
            const error = new Error('Invalid file type. Only PDF, Office Word, and images are allowed.');
            error.code = 'INVALID_FILE_TYPE';
            return cb(error, false);
        }
        cb(null, true);
    }
});

module.exports = { TMP_DIR, upload, handleUploadError };
