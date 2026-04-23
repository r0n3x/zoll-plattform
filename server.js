const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const RSSParser = require('rss-parser');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const ZOLL_RSS_URL = process.env.ZOLL_RSS_URL;
const EXCHANGE_API_URL = process.env.EXCHANGE_API_URL || 'https://api.exchangerate.host/latest';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// ------------------ DB INIT ------------------

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      public_id VARCHAR(20) UNIQUE,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      full_name VARCHAR(255),
      avatar_url TEXT,
      bio TEXT,
      location VARCHAR(255)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hs_codes (
      id SERIAL PRIMARY KEY,
      code VARCHAR(20) UNIQUE,
      description TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      room VARCHAR(255) NOT NULL,
      user_id INTEGER REFERENCES users(id),
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games_scores (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      game_key VARCHAR(50),
      score INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

// ------------------ HS-DATEI LADEN ------------------

function loadHS(year = "2026") {
  try {
    const filePath = path.join(__dirname, "data", "hs", `hs_${year}.json`);
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("Fehler beim Laden der HS-Datei:", e);
    return [];
  }
}

// ------------------ AUTH ------------------

function generatePublicId(id) {
  return `1.${String(id).padStart(3, '0')}`;
}

function getTokenFromCookieHeader(header) {
  if (!header) return null;
  const parts = header.split(';').map(p => p.trim());
  const tokenPart = parts.find(p => p.startsWith('token='));
  return tokenPart ? tokenPart.replace('token=', '') : null;
}

function authMiddleware(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Ungültiger Token' });
  }
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(400).json({ error: 'Email existiert bereits' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id',
      [email, hash]
    );

    const userId = result.rows[0].id;
    const publicId = generatePublicId(userId);

    await pool.query('UPDATE users SET public_id=$1 WHERE id=$2', [publicId, userId]);
    await pool.query('INSERT INTO profiles (user_id) VALUES ($1)', [userId]);

    const token = jwt.sign({ id: userId, email, publicId }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });

    res.json({ message: 'Registriert', publicId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length) return res.status(400).json({ error: 'Ungültige Daten' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ error: 'Ungültige Daten' });

    const token = jwt.sign({ id: user.id, email, publicId: user.public_id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });

    res.json({ message: 'Login OK', publicId: user.public_id });
  } catch {
    res.status(500).json({ error: 'Serverfehler' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout OK' });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

// ------------------ PROFILE ------------------

app.get('/api/profile/me', authMiddleware, async (req, res) => {
  const result = await pool.query(
    `SELECT u.public_id, u.email, p.full_name, p.avatar_url, p.bio, p.location
     FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=$1`,
    [req.user.id]
  );
  res.json(result.rows[0]);
});

app.put('/api/profile/me', authMiddleware, async (req, res) => {
  const { full_name, avatar_url, bio, location } = req.body;
  await pool.query(
    `UPDATE profiles SET full_name=$1, avatar_url=$2, bio=$3, location=$4 WHERE user_id=$5`,
    [full_name, avatar_url, bio, location, req.user.id]
  );
  res.json({ message: 'Profil aktualisiert' });
});

// ------------------ HS-CODE FINDER (Datei + DB) ------------------

app.get('/api/hs-codes', async (req, res) => {
  try {
    const q = req.query.q || '';
    const year = req.query.year || '2026';

    if (!q) return res.json([]);

    // 1) Lokale DB-Suche
    const local = await pool.query(
      `SELECT code, description
       FROM hs_codes
       WHERE code ILIKE $1 OR description ILIKE $1
       ORDER BY code
       LIMIT 50`,
      [`%${q}%`]
    );

    const localMapped = local.rows.map(r => ({
      code: r.code,
      description: r.description,
      source: "local"
    }));

    // 2) HS-Datei laden
    const hsData = loadHS(year);

    const fileMatches = hsData
      .filter(item =>
        item.code.includes(q) ||
        item.description.toLowerCase().includes(q.toLowerCase())
      )
      .map(item => ({
        code: item.code,
        description: item.description,
        source: "file"
      }));

    // 3) Merge ohne Duplikate
    const seen = new Set(localMapped.map(x => x.code));
    const merged = [
      ...localMapped,
      ...fileMatches.filter(x => !seen.has(x.code))
    ];

    res.json(merged);

  } catch (e) {
    console.error("HS-Code Fehler:", e);
    res.status(500).json({ error: "Fehler bei der HS-Code Suche" });
  }
});

// ------------------ WÄHRUNGEN ------------------

app.get('/api/currency/rates', async (req, res) => {
  const base = req.query.base || 'EUR';
  const response = await fetch(`${EXCHANGE_API_URL}?base=${base}`);
  res.json(await response.json());
});

app.post('/api/customs-value', async (req, res) => {
  const { amount, fromCurrency, toCurrency, freight = 0, insurance = 0 } = req.body;

  const response = await fetch(`${EXCHANGE_API_URL}?base=${fromCurrency}`);
  const data = await response.json();

  const rate = data.rates[toCurrency];
  const baseValue = Number(amount) + Number(freight) + Number(insurance);

  res.json({
    rate,
    customsValueBase: baseValue,
    customsValueTarget: baseValue * rate
  });
});

// ------------------ NEWS ------------------

const rssParser = new RSSParser();

app.get('/api/news/zoll', async (req, res) => {
  const feed = await rssParser.parseURL(ZOLL_RSS_URL);
  res.json(feed.items);
});

// ------------------ CHAT ------------------

io.use((socket, next) => {
  const token = getTokenFromCookieHeader(socket.handshake.headers.cookie);
  if (!token) return next(new Error('Nicht autorisiert'));

  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Ungültiger Token'));
  }
});

io.on('connection', socket => {
  socket.join('global');

  socket.on('message', async ({ room = 'global', message }) => {
    await pool.query(
      'INSERT INTO chat_messages (room, user_id, message) VALUES ($1,$2,$3)',
      [room, socket.user.id, message]
    );

    io.to(room).emit('message', {
      user: { publicId: socket.user.publicId },
      message
    });
  });
});

// ------------------ START ------------------

initDb().then(() => {
  server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
});
