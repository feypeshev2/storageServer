const express = require('express');
const cors = require('cors');
const { auth } = require('./lib/auth');
const { UPLOADS_ROOT } = require('./lib/config');

const app = express();

const origins = (process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : ['https://app.openbuzludzha.bg', 'https://dev.openbuzludzha.bg', 'http://localhost:50000', 'http://localhost:3000']);
app.use(cors({ origin: origins }));
app.use(express.json());

// Uploaded files are served publicly by (unguessable) name; everything that changes them needs a token.
app.use('/uploads', express.static(UPLOADS_ROOT, { dotfiles: 'deny', index: false }));

app.use('/images', auth, require('./routes/images'));
app.use('/files', auth, require('./routes/files'));

module.exports = app;
