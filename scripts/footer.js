/* footer: keep the copyright year current (the static year stays if this never runs),
   and when "Revenir au début du fil" is followed, bring keyboard focus up with the page
   so the next Tab starts from the top rather than from the footer. */
(() => {
  const year = document.querySelector("#footer [data-ft-year]");
  if (year) year.textContent = String(new Date().getFullYear());

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
