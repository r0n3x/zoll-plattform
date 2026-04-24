const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const xml2js = require("xml2js");

const app = express();
app.use(express.json());
app.use(express.static("public"));

/* -----------------------------------------------------
   HS-CODE DATEN LADEN
----------------------------------------------------- */
let hsCodes = [];

try {
    const hsPath = path.join(__dirname, "data/hs/hs_2026.json");
    const raw = fs.readFileSync(hsPath, "utf8");
    hsCodes = JSON.parse(raw);
    console.log("HS Codes geladen:", hsCodes.length);
} catch (err) {
    console.error("Fehler beim Laden der HS-Daten:", err);
}

app.get("/api/hs-codes", (req, res) => {
    const q = (req.query.q || "").toLowerCase();

    const results = hsCodes.filter(item =>
        item.code.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );

    res.json(results);
});

/* -----------------------------------------------------
   TEST-NEWS (GARANTIERT SICHTBAR)
----------------------------------------------------- */

let cachedNews = [
  {
    title: "LUDARA Testmeldung 1",
    link: "https://example.com",
    date: new Date().toISOString(),
    description: "Dies ist eine automatisch generierte Testmeldung.",
    category: "news"
  },
  {
    title: "LUDARA Testmeldung 2",
    link: "https://example.com",
    date: new Date().toISOString(),
    description: "Wenn du das hier siehst, funktioniert dein Frontend.",
    category: "news"
  }
];

app.get("/api/news", (req, res) => {
  res.json(cachedNews);
});


/* -----------------------------------------------------
   SERVER STARTEN
----------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server läuft auf Port", PORT);
});
