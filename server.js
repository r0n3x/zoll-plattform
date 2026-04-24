const express = require("express");
const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");   // <— EINMAL, korrekt

const app = express();
app.use(express.json());
app.use(express.static("public"));

// -----------------------------------------------------
// HS-CODE DATEN LADEN
// -----------------------------------------------------
let hsCodes = [];

try {
    const hsPath = path.join(__dirname, "data/hs/hs_2026.json");
    const raw = fs.readFileSync(hsPath, "utf8");
    hsCodes = JSON.parse(raw);
    console.log("HS Codes geladen:", hsCodes.length);
} catch (err) {
    console.error("Fehler beim Laden der HS-Daten:", err);
}

// API: HS-Code Suche
app.get("/api/hs-codes", (req, res) => {
    const q = (req.query.q || "").toLowerCase();

    const results = hsCodes.filter(item =>
        item.code.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );

    res.json(results);
});

// -----------------------------------------------------
// AUTOMATISCHE ZOLL NEWS (ROBUST VERSION)
// -----------------------------------------------------
const parser = new Parser({
    xml2js: {
        strict: false,          // toleriert fehlerhafte XML-Attribute
        normalizeTags: true,
        mergeAttrs: true
    }
});

let cachedNews = [];

async function loadZollNews() {
    try {
        const feed = await parser.parseURL(
            "https://www.zoll.de/SiteGlobals/Functions/RSSFeed/DE/RSSNewsfeed.xml"
        );

        cachedNews = (feed.items || []).slice(0, 20).map(item => ({
            title: item.title || "",
            link: item.link || "",
            date: item.pubdate || item.pubDate || "",
            description: item.description || item.contentSnippet || ""
        }));

        console.log("Zoll-News aktualisiert:", cachedNews.length);

    } catch (err) {
        console.error("Fehler beim Laden der Zoll-News:", err);
    }
}

// Beim Start laden
loadZollNews();

// Alle 30 Minuten aktualisieren
setInterval(loadZollNews, 30 * 60 * 1000);

// API: Zoll-News
app.get("/api/news", (req, res) => {
    res.json(cachedNews);
});

// -----------------------------------------------------
// SERVER STARTEN
// -----------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server läuft auf Port", PORT);
});
