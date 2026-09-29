const path = require('path');
const multer = require('multer');
const {
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_FILES,
    ALLOWED_UPLOAD_EXTENSIONS
} = require('../contracts/limits');

const TMP_DIR = path.join(__dirname, '..', '..', '..', 'tmp');

const upload = multer({
    dest: TMP_DIR,
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: MAX_UPLOAD_FILES
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
            return cb(new Error('Invalid file type. Only PDF, Office Word, and images are allowed.'), false);
        }
        cb(null, true);
    }
});

module.exports = { TMP_DIR, upload };
