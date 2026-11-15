const path = require('path');

// Resolve a client-supplied relative path INSIDE root. Returns null if it escapes (../, absolute, NUL byte)
// or is the root itself, so callers can never touch anything outside the uploads directory.
function resolveInside(root, rel) {
    if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return null;
    const base = path.resolve(root);
    const full = path.resolve(base, '.' + path.sep + rel);
    return full.startsWith(base + path.sep) ? full : null;
}

// Keep only characters that are safe in a file name.
const safeName = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

// Escape text before it is interpolated into SVG/XML.
const escapeXml = (value) =>
    String(value ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

module.exports = { resolveInside, safeName, escapeXml };
