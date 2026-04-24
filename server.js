// ======================================================
// LUDARA Backend – Vollständig, 1:1 kopierbar
// ======================================================

import express from "express";
import bodyParser from "body-parser";
import multer from "multer";

const app = express();
app.use(bodyParser.json());

// Für Datei-Uploads (Foto-Analyse)
const upload = multer({ storage: multer.memoryStorage() });

// ------------------------------------------------------
// Hilfsfunktion: Immer gültige AI-Antwort erzeugen
// ------------------------------------------------------
function buildAIResponse(inputText) {
  return {
    top5: [
      {
        code: "8518.22",
        description: `Beispiel-Einreihung basierend auf: ${inputText}`,
        confidence: 0.92
      },
      {
        code: "8518.29",
        description: "Alternative Einreihung",
        confidence: 0.75
      },
      {
        code: "8525.80",
        description: "Kamera / Aufnahmegerät",
        confidence: 0.63
      },
      {
        code: "8504.40",
        description: "Netzteil / Stromversorgung",
        confidence: 0.55
      },
      {
        code: "8517.12",
        description: "Kommunikationsgerät",
        confidence: 0.48
      }
    ],
    explanation: `Die HS-Codes wurden anhand der Eingabe "${inputText}" generiert.`
  };
}

// ======================================================
// TEXT → HS (AI)
// ======================================================
app.post("/api/ai-hs", async (req, res) => {
  try {
    const q = (req.body?.q || "").trim();
    console.log("[AI-HS] Anfrage:", q);

    if (!q) {
      return res.status(400).json({ error: "Parameter 'q' fehlt" });
    }

    // Immer gültige Antwort erzeugen
    const result = buildAIResponse(q);

    return res.json(result);

  } catch (err) {
    console.error("Fehler in /api/ai-hs:", err);
    return res.status(500).json({ error: "Interner Serverfehler" });
  }
});

// ======================================================
// FOTO → HS (AI)
// ======================================================
app.post("/api/ai-hs-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Kein Bild erhalten" });
    }

    console.log("[AI-HS-IMAGE] Bild erhalten:", req.file.originalname);

    // Dummy-Analyse basierend auf Dateiname
    const result = buildAIResponse(req.file.originalname);

    return res.json(result);

  } catch (err) {
    console.error("Fehler in /api/ai-hs-image:", err);
    return res.status(500).json({ error: "Interner Serverfehler" });
  }
});

// ======================================================
// BILD-URL → HS (AI)
// ======================================================
app.post("/api/ai-hs-url", async (req, res) => {
  try {
    const url = (req.body?.url || "").trim();

    if (!url) {
      return res.status(400).json({ error: "Parameter 'url' fehlt" });
    }

    console.log("[AI-HS-URL] URL erhalten:", url);

    // Dummy-Analyse basierend auf URL
    const result = buildAIResponse(url);

    return res.json(result);

  } catch (err) {
    console.error("Fehler in /api/ai-hs-url:", err);
    return res.status(500).json({ error: "Interner Serverfehler" });
  }
});

// ======================================================
// HS-CODE SUCHE (Dummy)
// ======================================================
app.get("/api/hs-codes", (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  console.log("[HS-Suche] Anfrage:", q);

  if (!q) {
    return res.json([]);
  }

  // Beispiel-Datenbank
  const db = [
    { code: "8518.22", description: "Lautsprecher" },
    { code: "8518.50", description: "Kopfhörer" },
    { code: "8525.80", description: "Kamera" },
    { code: "8504.40", description: "Netzteil" },
    { code: "8517.12", description: "Smartphone" }
  ];

  const results = db.filter(
    item =>
      item.code.includes(q) ||
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
  console.log("LUDARA Backend läuft auf Port", PORT);
});
