// routes/files.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { UPLOADS_ROOT } = require('../lib/config');
const { resolveInside } = require('../lib/safePath');
const { mayEditEntity, mayEditPath } = require('../lib/auth');
const FILE_ENTITY_TYPES = ['user'];
const ALLOWED_FILE_MIMES = ['application/pdf'];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_FILE_MIMES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    },
});

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function relPath(fullPath) {
    return fullPath.replace(UPLOADS_ROOT, '');
}

// POST /files/upload
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        const { entityType, entityId } = req.body;

        if (!entityType || !entityId) {
            return res.status(400).json({ message: 'entityType and entityId are required' });
        }
        if (!FILE_ENTITY_TYPES.includes(entityType)) {
            return res.status(400).json({ message: `Invalid entityType. Allowed: ${FILE_ENTITY_TYPES.join(', ')}` });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }
        if (!mayEditEntity(req.user, entityType)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const dir = path.join(UPLOADS_ROOT, entityType, 'files');
        ensureDir(dir);

        const uuid = uuidv4();
        const fullPath = path.join(dir, `${uuid}.pdf`);
        fs.writeFileSync(fullPath, req.file.buffer);

        res.status(201).json({
            filePath: relPath(fullPath),
            mimeType: req.file.mimetype,
            size: req.file.size,
        });
    } catch (err) {
        console.error('File upload error:', err);
        res.status(500).json({ message: err.message });
    }
});

// DELETE /files/delete
router.delete('/delete', async (req, res) => {
    try {
        const { filePath } = req.query; // string only (?filePath=a&filePath=b would be an array)
        if (!filePath) return res.status(400).json({ message: 'filePath required' });

        const fullPath = resolveInside(UPLOADS_ROOT, filePath);
        if (!fullPath) return res.status(400).json({ message: 'Invalid filePath' });
        if (!mayEditPath(req.user, filePath)) return res.status(403).json({ message: 'Forbidden' });
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;