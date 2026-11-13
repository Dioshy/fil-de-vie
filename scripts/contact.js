/* contact: the letter goes to Nathalie through the server. If the server cannot be reached,
   the visitor's own mail app opens with the letter already written. */
(() => {
  const form = document.querySelector("#contact .ct-form");
  if (!form) return;
  const btn = form.querySelector(".ct-btn");
  const status = form.querySelector(".ct-status");
  const label = btn.textContent;
  const say = (text, tone) => { status.textContent = text; if (tone) status.dataset.tone = tone; else delete status.dataset.tone; };
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
      say(missing.length === 2 ? "Il me faut au moins un prénom et un moyen de vous répondre." : missing[0] === "name" ? "Il me manque votre prénom." : "Il me manque un e-mail ou un numéro pour vous répondre.", "error");
      field(missing[0]).focus();
      return;
    }

    btn.setAttribute("aria-busy", "true");
    btn.textContent = "J'envoie…";
    say("");
    try {
      const res = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(out.error || "refused"), { status: res.status });
      const thanks = `Merci ${data.name}. J'ai bien reçu votre mot, je vous réponds moi-même.`;
      let played = false;
      try { played = !!window.__ctRitual?.({ name: data.name, text: data.message, say }); } catch (_) { played = false; }
      if (!played) {
        form.reset();
        say(thanks, "ok");
        document.dispatchEvent(new CustomEvent("fildevie:message-sent"));
      }
    } catch (err) {
      if (err.status && err.status < 500 && err.status !== 404 && err.status !== 405) {
        say(err.message || "Le message n'a pas pu partir. Réessayez dans un instant.", "error");
      } else {
        // No server (or it failed): hand the letter to the visitor's own mail app
        const to = (document.querySelector("[data-contact-email]")?.getAttribute("href") || "mailto:").replace(/^mailto:/, "");
        const body = `${data.message}\n\n${data.name}\n${data.contact}`;
        location.href = `mailto:${to}?subject=${encodeURIComponent(`Un mot de ${data.name}`)}&body=${encodeURIComponent(body)}`;
        say("Le site n'a pas pu l'envoyer : votre messagerie s'ouvre avec le message déjà écrit.", "error");
      }
    } finally {
      btn.removeAttribute("aria-busy");
      btn.textContent = label;
    }
  });
})();
