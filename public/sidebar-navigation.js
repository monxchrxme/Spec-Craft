export function sidebarSearchPattern(input) {
  const query = input.value.trim().replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  return query ? new RegExp(query, "giu") : null;
}

export function highlightSidebarMatches(label, text, pattern) {
  const matches = pattern ? [...text.matchAll(pattern)] : [];
  if (!matches.length) {
    label.textContent = text;
    return false;
  }

  const fragment = document.createDocumentFragment();
  let end = 0;
  for (const { 0: match, index } of matches) {
    const mark = document.createElement("mark");
    mark.className = "sidebar-search-match";
    mark.textContent = match;
    fragment.append(text.slice(end, index), mark);
    end = index + match.length;
  }
  fragment.append(text.slice(end));
  label.replaceChildren(fragment);
  return true;
}

export function enableSidebarSearch(toggle, input, results) {
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
    if (event.isComposing || !["Escape", "Enter"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") show(false);
    else
      results.querySelector(".sidebar-search-match")?.closest("button")?.click();
  };
}

function remember(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // The current layout still works without browser storage.
  }
}

function enableSectionCollapse(toggle, storageKey) {
  const section = toggle.closest("section");
  const content = document.getElementById(toggle.getAttribute("aria-controls"));

  function setCollapsed(collapsed) {
    section.classList.toggle("is-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    content.hidden = collapsed;
  }

  try {
    setCollapsed(localStorage.getItem(storageKey) === "true");
  } catch {
    // Both sections start expanded if browser storage is unavailable.
  }
  toggle.onclick = () => {
    const collapsed = !content.hidden;
    setCollapsed(collapsed);
    remember(storageKey, collapsed);
  };
}

export function enableSidebarPanes(panes, handle) {
  enableSectionCollapse(
    panes.querySelector("#documents-section-toggle"),
    "buro:documents-collapsed",
  );
  enableSectionCollapse(
    panes.querySelector("#outline-section-toggle"),
    "buro:outline-collapsed",
  );
  const shareKey = "buro:outline-share";
  const min = 25;
  const max = 75;
  const defaultShare = 45;
  let share = defaultShare;
  let drag;

  function setShare(next) {
    share = Math.max(min, Math.min(max, Math.round(next)));
    panes.style.setProperty("--outline-share", share + "%");
    handle.setAttribute("aria-valuenow", share);
    handle.setAttribute("aria-valuetext", share + "%");
  }

  handle.setAttribute("aria-valuemin", min);
  handle.setAttribute("aria-valuemax", max);
  try {
    const saved = Number(localStorage.getItem(shareKey));
    if (saved >= min && saved <= max) share = saved;
  } catch {
    // The default layout applies without browser storage.
  }
  setShare(share);

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
