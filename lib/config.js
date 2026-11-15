// Overridable so tests can use a temp dir.
module.exports = {
    get UPLOADS_ROOT() {
        return process.env.UPLOADS_ROOT || '/mnt/storage/uploads';
    },
};
