const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

    // 1) DB-Suche
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

    // 2) JSON-Datei
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

    // 3) Merge ohne Duplikate
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
