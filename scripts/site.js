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
    paymentNote: "Aucun paiement en ligne. Votre messagerie s'ouvre avec la commande déjà écrite : envoyez-la, je vous réponds pour la confirmer et vous dire comment régler.",
    pickupEnabled: true,
    pickupNote: "Retrait à l'atelier, sur rendez-vous",
    shippingEnabled: true,
    shippingFee: 690,
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const euro = new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" });

  window.FDV = Object.assign(window.FDV || {}, {
    reduce,
    price: (cents) => euro.format((Number(cents) || 0) / 100),
    async api(url, opts = {}) {
      const res = await fetch(url, {
        ...opts,
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
        body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
      });
      let data = null;
      try { data = await res.json(); } catch { /* empty body */ }
      if (!res.ok) { const err = new Error((data && data.error) || `Erreur ${res.status}`); err.status = res.status; err.data = data; throw err; }
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

  // Mark the link of the section on screen (home page only)
  const links = [...bar.querySelectorAll('.site-nav a[href^="#"]')];
  const targets = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  if (!targets.length || !("IntersectionObserver" in window)) return;
  const seen = new Map();
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target, e.isIntersecting);
    const here = targets.filter((t) => seen.get(t)).pop();
    links.forEach((a) => a.classList.toggle("is-here", !!here && a.getAttribute("href") === `#${here.id}`));
  }, { rootMargin: "-30% 0px -60% 0px" });
  targets.forEach((t) => spy.observe(t));
})();
