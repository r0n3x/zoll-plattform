const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static('public'));

// ---------- DB INIT ----------

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

// ---------- HS JSON LADEN ----------

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

// ---------- HS-SUCHE API ----------

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
       RETURNING id, user_id, full_name, username`,
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
    if (!email || !password) {
      return res.status(400).json({ error: 'email und password erforderlich' });
    }

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
      user: {
        id: user.id,
        email: user.email
      },
      profile: profileResult.rows[0] || null
    });
  } catch (e) {
    console.error("Login Fehler:", e);
    res.status(500).json({ error: "Fehler beim Login" });
  }
});

// ---------- USER & PROFILE API ----------

app.post('/api/users', async (req, res) => {
  try {
    const { email, full_name, username } = req.body;
    if (!email) return res.status(400).json({ error: 'email erforderlich' });

    const userResult = await pool.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id, email, created_at`,
      [email]
    );

    const user = userResult.rows[0];

    const profileResult = await pool.query(
      `INSERT INTO profiles (user_id, full_name, username)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, full_name, username`,
      [user.id, full_name || null, username || null]
    );

    res.json({ user, profile: profileResult.rows[0] });
  } catch (e) {
    console.error("User-Erstellung Fehler:", e);
    res.status(500).json({ error: "Fehler bei der Benutzererstellung" });
  }
});

app.get('/api/profiles/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const result = await pool.query(
      `SELECT p.*, u.email
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.username = $1`,
      [username]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profil nicht gefunden' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error("Profil-Abruf Fehler:", e);
    res.status(500).json({ error: "Fehler beim Abrufen des Profils" });
  }
});

app.put('/api/profiles/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { full_name, avatar_url, cover_url, bio, location, website } = req.body;

    const result = await pool.query(
      `UPDATE profiles
       SET full_name = COALESCE($1, full_name),
           avatar_url = COALESCE($2, avatar_url),
           cover_url = COALESCE($3, cover_url),
           bio = COALESCE($4, bio),
           location = COALESCE($5, location),
           website = COALESCE($6, website)
       WHERE username = $7
       RETURNING *`,
      [full_name, avatar_url, cover_url, bio, location, website, username]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Profil nicht gefunden' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error("Profil-Update Fehler:", e);
    res.status(500).json({ error: "Fehler beim Aktualisieren des Profils" });
  }
});

// ---------- FRIENDS API ----------

app.post('/api/friends/request', async (req, res) => {
  try {
    const { requester_id, addressee_id } = req.body;
    if (!requester_id || !addressee_id) {
      return res.status(400).json({ error: 'requester_id und addressee_id erforderlich' });
    }

    const result = await pool.query(
      `INSERT INTO friends (requester_id, addressee_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [requester_id, addressee_id]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, type, payload)
       VALUES ($1, 'friend_request', $2)`,
      [addressee_id, { from: requester_id }]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error("Freundschaftsanfrage Fehler:", e);
    res.status(500).json({ error: "Fehler bei der Freundschaftsanfrage" });
  }
});

app.post('/api/friends/accept', async (req, res) => {
  try {
    const { request_id } = req.body;
    if (!request_id) return res.status(400).json({ error: 'request_id erforderlich' });

    const result = await pool.query(
      `UPDATE friends
       SET status = 'accepted'
       WHERE id = $1
       RETURNING *`,
      [request_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error("Freundschaftsannahme Fehler:", e);
    res.status(500).json({ error: "Fehler beim Akzeptieren der Freundschaft" });
  }
});

app.get('/api/friends/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT f.*, p.username, p.full_name, p.avatar_url
       FROM friends f
       JOIN profiles p
         ON (p.user_id = f.requester_id AND f.addressee_id = $1)
         OR (p.user_id = f.addressee_id AND f.requester_id = $1)
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'`,
      [userId]
    );
    res.json(result.rows);
  } catch (e) {
    console.error("Freundesliste Fehler:", e);
    res.status(500).json({ error: "Fehler beim Abrufen der Freunde" });
  }
});

// ---------- POSTS / COMMENTS / LIKES API ----------

