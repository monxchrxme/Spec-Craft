export function enableSidebarResize(workspace, sidebar, handle) {
  const storageKey = "buro:sidebar-width";
  const widthProperty = "--sidebar-user-width";
  let drag;

  function limits() {
    const style = getComputedStyle(sidebar);
    return [parseFloat(style.minWidth), parseFloat(style.maxWidth)];
  }

  function updateAria() {
    if (!sidebar.offsetWidth) return;
    const [min, max] = limits();
    handle.setAttribute("aria-valuemin", min);
    handle.setAttribute("aria-valuemax", max);
    handle.setAttribute("aria-valuenow", sidebar.offsetWidth);
  }

  function setWidth(width) {
    if (width === null) workspace.style.removeProperty(widthProperty);
    else {
      const [min, max] = limits();
      const bounded = Math.round(Math.max(min, Math.min(max, width)));
      if (bounded !== sidebar.offsetWidth)
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
    if (event.button !== 0 || drag) return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      width: sidebar.offsetWidth,
    };
    handle.setPointerCapture(drag.id);
    handle.dataset.resizing = "";
    event.preventDefault();
  };
  handle.onpointermove = (event) => {
    if (drag?.id === event.pointerId)
      setWidth(drag.width + event.clientX - drag.x);
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
    const [min, max] = limits();
    const width = {
      ArrowLeft: sidebar.offsetWidth - 16,
      ArrowRight: sidebar.offsetWidth + 16,
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
  observer.observe(sidebar);
  observer.observe(workspace);
  updateAria();
}
