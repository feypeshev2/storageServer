const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { UPLOADS_ROOT } = require('../lib/config');
const { resolveInside, safeName, escapeXml } = require('../lib/safePath');
const { can, mayEditEntity, mayEditPath } = require('../lib/auth');

const THUMB_SIZES = {
    user: { width: 160, height: 160 },
    band: { width: 320, height: 200 },
    asset: { width: 320, height: 200 },
    equipment: { width: 320, height: 200 },
    stage: { width: 320, height: 200 },
    room: { width: 320, height: 200 },
    stay: { width: 320, height: 200 },
    zone: { width: 320, height: 200 },
    location: { width: 320, height: 200 },
    service: { width: 320, height: 200 },
    task: { width: 320, height: 200 },
    merch_product: { width: 360, height: 360 }, // square: a product photo sits in a card and a table row
    lost_found: { width: 320, height: 200 }, // something found on site (the lost and found of the team)
};

const ENTITY_TYPES = ['user', 'band', 'asset', 'equipment', 'stage', 'badge', 'room', 'stay', 'zone', 'location', 'service', 'task', 'merch_product', 'lost_found'];
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

// ─── Multer ───────────────────────────────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();

        if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG and WebP images are allowed'));
        }
    },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Returns path relative to UPLOADS_ROOT for storage in MongoDB
function relPath(fullPath) {
    return fullPath.replace(UPLOADS_ROOT, '');
}

