const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors(
    {
        origin: [
            'https://dev.openbuzludzha.bg',
            'http://localhost:50000',
            'http://localhost:3000',
        ],
    }


));
app.use(express.json());

// Serve static files
app.use('/uploads', express.static('/mnt/storage/uploads'));

// Routes
app.use('/images', require('./routes/images'));

app.listen(PORT, () => {
    console.log(`✅ OBF Storage server listening on :${PORT}`);
});