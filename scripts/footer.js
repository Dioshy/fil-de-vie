/* footer: keep the copyright year current (the static year stays if this never runs),
   and when "Revenir au début du fil" is followed, bring keyboard focus up with the page
   so the next Tab starts from the top rather than from the footer. */
(() => {
  const year = document.querySelector("#footer [data-ft-year]");
  const setYear = () => { if (year) year.textContent = window.i18n ? window.i18n.formatDate(new Date(), { year: "numeric" }) : String(new Date().getFullYear()); };
  setYear();
  document.addEventListener("fildevie:locale-changed", setYear);

  const top = document.querySelector("#footer .ft-top");
  if (!top) return;
  top.addEventListener("click", () => {
    const target = document.querySelector(top.getAttribute("href"));
    const heading = target && target.querySelector("h1, h2");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    setTimeout(() => heading.focus({ preventScroll: true }), 50);
  });
})();
