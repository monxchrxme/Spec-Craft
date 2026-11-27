export function enableMiddleScroll(root) {
  let drag, frame, interceptClick;
  const deadZone = 7;

  function stop() {
    if (!drag) return;
    const { surface, pointer } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    frame = null;
    delete surface.dataset.middleScroll;
    if (surface.hasPointerCapture(pointer)) surface.releasePointerCapture(pointer);
  }

  function scroll(now) {
    frame = null;
    if (!drag) return;
    const { surface, distance, last } = drag;
    if (!surface.clientHeight) {
      stop();
      return;
    }
    const speed = Math.min(3200, (Math.abs(distance) - deadZone) * 14);
    if (speed <= 0) return;
    if (distance < 0 ? surface.scrollTop <= 0 :
      surface.scrollTop >= surface.scrollHeight - surface.clientHeight - 1) return;
    const elapsed = Math.max(0, Math.min(40, now - last)) / 1000;
    const advance = Math.sign(distance) * speed * elapsed + drag.remainder;
    const pixels = Math.trunc(advance);
    surface.scrollTop += pixels;
    drag.remainder = advance - pixels;
    drag.last = now;
    frame = requestAnimationFrame(scroll);
  }

  root.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 1 || drag) return;
    interceptClick = false;
    if (event.defaultPrevented || event.target.closest(
      "a[href],button,input,select,.graph-stage,.diagram-window,.drawing-stage",
    )) return;
    const surface = event.target.closest(".pdf-stage,#source,#source-preview") || root;
    if (surface.scrollHeight - surface.clientHeight <= 1) return;
    event.preventDefault();
    drag = { surface, pointer: event.pointerId, origin: event.clientY, distance: 0, remainder: 0 };
    interceptClick = true;
    surface.dataset.middleScroll = "";
    surface.setPointerCapture(event.pointerId);
  });

  root.addEventListener("pointermove", (event) => {
    if (drag?.pointer !== event.pointerId) return;
    if (!(event.buttons & 4)) {
      stop();
      return;
    }
    drag.distance = event.clientY - drag.origin;
    if (!frame && Math.abs(drag.distance) > deadZone) {
      drag.last = performance.now();
      frame = requestAnimationFrame(scroll);
    }
  });

  root.addEventListener("lostpointercapture", (event) => {
    if (drag?.pointer === event.pointerId) stop();
  });
  window.addEventListener("mouseup", (event) => {
    if (event.button === 1) stop();
  });
  window.addEventListener("blur", stop);
  root.addEventListener("auxclick", (event) => {
    if (event.button === 1 && interceptClick) {
      event.preventDefault();
      interceptClick = false;
    }
  });
}
