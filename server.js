const path = require("path");

const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

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

function makeTransporter() {
  const host = requiredEnv("SMTP_HOST");
  const port = Number(requiredEnv("SMTP_PORT"));
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  const user = requiredEnv("SMTP_USER");
  const pass = requiredEnv("SMTP_PASS");

  // Helpful for Render debugging (no secrets)
  console.log("SMTP_CONFIG", { host, port, secure, user: String(user).replace(/(.{2}).+(@.*)/, "$1***$2") });

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // Avoid hanging requests (causes frontend timeout)
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 12_000,
    requireTLS: !secure, // enforce STARTTLS on 587
    tls: {
      servername: host,
    },
  });
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

    const toEmail = requiredEnv("TO_EMAIL");
    const fromEmail = requiredEnv("FROM_EMAIL");
    const transporter = makeTransporter();

    const subject = `Poptávka webu — DesignerWeb (${cleanName})`;
    const text = `Jméno: ${cleanName}\nE-mail: ${cleanEmail}\n\nZpráva:\n${cleanMessage}\n\n— Odesláno z designerweb.cz`;

    await transporter.sendMail({
      from: `DesignerWeb <${fromEmail}>`,
      to: toEmail,
      replyTo: cleanEmail,
      subject,
      text,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("CONTACT_SEND_ERROR", {
      message: err && err.message,
      code: err && err.code,
      responseCode: err && err.responseCode,
      command: err && err.command,
    });
    const msg = err && typeof err.message === "string" ? err.message : "";
    if (msg.startsWith("Missing env var:")) {
      return res.status(500).json({ ok: false, error: msg });
    }
    const code = err && typeof err.code === "string" ? err.code : "";
    const responseCode = err && typeof err.responseCode === "number" ? err.responseCode : undefined;

    // Return a useful, non-sensitive error for setup issues.
    if (code === "EAUTH" || responseCode === 535) {
      return res.status(500).json({
        ok: false,
        error: "SMTP přihlášení selhalo (zkontrolujte SMTP_USER/SMTP_PASS).",
      });
    }
    if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION" || code === "ECONNRESET") {
      const host = process.env.SMTP_HOST || "";
      const port = process.env.SMTP_PORT || "";
      const secure = process.env.SMTP_SECURE || "";
      return res.status(500).json({
        ok: false,
        error: `Nepodařilo se připojit k SMTP serveru (zkontrolujte SMTP_HOST/SMTP_PORT/SMTP_SECURE). (${host}:${port}, secure=${secure})`,
      });
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

