// ======================================================
// LUDARA Backend – Web Search + AI HS-Code Finder
// ======================================================

const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

const upload = multer({ storage: multer.memoryStorage() });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ------------------------------------------------------
// Root Route
// ------------------------------------------------------
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// ------------------------------------------------------
// Fallback-Antwort
// ------------------------------------------------------
function buildFallbackAIResponse(inputText) {
  return {
    top5: [
      {
        code: "0000.00",
        description: `Keine Daten gefunden für: ${inputText}`,
        confidence: 0.1
      }
    ],
    explanation: `Die Websuche lieferte keine verwertbaren Informationen.`
  };
}

// ------------------------------------------------------
// WEB-SUCHE (DuckDuckGo HTML Scraper)
// ------------------------------------------------------
async function webSearch(query) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query + " HS Code")}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const html = await response.text();

  // Sehr einfacher Text-Extractor
  const cleaned = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, 5000); // AI braucht nicht mehr
}

// ------------------------------------------------------
// AI HS-CODE ANALYSE MIT WEB-DATEN
// ------------------------------------------------------
async function callOpenAIForHS(inputText) {
  if (!OPENAI_API_KEY) {
    return buildFallbackAIResponse(inputText);
  }

  // 1) Websuche durchführen
  const webData = await webSearch(inputText);

  const prompt = `
Du bist ein professioneller Zollexperte mit Spezialisierung auf HS-Codes.

Hier sind echte Web-Suchergebnisse zum Produkt:
---
${webData}
---

Aufgabe:
- Analysiere die Webdaten.
- Ermittle die wahrscheinlichsten HS-Codes.
- Nutze WCO-Regeln (GRI 1–6).
- Gib nur echte 6-stellige HS-Codes zurück.
- Erkläre, warum diese Codes passen.
- Wenn Webdaten unklar sind: schätze basierend auf Funktion & Material.

ANTWORTFORMAT (STRICT JSON):
{
  "top5": [
    {
      "code": "HS-Code",
      "description": "Kurzbeschreibung",
      "confidence": 0.0 bis 1.0
    }
  ],
  "explanation": "Warum diese HS-Codes gewählt wurden."
}

EINGABE:
"${inputText}"
`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Du antwortest ausschließlich mit gültigem JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    return buildFallbackAIResponse(inputText);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch {
    return buildFallbackAIResponse(inputText);
  }
}

// ======================================================
// TEXT → HS
// ======================================================
app.post("/api/ai-hs", async (req, res) => {
  try {
    const q = (req.body?.q || "").trim();
    if (!q) return res.status(400).json({ error: "Parameter 'q' fehlt" });

    const result = await callOpenAIForHS(q);
    return res.json(result);

  } catch (err) {
    return res.status(500).json(buildFallbackAIResponse("INTERNAL_ERROR"));
  }
});

// ======================================================
// FOTO → HS
// ======================================================
app.post("/api/ai-hs-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Kein Bild erhalten" });

    const result = await callOpenAIForHS(`Foto: ${req.file.originalname}`);
    return res.json(result);

  } catch (err) {
    return res.status(500).json(buildFallbackAIResponse("IMAGE_ERROR"));
  }
});

// ======================================================
// URL → HS
// ======================================================
app.post("/api/ai-hs-url", async (req, res) => {
  try {
    const url = (req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "Parameter 'url' fehlt" });

    const result = await callOpenAIForHS(`Bild-URL: ${url}`);
    return res.json(result);

  } catch (err) {
    return res.status(500).json(buildFallbackAIResponse("URL_ERROR"));
  }
});

// ======================================================
// SERVER STARTEN
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("LUDARA Backend läuft auf Port", PORT);
});
