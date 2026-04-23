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
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const ZOLL_RSS_URL = process.env.ZOLL_RSS_URL;
const EXCHANGE_API_URL = process.env.EXCHANGE_API_URL || 'https://api.exchangerate.host/latest';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// ---------- Hilfsfunktionen ----------

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
      code VARCHAR(20) NOT NULL,
      description TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      room VARCHAR(255) NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games_scores (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      game_key VARCHAR(50) NOT NULL,
      score INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

function generatePublicId(numericId) {
  return `1.${String(numericId).padStart(3, '0')}`; // 1.001, 1.002 ...
}

function authMiddleware(req, res, next) {
  const token = req.cookies.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Ungültiger Token' });
  }
}

function getTokenFromCookieHeader(header) {
  if (!header) return null;
  const parts = header.split(';').map(p => p.trim());
  const tokenPart = parts.find(p => p.startsWith('token='));
  if (!tokenPart) return null;
  return tokenPart.substring('token='.length);
}

// ---------- Auth Routen ----------

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email und Passwort erforderlich' });

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email bereits registriert' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
      [email, hash]
    );
    const userId = result.rows[0].id;
    const publicId = generatePublicId(userId);

    await pool.query('UPDATE users SET public_id = $1 WHERE id = $2', [publicId, userId]);
    await pool.query('INSERT INTO profiles (user_id) VALUES ($1)', [userId]);

    const token = jwt.sign({ id: userId, email, publicId }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ message: 'Registrierung erfolgreich', publicId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Ungültige Login-Daten' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ error: 'Ungültige Login-Daten' });

    const token = jwt.sign({ id: user.id, email: user.email, publicId: user.public_id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ message: 'Login erfolgreich', publicId: user.public_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout erfolgreich' });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, publicId: req.user.publicId });
});

// ---------- HS-Code Finder ----------

app.get('/api/hs-codes', async (req, res) => {
  try {
    const q = req.query.q || '';

    // 1) Lokale Datenbank durchsuchen
    const local = await pool.query(
      'SELECT * FROM hs_codes WHERE code ILIKE $1 OR description ILIKE $1 ORDER BY code LIMIT 20',
      [`%${q}%`]
    );

    // 2) Online-Suche (exchangerate.host/tax)
    const url = `https://api.exchangerate.host/tax?search=${encodeURIComponent(q)}`;
    const response = await fetch(url);
    const onlineData = await response.json();

    let online = [];
    if (onlineData && onlineData.rates) {
      online = onlineData.rates.map(item => ({
        code: item.code,
        description: item.description,
        source: "online"
      }));
    }

    // 3) Lokale + Online Ergebnisse kombinieren
    const combined = [
      ...local.rows.map(r => ({
        code: r.code,
        description: r.description,
        source: "local"
      })),
      ...online
    ];

    res.json(combined);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Fehler bei der HS-Code Suche' });
  }
});


// ---------- Währungs- & Zollwertrechner ----------

app.get('/api/currency/rates', async (req, res) => {
  try {
    const base = req.query.base || 'EUR';
    const url = `${EXCHANGE_API_URL}?base=${encodeURIComponent(base)}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Fehler beim Laden der Wechselkurse' });
  }
});

app.post('/api/customs-value', async (req, res) => {
  try {
    const { amount, fromCurrency, toCurrency, freight = 0, insurance = 0 } = req.body;
    if (!amount || !fromCurrency || !toCurrency) {
      return res.status(400).json({ error: 'amount, fromCurrency, toCurrency erforderlich' });
    }

    const url = `${EXCHANGE_API_URL}?base=${encodeURIComponent(fromCurrency)}`;
    const response = await fetch(url);
    const data = await response.json();
    const rate = data.rates[toCurrency];
    if (!rate) return res.status(400).json({ error: 'Zielwährung nicht gefunden' });

    const zollwertBasis = Number(amount) + Number(freight) + Number(insurance);
    const zollwertZiel = zollwertBasis * rate;

    res.json({
      fromCurrency,
      toCurrency,
      rate,
      customsValueBase: zollwertBasis,
      customsValueTarget: zollwertZiel
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Fehler beim Zollwertrechner' });
  }
});

// ---------- News-Feed deutscher Zoll ----------

const rssParser = new RSSParser();

app.get('/api/news/zoll', async (req, res) => {
  try {
    const feed = await rssParser.parseURL(ZOLL_RSS_URL);
    const items = feed.items.map(item => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      contentSnippet: item.contentSnippet
    }));
    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Fehler beim Laden der Zoll-News' });
  }
});

// ---------- Profile & User-Suche ----------

app.get('/api/profile/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.public_id, u.email, p.full_name, p.avatar_url, p.bio, p.location
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

app.put('/api/profile/me', authMiddleware, async (req, res) => {
  try {
    const { full_name, avatar_url, bio, location } = req.body;
    await pool.query(
      `UPDATE profiles
       SET full_name = $1, avatar_url = $2, bio = $3, location = $4
       WHERE user_id = $5`,
      [full_name || null, avatar_url || null, bio || null, location || null, req.user.id]
    );
    res.json({ message: 'Profil aktualisiert' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

app.get('/api/users/search', authMiddleware, async (req, res) => {
  try {
    const q = req.query.q || '';
    const result = await pool.query(
      `SELECT u.public_id, u.email, p.full_name, p.location
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.public_id ILIKE $1
          OR u.email ILIKE $1
          OR p.full_name ILIKE $1
       LIMIT 50`,
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

// ---------- Games: Scores speichern (optional) ----------

app.post('/api/games/score', authMiddleware, async (req, res) => {
  try {
    const { game_key, score } = req.body;
    if (!game_key || typeof score === 'undefined') {
      return res.status(400).json({ error: 'game_key und score erforderlich' });
    }
    await pool.query(
      'INSERT INTO games_scores (user_id, game_key, score) VALUES ($1, $2, $3)',
      [req.user.id, game_key, score]
    );
    res.json({ message: 'Score gespeichert' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

// ---------- Socket.IO Chat (Textchat) ----------

io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie;
  const token = getTokenFromCookieHeader(cookieHeader);
  if (!token) return next(new Error('Nicht autorisiert'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (e) {
    next(new Error('Ungültiger Token'));
  }
});

io.on('connection', (socket) => {
  console.log('User verbunden:', socket.user.publicId);

  socket.join('global');

  socket.on('joinRoom', (room) => {
    socket.join(room);
  });

  socket.on('message', async ({ room = 'global', message }) => {
    if (!message) return;
    const payload = {
      room,
      user: {
        id: socket.user.id,
        publicId: socket.user.publicId
      },
      message,
      createdAt: new Date().toISOString()
    };

    try {
      await pool.query(
        'INSERT INTO chat_messages (room, user_id, message) VALUES ($1, $2, $3)',
        [room, socket.user.id, message]
      );
    } catch (e) {
      console.error('Fehler beim Speichern der Chat-Nachricht', e);
    }

    io.to(room).emit('message', payload);
  });

  socket.on('disconnect', () => {
    console.log('User getrennt:', socket.user.publicId);
  });
});

// ---------- Start ----------

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server läuft auf Port ${PORT}`);
    });
  })
  .catch((e) => {
    console.error('DB-Init Fehler:', e);
    process.exit(1);
  });
