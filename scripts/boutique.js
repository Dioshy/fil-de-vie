/* The shop page: pieces from the server, a piece sheet, a basket kept in this browser,
   and the order sent to Nathalie. Every text from the server goes in with textContent.
   Feedback stays quiet: a short thread that ties itself, a soft glow on the basket. No bouncing. */
(() => {
  const { api, price } = window.FDV;
  const i18n = window.i18n;
  const t = (key, params) => i18n.t(key, params);
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
  let loaded = false;   // the shop has been drawn once

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
    $$("[data-cart-sr]").forEach((s) => { s.textContent = n ? t("cart.srItems", { items: i18n.plural("cart.items", n) }) : t("cart.srEmpty"); });
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
    filters.replaceChildren(mk(t("shop.all"), ""), ...cats.map((c) => mk(c, c)));
  }

  const metaOf = (p) => {
    if (p.stock <= 0) return [p.category, t("shop.sold")].filter(Boolean).join(" · ");
    // No counts, no "last one": nothing here should hurry anyone. Stock only limits the quantity field.
    return [p.category, p.unique ? t("shop.unique") : ""].filter(Boolean).join(" · ");
  };

  function renderGrid() {
    const shown = products.filter((p) => !filter || p.category === filter);
    state.removeAttribute("data-i18n"); // this line is the page's own to set from here on
    state.textContent = products.length ? "" : t("shop.empty");
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
    const pic = picture(p, p.images[photo], n ? t("shop.photoAlt", { name: p.name, n: photo + 1, total: n }) : "", false);
    main.className = pic.className + " piece-main";
    main.replaceChildren(...pic.childNodes);
    counter.textContent = n > 1 ? t("shop.photoCounter", { n: photo + 1, total: n }) : "";
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
      b.setAttribute("aria-label", t("shop.photoLabel", { n: i + 1, total: p.images.length }));
      b.append(picture(p, src));
      b.addEventListener("click", () => show(i));
      li.append(b);
      return li;
    }) : []));
    show(0);

    $(".piece-cat", pieceDlg).textContent = [p.category, p.unique ? t("shop.unique") : ""].filter(Boolean).join(" · ");
    $(".piece-name", pieceDlg).textContent = p.name;
    $(".piece-price", pieceDlg).textContent = price(p.price);
    $(".piece-made-more", pieceDlg).textContent = p.unique ? t("shop.madeUnique") : t("shop.madeVaried");
    $(".piece-desc", pieceDlg).replaceChildren(...(p.description || "").split(/\n\s*\n/).filter((para) => para.trim()).map((para) => el("p", "", para.trim())));
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
      p.stock <= 0 ? t("shop.availSold")
      : left <= 0 ? t("shop.availInCart")
      : p.unique ? t("shop.availUnique")
      : left > 1 ? t("shop.availUpTo", { n: left })
      : "";
    if (p.stock <= 0) {
      const a = el("a", "text-link", t("shop.writeToNathalie"));
      a.href = "index.html#ecrire";
      $(".piece-avail", pieceDlg).append(" ", a);
    } else if (left <= 0) {
      const a = el("button", "text-link link-btn", t("shop.viewCart"));
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
    live.textContent = t("shop.addedLive", { name: p.name });
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
        const lab = el("label", "l-qty", `${t("cart.howMany")} `);
        const q = el("input");
        q.type = "number"; q.min = "1"; q.max = String(maxQty(p)); q.value = String(l.qty); q.inputMode = "numeric";
        const qLabel = t("cart.howManyFor", { name: p.name });
        q.setAttribute("aria-label", qLabel);
        q.addEventListener("change", () => {
          l.qty = Math.min(maxQty(p), Math.max(1, parseInt(q.value, 10) || 1));
          saveCart(); renderCart();
          $(`[aria-label="${CSS.escape(qLabel)}"]`, cartDlg)?.focus();
        });
        lab.append(q);
        meta.append(lab);
      } else {
        meta.append(el("span", "", p.unique ? t("cart.unique") : i18n.plural("cart.items", 1)));
      }
      const del = el("button", "l-del", t("cart.remove"));
      del.type = "button";
      del.setAttribute("aria-label", t("cart.removeFor", { name: p.name }));
      del.addEventListener("click", () => {
        cart = cart.filter((x) => x !== l);
        saveCart(); renderCart();
        live.textContent = t("cart.removedLive", { name: p.name });
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

    const sums = totals();
    $("[data-cart-sub]", cartDlg).textContent = price(sums.sub);
    $("[data-cart-total]", cartDlg).textContent = price(sums.total);
    $(".order-address", cartDlg).hidden = delivery() !== "shipping";
  }

  function openCart() {
    if (!pieceDlg.open && !cartDlg.open) returnTo = document.activeElement;
    $(".cart-view", cartDlg).hidden = false;
    $(".cart-done", cartDlg).hidden = true;
    $(".order-status", cartDlg).textContent = "";
    statusMsg = null;
    renderCart();
    if (!cartDlg.open) cartDlg.showModal();
    $(".cart-title", cartDlg).focus();
  }

  // Nathalie's own wording is shown as she wrote it. Empty, or still the French default the server ships with, means "use the visitor's language".
  const mine = (key) => {
    const v = (settings[key] || "").trim();
    return v && v !== window.i18n.french("shopDefaults." + key).trim() ? settings[key] : "";
  };

  function applySettings() {
    const pick = $('[data-opt="pickup"]', cartDlg), ship = $('[data-opt="shipping"]', cartDlg);
    pick.hidden = !settings.pickupEnabled;
    ship.hidden = !settings.shippingEnabled;
    // Nathalie's own wording is kept as she wrote it; the example shop (no server) speaks the visitor's language
    $("[data-pickup-note]", cartDlg).textContent = mine("pickupNote") || (window.FDV.offline ? t("checkout.offlinePickup") : t("shopDefaults.pickupNote"));
    $("[data-ship-fee]", cartDlg).textContent = settings.shippingFee ? t("checkout.shipFee", { fee: price(settings.shippingFee) }) : t("checkout.shipFree");
    $("[data-payment-note]", cartDlg).textContent = mine("paymentNote") || (window.FDV.offline ? t("checkout.offlinePayment") : t("shopDefaults.paymentNote"));
    const d = delivery();
    if (!d || (d === "pickup" && !settings.pickupEnabled) || (d === "shipping" && !settings.shippingEnabled)) {
      orderForm.elements.delivery.value = settings.pickupEnabled ? "pickup" : "shipping";
    }
    if (mine("shopIntro")) $$("[data-shop-intro]").forEach((p) => { p.removeAttribute("data-i18n"); p.textContent = settings.shopIntro; });
    window.FDV.setContactEmail(settings.contactEmail);
  }

  /* ---------- Friendly validation: after the field is left, cleared as soon as it is right ---------- */
  const MSG = {
    name: { missing: "checkout.error.nameMissing" },
    email: { missing: "checkout.error.emailMissing", bad: "checkout.error.emailBad" },
    address: { missing: "checkout.error.addressMissing" },
    postal: { missing: "checkout.error.postalMissing" },
    city: { missing: "checkout.error.cityMissing" },
  };
  const needed = () => ["name", "email", ...(delivery() === "shipping" ? ["address", "postal", "city"] : [])];
  const dirty = new WeakSet();
  // What the order-status line says, kept as a function so it can be written again in the visitor's language
  let statusMsg = null;
  const orderStatus = () => $(".order-status", cartDlg);
  function showStatus(fn, tone) {
    statusMsg = fn;
    const s = orderStatus();
    s.textContent = fn ? fn() : "";
    if (fn && tone) s.dataset.tone = tone; else delete s.dataset.tone;
  }
  // The "a few lines are missing" list is rebuilt from the fields that are still wrong, so it follows the language
  function fillSummary(missing) {
    const f = orderForm.elements;
    $("ul", $(".order-summary", cartDlg)).replaceChildren(...missing.map((n) => {
      const li = el("li");
      const a = el("a", "", problem(n));
      a.href = `#${f[n].id}`;
      a.addEventListener("click", (ev) => { ev.preventDefault(); f[n].focus(); });
      li.append(a);
      return li;
    }));
  }

  function problem(name) {
    const v = orderForm.elements[name].value.trim();
    if (!needed().includes(name)) return "";
    if (!v) return t(MSG[name].missing);
    if (name === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return t(MSG.email.bad);
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
    if (btn.getAttribute("aria-busy") === "true") return;

    const missing = needed().filter((n) => render(n));
    const summary = $(".order-summary", cartDlg);
    if (missing.length) {
      fillSummary(missing);
      summary.hidden = false;
      showStatus(null);
      summary.focus();
      return;
    }
    summary.hidden = true;

    const body = { delivery: delivery(), items: cart.map(({ id, qty }) => ({ id, qty })) };
    for (const n of ["name", "email", "phone", "address", "postal", "city", "country", "note", "website"]) body[n] = f[n].value.trim();

    btn.setAttribute("aria-busy", "true");
    btn.textContent = t("checkout.sending");
    showStatus(null);
    if (window.FDV.offline) {
      // No server behind this copy of the site: the order leaves as an e-mail from the visitor's own mail app
      const lines = cart.map(({ id, qty }) => { const p = byId(id); return t("checkout.mail.line", { qty, name: p.name, price: price(p.price * qty) }); });
      const ship = body.delivery === "shipping";
      const fee = ship ? (Number(settings.shippingFee) || 0) : 0;
      const total = cart.reduce((t, { id, qty }) => t + byId(id).price * qty, 0) + fee;
      const text = [
        t("checkout.mail.greeting"), "", t("checkout.mail.intro"), ...lines,
        ship ? t("checkout.mail.shipping", { price: price(fee) }) : t("checkout.mail.pickup"), t("checkout.mail.total", { price: price(total) }), "",
        ship ? t("checkout.mail.address", body) : "",
        body.note ? t("checkout.mail.note", body) : "", "",
        body.name, body.email, body.phone,
      ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
      const to = settings.contactEmail || "";
      location.href = `mailto:${to}?subject=${encodeURIComponent(t("checkout.mail.subject", { name: body.name }))}&body=${encodeURIComponent(text)}`;
      showStatus(() => t("checkout.offlineStatus"));
      btn.removeAttribute("aria-busy");
      btn.textContent = t("checkout.submit");
      return;
    }
    try {
      const out = await api("/api/orders", { method: "POST", body });
      cart = []; saveCart();
      orderForm.reset();
      clearErrors();
      showStatus(null);
      applySettings();
      const num = $("[data-order-number]", cartDlg);
      num.textContent = out.number ? t("cart.orderNumber", { number: out.number }) : "";
      $(".cart-view", cartDlg).hidden = true;
      $(".cart-done", cartDlg).hidden = false;
      tie($(".cart-done .tie", cartDlg));
      $(".done-title", cartDlg).focus();
      load(); // stock has changed
    } catch (err) {
      showStatus(() => (err.status ? window.FDV.errorText(err) : t("errors.orderUnreachable")), "error");
      if (err.status === 409) { await load(); renderCart(); }
    } finally {
      btn.removeAttribute("aria-busy");
      btn.textContent = t("checkout.submit");
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
      loaded = true;
    } catch {
      state.removeAttribute("data-i18n");
      state.textContent = t("errors.shopUnreachable");
    }
  }

  // A language switch happens with the sheets closed (they are modal), so the page itself is what needs redrawing
  document.addEventListener("fildevie:locale-changed", () => {
    renderCount();
    if (!loaded) return;
    renderFilters();
    renderGrid();
    applySettings();
    // The basket and its messages may be open: write them again in the new language
    renderCart();
    Object.keys(MSG).forEach((n) => { if (orderForm.elements[n].getAttribute("aria-invalid") === "true") render(n); });
    const summary = $(".order-summary", cartDlg);
    if (!summary.hidden) fillSummary(needed().filter(problem));
    if (statusMsg) orderStatus().textContent = statusMsg();
  });

  i18n.ready.then(() => { renderCount(); return load(); }).then(() => {
    const id = location.hash.startsWith("#p-") ? location.hash.slice(3) : "";
    if (id && byId(id)) openPiece(id, false);
  });
})();
