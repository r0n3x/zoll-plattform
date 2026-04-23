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

// ------------------ AUTH ------------------

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

// ------------------ HS-CODE: LOKAL + ONLINE (UN COMTRADE) + AI + DUTIES ------------------

app.get('/api/hs-codes', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q) return res.json([]);

    // 1) Lokale Volltextsuche
    const local = await pool.query(
      `SELECT code, description,
        ts_rank_cd(
          to_tsvector('german', coalesce(code,'') || ' ' || coalesce(description,'')),
          plainto_tsquery('german', $1)
        ) AS rank
       FROM hs_codes
       WHERE to_tsvector('german', coalesce(code,'') || ' ' || coalesce(description,'')) @@ plainto_tsquery('german', $1)
       ORDER BY rank DESC
       LIMIT 20`,
      [q]
    );

    const localMapped = local.rows.map(r => ({
      code: r.code,
      description: r.description,
      source: 'local'
    }));

    // 2) Online-Suche über UN Comtrade (stabil, JSON)
    let onlineMapped = [];
    try {
      const url = `https://comtradeapi.un.org/public/v1/preview/hs?search=${encodeURIComponent(q)}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data && data.data) {
        onlineMapped = data.data.map(item => ({
          code: item.cmdCode,
          description: item.cmdDesc,
          source: 'online'
        }));
      }

      // Autosave
      for (const item of onlineMapped) {
        await pool.query(
          'INSERT INTO hs_codes (code, description) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING',
          [item.code, item.description]
        );
      }
    } catch (e) {
      console.error('Online HS Fehler:', e.message);
    }

    // 3) Merge
    const seen = new Set(localMapped.map(x => x.code));
    const merged = [...localMapped, ...onlineMapped.filter(x => !seen.has(x.code))];

    res.json(merged);
  } catch (e) {
    console.error('HS-Code Fehler:', e);
    res.status(500).json({ error: 'HS-Code Fehler' });
  }
});

// AI / Semantische Suche
app.get('/api/hs-codes/ai', async (req, res) => {
  try {
    const term = req.query.term || '';
    if (!term) return res.json([]);

    const url = `https://comtradeapi.un.org/public/v1/preview/hs?search=${encodeURIComponent(term)}`;
    const response = await fetch(url);
    const data = await response.json();

    const results = (data.data || []).map(item => ({
      code: item.cmdCode,
      description: item.cmdDesc,
      score: item.score || null
    }));

    res.json(results);
  } catch (e) {
    console.error('AI Fehler:', e);
    res.status(500).json({ error: 'AI Fehler' });
  }
});

// Zollsätze (Duties)
app.get('/api/hs-codes/duties', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: 'code fehlt' });

    const url = `https://comtradeapi.un.org/public/v1/preview/hs?cmdCode=${encodeURIComponent(code)}`;
    const response = await fetch(url);
    const data = await response.json();

    res.json(data);
  } catch (e) {
    console.error('Duties Fehler:', e);
    res.status(500).json({ error: 'Duties Fehler' });
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
