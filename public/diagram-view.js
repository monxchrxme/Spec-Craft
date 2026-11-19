// Reading controls change only the viewport. The diagram stored in Markdown
// keeps its original coordinates and scale.
import { draw, frameLayout, styleFrame } from "./graph.js";

export function diagramView(graph, { edit } = {}) {
  const card = document.createElement("section");
  card.className = "diagram-card";
  const title = graph.title || "Блок-схема";
  card.setAttribute("aria-label", title);
  card.innerHTML = `
    <header class="diagram-title"><i data-lucide="workflow" aria-hidden="true"></i><strong></strong><span class="spacer"></span></header>
    <div class="diagram-window graph-bg" tabindex="0"></div>
    <div class="diagram-zoom" role="group" aria-label="Масштаб схемы">
      <button class="zoom-out" aria-label="Уменьшить схему">−</button>
      <button class="zoom-reset" title="Показать в масштабе 100%"></button>
      <button class="zoom-in" aria-label="Увеличить схему">+</button>
      <button class="zoom-fit" aria-pressed="false">Вписать целиком</button>
    </div>`;
  const header = card.querySelector("header");
  header.querySelector("strong").textContent = title;
  function addAction(name, symbol, fn) {
    if (!fn) return;
    const button = document.createElement("button");
    button.innerHTML =
      '<i aria-hidden="true" data-lucide="' + symbol + '"></i>';
    button.append(name);
    button.onclick = fn;
    header.append(button);
  }
  addAction("Изменить", "sliders-horizontal", edit);
  let expanded = false;
  const expand = () => {
    expanded = !expanded;
    card.classList.toggle("diagram-expanded", expanded);
    expandButton.lastChild.textContent = expanded ? "Свернуть" : "Развернуть";
    expandButton.setAttribute("aria-expanded", String(expanded));
    card.scrollIntoView({ block: "nearest" });
  };
  addAction("Развернуть", "maximize-2", expand);
  const expandButton = header.lastElementChild;
  expandButton.setAttribute("aria-expanded", "false");
  card.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expanded) {
      expand();
      expandButton.focus();
    }
  });
  styleFrame(card, graph);
  const frame = card.querySelector(".diagram-window");
  frame.setAttribute("aria-label", "Просмотр схемы «" + title + "»");
  const svg = draw(graph);
  const { width, height } = svg.viewBox.baseVal;
  frame.append(svg);
  frame.ondblclick = edit || expand || null;
  card.style.setProperty("--diagram-ratio", width / height);
  const reset = card.querySelector(".zoom-reset"),
    fit = card.querySelector(".zoom-fit");
  const minus = card.querySelector(".zoom-out"),
    plus = card.querySelector(".zoom-in");
  function scale(value) {
    const previous = svg.getBoundingClientRect();
    const viewport = frame.getBoundingClientRect();
    const centerX =
      (viewport.left + frame.clientWidth / 2 - previous.left) /
      (previous.width || width);
    const centerY =
      (viewport.top + frame.clientHeight / 2 - previous.top) /
      (previous.height || height);
    const fitting = value === "fit";
    const widthFit = value === "width";
    const factor = fitting || widthFit ? 1 : Math.max(0.1, Math.min(4, value));
    svg.style.width = factor * width + "px";
    card.classList.toggle("fit-diagram", fitting);
    card.classList.toggle("width-diagram", widthFit);
    reset.textContent =
      fitting || widthFit ? "1:1" : Math.round(factor * 100) + "%";
    reset.setAttribute("aria-label", "Масштаб 100%");
    minus.disabled = !fitting && factor <= 0.1;
    plus.disabled = !fitting && factor >= 4;
    fit.setAttribute("aria-pressed", String(fitting));
    if (previous.width) {
      const next = svg.getBoundingClientRect();
      frame.scrollLeft = fitting
        ? 0
        : centerX * next.width - frame.clientWidth / 2;
      frame.scrollTop = fitting
        ? 0
        : centerY * next.height - frame.clientHeight / 2;
    }
  }
  const currentScale = () => svg.getBoundingClientRect().width / width;
  minus.onclick = () => scale(currentScale() / 1.25);
  plus.onclick = () => scale(currentScale() * 1.25);
  reset.onclick = () => scale(1);
  fit.onclick = () => scale("fit");
  let pan = null;
  frame.onpointerdown = (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    pan = {
      x: e.clientX,
      y: e.clientY,
      left: frame.scrollLeft,
      top: frame.scrollTop,
    };
    frame.setPointerCapture(e.pointerId);
  };
  frame.onpointermove = (e) => {
    if (!pan) return;
    frame.scrollLeft = pan.left + pan.x - e.clientX;
    frame.scrollTop = pan.top + pan.y - e.clientY;
  };
  frame.onlostpointercapture = () => {
    pan = null;
  };
  const fitMode = frameLayout(graph).fit;
  scale(fitMode === "contain" ? "fit" : fitMode === "width" ? "width" : 1);
  return card;
}
