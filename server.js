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
   NEWS – SÜDDEUTSCHE ZEITUNG (STABIL)
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

async function loadSZNews() {
    try {
        const response = await axios.get("https://www.sueddeutsche.de/news/rss", {
            responseType: "text",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }
        });

        const xml = response.data;

        const parser = new xml2js.Parser({
            explicitArray: false,
            mergeAttrs: true,
            strict: false
        });

        const result = await parser.parseStringPromise(xml);
        const items = result?.rss?.channel?.item || [];

        cachedNews = items.slice(0, 25).map(item => ({
            title: item.title || "",
            link: item.link || "",
            date: item.pubDate || "",
            description: item.description || "",
            category: detectCategory(item)
        }));

        console.log("SZ-News geladen:", cachedNews.length);

    } catch (err) {
        console.error("Fehler beim Laden der SZ-News:", err);
    }
}

// Beim Start laden
loadSZNews();

// Alle 30 Minuten aktualisieren
setInterval(loadSZNews, 30 * 60 * 1000);

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
