const jwt = require('jsonwebtoken');

// Same JWT the API issues (shared JWT_SECRET). Fails CLOSED when the secret is not configured.
function auth(req, res, next) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        console.error('JWT_SECRET is not set: refusing all storage requests');
        return res.status(500).json({ message: 'Storage auth is not configured' });
    }
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing token' });
    try {
        req.user = jwt.verify(token, secret);
        next();
    } catch {
        res.status(401).json({ message: 'Invalid token' });
    }
}

const isSuper = (u) => Boolean(u?.isSuperAdmin || u?.roleKey === 'administrator');
const can = (u, resource, action) => isSuper(u) || Boolean(u?.permissions?.[resource]?.includes(action));

// Which API resource governs files of an entity type (images use the singular, folders the plural).
// 'self' = anyone logged in: avatars / own documents (ownership cannot be checked here, the API owns that data).
const ENTITY_RESOURCE = {
    user: 'self', badge: 'users', band: 'bands', asset: 'assets', equipment: 'equipment', stage: 'stages',
    room: 'rooms', stay: 'stays', zone: 'zones', location: 'locations', service: 'services', task: 'tasks',
    merch_product: 'merch', lost_found: 'inventory',
};
const FOLDER_RESOURCE = {
    users: 'self', user: 'self', badges: 'users', generated: 'users', bands: 'bands', assets: 'assets',
    equipments: 'equipment', stages: 'stages', rooms: 'rooms', stays: 'stays', zones: 'zones',
    locations: 'locations', services: 'services', tasks: 'tasks', merch_products: 'merch', lost_founds: 'inventory',
};

// The merch is run by administrators, organizers and the global coordinator. This server only sees the token, which has the
// role but not the scopes, so it lets every coordinator through; the API decides exactly (it checks the scope) before the
// photo is attached to a product, so a file uploaded by a coordinator who may not is never shown.
const MERCH_ROLES = ['administrator', 'organizer', 'coordinator'];

function mayEdit(user, resource) {
    if (!resource) return false;
    if (resource === 'merch') return isSuper(user) || MERCH_ROLES.includes(user?.roleKey);
    // the people who work with the inventory (anyone who may at least see assets or equipment) note what they found on site; the API
    // checks the same before a photo is attached to an entry
    if (resource === 'inventory') return can(user, 'assets', 'view') || can(user, 'equipment', 'view');
    return resource === 'self' || can(user, resource, 'edit');
}

const mayEditEntity = (user, entityType) => mayEdit(user, ENTITY_RESOURCE[entityType]);
const mayEditPath = (user, rel) => mayEdit(user, FOLDER_RESOURCE[String(rel).split('/').filter(Boolean)[0]]);

module.exports = { auth, can, mayEditEntity, mayEditPath };
