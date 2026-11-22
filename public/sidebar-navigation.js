export function enableSidebarSearch(toggle, input) {
  function show(visible) {
    input.hidden = !visible;
    toggle.setAttribute("aria-expanded", String(visible));
    if (visible) {
      input.focus();
    } else {
      toggle.focus();
      input.value = "";
      input.dispatchEvent(new Event("input"));
    }
  }

  toggle.onclick = () => show(input.hidden);
  input.onkeydown = (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    show(false);
  };
}

export function enableOutlineResize({
  panes,
  outline,
  handle,
  toggle,
  content,
  actions,
}) {
  const shareKey = "buro:outline-share";
  const collapsedKey = "buro:outline-collapsed";
  const min = 25;
  const max = 75;
  const defaultShare = 45;
  let share = defaultShare;
  let drag;

  function remember(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // The current layout still works without browser storage.
    }
  }

  function setShare(next) {
    share = Math.max(min, Math.min(max, Math.round(next)));
    panes.style.setProperty("--outline-share", share + "%");
    handle.setAttribute("aria-valuenow", share);
    handle.setAttribute("aria-valuetext", share + "%");
  }

  function setCollapsed(collapsed) {
    outline.classList.toggle("is-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    content.hidden = actions.hidden = handle.hidden = collapsed;
  }

  handle.setAttribute("aria-valuemin", min);
  handle.setAttribute("aria-valuemax", max);
  try {
    const saved = Number(localStorage.getItem(shareKey));
    if (saved >= min && saved <= max) share = saved;
    setCollapsed(localStorage.getItem(collapsedKey) === "true");
  } catch {
    // The default layout applies without browser storage.
  }
  setShare(share);

  toggle.onclick = () => {
    const collapsed = !content.hidden;
    setCollapsed(collapsed);
    remember(collapsedKey, collapsed);
  };
  handle.onpointerdown = (event) => {
    if (event.button !== 0 || drag) return;
    drag = {
      id: event.pointerId,
      y: event.clientY,
      height: panes.clientHeight,
      share,
    };
    handle.setPointerCapture(drag.id);
    event.preventDefault();
  };
  handle.onpointermove = (event) => {
    if (drag?.id !== event.pointerId || !drag.height) return;
    setShare(drag.share + (100 * (drag.y - event.clientY)) / drag.height);
  };
  handle.onlostpointercapture = (event) => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    remember(shareKey, share);
  };
  handle.ondblclick = () => {
    setShare(defaultShare);
    remember(shareKey, share);
  };
  handle.onkeydown = (event) => {
    const next = {
      ArrowUp: share + 5,
      ArrowDown: share - 5,
      Home: min,
      End: max,
      Enter: defaultShare,
    };
    if (!Object.hasOwn(next, event.key)) return;
    event.preventDefault();
    setShare(next[event.key]);
    remember(shareKey, share);
  };
}
