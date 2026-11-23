export function enableDiagramPan(surface, { rightButton = false } = {}) {
  let drag;
  if (rightButton) surface.oncontextmenu = (event) => event.preventDefault();
  surface.onpointerdown = (event) => {
    if (event.pointerType !== "mouse" || drag) return;
    // A middle click uses the browser's native scrolling.
    if (event.button === 2 && rightButton) event.preventDefault();
    else if (
      event.button !== 0 ||
      (event.target !== surface && !surface.firstElementChild?.contains(event.target))
    ) return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: surface.scrollLeft,
      top: surface.scrollTop,
    };
    surface.setPointerCapture(event.pointerId);
    surface.setAttribute("data-panning", "");
  };
  surface.onpointermove = (event) => {
    if (drag?.id !== event.pointerId) return;
    surface.scrollLeft = drag.left + drag.x - event.clientX;
    surface.scrollTop = drag.top + drag.y - event.clientY;
  };
  surface.onlostpointercapture = (event) => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    surface.removeAttribute("data-panning");
  };
}
