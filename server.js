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
   AUTOMATISCHE ZOLL-NEWS (MIT KATEGORIEN)
----------------------------------------------------- */

let cachedNews = [];

function detectCategory(item) {
    const t = (item.title || "").toLowerCase();
    const d = (item.description || "").toLowerCase();

    if (t.includes("eu") || d.includes("eu")) return "eu";
    if (t.includes("wirtschaft") || d.includes("wirtschaft")) return "wirtschaft";
    return "zoll"; // Default
}

async function loadZollNews() {
    try {
        const url = "https://www.zoll.de/SiteGlobals/Functions/RSSFeed/DE/RSSNewsfeed.xml";

        const response = await axios.get(url, { responseType: "text" });
        const xml = response.data;

        const parser = new xml2js.Parser({
            explicitArray: false,
            mergeAttrs: true,
            strict: false
        });

        const result = await parser.parseStringPromise(xml);

        const items =
            result?.rss?.channel?.item ||
            result?.feed?.entry ||
            [];

        cachedNews = items.slice(0, 30).map(item => ({
            title: item.title || "",
            link: item.link?.href || item.link || "",
            date: item.pubDate || item.updated || "",
            description: item.description || item.summary || "",
            category: detectCategory(item)
        }));

        console.log("Zoll-News geladen:", cachedNews.length);

    } catch (err) {
        console.error("Fehler beim Laden der Zoll-News:", err);
    }
}

// Beim Start laden
loadZollNews();

// Alle 30 Minuten aktualisieren
setInterval(loadZollNews, 30 * 60 * 1000);

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
