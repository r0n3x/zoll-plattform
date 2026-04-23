// ===============================
//  GAMING ASSOCIATION BACKEND
//  Voll funktionsfähig
//  Mit HS-2026 JSON Loader
// ===============================

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ===============================
//  IN-MEMORY DATENBANK
// ===============================

let users = [];
let profiles = [];
let posts = [];
let friends = [];

let news = [
  {
    id: 1,
    title: "Zoll-News 1",
    date: "2024-01-01",
    source: "Zollportal",
    summary: "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
  },
  {
    id: 2,
    title: "Zoll-News 2",
    date: "2024-01-02",
    source: "EU-Kommission",
    summary: "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
  }
];

let nextUserId = 1;
let nextPostId = 1;

// ===============================
//  HS-CODE DATENBANK LADEN
// ===============================

let hsCodes = [];

try {
  const hsPath = path.join(__dirname, "data", "hs", "hs_2026.json");
  const raw = fs.readFileSync(hsPath, "utf8");
  hsCodes = JSON.parse(raw);

  console.log("HS-Datenbank geladen:", hsCodes.length, "Einträge");
} catch (err) {
  console.error("Fehler beim Laden der HS-Datenbank:", err);
}

// ===============================
//  AUTH
// ===============================

// Registrierung
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, full_name, username } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "E-Mail und Passwort erforderlich" });

    const exists = users.find(u => u.email === email);
    if (exists)
      return res.status(400).json({ error: "E-Mail bereits registriert" });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = {
      id: nextUserId++,
      email,
      passwordHash,
      full_name: full_name || "",
      username: username || `user${Date.now()}`
    };

    users.push(user);

    profiles.push({
      user_id: user.id,
      full_name: user.full_name || user.username,
      username: user.username,
      bio: "",
      location: "",
      website: ""
    });

    res.status(201).json({ message: "Registrierung erfolgreich" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Serverfehler bei Registrierung" });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = users.find(u => u.email === email);
    if (!user)
      return res.status(401).json({ error: "Ungültige Zugangsdaten" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok)
      return res.status(401).json({ error: "Ungültige Zugangsdaten" });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        username: user.username
      },
      profile: profiles.find(p => p.user_id === user.id)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Serverfehler bei Login" });
  }
});

// ===============================
//  PROFILE
// ===============================

app.get("/api/profiles/:username", (req, res) => {
  const profile = profiles.find(p => p.username === req.params.username);
  if (!profile)
    return res.status(404).json({ error: "Profil nicht gefunden" });

  res.json(profile);
});

// ===============================
//  POSTS
// ===============================

// Feed
app.get("/api/posts/feed", (req, res) => {
  const result = posts
    .slice()
    .sort((a, b) => b.id - a.id)
    .map(p => {
      const user = users.find(u => u.id === p.user_id);
      return {
        ...p,
        full_name: user?.full_name || "",
        username: user?.username || ""
      };
    });

  res.json(result);
});

// Posts eines Users
app.get("/api/posts/user/:id", (req, res) => {
  const userId = parseInt(req.params.id);

  const result = posts
    .filter(p => p.user_id === userId)
    .sort((a, b) => b.id - a.id)
    .map(p => {
      const user = users.find(u => u.id === p.user_id);
      return {
        ...p,
        full_name: user?.full_name || "",
        username: user?.username || ""
      };
    });

  res.json(result);
});

// Post erstellen
app.post("/api/posts", (req, res) => {
  const { user_id, content } = req.body;

  if (!user_id || !content)
    return res.status(400).json({ error: "user_id und content erforderlich" });

  const user = users.find(u => u.id === user_id);
  if (!user)
    return res.status(400).json({ error: "User existiert nicht" });

  const post = {
    id: nextPostId++,
    user_id,
    content,
    created_at: new Date().toISOString()
  };

  posts.push(post);

  res.status(201).json(post);
});

// ===============================
//  FREUNDE
// ===============================

app.get("/api/friends/:id", (req, res) => {
  const userId = parseInt(req.params.id);

  const result = friends
    .filter(f => f.user_id === userId)
    .map(f => {
      const u = users.find(x => x.id === f.friend_id);
      return {
        user_id: f.friend_id,
        full_name: u?.full_name || "",
        username: u?.username || ""
      };
    });

  res.json(result);
});

// ===============================
//  NEWS
// ===============================

app.get("/api/news", (req, res) => {
  res.json(news);
});

// ===============================
//  HS-CODE SUCHE
// ===============================

app.get("/api/hs-codes", (req, res) => {
  const q = (req.query.q || "").toLowerCase().trim();

  if (!q) return res.json([]);

  const result = hsCodes.filter(item =>
    item.code.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q)
  );

  res.json(result);
});

// ===============================
//  SERVER START
// ===============================

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
