/* contact: the letter goes to Nathalie through the server. If the server cannot be reached,
   the visitor's own mail app opens with the letter already written. */
(() => {
  const form = document.querySelector("#contact .ct-form");
  if (!form) return;
  const btn = form.querySelector(".ct-btn");
  const status = form.querySelector(".ct-status");
  const t = (k, p) => window.i18n.t(k, p);
  // The message may be text or a function, so a visible message can be written again when the language changes
  let current = null;
  const say = (text, tone) => {
    current = typeof text === "function" ? text : null;
    status.textContent = current ? current() : text;
    if (tone) status.dataset.tone = tone; else delete status.dataset.tone;
  };
  document.addEventListener("fildevie:locale-changed", () => { if (current) status.textContent = current(); });
  const field = (n) => form.elements[n];

  form.noValidate = true;
  form.addEventListener("input", (e) => { if (e.target.getAttribute("aria-invalid")) e.target.removeAttribute("aria-invalid"); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (btn.getAttribute("aria-busy") === "true") return;
    const data = {
      name: field("name").value.trim(),
      contact: field("contact").value.trim(),
      message: field("message").value.trim(),
      website: field("website").value,
    };
    const missing = ["name", "contact"].filter((k) => !data[k]);
    missing.forEach((k) => field(k).setAttribute("aria-invalid", "true"));
    if (missing.length) {
      say(() => (missing.length === 2 ? t("contact.error.both") : missing[0] === "name" ? t("contact.error.name") : t("contact.error.contact")), "error");
      field(missing[0]).focus();
      return;
    }

    btn.setAttribute("aria-busy", "true");
    btn.textContent = t("contact.sending");
    say("");
    try {
      const res = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(out.error || "refused"), { status: res.status, code: out.code, params: out.params });
      let played = false;
      try { played = !!window.__ctRitual?.({ name: data.name, text: data.message, say }); } catch (_) { played = false; }
      if (!played) {
        form.reset();
        say(() => t("ritual.thanks", { name: data.name }), "ok");
        document.dispatchEvent(new CustomEvent("fildevie:message-sent"));
      }
    } catch (err) {
      if (err.status && err.status < 500 && err.status !== 404 && err.status !== 405) {
        say(() => window.FDV.errorText(err, "errors.messageFailed"), "error");
      } else {
        // No server (or it failed): hand the letter to the visitor's own mail app
        const to = (document.querySelector("[data-contact-email]")?.getAttribute("href") || "mailto:").replace(/^mailto:/, "");
        const body = `${data.message}\n\n${data.name}\n${data.contact}`;
        location.href = `mailto:${to}?subject=${encodeURIComponent(t("contact.mailSubject", { name: data.name }))}&body=${encodeURIComponent(body)}`;
        say(() => t("errors.mailFallback"), "error");
      }
    } finally {
      btn.removeAttribute("aria-busy");
      btn.textContent = t("contact.submit");
    }
  });
})();