// ─── POST /images/upload ──────────────────────────────────────────────────────
// Multipart body: entityType, entityId
// File field: image
// Returns: { originalPath, thumbPath, mimeType, size }
router.post('/upload', upload.single('image'), async (req, res) => {
    try {
        const { entityType } = req.body;

        if (!entityType) {
            return res.status(400).json({ message: 'entityType is required' });
        }
        if (!ENTITY_TYPES.includes(entityType)) {
            return res.status(400).json({ message: `Invalid entityType. Must be one of: ${ENTITY_TYPES.join(', ')}` });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'No image file provided' });
        }
        if (!mayEditEntity(req.user, entityType)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const filename = `${uuidv4()}.jpg`;
        const thumbName = `thumb_${filename}`;
        const dir = path.join(UPLOADS_ROOT, `${entityType}s`);
        const thumbDir = path.join(dir, 'thumbs');

        ensureDir(dir);
        ensureDir(thumbDir);

        const originalFullPath = path.join(dir, filename);
        const thumbFullPath = path.join(thumbDir, thumbName);

        // Save original as JPEG
        await sharp(req.file.buffer)
            .jpeg({ quality: 88 })
            .toFile(originalFullPath);

        // Generate thumbnail
        const thumbSize = THUMB_SIZES[entityType];
        await sharp(req.file.buffer)
            .resize(thumbSize.width, thumbSize.height, { fit: 'cover', position: 'centre' })
            .jpeg({ quality: 80 })
            .toFile(thumbFullPath);

        const stat = fs.statSync(originalFullPath);

        res.status(201).json({
            originalPath: relPath(originalFullPath),
            thumbPath: relPath(thumbFullPath),
            mimeType: 'image/jpeg',
            size: stat.size,
        });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── DELETE /images/delete ────────────────────────────────────────────────────
// Body: { originalPath, thumbPath }
router.delete('/delete', async (req, res) => {
    try {
        const { originalPath, thumbPath } = req.body;

        if (!originalPath) {
            return res.status(400).json({ message: 'originalPath is required' });
        }

        const originalFull = resolveInside(UPLOADS_ROOT, originalPath);
        const thumbFull = thumbPath ? resolveInside(UPLOADS_ROOT, thumbPath) : null;
        if (!originalFull || (thumbPath && !thumbFull)) {
            return res.status(400).json({ message: 'Invalid path' });
        }
        if (!mayEditPath(req.user, originalPath) || (thumbPath && !mayEditPath(req.user, thumbPath))) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        if (fs.existsSync(originalFull)) fs.unlinkSync(originalFull);
        if (thumbFull && fs.existsSync(thumbFull)) fs.unlinkSync(thumbFull);

        res.status(204).send();
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── POST /images/generate/badge ─────────────────────────────────────────────
// Body: { userId, name, bandRole, phone }
// Returns: { originalPath, mimeType, size }
router.post('/generate/badge', async (req, res) => {
    try {
        if (!can(req.user, 'users', 'edit')) return res.status(403).json({ message: 'Forbidden' });

        const { userId: rawUserId, name: rawName, bandRole: rawRole, phone: rawPhone } = req.body;

        if (!rawUserId || !rawName) {
            return res.status(400).json({ message: 'userId and name are required' });
        }

        // userId ends up in a file name, the rest is pasted into an SVG: neither may carry markup or path parts
        const userId = safeName(rawUserId);
        if (!userId) return res.status(400).json({ message: 'Invalid userId' });
        const clip = (v) => String(v ?? '').slice(0, 120);
        const name = escapeXml(clip(rawName));
        const bandRole = escapeXml(clip(rawRole));
        const phone = escapeXml(clip(rawPhone));

        const W = 1240;
        const H = 874;

        

        const dir = path.join(UPLOADS_ROOT, 'generated', 'badges');
        ensureDir(dir);

        const filename = `badge_${userId}_${Date.now()}.png`;
        const fullPath = path.join(dir, filename);

        const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>
      .title  { font-family: Georgia, serif; font-size: 72px; font-weight: 700; fill: #D9D0E8; letter-spacing: 18px; }
      .sub    { font-family: Georgia, serif; font-size: 22px; fill: #7B52AB; letter-spacing: 8px; }
      .label  { font-family: 'Courier New', monospace; font-size: 16px; fill: #7B52AB; letter-spacing: 4px; }
      .value  { font-family: Georgia, serif; font-size: 32px; fill: #D9D0E8; }
      .footer { font-family: Georgia, serif; font-size: 16px; fill: #7B52AB; letter-spacing: 6px; }
      .qrlabel{ font-family: 'Courier New', monospace; font-size: 13px; fill: #4B0082; letter-spacing: 3px; }
    </style>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="#0D0D1A"/>

  <!-- Top header band -->
  <rect x="0" y="0" width="${W}" height="160" fill="#4B0082"/>

  <!-- Bottom footer band -->
  <rect x="0" y="${H - 90}" width="${W}" height="90" fill="#2A0052"/>

  <!-- Decorative arcs top-right -->
  <circle cx="${W - 60}" cy="60" r="120" fill="none" stroke="#7B52AB" stroke-width="1" opacity="0.3"/>
  <circle cx="${W - 60}" cy="60" r="180" fill="none" stroke="#7B52AB" stroke-width="1" opacity="0.2"/>

  <!-- Decorative arcs bottom-left -->
  <circle cx="60" cy="${H - 60}" r="90"  fill="none" stroke="#7B52AB" stroke-width="1" opacity="0.3"/>
  <circle cx="60" cy="${H - 60}" r="140" fill="none" stroke="#7B52AB" stroke-width="1" opacity="0.2"/>

  <!-- Ghost year watermark -->
  <text x="${W / 2}" y="${H / 2 + 50}" text-anchor="middle"
        font-family="Georgia, serif" font-size="260" font-weight="700"
        fill="#4B0082" opacity="0.10">2026</text>

  <!-- Corner marks -->
  <polyline points="40,20 20,20 20,50" fill="none" stroke="#7B52AB" stroke-width="1.5" opacity="0.6"/>
  <polyline points="${W - 40},20 ${W - 20},20 ${W - 20},50" fill="none" stroke="#7B52AB" stroke-width="1.5" opacity="0.6"/>
  <polyline points="40,${H - 20} 20,${H - 20} 20,${H - 50}" fill="none" stroke="#7B52AB" stroke-width="1.5" opacity="0.6"/>
  <polyline points="${W - 40},${H - 20} ${W - 20},${H - 20} ${W - 20},${H - 50}" fill="none" stroke="#7B52AB" stroke-width="1.5" opacity="0.6"/>

  <!-- OBF Title -->
  <text x="${W / 2}" y="100" text-anchor="middle" class="title">OBF</text>
  <text x="${W / 2}" y="138" text-anchor="middle" class="sub">OPEN BUZLUDZHA FESTIVAL</text>

  <!-- Divider -->
  <line x1="60" y1="162" x2="${W - 60}" y2="162" stroke="#7B52AB" stroke-width="0.8" opacity="0.5"/>
  <circle cx="60" cy="162" r="3" fill="#7B52AB"/>
  <circle cx="${W - 60}" cy="162" r="3" fill="#7B52AB"/>

  <!-- Photo placeholder -->
  <rect x="60" y="195" width="220" height="270" fill="none" stroke="#4B0082" stroke-width="1" stroke-dasharray="4,4" rx="2"/>
  <text x="170" y="338" text-anchor="middle" class="qrlabel">PHOTO</text>

  <!-- Name -->
  <text x="320" y="240" class="label">NAME</text>
  <text x="320" y="278" class="value">${name}</text>
  <line x1="320" y1="285" x2="${W - 60}" y2="285" stroke="#4B0082" stroke-width="0.8"/>

  <!-- Band / Role -->
  <text x="320" y="325" class="label">BAND / ROLE</text>
  <text x="320" y="363" class="value">${bandRole || ''}</text>
  <line x1="320" y1="370" x2="${W - 60}" y2="370" stroke="#4B0082" stroke-width="0.8"/>

  <!-- Phone -->
  <text x="320" y="410" class="label">PHONE</text>
  <text x="320" y="448" class="value">${phone || ''}</text>
  <line x1="320" y1="455" x2="${W - 60}" y2="455" stroke="#4B0082" stroke-width="0.8"/>

  <!-- Mid divider -->
  <line x1="60" y1="500" x2="${W - 60}" y2="500" stroke="#4B0082" stroke-width="0.6" opacity="0.5"/>

  <!-- QR placeholder -->
  <rect x="60" y="518" width="180" height="180" fill="none" stroke="#4B0082" stroke-width="1" stroke-dasharray="4,4" rx="2"/>
  <text x="150" y="616" text-anchor="middle" class="qrlabel">QR CODE</text>

  <!-- ID -->
  <text x="280" y="546" class="label">ID</text>
  <text x="280" y="578" class="value" font-size="22">${userId}</text>
  <line x1="280" y1="585" x2="${W - 60}" y2="585" stroke="#4B0082" stroke-width="0.8"/>

  <!-- Footer -->
  <text x="${W / 2}" y="${H - 50}" text-anchor="middle" class="footer">BUZLUDZHA · KAZANLAK · BULGARIA</text>
  <text x="${W / 2}" y="${H - 22}" text-anchor="middle" class="footer" font-size="13" opacity="0.7">WWW.OPENBUZLUDZHA.COM</text>
</svg>`;

        await sharp(Buffer.from(svg))
            .png({ compressionLevel: 6 })
            .toFile(fullPath);

        const stat = fs.statSync(fullPath);

        res.status(201).json({
            originalPath: relPath(fullPath),
            mimeType: 'image/png',
            size: stat.size,
        });
    } catch (err) {
        console.error('Badge generation error:', err);
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;