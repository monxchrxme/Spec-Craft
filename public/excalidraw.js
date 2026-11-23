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

export function excalidrawBlocks(md) {
  const original = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (!isExcalidraw(token)) return original(tokens, index, options, env, self);
    return `<figure class="diagram-card drawing-card" data-excalidraw>
      <header class="diagram-title"><strong>Excalidraw</strong>
        <button type="button" data-excalidraw-edit hidden>Редактировать рисунок</button>
      </header>
      <img alt="Рисунок Excalidraw" hidden>
      <p role="status">Загрузка рисунка…</p>
      <code data-excalidraw-source hidden>${md.utils.escapeHtml(token.content)}</code>
    </figure>`;
  };
}

export async function drawingGraphic(source) {
  if (!images.has(source)) {
    const scene = readDrawing(source);
    if (!scene.elements.some((element) => !element.isDeleted)) return null;
    if (images.size >= 8) images.delete(images.keys().next().value);
    const result = import("./excalidraw-assets/adapter.js").then((module) =>
      module.drawingImage(scene),
    );
    images.set(source, result);
    result.catch(() => {
      if (images.get(source) === result) images.delete(source);
    });
  }
  return images.get(source);
}

export function paintDrawings(root) {
  for (const card of root.querySelectorAll("[data-excalidraw]:not([data-painted])")) {
    card.dataset.painted = "true";
    const status = card.querySelector("[role=status]");
    const image = card.querySelector("img");
    void drawingGraphic(card.querySelector("[data-excalidraw-source]").textContent)
      .then((graphic) => {
        if (!graphic) {
          status.textContent = "Пустой рисунок";
          return;
        }
        image.width = graphic.width;
        image.height = graphic.height;
        image.src = graphic.url;
        image.hidden = false;
        status.hidden = true;
      })
      .catch(() => { status.textContent = "Не удалось показать рисунок Excalidraw."; });
  }
}

export function editDrawing(source, apply) {
  const scene = readDrawing(source);
  const dialog = document.createElement("dialog");
  dialog.className = "drawing-editor";
  dialog.setAttribute("aria-label", "Редактор Excalidraw");
  dialog.innerHTML = `<header>
    <h2>Excalidraw</h2><span role="status">Загрузка редактора…</span>
    <button type="button" data-cancel>Отмена</button>
    <button type="button" class="primary" data-save disabled>Сохранить рисунок</button>
  </header><iframe title="Холст Excalidraw"></iframe>`;
  const frame = dialog.querySelector("iframe");
  const save = dialog.querySelector("[data-save]");
  const status = dialog.querySelector("[role=status]");
  const origin = location.origin;
  const post = (type, data) => frame.contentWindow.postMessage({ type, ...data }, origin);
  let loaded = false;
  let saving = false;
  const loadTimer = setTimeout(() => {
    status.textContent = "Не удалось загрузить редактор Excalidraw.";
  }, 15_000);
  function receive(event) {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    switch (event.data?.type) {
      case "excalidraw-ready":
        post("excalidraw-open", { scene });
        break;
      case "excalidraw-loaded":
        clearTimeout(loadTimer);
        loaded = true;
        save.disabled = false;
        status.textContent = "";
        break;
      case "excalidraw-result":
        if (!saving) break;
        try {
          if (apply(readDrawing(event.data.source))) dialog.close();
          else status.textContent = "Блок изменился. Скачайте рисунок из Excalidraw перед закрытием.";
        } catch {
          status.textContent = "Не удалось сохранить рисунок.";
        }
        saving = false;
        save.disabled = false;
        break;
      case "excalidraw-error":
        clearTimeout(loadTimer);
        status.textContent = event.data.message;
        saving = false;
        save.disabled = !loaded;
        break;
    }
  }
  save.onclick = () => {
    saving = true;
    save.disabled = true;
    status.textContent = "Сохранение…";
    post("excalidraw-save");
  };
  dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    clearTimeout(loadTimer);
    window.removeEventListener("message", receive);
    dialog.remove();
  }, { once: true });
  window.addEventListener("message", receive);
  frame.src = new URL("./excalidraw-frame.html", import.meta.url).href;
  document.body.append(dialog);
  dialog.showModal();
}
