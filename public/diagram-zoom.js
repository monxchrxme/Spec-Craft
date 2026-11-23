export function enableDiagramFitToggle(button, surface, currentScale, scale) {
  let previous;
  button.onclick = () => {
    if (button.getAttribute("aria-pressed") === "true") {
      scale(previous?.scale ?? 1);
      if (previous) {
        surface.scrollLeft = previous.left;
        surface.scrollTop = previous.top;
      }
      previous = undefined;
      return;
    }

    previous = {
      scale: currentScale(),
      left: surface.scrollLeft,
      top: surface.scrollTop,
    };
    scale("fit");
  };
}
