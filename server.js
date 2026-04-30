'use strict';

const express = require('express');
const path = require('path');
const { initDb } = require('./db/database');
const designsRouter = require('./routes/designs');
const revisionsRouter = require('./routes/revisions');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/designs', designsRouter);
app.use('/api/designs', revisionsRouter);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb();
app.listen(PORT, () => {
  console.log(`Ward & Burke — Pile Designer running on http://localhost:${PORT}`);
});
