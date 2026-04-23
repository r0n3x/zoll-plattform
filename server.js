const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs'); // Render-kompatibel

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- DATABASE CONNECTION ----------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static('public'));

// ---------- INIT DATABASE ----------

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      full_name VARCHAR(255),
      username VARCHAR(50) UNIQUE,
      avatar_url TEXT,
      cover_url TEXT,
      bio TEXT,
      location VARCHAR(255),
      website VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friends (
      id SERIAL PRIMARY KEY,
      requester_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      addressee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS likes (
      id SERIAL PRIMARY KEY,
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (post_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(50),
      payload JSONB,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hs_codes (
      id SERIAL PRIMARY KEY,
      code VARCHAR(20) NOT NULL,
      description TEXT NOT NULL,
      year VARCHAR(4) NOT NULL,
      source VARCHAR(20) DEFAULT 'import',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

// ---------- LOAD HS JSON ----------

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

// ---------- HS SEARCH API ----------

app.get('/api/hs-codes', async (req, res) => {
  try {
    const q = req.query.q || '';
    const year = req.query.year || '2026';

    if (!q) return res.json([]);

    const dbResult = await pool.query(
      `SELECT code, description, year
       FROM hs_codes
       WHERE (code ILIKE $1 OR description ILIKE $1)
       AND year = $2
       ORDER BY code
       LIMIT 100`,
      [`%${q}%`, year]
    );

    const dbMapped = dbResult.rows.map(r => ({
      code: r.code,
      description: r.description,
      year: r.year,
      source: "db"
    }));

    const fileData = loadHS(year);

    const fileMatches = fileData
      .filter(item =>
        item.code.includes(q) ||
        item.description.toLowerCase().includes(q.toLowerCase())
      )
      .map(item => ({
        code: item.code,
        description: item.description,
        year: item.year || year,
        source: "file"
      }));

    const seen = new Set(dbMapped.map(x => x.code));
    const merged = [
      ...dbMapped,
      ...fileMatches.filter(x => !seen.has(x.code))
    ];

    res.json(merged);

  } catch (e) {
    console.error("HS-Code Fehler:", e);
    res.status(500).json({ error: "Fehler bei der HS-Code Suche" });
  }
});

// ---------- AUTH API ----------

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name, username } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email und password erforderlich' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, created_at`,
      [email, password_hash]
    );

    const user = userResult.rows[0];

    const profileResult = await pool.query(
      `INSERT INTO profiles (user_id, full_name, username)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user.id, full_name || null, username || null]
    );

    res.json({ user, profile: profileResult.rows[0] });

  } catch (e) {
    console.error("Register Fehler:", e);
    res.status(500).json({ error: "Fehler bei der Registrierung" });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const userResult = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
    }

    const user = userResult.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash || '');

    if (!ok) {
      return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
    }

    const profileResult = await pool.query(
      `SELECT * FROM profiles WHERE user_id = $1`,
      [user.id]
    );

    res.json({
      user: { id: user.id, email: user.email },
      profile: profileResult.rows[0] || null
    });

  } catch (e) {
    console.error("Login Fehler:", e);
    res.status(500).json({ error: "Fehler beim Login" });
  }
});

// ---------- PROFILE API ----------

app.get('/api/profiles/:username', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.email
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.username = $1`,
      [req.params.username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profil nicht gefunden' });
    }

    res.json(result.rows[0]);

  } catch (e) {
    console.error("Profil Fehler:", e);
    res.status(500).json({ error: "Fehler beim Abrufen des Profils" });
  }
});

// ---------- POSTS API ----------

app.post('/api/posts', async (req, res) => {
  try {
    const { user_id, content, image_url } = req.body;

    const result = await pool.query(
      `INSERT INTO posts (user_id, content, image_url)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user_id, content, image_url || null]
    );

    res.json(result.rows[0]);

  } catch (e) {
    console.error("Post Fehler:", e);
    res.status(500).json({ error: "Fehler beim Erstellen des Posts" });
  }
});

app.get('/api/posts/feed', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, pr.username, pr.full_name, pr.avatar_url
       FROM posts p
       JOIN profiles pr ON pr.user_id = p.user_id
       ORDER BY p.created_at DESC
       LIMIT 100`
    );

    res.json(result.rows);

  } catch (e) {
    console.error("Feed Fehler:", e);
    res.status(500).json({ error: "Fehler beim Abrufen des Feeds" });
  }
});

// ---------- NEWS API ----------

app.get('/api/news', (req, res) => {
  res.json([
    {
      id: 1,
      title: "Aktuelle Änderungen im EU-Zolltarif",
      source: "EU-Kommission",
      date: "2026-04-20",
      summary: "Neue Anpassungen im Bereich Elektronik und Maschinen wurden veröffentlicht."
    },
    {
      id: 2,
      title: "Digitalisierung der Zollabwicklung",
      source: "Bundeszollverwaltung",
      date: "2026-04-18",
      summary: "Elektronische Anmeldungen und automatisierte Prüfungen werden weiter ausgebaut."
    }
  ]);
});

// ---------- START SERVER ----------

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
  })
  .catch(err => {
    console.error("DB Init Fehler:", err);
    process.exit(1);
  });
