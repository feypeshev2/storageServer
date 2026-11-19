const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const sharp = require('sharp');

// sandbox: <tmp>/outside.txt is a file the server must never touch, <tmp>/uploads is its root
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'obf-storage-'));
const ROOT = path.join(SANDBOX, 'uploads');
const OUTSIDE = path.join(SANDBOX, 'outside.txt');
process.env.UPLOADS_ROOT = ROOT;
process.env.JWT_SECRET = 'test-secret';
const app = require('../app');

const token = (claims = {}) =>
    `Bearer ${jwt.sign({ uid: 'u1', roleKey: 'volunteer', permissions: {}, ...claims }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
const volunteer = token();
const bandEditor = token({ permissions: { bands: ['edit'] } });
const staff = token({ roleKey: 'coordinator', permissions: { users: ['edit'] } });
const admin = token({ roleKey: 'administrator' });
const organizer = token({ roleKey: 'organizer' });
const coordinator = token({ roleKey: 'coordinator' });

const put = (rel, content = 'x') => {
    const full = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
};
const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: '#336699' } }).png().toBuffer();

beforeEach(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    fs.writeFileSync(OUTSIDE, 'precious');
    process.env.JWT_SECRET = 'test-secret';
});
afterAll(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

describe('authentication', () => {
    test.each([
        ['POST', '/images/upload'],
        ['DELETE', '/images/delete'],
        ['POST', '/images/generate/badge'],
        ['POST', '/files/upload'],
        ['DELETE', '/files/delete?filePath=users/x.jpg'],
    ])('%s %s without a token is 401', async (method, url) => {
        const res = await request(app)[method.toLowerCase()](url).send({});
        expect(res.status).toBe(401);
    });

    test('a token signed with another secret is 401', async () => {
        const forged = `Bearer ${jwt.sign({ roleKey: 'administrator' }, 'attacker')}`;
        expect((await request(app).delete('/files/delete?filePath=users/x.jpg').set('Authorization', forged)).status).toBe(401);
    });

    test('fails closed when JWT_SECRET is not configured', async () => {
        delete process.env.JWT_SECRET;
        const res = await request(app).delete('/files/delete?filePath=users/x.jpg').set('Authorization', volunteer);
        expect(res.status).toBe(500);
    });

    test('uploaded files are still served publicly', async () => {
        put('users/a.jpg', 'pixels');
        const res = await request(app).get('/uploads/users/a.jpg');
        expect(res.status).toBe(200);
    });
});

describe('path traversal', () => {
    test.each([
        ['../outside.txt'],
        ['users/../../outside.txt'],
        ['users/\0x'],
    ])('DELETE /files/delete refuses %j', async (filePath) => {
        const res = await request(app).delete('/files/delete').query({ filePath }).set('Authorization', admin);
        expect(res.status).toBe(400);
        expect(fs.readFileSync(OUTSIDE, 'utf8')).toBe('precious');
    });

    test('an encoded-looking name is just a literal folder name: stays inside, and unknown folders are refused', async () => {
        const res = await request(app).delete('/files/delete').query({ filePath: '%2e%2e/outside.txt' }).set('Authorization', admin);
        expect(res.status).toBe(403);
        expect(fs.readFileSync(OUTSIDE, 'utf8')).toBe('precious');
    });

    test('a filePath array is refused', async () => {
        const res = await request(app).delete('/files/delete?filePath=a&filePath=b').set('Authorization', admin);
        expect(res.status).toBe(400);
    });

    test('DELETE /images/delete refuses an originalPath or thumbPath outside the root', async () => {
        const inside = put('users/ok.jpg');
        const a = await request(app).delete('/images/delete').set('Authorization', admin).send({ originalPath: '../outside.txt' });
        const b = await request(app).delete('/images/delete').set('Authorization', admin)
            .send({ originalPath: 'users/ok.jpg', thumbPath: '../outside.txt' });
        expect([a.status, b.status]).toEqual([400, 400]);
        expect(fs.readFileSync(OUTSIDE, 'utf8')).toBe('precious');
        expect(fs.existsSync(inside)).toBe(true); // all-or-nothing: nothing was deleted
    });

    test('the uploads root itself cannot be deleted', async () => {
        const res = await request(app).delete('/files/delete').query({ filePath: '.' }).set('Authorization', admin);
        expect(res.status).toBe(400);
        expect(fs.existsSync(ROOT)).toBe(true);
    });
});

describe('who may delete what', () => {
    test('anyone logged in may delete user images (avatars)', async () => {
        const f = put('users/a.jpg');
        const t = put('users/thumbs/thumb_a.jpg');
        const res = await request(app).delete('/images/delete').set('Authorization', volunteer)
            .send({ originalPath: '/users/a.jpg', thumbPath: '/users/thumbs/thumb_a.jpg' });
        expect(res.status).toBe(204);
        expect([fs.existsSync(f), fs.existsSync(t)]).toEqual([false, false]);
    });

    test('band images need bands.edit', async () => {
        const f = put('bands/b.jpg');
        const denied = await request(app).delete('/images/delete').set('Authorization', volunteer).send({ originalPath: '/bands/b.jpg' });
        expect(denied.status).toBe(403);
        expect(fs.existsSync(f)).toBe(true);
        const ok = await request(app).delete('/images/delete').set('Authorization', bandEditor).send({ originalPath: '/bands/b.jpg' });
        expect(ok.status).toBe(204);
        expect(fs.existsSync(f)).toBe(false);
    });

    test('a thumb in a folder the caller may not edit blocks the whole delete', async () => {
        const mine = put('users/a.jpg');
        put('bands/thumbs/t.jpg');
        const res = await request(app).delete('/images/delete').set('Authorization', volunteer)
            .send({ originalPath: '/users/a.jpg', thumbPath: '/bands/thumbs/t.jpg' });
        expect(res.status).toBe(403);
        expect(fs.existsSync(mine)).toBe(true);
    });

    test('badges / generated files need users.edit; unknown folders are refused', async () => {
        put('generated/badges/b.png');
        put('secrets/x.txt');
        const del = (who, p) => request(app).delete('/files/delete').query({ filePath: p }).set('Authorization', who);
        expect((await del(volunteer, '/generated/badges/b.png')).status).toBe(403);
        expect((await del(staff, '/generated/badges/b.png')).status).toBe(204);
        expect((await del(admin, '/secrets/x.txt')).status).toBe(403);
    });

    test('user PDFs: any logged-in user may delete (own documents)', async () => {
        const f = put('user/files/doc.pdf');
        expect((await request(app).delete('/files/delete').query({ filePath: '/user/files/doc.pdf' }).set('Authorization', volunteer)).status).toBe(204);
        expect(fs.existsSync(f)).toBe(false);
    });
});

describe('uploads', () => {
    test('a user can upload their own avatar', async () => {
        const res = await request(app).post('/images/upload').set('Authorization', volunteer)
            .field('entityType', 'user').attach('image', await png(), { filename: 'a.png', contentType: 'image/png' });
        expect(res.status).toBe(201);
        expect(fs.existsSync(path.join(ROOT, res.body.originalPath))).toBe(true);
    });

    test('band images need bands.edit', async () => {
        const send = async (who) =>
            request(app).post('/images/upload').set('Authorization', who)
                .field('entityType', 'band').attach('image', await png(), { filename: 'a.png', contentType: 'image/png' });
        expect((await send(volunteer)).status).toBe(403);
        expect(fs.readdirSync(ROOT)).toEqual([]); // nothing written
        expect((await send(bandEditor)).status).toBe(201);
    });

    test('merch product photos: the people who run the merch (administrator, organizer, coordinators); not volunteers or other roles', async () => {
        const send = async (who) =>
            request(app).post('/images/upload').set('Authorization', who)
                .field('entityType', 'merch_product').attach('image', await png(), { filename: 'a.png', contentType: 'image/png' });
        expect((await send(volunteer)).status).toBe(403);
        expect((await send(bandEditor)).status).toBe(403); // bands.edit is not the merch
        expect(fs.readdirSync(ROOT)).toEqual([]); // nothing written
        for (const who of [admin, organizer, coordinator]) {
            const res = await send(who);
            expect(res.status).toBe(201);
            expect(res.body.originalPath).toMatch(/^\/merch_products\//);
            expect(res.body.thumbPath).toMatch(/^\/merch_products\/thumbs\//);
        }
    });

    test('a merch product photo thumbnail is square', async () => {
        const res = await request(app).post('/images/upload').set('Authorization', admin)
            .field('entityType', 'merch_product').attach('image', await png(), { filename: 'a.png', contentType: 'image/png' });
        const meta = await sharp(path.join(ROOT, res.body.thumbPath)).metadata();
        expect([meta.width, meta.height]).toEqual([360, 360]);
    });

    test('merch product photos are deleted by the same people', async () => {
        const f = put('merch_products/p.jpg');
        const t = put('merch_products/thumbs/thumb_p.jpg');
        const del = (who) => request(app).delete('/images/delete').set('Authorization', who).send({ originalPath: '/merch_products/p.jpg', thumbPath: '/merch_products/thumbs/thumb_p.jpg' });
        expect((await del(volunteer)).status).toBe(403);
        expect(fs.existsSync(f) && fs.existsSync(t)).toBe(true);
        expect((await del(organizer)).status).toBe(204);
        expect(fs.existsSync(f) || fs.existsSync(t)).toBe(false);
    });

    test('lost and found photos: the people who work with the inventory; not the outside roles or people with no inventory rights', async () => {
        const inventoryUser = token({ permissions: { assets: ['view'] } });
        const equipmentUser = token({ permissions: { equipment: ['view'] } });
        const dj = token({ roleKey: 'dj', permissions: { events: ['view'] } });
        const send = async (who) =>
            request(app).post('/images/upload').set('Authorization', who)
                .field('entityType', 'lost_found').attach('image', await png(), { filename: 'a.png', contentType: 'image/png' });
        expect((await send(volunteer)).status).toBe(403); // no inventory rights
        expect((await send(dj)).status).toBe(403);
        expect(fs.readdirSync(ROOT)).toEqual([]); // nothing written
        const coordinatorWithRights = token({ roleKey: 'coordinator', permissions: { assets: ['view', 'create', 'edit'] } });
        for (const who of [inventoryUser, equipmentUser, coordinatorWithRights, admin]) {
            const res = await send(who);
            expect(res.status).toBe(201);
            expect(res.body.originalPath).toMatch(/^\/lost_founds\//);
            expect(res.body.thumbPath).toMatch(/^\/lost_founds\/thumbs\//);
        }
    });

    test('a lost and found photo thumbnail is 320 x 200', async () => {
        const res = await request(app).post('/images/upload').set('Authorization', admin)
            .field('entityType', 'lost_found').attach('image', await png(), { filename: 'a.png', contentType: 'image/png' });
        const meta = await sharp(path.join(ROOT, res.body.thumbPath)).metadata();
        expect([meta.width, meta.height]).toEqual([320, 200]);
    });

    test('lost and found photos are deleted by the same people', async () => {
        const inventoryUser = token({ permissions: { assets: ['view'] } });
        const f = put('lost_founds/p.jpg');
        const t = put('lost_founds/thumbs/thumb_p.jpg');
        const del = (who) => request(app).delete('/images/delete').set('Authorization', who).send({ originalPath: '/lost_founds/p.jpg', thumbPath: '/lost_founds/thumbs/thumb_p.jpg' });
        expect((await del(volunteer)).status).toBe(403);
        expect(fs.existsSync(f) && fs.existsSync(t)).toBe(true);
        expect((await del(inventoryUser)).status).toBe(204);
        expect(fs.existsSync(f) || fs.existsSync(t)).toBe(false);
    });

    test('PDF upload: user only, and only entityType=user', async () => {
        const send = (entityType) =>
            request(app).post('/files/upload').set('Authorization', volunteer)
                .field('entityType', entityType).field('entityId', 'x').attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' });
        expect((await send('user')).status).toBe(201);
        expect((await send('band')).status).toBe(400);
    });
});

describe('badge generation', () => {
    const gen = (who, body) => request(app).post('/images/generate/badge').set('Authorization', who).send(body);

    test('staff only', async () => {
        expect((await gen(volunteer, { userId: 'u1', name: 'A' })).status).toBe(403);
        expect((await gen(staff, { userId: 'u1', name: 'A' })).status).toBe(201);
    });

    test('userId cannot walk out of the badges folder', async () => {
        const res = await gen(staff, { userId: '../../../outside', name: 'A' });
        expect(res.status).toBe(201);
        expect(res.body.originalPath).toMatch(/^\/generated\/badges\/badge_outside_\d+\.png$/);
        expect(fs.existsSync(path.join(SANDBOX, 'outside_1.png'))).toBe(false);
        expect(fs.readFileSync(OUTSIDE, 'utf8')).toBe('precious');
    });

    test('a userId with nothing safe left is rejected', async () => {
        expect((await gen(staff, { userId: '../..', name: 'A' })).status).toBe(400);
    });

    test('markup in name / role / phone is rendered as text, not parsed (no external image fetch)', async () => {
        const evil = '</text><image href="file:///etc/passwd" width="10" height="10"/><text>';
        const res = await gen(staff, { userId: 'u1', name: evil, bandRole: '<b>&', phone: '"\'' });
        expect(res.status).toBe(201);
        const meta = await sharp(path.join(ROOT, res.body.originalPath)).metadata();
        expect(meta.width).toBe(1240);
    });

    test('ordinary names with & still work (used to produce invalid XML -> 500)', async () => {
        expect((await gen(staff, { userId: 'u1', name: 'Tom & Jerry', bandRole: 'Drums & Bass' })).status).toBe(201);
    });
});
