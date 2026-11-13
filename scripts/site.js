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
  const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

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
