// Menus are <details> and work without this. It only makes them close the way menus do:
// one open at a time, and shut on a click elsewhere or Escape.
(() => {
  const menus = [...document.querySelectorAll(".menu")];

  for (const menu of menus) {
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      for (const other of menus) if (other !== menu) other.open = false;
    });
  }

  document.addEventListener("click", (event) => {
    for (const menu of menus) if (!menu.contains(event.target)) menu.open = false;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const menu of menus) {
      if (!menu.open) continue;
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
})();

// The tiles on the home page carry a light that follows the cursor.
for (const tile of document.querySelectorAll(".tile")) {
  tile.addEventListener("pointermove", (event) => {
    const box = tile.getBoundingClientRect();
    tile.style.setProperty("--mx", `${event.clientX - box.left}px`);
    tile.style.setProperty("--my", `${event.clientY - box.top}px`);
  });
}

// CSS can stop CSS animations for people who ask for less motion, but SVG's own need stopping here.
if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  for (const svg of document.querySelectorAll("svg")) svg.pauseAnimations?.();
}
