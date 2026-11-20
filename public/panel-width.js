export function enablePanelResize(workspace, panels, handle, side) {
  const right = side === "right";
  const name = right ? "inspector" : "sidebar";
  const storageKey = "buro:" + name + "-width";
  const widthProperty = "--" + name + "-user-width";
  const direction = right ? -1 : 1;
  const panel = () => panels.find((item) => item.offsetWidth);
  let drag;

  function limits() {
    const style = getComputedStyle(panel());
    return [parseFloat(style.minWidth), parseFloat(style.maxWidth)];
  }

  function updateAria() {
    const active = panel();
    if (!active || !handle.offsetWidth) return;
    const [min, max] = limits();
    handle.setAttribute("aria-valuemin", min);
    handle.setAttribute("aria-valuemax", max);
    handle.setAttribute("aria-valuenow", active.offsetWidth);
    handle.setAttribute("aria-controls", active.id);
  }

  function setWidth(width) {
    if (width === null) workspace.style.removeProperty(widthProperty);
    else if (panel()) {
      const [min, max] = limits();
      const bounded = Math.round(Math.max(min, Math.min(max, width)));
      if (bounded !== panel().offsetWidth)
        workspace.style.setProperty(widthProperty, bounded + "px");
    }
    updateAria();
  }

  function saveWidth() {
    const value = workspace.style.getPropertyValue(widthProperty);
    try {
      if (value) localStorage.setItem(storageKey, value);
      else localStorage.removeItem(storageKey);
    } catch {
      // The width is still applied for the current session.
    }
  }

  try {
    const saved = localStorage.getItem(storageKey);
    if (/^\d{3}px$/.test(saved))
      workspace.style.setProperty(widthProperty, saved);
  } catch {
    // The CSS default applies if storage is unavailable.
  }

  handle.onpointerdown = (event) => {
    if (event.button !== 0 || drag || !panel()) return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      width: panel().offsetWidth,
    };
    handle.setPointerCapture(drag.id);
    handle.dataset.resizing = "";
    event.preventDefault();
  };
  handle.onpointermove = (event) => {
    if (drag?.id === event.pointerId)
      setWidth(drag.width + direction * (event.clientX - drag.x));
  };
  handle.onlostpointercapture = (event) => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    delete handle.dataset.resizing;
    saveWidth();
  };
  handle.ondblclick = () => {
    setWidth(null);
    saveWidth();
  };
  handle.onkeydown = (event) => {
    const active = panel();
    if (!active) return;
    const [min, max] = limits();
    const width = {
      ArrowLeft: active.offsetWidth - direction * 16,
      ArrowRight: active.offsetWidth + direction * 16,
      Home: min,
      End: max,
      Enter: null,
    };
    if (!Object.hasOwn(width, event.key)) return;
    event.preventDefault();
    setWidth(width[event.key]);
    saveWidth();
  };

  const observer = new ResizeObserver(updateAria);
  panels.forEach((element) => observer.observe(element));
  observer.observe(workspace);
  updateAria();
}
