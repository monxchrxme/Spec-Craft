import { addHeightHandle, diagramHeight, setDiagramHeight } from "./diagram-height.js";
import { enableDiagramPan } from "./diagram-pan.js";

const images = new Map();

export const isExcalidraw = (token) =>
  token?.type === "fence" && token.info.trim().toLowerCase() === "excalidraw";

export function readDrawing(source) {
  const scene = JSON.parse(source);
  if (scene?.type !== "excalidraw" || !Array.isArray(scene.elements))
    throw Error("Некорректный рисунок Excalidraw.");
  return { ...scene, appState: scene.appState || {}, files: scene.files || {} };
}

export function drawingFence(scene = { type: "excalidraw", version: 2, elements: [] }) {
  return "```excalidraw\n" + JSON.stringify(scene) + "\n```";
}

function drawingFrames(scene) {
  return scene.elements.filter((element) => element?.type === "frame" &&
    !element.isDeleted && element.width > 0 && element.height > 0);
}

export function drawingPresentation(scene) {
  const { height, crop } = scene.specCraft || {};
  return {
    height: Number.isFinite(height) ? diagramHeight(height) : 0,
    crop: drawingFrames(scene).some((frame) => frame.id === crop) ? crop : "",
  };
}

export function excalidrawBlocks(md) {
  const original = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (!isExcalidraw(token)) return original(tokens, index, options, env, self);
    return `<figure class="diagram-card drawing-card" data-excalidraw>
      <header class="diagram-title"><i data-lucide="pencil-ruler" aria-hidden="true"></i><strong>Excalidraw</strong>
        <label data-drawing-crop hidden>Обрезка <select aria-label="Обрезка рисунка"></select></label>
        <button type="button" data-excalidraw-edit hidden>Изменить</button>
        <button type="button" data-drawing-expand hidden><i data-lucide="maximize-2" aria-hidden="true"></i><span>Развернуть</span></button>
        <button type="button" data-drawing-fullscreen hidden aria-pressed="false"><i data-lucide="fullscreen" aria-hidden="true"></i><span>На всю вкладку</span></button>
      </header>
      <div class="diagram-zoom drawing-zoom" role="group" aria-label="Масштаб рисунка Excalidraw" hidden>
        <button type="button" class="zoom-out" aria-label="Уменьшить рисунок">−</button>
        <button type="button" class="zoom-reset" aria-label="Масштаб рисунка 100%" title="Масштаб 100%"></button>
        <button type="button" class="zoom-in" aria-label="Увеличить рисунок">+</button>
        <button type="button" class="zoom-fit" aria-pressed="true">Вписать целиком</button>
      </div>
      <div class="drawing-stage">
        <img alt="Рисунок Excalidraw" draggable="false" hidden>
        <p role="status">Загрузка рисунка…</p>
      </div>
      <code data-excalidraw-source hidden>${md.utils.escapeHtml(token.content)}</code>
    </figure>`;
  };
}

export async function drawingGraphic(source) {
  if (!images.has(source)) {
    const scene = readDrawing(source);
    if (!scene.elements.some((element) => element && !element.isDeleted)) return null;
    if (images.size >= 8) images.delete(images.keys().next().value);
    const result = import("./excalidraw-assets/adapter.js").then((module) =>
      module.drawingImage(scene, drawingPresentation(scene).crop),
    );
    images.set(source, result);
    result.catch(() => {
      if (images.get(source) === result) images.delete(source);
    });
  }
  return images.get(source);
}

