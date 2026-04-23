const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ===== In-Memory "Datenbank" =====
let users = [];          // { id, email, passwordHash, full_name, username }
let profiles = [];       // { user_id, full_name, username, bio, location, website }
let posts = [];          // { id, user_id, content, created_at }
let friends = [];        // { user_id, friend_id }
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

let hsCodes = [
  { code: "0101", description: "Lebende Pferde" },
  { code: "0102", description: "Lebende Rinder" },
  { code: "0201", description: "Rindfleisch, frisch oder gekühlt" },
  { code: "0202", description: "Rindfleisch, gefroren" },
  { code: "8471", description: "Datenverarbeitungsmaschinen (Computer)" }
];

let nextUserId = 1;
let nextPostId = 1;

// ===== AUTH =====

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, full_name, username } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "E-Mail und Passwort erforderlich" });
    }

    const existing = users.find(u => u.email === email);
    if (existing) {
      return res.status(400).json({ error: "E-Mail bereits registriert" });
    }

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

    return res.status(201).json({ message: "Registrierung erfolgreich" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Serverfehler bei Registrierung" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ error: "Ungültige Zugangsdaten" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Ungültige Zugangsdaten" });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        username: user.username
      },
      profile: profiles.find(p => p.user_id === user.id) || null
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Serverfehler bei Login" });
  }
});

// ===== PROFILE =====

app.get("/api/profiles/:username", (req, res) => {
  const username = req.params.username;
  const profile = profiles.find(p => p.username === username);
  if (!profile) {
    return res.status(404).json({ error: "Profil nicht gefunden" });
  }
  return res.json(profile);
});

// ===== POSTS =====

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
  return res.json(result);
});

app.get("/api/posts/user/:id", (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const userPosts = posts
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
  return res.json(userPosts);
});

app.post("/api/posts", (req, res) => {
  const { user_id, content } = req.body;
  if (!user_id || !content) {
    return res.status(400).json({ error: "user_id und content erforderlich" });
  }

  const user = users.find(u => u.id === user_id);
  if (!user) {
    return res.status(400).json({ error: "User existiert nicht" });
  }

  const post = {
    id: nextPostId++,
    user_id,
    content,
    created_at: new Date().toISOString()
  };
  posts.push(post);

  return res.status(201).json(post);
});

// ===== FREUNDE =====

app.get("/api/friends/:id", (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const friendLinks = friends.filter(f => f.user_id === userId);
  const result = friendLinks.map(f => {
    const u = users.find(x => x.id === f.friend_id);
    return {
      user_id: f.friend_id,
      full_name: u?.full_name || "",
      username: u?.username || ""
    };
  });
  return res.json(result);
});

// ===== NEWS =====

app.get("/api/news", (req, res) => {
  return res.json(news);
});

// ===== HS-CODES =====

app.get("/api/hs-codes", (req, res) => {
  const q = (req.query.q || "").toString().toLowerCase().trim();
  if (!q) {
    return res.json([]);
  }

  const result = hsCodes.filter(item => {
    return (
      item.code.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
    );
  });

  return res.json(result);
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