app.post('/api/posts', async (req, res) => {
  try {
    const { user_id, content, image_url } = req.body;
    if (!user_id || !content) return res.status(400).json({ error: 'user_id und content erforderlich' });

    const result = await pool.query(
      `INSERT INTO posts (user_id, content, image_url)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user_id, content, image_url || null]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error("Post-Erstellung Fehler:", e);
    res.status(500).json({ error: "Fehler beim Erstellen des Posts" });
  }
});

app.get('/api/posts/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT p.*, pr.username, pr.full_name, pr.avatar_url
       FROM posts p
       JOIN profiles pr ON pr.user_id = p.user_id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 100`,
      [userId]
    );
    res.json(result.rows);
  } catch (e) {
    console.error("User-Posts Fehler:", e);
    res.status(500).json({ error: "Fehler beim Abrufen der Posts" });
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

app.post('/api/comments', async (req, res) => {
  try {
    const { post_id, user_id, content } = req.body;
    if (!post_id || !user_id || !content) {
      return res.status(400).json({ error: 'post_id, user_id und content erforderlich' });
    }

    const result = await pool.query(
      `INSERT INTO comments (post_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [post_id, user_id, content]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error("Kommentar-Erstellung Fehler:", e);
    res.status(500).json({ error: "Fehler beim Erstellen des Kommentars" });
  }
});

app.get('/api/comments/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const result = await pool.query(
      `SELECT c.*, pr.username, pr.full_name, pr.avatar_url
       FROM comments c
       JOIN profiles pr ON pr.user_id = c.user_id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [postId]
    );
    res.json(result.rows);
  } catch (e) {
    console.error("Kommentare-Abruf Fehler:", e);
    res.status(500).json({ error: "Fehler beim Abrufen der Kommentare" });
  }
});

app.post('/api/likes', async (req, res) => {
  try {
    const { post_id, user_id } = req.body;
    if (!post_id || !user_id) return res.status(400).json({ error: 'post_id und user_id erforderlich' });

    const result = await pool.query(
      `INSERT INTO likes (post_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (post_id, user_id) DO NOTHING
       RETURNING *`,
      [post_id, user_id]
    );

    res.json(result.rows[0] || { status: 'already_liked' });
  } catch (e) {
    console.error("Like Fehler:", e);
    res.status(500).json({ error: "Fehler beim Liken" });
  }
});

app.get('/api/likes/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const result = await pool.query(
      `SELECT l.*, pr.username, pr.full_name, pr.avatar_url
       FROM likes l
       JOIN profiles pr ON pr.user_id = l.user_id
       WHERE l.post_id = $1`,
      [postId]
    );
    res.json(result.rows);
  } catch (e) {
    console.error("Likes-Abruf Fehler:", e);
    res.status(500).json({ error: "Fehler beim Abrufen der Likes" });
  }
});

// ---------- NOTIFICATIONS API ----------

app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );
    res.json(result.rows);
  } catch (e) {
    console.error("Notifications Fehler:", e);
    res.status(500).json({ error: "Fehler beim Abrufen der Benachrichtigungen" });
  }
});

// ---------- ZOLL-NEWS API ----------

app.get('/api/news', (req, res) => {
  const news = [
    {
      id: 1,
      title: "Aktuelle Änderungen im EU-Zolltarif",
      source: "EU-Kommission",
      date: "2026-04-20",
      category: "Zolltarif",
      summary: "Neue Anpassungen im Bereich Elektronik und Maschinen wurden veröffentlicht.",
      link: "#"
    },
    {
      id: 2,
      title: "Digitalisierung der Zollabwicklung",
      source: "Bundeszollverwaltung",
      date: "2026-04-18",
      category: "Digitalisierung",
      summary: "Elektronische Anmeldungen und automatisierte Prüfungen werden weiter ausgebaut.",
      link: "#"
    },
    {
      id: 3,
      title: "Neue Compliance-Anforderungen für Importeure",
      source: "WTO",
      date: "2026-04-15",
      category: "Compliance",
      summary: "Strengere Dokumentationspflichten für bestimmte Warengruppen treten in Kraft.",
      link: "#"
    }
  ];
  res.json(news);
});

// ---------- START ----------

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server läuft auf Port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("Fehler bei initDb:", err);
    process.exit(1);
  });
