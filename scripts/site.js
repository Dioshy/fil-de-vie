/* Shared, page-wide: text that waits below the fold fades in by opacity when it is reached.
   The hero animates in CSS on its own. Also a few helpers the other scripts use. */
(() => {
  // The host app's preview shell rejects a notification-permission check this site never makes;
  // keep that one rejection out of the console.
  addEventListener("unhandledrejection", (e) => {
    const msg = String((e.reason && e.reason.message) || e.reason || "");
    if (msg.includes("notification|is_permission_granted")) e.preventDefault();
  });

  const OFFLINE_SETTINGS = {
    contactEmail: "nathalie@fildevie.fr",
    shopIntro: "",
    paymentNote: "",   // the shop page words these two itself (checkout.offlinePayment / offlinePickup), in the visitor's language
    pickupEnabled: true,
    pickupNote: "",
    shippingEnabled: true,
    shippingFee: 690,
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.FDV = Object.assign(window.FDV || {}, {
    reduce,
    price: (cents) => window.i18n.formatPrice((Number(cents) || 0) / 100),
    // Nathalie's address from the server goes into every [data-contact-email]; it is put back after a language switch re-writes the text around it
    contactEmail: "",
    setContactEmail(email) {
      if (email) window.FDV.contactEmail = email;
      const mail = window.FDV.contactEmail;
      if (!mail) return;
      document.querySelectorAll("[data-contact-email]").forEach((a) => {
        a.href = `mailto:${mail}`;
        a.textContent = mail;
        a.removeAttribute("data-fill");
      });
    },
    // The message for a server error in the visitor's language: errors.<code> when the server sent a code
    // this language knows, otherwise the server's own (French) text, otherwise the fallback key.
    errorText(err, fallbackKey) {
      const i = window.i18n;
      if (err && err.code && i) {
        const key = `errors.${err.code}`;
        const m = i.t(key, err.params);
        if (m !== key) return m;
      }
      return (err && err.message && err.status ? err.message : "") || (i && fallbackKey ? i.t(fallbackKey) : "");
    },
    async api(url, opts = {}) {
      const res = await fetch(url, {
        ...opts,
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
        body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
      });
      let data = null;
      try { data = await res.json(); } catch { /* empty body */ }
      if (!res.ok) { const err = new Error((data && data.error) || `Erreur ${res.status}`); err.status = res.status; err.data = data; err.code = data && data.code; err.params = data && data.params; throw err; }
      return data;
    },
    // The shop's pieces and settings. Without the server (a static host such as GitHub Pages),
    // the example pieces in seed/ are shown instead and FDV.offline becomes true.
    async shop() {
      try {
        const data = await window.FDV.api("/api/shop");
        window.FDV.offline = false;
        return data;
      } catch (err) {
        if (err.status && err.status < 404) throw err;
        const res = await fetch(new URL("seed/products.json", document.baseURI));
        if (!res.ok) throw err;
        const seed = await res.json();
        window.FDV.offline = true;
        return {
          products: seed.filter((p) => p.status === "published").map((p, i) => ({ ...p, id: `exemple-${i + 1}` })),
          settings: { ...OFFLINE_SETTINGS },
        };
      }
    },
    watchFades(scope = document) {
      if (reduce || !("IntersectionObserver" in window)) return;
      scope.querySelectorAll("[data-fade]").forEach((el) => {
        if (el.closest("#hero") || el.dataset.fadeArmed) return;
        el.dataset.fadeArmed = "1";
        if (el.getBoundingClientRect().top <= innerHeight) return;
        el.classList.add("is-waiting");
        io.observe(el);
      });
    },
  });

  const io = "IntersectionObserver" in window && new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.remove("is-waiting");
      io.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -8% 0px" });

  window.FDV.watchFades();
  document.addEventListener("fildevie:locale-changed", () => window.FDV.setContactEmail());
  window.i18n.ready.then(() => window.FDV.setContactEmail());
})();

/* The top bar: a menu on phones, a hairline once the page has scrolled, and the section you are in */
(() => {
  const bar = document.querySelector("[data-site-bar]");
  if (!bar) return;
  const btn = bar.querySelector("[data-site-menu]");
  const nav = bar.querySelector(".site-nav-wrap");
  const setOpen = (open) => {
    btn.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  };
  btn?.addEventListener("click", () => setOpen(btn.getAttribute("aria-expanded") !== "true"));
  nav?.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && btn?.getAttribute("aria-expanded") === "true") { setOpen(false); btn.focus(); }
  });
  document.addEventListener("click", (e) => { if (!bar.contains(e.target)) setOpen(false); });

  const onScroll = () => bar.classList.toggle("is-scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Mark the link of the section the reader is in (home page only), all the way down: the sections with no
  // link of their own count for the one they follow (a wish for the accompaniment, what remains for the
  // workshops), so the bar never goes blank between two sections
  const links = [...bar.querySelectorAll('.site-nav a[href^="#"]')];
  const linkFor = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const OWNER = { souhaits: "accompagnement", "ce-qui-reste": "ateliers", contact: "reserver" };
  const secs = [...document.querySelectorAll("section[id]")].filter((el) => !el.parentElement.closest("section[id]"))
    .map((el) => ({ el, a: linkFor.get(OWNER[el.id] || el.id) || null }));
  if (!secs.some((s) => s.a)) return;
  let current = undefined, queued = false;
  const mark = () => {
    queued = false;
    const line = innerHeight * 0.35;
    let here = null;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) here = secs[secs.length - 1];
    else for (const s of secs) { if (s.el.getBoundingClientRect().top <= line) here = s; else break; }
    const a = here ? here.a : null;
    if (a === current) return;
    current = a;
    links.forEach((l) => {
      l.classList.toggle("is-here", l === a);
      if (l === a) l.setAttribute("aria-current", "location"); else if (l.getAttribute("aria-current") === "location") l.removeAttribute("aria-current");
    });
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(mark); } };
  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue);
  addEventListener("load", queue);
  mark();
})();
