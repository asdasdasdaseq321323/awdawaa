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

async function sendViaBrevo({ toEmail, fromEmail, replyToEmail, subject, text }) {
  const apiKey = requiredEnv("BREVO_API_KEY");

  const payload = {
    sender: { email: fromEmail, name: "DesignerWeb" },
    to: [{ email: toEmail }],
    replyTo: { email: replyToEmail },
    subject,
    textContent: text,
  };

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const raw = await resp.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }

  if (!resp.ok) {
    const msg =
      (data && (data.message || data.error || data.code)) ||
      (raw && raw.slice(0, 300).replace(/\s+/g, " ").trim()) ||
      `Brevo error (HTTP ${resp.status})`;
    const err = new Error(String(msg));
    err.status = resp.status;
    throw err;
  }

  return data;
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

    const toEmail = requiredEnv("TO_EMAIL");
    const fromEmail = requiredEnv("FROM_EMAIL");

    const subject = `Poptávka webu — DesignerWeb (${cleanName})`;
    const text = `Jméno: ${cleanName}\nE-mail: ${cleanEmail}\n\nZpráva:\n${cleanMessage}\n\n— Odesláno z designerweb.cz`;

    await sendViaBrevo({
      toEmail,
      fromEmail,
      replyToEmail: cleanEmail,
      subject,
      text,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("CONTACT_SEND_ERROR", {
      message: err && err.message,
      status: err && err.status,
    });
    const msg = err && typeof err.message === "string" ? err.message : "";
    if (msg.startsWith("Missing env var:")) {
      return res.status(500).json({ ok: false, error: msg });
    }
    if (err && typeof err.status === "number") {
      return res.status(502).json({ ok: false, error: `Brevo: ${msg}` });
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

