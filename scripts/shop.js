/* Home page: the few pieces Nathalie has chosen to show, and her contact address, from the server.
   Without the server the section keeps its text and link to the shop. */
(() => {
  const list = document.querySelector("[data-shop-featured]");
  const intro = document.querySelector("[data-shop-intro]");
  const { shop, price } = window.FDV || {};
  if (!shop) return;

  // wait for the language files too, so nothing shows a bare key
  Promise.all([shop(), window.i18n.ready]).then(([{ products = [], settings = {} }]) => {
    window.FDV.setContactEmail(settings.contactEmail);
    // Nathalie's own words for the intro are shown as she wrote them, in every language
    const custom = (settings.shopIntro || "").trim();
    if (intro && custom && custom !== window.i18n.french("shopDefaults.shopIntro").trim()) { intro.removeAttribute("data-i18n"); intro.textContent = settings.shopIntro; }
    if (!list) return;

    const featured = products.filter((p) => p.featured);
    const shown = (featured.length ? featured : products).slice(0, 3);
    const render = () => list.replaceChildren(...shown.map((p) => {
      const li = document.createElement("li");
      li.className = "bq-item";
      const a = document.createElement("a");
      a.href = `boutique.html#p-${p.id}`;
      const frame = document.createElement("span");
      frame.className = "c-frame";
      const fig = document.createElement("span");
      fig.className = "piece-img";
      if (p.images && p.images[0]) {
        const img = document.createElement("img");
        img.src = p.images[0]; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
        fig.append(img);
      } else {
        const ph = document.createElement("span");
        ph.className = "piece-ph";
        ph.setAttribute("aria-hidden", "true");
        ph.textContent = (p.name || "?").trim().charAt(0);
        fig.append(ph);
      }
      frame.append(fig);
      const txt = document.createElement("span");
      txt.className = "bq-text";
      const name = document.createElement("span"); name.className = "bq-name"; name.textContent = p.name;
      const meta = document.createElement("span"); meta.className = "bq-meta";
      meta.textContent = [p.category, p.stock <= 0 ? i18n.t("shop.sold") : p.unique ? i18n.t("shop.unique") : ""].filter(Boolean).join(" · ");
      const pr = document.createElement("span"); pr.className = "bq-price";
      pr.textContent = price(p.price);
      txt.append(name, meta, pr);
      a.append(frame, txt);
      li.append(a);
      return li;
    }));
    render();
    list.hidden = !shown.length;
    window.FDV.rebuildThread?.();
    // prices and the "pièce unique" note follow the language
    document.addEventListener("fildevie:locale-changed", render);
  }).catch(() => { /* no server: the static section stays */ });
})();
