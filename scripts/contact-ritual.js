/* contact-ritual: what happens once a message has really been sent.
   The words fold into a letter, the red thread ties it, it rises and drifts away, and a quiet
   acknowledgement stays. Also the writing feel: a soft word count under the textarea.
   contact.js calls window.__ctRitual({ name, text, say }) after a successful send; if this file is
   missing, throws, or returns falsy, contact.js falls back to the plain reset + message.
   Plain WAAPI. Only transform and opacity move, apart from the thread drawing itself. */
(() => {
  const form = document.querySelector("#contact .ct-form");
  if (!form) return;
  const stage = form.querySelector(".ct-stage");
  const thanks = form.querySelector(".ct-thanks");
  const again = form.querySelector(".ct-again");
  const area = form.querySelector("textarea");
  const count = form.querySelector(".ct-count");
  if (!stage || !thanks || !again) return;

  const env = stage.querySelector(".ct-env");
  const envText = stage.querySelector(".ct-env-text");
  const fold = stage.querySelector(".ct-env-fold");
  const thread = stage.querySelector(".ct-env-thread");
  const dots = [...stage.querySelectorAll(".ct-dot")];
  const thanksText = thanks.querySelector(".ct-thanks-text");
  const parts = () => [...form.querySelectorAll(":scope > .ct-field, :scope > .ct-act, :scope > .ct-hp")];
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const token = (name, fallback) => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const SETTLE = "cubic-bezier(0.16, 1, 0.3, 1)";
  const CALM = "cubic-bezier(0.65, 0, 0.35, 1)";
  let running = false;
  let sentName = "";
  // the acknowledgement on screen follows a language switch
  document.addEventListener("fildevie:locale-changed", () => {
    if (!thanks.hidden && sentName) thanksText.textContent = window.i18n.t("ritual.thanks", { name: sentName });
  });

  /* ---- writing feel: a quiet word count, only after typing, never a limit ---- */
  if (area && count) {
    const update = () => {
      const n = (area.value.trim().match(/\S+/g) || []).length;
      count.textContent = n ? window.i18n.plural("ritual.words", n) : "";
      count.classList.toggle("is-on", n > 0);
    };
    area.addEventListener("input", update);
    form.addEventListener("reset", () => setTimeout(update));
    document.addEventListener("fildevie:locale-changed", update);
  }

  const announce = () => document.dispatchEvent(new CustomEvent("fildevie:message-sent"));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function restore() {
    parts().forEach((el) => { el.inert = false; el.style.opacity = ""; });
    stage.hidden = true;
    stage.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    thanks.hidden = true;
    thanks.style.opacity = "";
    running = false;
  }

  async function run({ name, text, say }) {
    const fields = parts();
    const ms = reduced() ? 0 : 1;
    const t = (n) => n;
    const done = window.i18n.t("ritual.thanks", { name });

    fields.forEach((el) => { el.inert = true; });
    sentName = name;
    thanksText.textContent = done;
    say(done, "ok"); // the live region announces it; the visible copy is hidden from assistive tech
    thanks.style.opacity = "0";
    thanks.hidden = false;

    if (!ms) {
      /* reduced motion: a plain cross-fade, no flight */
      const d = token("--dur-2", 420);
      announce();
      const fades = fields.map((el) => el.animate({ opacity: [1, 0] }, { duration: d, easing: "linear", fill: "forwards" }));
      await Promise.all(fades.map((f) => f.finished));
      fields.forEach((el) => { el.style.opacity = "0"; });
      fades.forEach((f) => f.cancel());
      form.reset();
      const shown = thanks.animate({ opacity: [0, 1] }, { duration: d, easing: "linear", fill: "forwards" });
      await shown.finished;
      thanks.style.opacity = "1";
      shown.cancel();
      thanks.focus();
      return;
    }

    /* bring the stage into view if the visitor sent from far below it */
    const r = form.getBoundingClientRect();
    if (r.top < 0 || r.top + r.height * 0.5 > innerHeight * 0.9) form.scrollIntoView({ block: "center", behavior: "smooth" });

    envText.textContent = text.length > 140 ? text.slice(0, 140) + "…" : text;
    const len = thread.getTotalLength();
    thread.style.strokeDasharray = len;
    thread.style.strokeDashoffset = len;
    stage.hidden = false;
    env.style.opacity = "0";
    fold.style.opacity = "0";
    dots.forEach((d, i) => { d.style.opacity = "0"; });

    const o = { fill: "both" };
    const anims = [];
    const go = (el, kf, opt) => { const a = el.animate(kf, { ...o, ...opt }); anims.push(a); return a; };
    // 1. the words fold into a letter
    fields.forEach((el) => go(el, { opacity: [1, 0] }, { duration: t(520), easing: CALM }));
    go(env, [{ opacity: 0, transform: "scale(1.45)" }, { opacity: 1, transform: "scale(1)" }], { duration: t(700), easing: CALM });
    go(envText, { opacity: [0.9, 0] }, { duration: t(600), easing: CALM });
    go(fold, { opacity: [0, 1] }, { duration: t(450), delay: t(250), easing: CALM });
    // 2. the red thread ties it
    go(thread, { strokeDashoffset: [len, 0] }, { duration: t(600), delay: t(600), easing: CALM });
    // 3. it rises and drifts, with a slight sway
    const rise = [
      { opacity: 1, transform: "translate(0, 0)" },
      { opacity: 1, offset: 0.25, transform: "translate(7px, -48px)" },
      { opacity: 0.8, offset: 0.55, transform: "translate(-6px, -120px)" },
      { opacity: 0, transform: "translate(4px, -210px)" },
    ];
    // the animation above leaves env at scale(1); the rise starts from there
    go(env, rise, { duration: t(1200), delay: t(1200), easing: "cubic-bezier(0.4, 0, 0.3, 1)", fill: "forwards" });
    // a few faint lights linger and fade
    dots.forEach((d, i) => {
      go(d, [
        { opacity: 0, transform: "translate(0, 0)" },
        { opacity: 0.5, offset: 0.3 },
        { opacity: 0, transform: `translate(${(i % 2 ? 1 : -1) * (6 + i * 3)}px, -${34 + i * 9}px)` },
      ], { duration: t(1400), delay: t(1150 + i * 110), easing: "ease-out" });
    });

    let fired = false;
    const fire = () => { if (!fired) { fired = true; announce(); } };
    setTimeout(fire, t(1200));

    await wait(t(1200 + 1200 + 150));
    fields.forEach((el) => { el.style.opacity = "0"; });
    form.reset();
    // 4. the acknowledgement
    const a = thanks.animate({ opacity: [0, 1], transform: ["translateY(6px)", "translateY(0)"] }, { duration: t(520), easing: SETTLE, fill: "both" });
    await a.finished;
    thanks.style.opacity = "1";
    a.cancel();
    anims.forEach((x) => x.cancel());
    stage.hidden = true;
    fire();
    thanks.focus();
  }

  window.__ctRitual = (info) => {
    if (running) return true;
    running = true;
    // contact.js must never lose the visitor's letter: if anything goes wrong, fall back to the plain state
    run(info).catch(() => {
      restore();
      form.reset();
      info.say(() => window.i18n.t("ritual.thanks", { name: info.name }), "ok");
      announce();
    });
    return true;
  };

  /* "Écrire un autre mot": the form comes back and the first field is ready */
  again.addEventListener("click", async () => {
    const fields = parts();
    const d = reduced() ? token("--dur-2", 420) : token("--dur-1", 180);
    const status = form.querySelector(".ct-status");
    status.textContent = "";
    delete status.dataset.tone;
    await thanks.animate({ opacity: [1, 0] }, { duration: d, easing: "linear", fill: "forwards" }).finished;
    thanks.hidden = true;
    thanks.getAnimations().forEach((a) => a.cancel());
    thanks.style.opacity = "";
    form.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    fields.forEach((el) => { el.inert = false; el.style.opacity = ""; });
    document.dispatchEvent(new CustomEvent("fildevie:message-reset"));
    if (!reduced()) fields.forEach((el) => el.animate({ opacity: [0, 1] }, { duration: token("--dur-2", 420), easing: SETTLE }));
    running = false;
    form.elements.name.focus();
  });
})();
