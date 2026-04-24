// ======================================================
// LUDARA Backend – CommonJS Version (Node 24 kompatibel)
// ======================================================

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();
app.use(bodyParser.json());

const upload = multer({ storage: multer.memoryStorage() });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ------------------------------------------------------
// Fallback-Antwort falls AI fehlschlägt
// ------------------------------------------------------
function buildFallbackAIResponse(inputText) {
  return {
    top5: [
      {
        code: "8518.22",
        description: `Fallback-HS-Code basierend auf: ${inputText}`,
        confidence: 0.9
      },
      {
        code: "8518.29",
        description: "Alternative Einreihung (Fallback)",
        confidence: 0.75
      }
    ],
    explanation: `Dies ist eine Fallback-Antwort, weil die AI keine gültige Antwort liefern konnte. Eingabe war: "${inputText}".`
  };
}

// ------------------------------------------------------
// OpenAI-Aufruf
// ------------------------------------------------------
async function callOpenAIForHS(inputText) {
  if (!OPENAI_API_KEY) {
    console.warn("WARNUNG: OPENAI_API_KEY fehlt → Fallback wird genutzt.");
    return buildFallbackAIResponse(inputText);
  }

  const prompt = `
Du bist ein Experte für Zolltarifierung und HS-Codes.
Analysiere die folgende Beschreibung oder Produktbezeichnung und gib mir eine strukturierte JSON-Antwort zurück.

EINGABE:
"${inputText}"

ANTWORTFORMAT (STRICT JSON):
{
  "top5": [
    {
      "code": "HS-Code als String",
      "description": "Kurzbeschreibung",
      "confidence": 0.0 bis 1.0
    }
  ],
  "explanation": "Warum diese HS-Codes gewählt wurden."
}
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
      temperature: 0.2
    })
  });

  if (!response.ok) {
    console.error("OpenAI HTTP-Fehler:", response.status, await response.text());
    return buildFallbackAIResponse(inputText);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("Fehler beim JSON-Parse:", err, content);
    return buildFallbackAIResponse(inputText);
  }

  if (!parsed.top5 || !Array.isArray(parsed.top5)) {
    return buildFallbackAIResponse(inputText);
  }

  parsed.top5 = parsed.top5.map(item => ({
    code: String(item.code),
    description: String(item.description),
    confidence: typeof item.confidence === "number" ? item.confidence : 0.5
  }));

  if (!parsed.explanation) {
    parsed.explanation = `Die HS-Codes wurden anhand der Eingabe "${inputText}" bestimmt.`;
  }

  return parsed;
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
    console.error("Fehler in /api/ai-hs:", err);
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
    console.error("Fehler in /api/ai-hs-image:", err);
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
    console.error("Fehler in /api/ai-hs-url:", err);
    return res.status(500).json(buildFallbackAIResponse("URL_ERROR"));
  }
});

// ======================================================
// HS-Suche (Dummy)
// ======================================================
app.get("/api/hs-codes", (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();

  const db = [
    { code: "8518.22", description: "Lautsprecher" },
    { code: "8518.50", description: "Kopfhörer" },
    { code: "8525.80", description: "Kamera" },
    { code: "8504.40", description: "Netzteil" },
    { code: "8517.12", description: "Smartphone" },
    { code: "CP030A", description: "Beispielgerät CP030A" }
  ];

  const results = db.filter(
    item =>
      item.code.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
  );

  return res.json(results);
});

// ======================================================
// NEWS (Dummy)
// ======================================================
app.get("/api/news", (req, res) => {
  return res.json([
    {
      title: "Zollsysteme werden modernisiert",
      description: "Neue digitale Prozesse angekündigt.",
      date: new Date(),
      category: "Zoll"
    },
    {
      title: "HS-Code Reform 2026",
      description: "Wichtige Änderungen treten in Kraft.",
      date: new Date(),
      category: "HS-Codes"
    }
  ]);
});

// ======================================================
// SERVER STARTEN
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("LUDARA Backend (CommonJS) läuft auf Port", PORT);
});
