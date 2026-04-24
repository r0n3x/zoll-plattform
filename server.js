const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

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
   NEWS – VIA RSS2JSON (GARANTIERT FUNKTIONIEREND)
----------------------------------------------------- */

let cachedNews = [];

function detectCategory(item) {
    const t = (item.title || "").toLowerCase();
    const d = (item.description || "").toLowerCase();

    if (t.includes("eu") || d.includes("eu")) return "eu";
    if (t.includes("wirtschaft") || d.includes("wirtschaft")) return "wirtschaft";
    if (t.includes("politik") || d.includes("politik")) return "politik";
    return "news";
}

async function loadNews() {
    try {
        const url =
            "https://api.rss2json.com/v1/api.json?rss_url=https://www.tagesschau.de/xml/rss2";

        const response = await axios.get(url);
        const items = response.data.items || [];

        cachedNews = items.slice(0, 25).map(item => ({
            title: item.title || "",
            link: item.link || "",
            date: item.pubDate || "",
            description: item.description || "",
            category: detectCategory(item)
        }));

        console.log("News geladen:", cachedNews.length);

    } catch (err) {
        console.error("Fehler beim Laden der News:", err);
    }
}

// Beim Start laden
loadNews();

// Alle 30 Minuten aktualisieren
setInterval(loadNews, 30 * 60 * 1000);

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
