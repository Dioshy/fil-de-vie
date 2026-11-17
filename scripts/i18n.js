/* i18n: French, English and Dutch, with no library.
   The page's own text is the French source and the no-JavaScript fallback. This file picks a language,
   loads i18n/<lang>.json, and swaps the text of the elements marked in the HTML:
     data-i18n="key"            textContent
     data-i18n-html="key"       innerHTML (only where the text holds em / br / a / span)
     data-i18n-attr="a:key;b:key"   attributes (aria-label, alt, title, placeholder, content, ...)
   Language order: ?lang= , the saved choice, the browser's languages, then French.
   Other scripts call i18n.t(), wait for i18n.ready, and listen to "fildevie:locale-changed". */
(() => {
  const SUPPORTED = ["fr", "en", "nl"];
  const DEFAULT = "fr";
  const KEY = "fildevie:lang";
  // How each language writes numbers, prices and dates (Brussels: French and Dutch as spoken in Belgium)
  const FORMAT = { fr: "fr-BE", en: "en-GB", nl: "nl-BE" };

  const messages = {};
  const pick = (code) => {
    const base = String(code || "").toLowerCase().split(/[-_]/)[0];
    return SUPPORTED.includes(base) ? base : "";
  };
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save = (l) => { try { localStorage.setItem(KEY, l); } catch { /* private mode */ } };

  function detect() {
    const asked = pick(new URLSearchParams(location.search).get("lang"));
    if (asked) { save(asked); return asked; }
    const saved = pick(read());
    if (saved) return saved;
    for (const l of navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) {
      const m = pick(l);
      if (m) return m;
    }
    return DEFAULT;
  }

  let locale = detect();
  let numberFormat, priceFormat, pluralRules;
  const formats = () => {
    const tag = FORMAT[locale];
    numberFormat = new Intl.NumberFormat(tag);
    priceFormat = new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" });
    pluralRules = new Intl.PluralRules(tag);
  };
  formats();
  document.documentElement.lang = locale;

  const flatten = (obj, prefix = "", out = {}) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object") flatten(v, `${prefix}${k}.`, out);
      else out[prefix + k] = String(v);
    }
    return out;
  };
  async function load(l) {
    if (messages[l]) return;
    try {
      const res = await fetch(new URL(`i18n/${l}.json`, document.baseURI));
      if (!res.ok) throw new Error(String(res.status));
      messages[l] = flatten(await res.json());
    } catch (err) {
      messages[l] = {};
      console.warn(`i18n: could not load ${l}`, err);
    }
  }

  const fill = (text, params) => (params ? text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : text);
  // French is the fallback for a key a language does not have yet; the key itself is the last resort
  const lookup = (key) => (messages[locale] && messages[locale][key]) ?? (messages[DEFAULT] && messages[DEFAULT][key]);
  const t = (key, params) => fill(lookup(key) ?? key, params);

  function plural(key, n, params) {
    const rule = pluralRules.select(n);
    const k = lookup(`${key}.${rule}`) != null ? `${key}.${rule}` : `${key}.other`;
    return t(k, { n: numberFormat.format(n), ...params });
  }

  const formatNumber = (n, opts) => (opts ? new Intl.NumberFormat(FORMAT[locale], opts).format(n) : numberFormat.format(n));
  // formatPrice takes euros (FDV.price takes cents)
  const formatPrice = (n) => priceFormat.format(Number(n) || 0);
  const formatDate = (d = new Date(), opts = { year: "numeric", month: "long", day: "numeric" }) =>
    new Intl.DateTimeFormat(FORMAT[locale], opts).format(d instanceof Date ? d : new Date(d));

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const m = lookup(el.dataset.i18n);
      if (m != null) el.textContent = m;
    });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const m = lookup(el.dataset.i18nHtml);
      if (m != null) el.innerHTML = m;
    });
    root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.dataset.i18nAttr.split(";").forEach((pair) => {
        const i = pair.indexOf(":");
        const m = lookup(pair.slice(i + 1).trim());
        if (i > 0 && m != null) el.setAttribute(pair.slice(0, i).trim(), m);
      });
    });
  }

  function mark() {
    document.documentElement.lang = locale;
    document.querySelectorAll("[data-lang-switch] a[hreflang]").forEach((a) => {
      if (a.getAttribute("hreflang") === locale) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  }

  const ready = Promise.all([load(DEFAULT), load(locale)]).then(() => {
    // French is already in the page, so nothing needs swapping for it on arrival
    if (locale !== DEFAULT) apply();
    mark();
  });

  async function setLocale(next) {
    const l = pick(next);
    if (!l || l === locale) return;
    await ready;
    await load(l);
    locale = l;
    save(l);
    formats();
    apply();
    mark();
    // A shared link keeps pointing at the language on screen
    const url = new URL(location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", l);
      history.replaceState(history.state, "", url);
    }
    document.dispatchEvent(new CustomEvent("fildevie:locale-changed", { detail: { locale: l } }));
  }

  // The FR · EN · NL links work without script; with it they switch in place and the page stays where it is
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-lang-switch] a[hreflang]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setLocale(a.getAttribute("hreflang"));
  });
  window.i18n = {
    t,
    plural,
    // the French message, whatever the active language (the source text and the server's defaults)
    french: (key) => (messages[DEFAULT] && messages[DEFAULT][key]) ?? "",
    setLocale,
    ready,
    apply,
    formatNumber,
    formatPrice,
    formatDate,
    get locale() { return locale; },
    get formatLocale() { return FORMAT[locale]; },
    supported: SUPPORTED.slice(),
  };
})();
