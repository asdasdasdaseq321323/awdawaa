/* Lightweight interactions: theme toggle, smooth nav, scroll reveal, form UX */

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function getPreferredTheme() {
  const saved = localStorage.getItem("dw_theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("dw_theme", theme);
  } catch {
    // ignore
  }
}

function cycleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  setTheme(current === "dark" ? "light" : "dark");
}

function initTheme() {
  const theme = getPreferredTheme();
  setTheme(theme);

  const btn = document.querySelector("[data-theme-toggle]");
  if (btn) {
    btn.addEventListener("click", cycleTheme);
  }

  // Follow OS changes only if user hasn't explicitly saved preference
  const mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mql) {
    mql.addEventListener?.("change", () => {
      const saved = localStorage.getItem("dw_theme");
      if (saved === "light" || saved === "dark") return;
      setTheme(getPreferredTheme());
    });
  }
}

function initHeaderElevate() {
  const header = document.querySelector("[data-elevate]");
  if (!header) return;

  const onScroll = () => {
    const y = window.scrollY || 0;
    header.classList.toggle("is-elevated", y > 8);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

function initSmoothAnchors() {
  const links = Array.from(document.querySelectorAll('a[href^="#"]'));
  for (const a of links) {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      if (!href || href === "#") return;
      const id = href.slice(1);
      const target = document.getElementById(id);
      if (!target) return;

      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.pushState(null, "", href);
    });
  }
}

function initReveal() {
  const els = Array.from(document.querySelectorAll("[data-reveal]"));
  if (els.length === 0) return;

  const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) {
    for (const el of els) el.classList.add("is-visible");
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        el.classList.add("is-visible");
        io.unobserve(el);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -10% 0px" }
  );

  els.forEach((el, idx) => {
    // Stagger via transition-delay (inline style keeps CSS small)
    const delay = clamp(idx * 35, 0, 420);
    el.style.transitionDelay = `${delay}ms`;
    io.observe(el);
  });
}

function toast(message) {
  const host = document.getElementById("toaster");
  if (!host) return;
  const inner = host.querySelector(".toaster__inner");
  if (!inner) return;

  inner.textContent = message;
  host.hidden = false;

  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => {
    host.hidden = true;
  }, 2600);
}

function initForm() {
  const form = document.getElementById("leadForm");
  const out = document.getElementById("formSuccess");
  if (!form || !out) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const email = String(fd.get("email") || "").trim();
    const message = String(fd.get("message") || "").trim();

    if (!name || !email || !message) {
      toast("Please fill in all fields.");
      return;
    }

    const subject = encodeURIComponent("Website request — designerweb.cz");
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\n\nWhat they need:\n${message}\n\n— Sent from designerweb.cz landing page`
    );

    // Conversion-friendly: show immediate success + open mail client
    out.hidden = false;
    out.textContent = "Perfect — opening your email app. If it doesn’t open, use the Email us button.";
    toast("Opening email…");

    // Replace hello@designerweb.cz anytime (kept as requested)
    window.location.href = `mailto:hello@designerweb.cz?subject=${subject}&body=${body}`;
  });
}

function initYear() {
  const y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
}

initTheme();
initHeaderElevate();
initSmoothAnchors();
initReveal();
initForm();
initYear();

