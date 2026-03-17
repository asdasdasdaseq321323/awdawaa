const path = require("path");

const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-origin" },
    contentSecurityPolicy: false, // keep simple for a single-file page w/ inline CSS/JS
  })
);
app.use(compression());
app.use(express.json({ limit: "50kb" }));

// Static assets only (don’t expose server source)
app.use("/assets", express.static(path.join(__dirname, "assets"), { maxAge: "7d", etag: true }));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.post("/api/contact", contactLimiter, async (req, res) => {
  try {
    const { name, email, message, botcheck } = req.body || {};

    // Honeypot: bots often fill this hidden field
    if (botcheck) return res.status(200).json({ ok: true });

    const cleanName = String(name || "").trim().slice(0, 120);
    const cleanEmail = String(email || "").trim().slice(0, 200);
    const cleanMessage = String(message || "").trim().slice(0, 4000);

    if (!cleanName || !cleanEmail || !cleanMessage) {
      return res.status(400).json({ ok: false, error: "Vyplňte prosím jméno, e‑mail a zprávu." });
    }
    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ ok: false, error: "Zadejte prosím platný e‑mail." });
    }

    const accessKey = requiredEnv("WEB3FORMS_ACCESS_KEY");

    const fd = new FormData();
    fd.set("access_key", accessKey);
    fd.set("name", cleanName);
    fd.set("email", cleanEmail);
    fd.set("message", cleanMessage);
    fd.set("subject", "Poptávka webu — DesignerWeb");
    fd.set("from_name", "designerweb.cz");

    const resp = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: fd,
    });
    const raw = await resp.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!resp.ok || data.success !== true) {
      const msg =
        (data && typeof data.message === "string" && data.message.trim()) ||
        (raw && raw.slice(0, 300).replace(/\s+/g, " ").trim()) ||
        "Odeslání se nepovedlo (Web3Forms).";

      return res.status(502).json({
        ok: false,
        error: msg,
        status: resp.status,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    const msg = err && typeof err.message === "string" ? err.message : "";
    if (msg.startsWith("Missing env var:")) {
      return res.status(500).json({ ok: false, error: msg });
    }
    return res.status(500).json({
      ok: false,
      error: "Omlouváme se, odeslání se nepovedlo. Zkuste to prosím znovu.",
    });
  }
});

const port = Number(process.env.PORT || 4174);
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

