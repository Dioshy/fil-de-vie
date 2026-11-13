/* ateliers: the row of workshops scrolls sideways; previous / next buttons step through it. */
(() => {
  const root = document.querySelector('[data-ws="ateliers"]');
  if (!root) return;

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const row = root.querySelector(".at-row");
const steps = root.querySelectorAll(".at-step");

// Previous / next: snap to the neighbouring card, and grey out the end you have reached.
function updateSteps() {
  const max = row.scrollWidth - row.clientWidth - 2;
  steps[0].disabled = row.scrollLeft <= 2;
  steps[1].disabled = row.scrollLeft >= max;
}

steps.forEach((btn) => {
  btn.addEventListener("click", () => {
    const cards = [...row.children];
    const x = row.scrollLeft;
    const target = btn.dataset.dir === "1"
      ? cards.find((c) => c.offsetLeft > x + 2)
      : cards.reverse().find((c) => c.offsetLeft < x - 2);
    if (target) row.scrollTo({ left: target.offsetLeft, behavior: reduce ? "auto" : "smooth" });
  });
});

row.addEventListener("scroll", updateSteps, { passive: true });
new ResizeObserver(updateSteps).observe(row);
updateSteps();

})();
