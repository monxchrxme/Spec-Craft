export function diagramHeight(value) {
  return value ? Math.round(Math.max(150, Math.min(1400, value))) : 0;
}

export function setDiagramHeight(card, height) {
  card.toggleAttribute("data-manual-height", height > 0);
  if (height) card.style.setProperty("--manual-diagram-height", height + "px");
  else card.style.removeProperty("--manual-diagram-height");
}

export function addHeightHandle(card, frame, initialHeight, onChange) {
  let height = initialHeight;
  let drag;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "diagram-height-grip";
  button.setAttribute("aria-label", "Изменить высоту диаграммы");
  button.title =
    "Потяните вверх или вниз. Двойной щелчок возвращает автовысоту.";
  button.innerHTML = '<i data-lucide="grip" aria-hidden="true"></i>';
  card.append(button);
  function commit(value) {
    if (value !== height) {
      if (onChange(value) === false) value = height;
      height = value;
    }
    setDiagramHeight(card, height);
  }
  button.onpointerdown = (event) => {
    if (event.button !== 0 || drag || !frame.clientHeight) return;
    drag = {
      id: event.pointerId,
      y: event.clientY,
      original: frame.offsetHeight,
    };
    button.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  button.onpointermove = (event) => {
    if (drag?.id !== event.pointerId) return;
    const delta = event.clientY - drag.y;
    drag.height = delta ? diagramHeight(drag.original + delta) : undefined;
    setDiagramHeight(card, drag.height ?? height);
  };
  button.onpointercancel = () => {
    drag = null;
    setDiagramHeight(card, height);
  };
  button.onlostpointercapture = (event) => {
    if (drag?.id !== event.pointerId) return;
    const value = drag.height;
    drag = null;
    if (value !== undefined) commit(value);
  };
  button.ondblclick = () => commit(0);
  button.onkeydown = (event) => {
    const step = { ArrowUp: -24, ArrowDown: 24 }[event.key];
    if (!step && event.key !== "Enter") return;
    event.preventDefault();
    commit(step ? diagramHeight(frame.offsetHeight + step) : 0);
  };
  return button;
}
