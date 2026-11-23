export function enableDiagramPan(surface) {
  let drag;
  surface.oncontextmenu = (event) => event.preventDefault();
  surface.onauxclick = (event) => {
    if (event.button === 1) event.preventDefault();
  };
  surface.onpointerdown = (event) => {
    if (event.pointerType !== "mouse" || ![0, 1, 2].includes(event.button)) return;
    if (event.button === 0 && event.target !== surface.firstElementChild) return;
    event.preventDefault();
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
  surface.onlostpointercapture = () => {
    drag = null;
    surface.removeAttribute("data-panning");
  };
}
