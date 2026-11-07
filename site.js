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
