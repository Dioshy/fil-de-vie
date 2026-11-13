/* The shop page: pieces from the server, a piece sheet, a basket kept in this browser,
   and the order sent to Nathalie. Every text from the server goes in with textContent.
   Feedback stays quiet: a short thread that ties itself, a soft glow on the basket. No bouncing. */
(() => {
  const { api, price } = window.FDV;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const grid = $(".shop-grid");
  const state = $(".shop-state");
  const filters = $(".shop-filters");
  const pieceDlg = $("#piece");
  const cartDlg = $("#cart");
  const orderForm = $(".order");
  const live = $("[data-cart-live]");

  let products = [];
  let settings = {};
  let filter = "";
  let current = null;   // the piece open in the sheet
  let photo = 0;        // its photo on show
  let returnTo = null;  // where focus goes back when the last sheet closes
  let switching = false;

  /* ---------- Basket, in localStorage ---------- */
  const KEY = "fdv-cart";
  const readCart = () => { try { const c = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(c) ? c : []; } catch { return []; } };
  let cart = readCart();
  const count = () => cart.reduce((s, l) => s + l.qty, 0);
  const saveCart = () => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* private mode */ } renderCount(); };
  const byId = (id) => products.find((p) => p.id === id);
  const maxQty = (p) => Math.max(0, p.unique ? Math.min(1, p.stock) : p.stock);

  function pruneCart() {
    cart = cart
      .map((l) => { const p = byId(l.id); return p ? { id: l.id, qty: Math.min(l.qty, maxQty(p)) } : null; })
      .filter((l) => l && l.qty > 0);
    saveCart();
  }
  function renderCount() {
    const n = count();
    $$("[data-cart-count]").forEach((s) => { s.textContent = `(${n})`; });
    $$("[data-cart-sr]").forEach((s) => { s.textContent = n ? `, ${n} pièce${n > 1 ? "s" : ""}` : ", vide"; });
    $(".cart-fab").hidden = n === 0;
  }
  // A soft light passes over the basket, once
  function glow() {
    $$("[data-open-cart]").forEach((b) => {
      b.classList.remove("is-glowing");
      void b.offsetWidth;
      b.classList.add("is-glowing");
    });
  }
  $$("[data-open-cart]").forEach((b) => b.addEventListener("animationend", () => b.classList.remove("is-glowing")));

  // The thread draws itself, then the knot is tied. Without motion it is simply there.
  function tie(svg) {
    svg.classList.remove("is-tying", "is-tied");
    if (reduce()) { svg.classList.add("is-tied"); return; }
    void svg.getBoundingClientRect();
    svg.classList.add("is-tying");
  }

  /* ---------- Picture (or its stand-in) ---------- */
  function picture(p, src, alt = "", lazy = true) {
    const box = el("span", "piece-img");
    if (src) {
      const img = el("img");
      img.src = src; img.alt = alt; img.decoding = "async";
      if (lazy) img.loading = "lazy";
      box.append(img);
    } else {
      box.classList.add("is-empty");
      const ph = el("span", "piece-ph", (p.name || "?").trim().charAt(0));
      ph.setAttribute("aria-hidden", "true");
      box.append(ph);
    }
    return box;
  }

  /* ---------- Grid and families ---------- */
  function renderFilters() {
    const cats = [...new Set(products.map((p) => p.category).filter(Boolean))];
    filters.hidden = cats.length < 2;
    if (filters.hidden) return;
    const mk = (label, value) => {
      const b = el("button", "", label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(filter === value));
      b.addEventListener("click", () => {
        filter = value;
        renderFilters();
        renderGrid();
        $$("button", filters).find((x) => x.textContent === label)?.focus();
      });
      return b;
    };
    filters.replaceChildren(mk("Tout", ""), ...cats.map((c) => mk(c, c)));
  }

  const metaOf = (p) => {
    if (p.stock <= 0) return [p.category, "partie"].filter(Boolean).join(" · ");
    // No counts, no "last one": nothing here should hurry anyone. Stock only limits the quantity field.
    return [p.category, p.unique ? "pièce unique" : ""].filter(Boolean).join(" · ");
  };

  function renderGrid() {
    const shown = products.filter((p) => !filter || p.category === filter);
    state.textContent = products.length ? "" : "La boutique se remplit doucement. Revenez bientôt, ou écrivez-moi si une pièce vous fait envie.";
    grid.replaceChildren(...shown.map((p) => {
      const li = el("li", "shop-card");
      if (p.stock <= 0) li.classList.add("is-out");
      li.id = `p-${p.id}`;
      li.dataset.fade = "";
      const b = el("button");
      b.type = "button";
      b.dataset.piece = p.id;
      b.setAttribute("aria-haspopup", "dialog");
      const frame = el("span", "c-frame");
      frame.append(picture(p, p.images[0]));
      const txt = el("span", "c-text");
      txt.append(el("span", "c-name", p.name), el("span", "c-meta", metaOf(p)), el("span", "c-price", price(p.price)));
      b.append(frame, txt);
      b.addEventListener("click", () => openPiece(p.id, true));
      li.append(b);
      return li;
    }));
    window.FDV.watchFades?.(grid);
    window.FDV.rebuildThread?.();
  }

  /* ---------- A piece ---------- */
  const main = $(".piece-main", pieceDlg);
  const thumbs = $(".piece-thumbs", pieceDlg);
  const nav = $(".piece-nav", pieceDlg);
  const counter = $(".piece-count", pieceDlg);
  const buy = $(".piece-buy", pieceDlg);
  const added = $(".piece-added", pieceDlg);

  function show(i) {
    const p = current;
    if (!p) return;
    const n = p.images.length;
    photo = n ? (i + n) % n : 0;
    const pic = picture(p, p.images[photo], n ? `${p.name}, photo ${photo + 1} sur ${n}` : "", false);
    main.className = pic.className + " piece-main";
    main.replaceChildren(...pic.childNodes);
    counter.textContent = n > 1 ? `${photo + 1} / ${n}` : "";
    $$("button", thumbs).forEach((t, k) => t.setAttribute("aria-pressed", String(k === photo)));
  }
  $$(".piece-step", pieceDlg).forEach((b) => b.addEventListener("click", () => show(photo + Number(b.dataset.step))));
  // Arrow keys turn the photos while focus is in the gallery
  $(".piece-gallery", pieceDlg).addEventListener("keydown", (e) => {
    if (!current || current.images.length < 2) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    show(photo + (e.key === "ArrowRight" ? 1 : -1));
    if (e.target.closest(".piece-thumbs")) $$("button", thumbs)[photo]?.focus();
  });

  function openPiece(id, push) {
    const p = byId(id);
    if (!p) return;
    current = p;
    if (!pieceDlg.open && !cartDlg.open) returnTo = document.activeElement;

    const many = p.images.length > 1;
    nav.hidden = !many;
    thumbs.replaceChildren(...(many ? p.images.map((src, i) => {
      const li = el("li");
      const b = el("button");
      b.type = "button";
      b.setAttribute("aria-label", `Photo ${i + 1} sur ${p.images.length}`);
      b.append(picture(p, src));
      b.addEventListener("click", () => show(i));
      li.append(b);
      return li;
    }) : []));
    show(0);

    $(".piece-cat", pieceDlg).textContent = [p.category, p.unique ? "pièce unique" : ""].filter(Boolean).join(" · ");
    $(".piece-name", pieceDlg).textContent = p.name;
    $(".piece-price", pieceDlg).textContent = price(p.price);
    $(".piece-made-more", pieceDlg).textContent = p.unique ? "Il n'y en a qu'une." : "Chacune est un peu différente.";
    $(".piece-desc", pieceDlg).replaceChildren(...(p.description || "").split(/\n\s*\n/).filter((t) => t.trim()).map((t) => el("p", "", t.trim())));
    $(".piece-details", pieceDlg).replaceChildren(...p.details.flatMap((d) => [el("dt", "", d.label), el("dd", "", d.value)]));

    added.hidden = true;
    buy.hidden = false;
    const qty = buy.elements.qty;
    const inCart = cart.find((l) => l.id === p.id)?.qty || 0;
    const left = maxQty(p) - inCart;
    $(".piece-qty", buy).hidden = p.unique || left <= 1;
    qty.max = String(Math.max(1, left));
    qty.value = "1";
    $("button[type=submit]", buy).hidden = left <= 0; // the note below says why, and where to go
    $(".piece-avail", pieceDlg).dataset.tone = p.stock <= 0 ? "out" : "";
    $(".piece-avail", pieceDlg).textContent =
      p.stock <= 0 ? "Elle est partie. Si vous aimeriez la même, écrivez-moi : je peux en refaire une proche, jamais tout à fait pareille."
      : left <= 0 ? "Elle est déjà dans votre panier."
      : p.unique ? "Pièce unique : il n'y en a qu'une."
      : left > 1 ? `Vous pouvez en prendre jusqu'à ${left}.`
      : "";
    if (p.stock <= 0) {
      const a = el("a", "text-link", "Écrire à Nathalie");
      a.href = "index.html#ecrire";
      $(".piece-avail", pieceDlg).append(" ", a);
    } else if (left <= 0) {
      const a = el("button", "text-link link-btn", "Voir le panier");
      a.type = "button";
      a.dataset.goCart = "";
      $(".piece-avail", pieceDlg).append(" ", a);
    }

    if (push && location.hash !== `#p-${p.id}`) history.pushState(null, "", `#p-${p.id}`);
    if (!pieceDlg.open) pieceDlg.showModal();
    $(".sheet-in", pieceDlg).scrollTop = 0;
    pieceDlg.scrollTop = 0;
  }

  buy.addEventListener("submit", (e) => {
    e.preventDefault();
    const p = current;
    if (!p) return;
    const inCart = cart.find((l) => l.id === p.id);
    const room = maxQty(p) - (inCart ? inCart.qty : 0);
    const n = Math.min(room, Math.max(1, parseInt(buy.elements.qty.value, 10) || 1));
    if (n <= 0) return;
    if (inCart) inCart.qty += n; else cart.push({ id: p.id, qty: n });
    saveCart();

    // The form steps aside; a thread ties itself in its place
    buy.hidden = true;
    added.hidden = false;
    tie($(".tie", added));
    added.focus();
    glow();
    live.textContent = `${p.name} est dans le panier.`;
  });

  /* ---------- Basket and order ---------- */
  const delivery = () => orderForm.elements.delivery.value || "";
  function totals() {
    const sub = cart.reduce((s, l) => s + (byId(l.id)?.price || 0) * l.qty, 0);
    const ship = delivery() === "shipping" ? settings.shippingFee || 0 : 0;
    return { sub, total: sub + ship };
  }

  function renderCart() {
    const lines = $(".cart-lines", cartDlg);
    lines.replaceChildren(...cart.map((l) => {
      const p = byId(l.id);
      const li = el("li", "cart-line");
      const txt = el("div");
      const meta = el("div", "l-meta");
      if (!p.unique && maxQty(p) > 1) {
        const lab = el("label", "l-qty", "Combien ");
        const q = el("input");
        q.type = "number"; q.min = "1"; q.max = String(maxQty(p)); q.value = String(l.qty); q.inputMode = "numeric";
        q.setAttribute("aria-label", `Combien, ${p.name}`);
        q.addEventListener("change", () => {
          l.qty = Math.min(maxQty(p), Math.max(1, parseInt(q.value, 10) || 1));
          saveCart(); renderCart();
          $(`[aria-label="Combien, ${CSS.escape(p.name)}"]`, cartDlg)?.focus();
        });
        lab.append(q);
        meta.append(lab);
      } else {
        meta.append(el("span", "", p.unique ? "Pièce unique" : "1 pièce"));
      }
      const del = el("button", "l-del", "Retirer");
      del.type = "button";
      del.setAttribute("aria-label", `Retirer ${p.name} du panier`);
      del.addEventListener("click", () => {
        cart = cart.filter((x) => x !== l);
        saveCart(); renderCart();
        live.textContent = `${p.name} a été retirée du panier.`;
        $(".cart-title", cartDlg).focus();
      });
      meta.append(del);
      txt.append(el("p", "l-name", p.name), meta);
      li.append(picture(p, p.images[0]), txt, el("span", "l-price", price(p.price * l.qty)));
      return li;
    }));

    const empty = cart.length === 0;
    cartDlg.classList.toggle("is-empty", empty);
    $(".cart-empty", cartDlg).hidden = !empty;
    $(".order-block", cartDlg).hidden = empty;
    orderForm.hidden = empty;

    const t = totals();
    $("[data-cart-sub]", cartDlg).textContent = price(t.sub);
    $("[data-cart-total]", cartDlg).textContent = price(t.total);
    $(".order-address", cartDlg).hidden = delivery() !== "shipping";
  }

  function openCart() {
    if (!pieceDlg.open && !cartDlg.open) returnTo = document.activeElement;
    $(".cart-view", cartDlg).hidden = false;
    $(".cart-done", cartDlg).hidden = true;
    $(".order-status", cartDlg).textContent = "";
    renderCart();
    if (!cartDlg.open) cartDlg.showModal();
    $(".cart-title", cartDlg).focus();
  }

  function applySettings() {
    const pick = $('[data-opt="pickup"]', cartDlg), ship = $('[data-opt="shipping"]', cartDlg);
    pick.hidden = !settings.pickupEnabled;
    ship.hidden = !settings.shippingEnabled;
    $("[data-pickup-note]", cartDlg).textContent = settings.pickupNote || "";
    $("[data-ship-fee]", cartDlg).textContent = settings.shippingFee ? `${price(settings.shippingFee)} de frais d'envoi, suivi` : "Envoi offert";
    $("[data-payment-note]", cartDlg).textContent = settings.paymentNote || "";
    const d = delivery();
    if (!d || (d === "pickup" && !settings.pickupEnabled) || (d === "shipping" && !settings.shippingEnabled)) {
      orderForm.elements.delivery.value = settings.pickupEnabled ? "pickup" : "shipping";
    }
    if (settings.shopIntro) $$("[data-shop-intro]").forEach((p) => { p.textContent = settings.shopIntro; });
    if (settings.contactEmail) {
      $$("[data-contact-email]").forEach((a) => { a.href = `mailto:${settings.contactEmail}`; a.textContent = settings.contactEmail; a.removeAttribute("data-fill"); });
    }
  }

  /* ---------- Friendly validation: after the field is left, cleared as soon as it is right ---------- */
  const MSG = {
    name: { missing: "Écrivez votre nom, pour que je sache à qui répondre." },
    email: { missing: "Écrivez votre e-mail, c'est par là que je vous répondrai.", bad: "Cette adresse semble incomplète, par exemple prenom@exemple.fr." },
    address: { missing: "Écrivez l'adresse où l'envoyer." },
    postal: { missing: "Écrivez le code postal." },
    city: { missing: "Écrivez la ville." },
  };
  const needed = () => ["name", "email", ...(delivery() === "shipping" ? ["address", "postal", "city"] : [])];
  const dirty = new WeakSet();

  function problem(name) {
    const v = orderForm.elements[name].value.trim();
    if (!needed().includes(name)) return "";
    if (!v) return MSG[name].missing;
    if (name === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return MSG.email.bad;
    return "";
  }
  function render(name) {
    const f = orderForm.elements[name];
    const err = $(`#${f.id}-error`, cartDlg);
    if (!err) return "";
    const msg = problem(name);
    err.textContent = msg;
    err.hidden = !msg;
    f.setAttribute("aria-invalid", msg ? "true" : "false");
    const ids = (f.getAttribute("aria-describedby") || "").split(" ").filter((x) => x && x !== err.id);
    if (msg) ids.push(err.id);
    if (ids.length) f.setAttribute("aria-describedby", ids.join(" ")); else f.removeAttribute("aria-describedby");
    return msg;
  }
  function clearErrors() {
    Object.keys(MSG).forEach((n) => {
      const f = orderForm.elements[n];
      const err = $(`#${f.id}-error`, cartDlg);
      err.hidden = true; err.textContent = "";
      f.setAttribute("aria-invalid", "false");
      const ids = (f.getAttribute("aria-describedby") || "").split(" ").filter((x) => x && x !== err.id);
      if (ids.length) f.setAttribute("aria-describedby", ids.join(" ")); else f.removeAttribute("aria-describedby");
    });
    $(".order-summary", cartDlg).hidden = true;
  }

  orderForm.addEventListener("change", (e) => {
    if (e.target.name === "delivery") { renderCart(); Object.keys(MSG).forEach((n) => { if (orderForm.elements[n].getAttribute("aria-invalid") === "true") render(n); }); }
  });
  orderForm.addEventListener("input", (e) => {
    const n = e.target.name;
    dirty.add(e.target);
    if (MSG[n] && e.target.getAttribute("aria-invalid") === "true") render(n);
    const summary = $(".order-summary", cartDlg);
    if (!summary.hidden && !needed().some(problem)) summary.hidden = true;
  });
  orderForm.addEventListener("focusout", (e) => {
    const n = e.target.name;
    if (MSG[n] && dirty.has(e.target)) render(n);
  });

  orderForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = orderForm.elements;
    const btn = $("button[type=submit]", orderForm);
    const status = $(".order-status", orderForm);
    if (btn.getAttribute("aria-busy") === "true") return;

    const missing = needed().filter((n) => render(n));
    const summary = $(".order-summary", cartDlg);
    if (missing.length) {
      $("ul", summary).replaceChildren(...missing.map((n) => {
        const li = el("li");
        const a = el("a", "", problem(n));
        a.href = `#${f[n].id}`;
        a.addEventListener("click", (ev) => { ev.preventDefault(); f[n].focus(); });
        li.append(a);
        return li;
      }));
      summary.hidden = false;
      status.textContent = "";
      summary.focus();
      return;
    }
    summary.hidden = true;

    const body = { delivery: delivery(), items: cart.map(({ id, qty }) => ({ id, qty })) };
    for (const n of ["name", "email", "phone", "address", "postal", "city", "country", "note", "website"]) body[n] = f[n].value.trim();

    btn.setAttribute("aria-busy", "true");
    btn.textContent = "J'envoie…";
    status.textContent = "";
    delete status.dataset.tone;
    if (window.FDV.offline) {
      // No server behind this copy of the site: the order leaves as an e-mail from the visitor's own mail app
      const lines = cart.map(({ id, qty }) => { const p = byId(id); return `- ${qty} × ${p.name} (${price(p.price * qty)})`; });
      const ship = body.delivery === "shipping";
      const fee = ship ? (Number(settings.shippingFee) || 0) : 0;
      const total = cart.reduce((t, { id, qty }) => t + byId(id).price * qty, 0) + fee;
      const text = [
        "Bonjour Nathalie,", "", "Je voudrais commander :", ...lines,
        ship ? `Envoi par la poste : ${price(fee)}` : "Retrait à l'atelier", `Total : ${price(total)}`, "",
        ship ? `Adresse : ${body.address}, ${body.postal} ${body.city}, ${body.country}` : "",
        body.note ? `Un mot : ${body.note}` : "", "",
        body.name, body.email, body.phone,
      ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
      const to = settings.contactEmail || "";
      location.href = `mailto:${to}?subject=${encodeURIComponent(`Commande de ${body.name}`)}&body=${encodeURIComponent(text)}`;
      status.textContent = "Votre messagerie s'ouvre avec la commande déjà écrite : il ne reste qu'à l'envoyer.";
      btn.removeAttribute("aria-busy");
      btn.textContent = "Envoyer ma demande à Nathalie";
      return;
    }
    try {
      const out = await api("/api/orders", { method: "POST", body });
      cart = []; saveCart();
      orderForm.reset();
      clearErrors();
      applySettings();
      const num = $("[data-order-number]", cartDlg);
      num.textContent = out.number ? `n° ${out.number}` : "";
      $(".cart-view", cartDlg).hidden = true;
      $(".cart-done", cartDlg).hidden = false;
      tie($(".cart-done .tie", cartDlg));
      $(".done-title", cartDlg).focus();
      load(); // stock has changed
    } catch (err) {
      status.dataset.tone = "error";
      status.textContent = err.status ? err.message : "Je n'arrive pas à joindre le site. Réessayez dans un instant, ou écrivez-moi directement.";
      if (err.status === 409) { await load(); renderCart(); }
    } finally {
      btn.removeAttribute("aria-busy");
      btn.textContent = "Envoyer ma demande à Nathalie";
    }
  });

  /* ---------- Sheets ---------- */
  function closeDlg(d) { if (d.open) d.close(); }
  function goCart() {
    switching = true;
    closeDlg(pieceDlg);
    switching = false;
    openCart();
  }
  for (const d of [pieceDlg, cartDlg]) {
    d.addEventListener("click", (e) => {
      if (e.target === d || e.target.closest("[data-close]")) closeDlg(d);
      else if (e.target.closest("[data-go-cart]")) goCart();
    });
    d.addEventListener("close", () => {
      if (switching || pieceDlg.open || cartDlg.open) return;
      // Back to where the reader was; a card re-drawn since then is found again by its piece
      let to = returnTo;
      if (to && !to.isConnected && to.dataset?.piece) to = $(`[data-piece="${to.dataset.piece}"]`);
      if (!to || !to.isConnected || to.closest("[hidden]")) to = $("#shop-title");
      requestAnimationFrame(() => to.focus({ preventScroll: true }));
    });
  }
  pieceDlg.addEventListener("close", () => {
    current = null;
    if (location.hash.startsWith("#p-")) history.replaceState(null, "", location.pathname + location.search);
  });
  $$("[data-open-cart]").forEach((b) => b.addEventListener("click", openCart));
  addEventListener("popstate", () => {
    const id = location.hash.startsWith("#p-") ? location.hash.slice(3) : "";
    if (id) openPiece(id, false); else closeDlg(pieceDlg);
  });

  /* ---------- Load ---------- */
  async function load() {
    try {
      const data = await window.FDV.shop();
      products = data.products || [];
      settings = data.settings || {};
      applySettings();
      pruneCart();
      renderFilters();
      renderGrid();
    } catch {
      state.textContent = "La boutique ne répond pas pour le moment. Réessayez un peu plus tard, ou écrivez-moi.";
    }
  }

  renderCount();
  load().then(() => {
    const id = location.hash.startsWith("#p-") ? location.hash.slice(3) : "";
    if (id && byId(id)) openPiece(id, false);
  });
})();