export async function drawingPrintImage(graphic, width, height) {
  const scale = Math.min(5, 8192 / Math.max(width, height),
    Math.sqrt(18_000_000 / (width * height)));
  const image = new Image();
  image.src = graphic.url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function enableDrawingZoom(card, image, originalWidth) {
  const surface = image.parentElement;
  const controls = card.querySelector(".drawing-zoom");
  const minus = controls.querySelector(".zoom-out");
  const plus = controls.querySelector(".zoom-in");
  const reset = controls.querySelector(".zoom-reset");
  const fit = controls.querySelector(".zoom-fit");
  const currentScale = () => image.getBoundingClientRect().width / originalWidth;

  function scale(value) {
    const before = image.getBoundingClientRect();
    const viewport = surface.getBoundingClientRect();
    const x = (viewport.left + surface.clientWidth / 2 - before.left) / before.width;
    const y = (viewport.top + surface.clientHeight / 2 - before.top) / before.height;
    const fitting = value === null;
    const zoom = fitting ? 1 : Math.min(4, Math.max(0.1, value));
    card.classList.toggle("drawing-fit", fitting);
    image.style.width = fitting ? "" : originalWidth * zoom + "px";
    reset.textContent = fitting ? "1:1" : Math.round(zoom * 100) + "%";
    fit.setAttribute("aria-pressed", String(fitting));
    minus.disabled = !fitting && zoom <= 0.1;
    plus.disabled = !fitting && zoom >= 4;
    const after = image.getBoundingClientRect();
    surface.scrollLeft = fitting || !before.width ? 0 : x * after.width - surface.clientWidth / 2;
    surface.scrollTop = fitting || !before.height ? 0 : y * after.height - surface.clientHeight / 2;
  }
  minus.onclick = () => scale(currentScale() / 1.25);
  plus.onclick = () => scale(currentScale() * 1.25);
  reset.onclick = () => scale(1);
  fit.onclick = () => scale(null);
  surface.tabIndex = 0;
  surface.setAttribute("aria-label", "Просмотр рисунка Excalidraw");
  enableDiagramPan(surface);
  controls.hidden = false;
  scale(null);
}

export function paintDrawings(root) {
  for (const card of root.querySelectorAll("[data-excalidraw]:not([data-painted])")) {
    card.dataset.painted = "true";
    const status = card.querySelector("[role=status]");
    const image = card.querySelector("img");
    void drawingGraphic(card.querySelector("[data-excalidraw-source]").textContent)
      .then((graphic) => {
        if (!image.isConnected) return;
        if (!graphic) {
          status.textContent = "Пустой рисунок";
          return;
        }
        image.width = graphic.width;
        image.height = graphic.height;
        card.querySelector(".drawing-stage").style.backgroundColor = graphic.background;
        image.src = graphic.url;
        image.hidden = false;
        status.hidden = true;
        enableDrawingZoom(card, image, graphic.width);
      })
      .catch(() => { status.textContent = "Не удалось показать рисунок Excalidraw."; });
  }
}

export function drawingControls(card, { expanded, onExpand, edit, change }) {
  const scene = readDrawing(card.querySelector("[data-excalidraw-source]").textContent);
  const layout = drawingPresentation(scene);
  const expand = card.querySelector("[data-drawing-expand]");
  expand.hidden = false;
  card.setExpanded = (value) => {
    card.classList.toggle("diagram-expanded", value);
    expand.setAttribute("aria-expanded", String(value));
    expand.lastElementChild.textContent = value ? "Свернуть" : "Развернуть";
  };
  expand.onclick = () => {
    card.setExpanded(!card.classList.contains("diagram-expanded"));
    onExpand?.();
    card.scrollIntoView({ block: "nearest" });
  };
  card.setExpanded(expanded);
  setDiagramHeight(card, layout.height);
  if (!edit) return;
  const editButton = card.querySelector("[data-excalidraw-edit]");
  editButton.hidden = false;
  editButton.onclick = () => edit();
  const fullscreen = card.querySelector("[data-drawing-fullscreen]");
  fullscreen.hidden = false;
  fullscreen.onclick = () => edit({ fullscreen: true });

  const crop = card.querySelector("[data-drawing-crop]");
  const select = crop.querySelector("select");
  select.add(new Option("Авто", ""));
  drawingFrames(scene).forEach((frame, index) => {
    const name = typeof frame.name === "string" && frame.name.trim();
    select.add(new Option(name || "Рамка " + (index + 1), frame.id));
  });
  const chooseArea = new Option("Выбрать область…", ":choose-area");
  select.add(chooseArea);
  select.value = layout.crop;
  select.onchange = () => {
    if (select.selectedOptions[0] === chooseArea) {
      select.value = layout.crop;
      edit({ crop: true });
      return;
    }
    if (!change({ crop: select.value })) select.value = layout.crop;
  };
  crop.hidden = false;
  addHeightHandle(card, card.querySelector(".drawing-stage"), layout.height,
    (height) => change({ height }));
}

export function editDrawing(card, scene, { save, cancel, crop = false, fullscreen = false }) {
  const stage = card.querySelector(".drawing-stage");
  stage.removeAttribute("tabindex");
  stage.removeAttribute("aria-label");
  const edit = card.querySelector("[data-excalidraw-edit]");
  const actions = document.createElement("div");
  actions.className = "drawing-edit-actions";
  actions.innerHTML = `<button type="button" data-frame-tool disabled>Рамка обрезки</button>
    <button type="button" data-cancel>Отмена</button>
    <button type="button" class="primary" data-save disabled>Сохранить рисунок</button>`;
  edit.after(actions);
  const hint = document.createElement("span");
  hint.className = "drawing-crop-hint";
  hint.setAttribute("role", "status");
  hint.hidden = true;
  card.querySelector("header").append(hint);
  edit.hidden = true;
  card.classList.add("drawing-editing");
  const frame = document.createElement("iframe");
  frame.title = "Холст Excalidraw";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Загрузка редактора…";
  const saveButton = actions.querySelector("[data-save]");
  const cropButton = actions.querySelector("[data-frame-tool]");
  const timer = setTimeout(() => { status.textContent = "Не удалось загрузить Excalidraw."; }, 15_000);
  let api, initial;
  let selectNewFrame = false;
  let stopped = false;
  const fullscreenButton = card.querySelector("[data-drawing-fullscreen]");

  function setFullscreen(active) {
    const block = card.parentElement;
    if (active) block.style.setProperty("--drawing-fullscreen-height", card.offsetHeight + "px");
    else block?.style.removeProperty("--drawing-fullscreen-height");
    card.classList.toggle("drawing-fullscreen", active);
    fullscreenButton.setAttribute("aria-pressed", String(active));
    fullscreenButton.lastElementChild.textContent = active ? "Вернуться к документу" : "На всю вкладку";
  }
  function exitFullscreen() {
    if (!card.classList.contains("drawing-fullscreen")) return false;
    setFullscreen(false);
    return true;
  }
  fullscreenButton.onclick = () => {
    if (!exitFullscreen()) setFullscreen(true);
  };

  function startCrop() {
    selectNewFrame = true;
    api.frameTool();
    cropButton.setAttribute("aria-pressed", "true");
    saveButton.textContent = "Применить обрезку";
    hint.textContent = "Протяните рамку вокруг нужной области.";
    hint.hidden = false;
  }
  frame.onload = () => {
    try {
      frame.contentDocument.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && exitFullscreen()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          fullscreenButton.focus({ preventScroll: true });
        }
      }, { capture: true });
      frame.contentWindow.openSpecCraftDrawing(scene, (drawingApi) => {
        if (stopped) return;
        clearTimeout(timer);
        api = drawingApi;
        initial = api.snapshot();
        status.hidden = true;
        cropButton.disabled = saveButton.disabled = false;
        if (crop) startCrop();
      });
    } catch {
      clearTimeout(timer);
      status.textContent = "Не удалось загрузить Excalidraw.";
    }
  };
  cropButton.onclick = () => {
    startCrop();
    frame.contentWindow.focus();
  };
  saveButton.onclick = save;
  actions.querySelector("[data-cancel]").onclick = cancel;
  frame.src = new URL("./excalidraw-frame.html", import.meta.url).href;
  stage.replaceChildren(frame, status);
  if (fullscreen) setFullscreen(true);
  return {
    exitFullscreen,
    snapshot(layout, requireCrop = false) {
      const raw = api?.snapshot();
      const next = raw && raw !== initial ? readDrawing(raw) : { ...scene };
      const nextLayout = { ...layout };
      if (selectNewFrame) {
        const previous = new Set(drawingFrames(scene).map((frame) => frame.id));
        const added = drawingFrames(next).findLast((frame) => !previous.has(frame.id));
        if (!added && requireCrop) {
          hint.textContent = "Сначала выделите область на холсте.";
          api.frameTool();
          return null;
        }
        if (added) nextLayout.crop = added.id;
      }
      next.specCraft = drawingPresentation({ ...next, specCraft: nextLayout });
      return next;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      exitFullscreen();
      frame.remove();
    },
  };
}
