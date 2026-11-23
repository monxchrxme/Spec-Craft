import {
  configureMermaid,
  mermaidDirections,
  mermaidLayouts,
  mermaidPresentation,
  mermaidThemes,
} from "./mermaid-presentation.js";
import { addHeightHandle, setDiagramHeight } from "./diagram-height.js";
import { downloadSvg } from "./diagram-download.js";
import { enableDiagramPan } from "./diagram-pan.js";

const channel = "speccraft-mermaid-";
const cached = new Map();
const pending = new Map();
let frame,
  ready,
  initialize,
  serial = 0;

export const isMermaid = (token) =>
  token?.type === "fence" && token.info.trim().toLowerCase() === "mermaid";

export function mermaidMarkdown(source) {
  const longest = Array.from(
    source.matchAll(/^ {0,3}(`{3,})/gm),
    (match) => match[1].length,
  );
  const fence = "`".repeat(Math.max(3, ...longest.map((length) => length + 1)));
  return (
    fence + "mermaid\n" + source.replace(/^\uFEFF/, "").trimEnd() + "\n" + fence
  );
}

export function mermaidBlocks(md) {
  const original = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (!isMermaid(token)) return original(tokens, index, options, env, self);
    const { height } = mermaidPresentation(token.content);
    return `<figure class="diagram-card mermaid-figure" data-mermaid${height ? ` data-manual-height style="--manual-diagram-height:${height}px"` : ""}>
      <header class="diagram-title"><strong>Mermaid</strong>
        <button type="button" data-mermaid-edit hidden>Изменить код</button>
        <label class="mermaid-option" data-mermaid-layout title="Как размещаются фигуры и стрелки" hidden>Раскладка <select aria-label="Раскладка Mermaid"></select></label>
        <label class="mermaid-option" data-mermaid-direction title="«Как в коде» следует исходнику. Другой вариант меняет направление при отрисовке." hidden>Направление <select aria-label="Направление Mermaid"></select></label>
        <label class="mermaid-option" data-mermaid-theme title="Цвета и оформление диаграммы" hidden>Оформление <select aria-label="Оформление Mermaid"></select></label>
        <button type="button" data-mermaid-svg title="Скачать диаграмму Mermaid как SVG" aria-label="Скачать SVG Mermaid" hidden>SVG</button>
        <button type="button" data-mermaid-fit aria-pressed="false" hidden>Вписать</button>
        <button type="button" data-mermaid-expand aria-expanded="false" hidden>Развернуть</button>
      </header>
      <div class="diagram-window mermaid-window" aria-label="Просмотр диаграммы Mermaid" tabindex="0" hidden></div>
      <p class="mermaid-status" role="status">Построение диаграммы…</p>
      <details class="mermaid-source"><summary>Код Mermaid</summary><pre><code>${md.utils.escapeHtml(token.content)}</code></pre></details>
    </figure>`;
  };
}

function engine() {
  if (ready) return ready;
  frame = document.createElement("iframe");
  frame.className = "mermaid-engine";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.title = "Построение диаграмм Mermaid";
  frame.tabIndex = -1;
  frame.src = new URL("./mermaid-renderer.html", import.meta.url).href;
  window.addEventListener("message", receive);
  ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      frame.remove();
      frame = ready = initialize = null;
      reject(Error("Не удалось загрузить движок Mermaid."));
    }, 18_000);
    initialize = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  document.body.append(frame);
  return ready;
}

function receive(event) {
  if (!frame || event.source !== frame.contentWindow || event.origin !== "null")
    return;
  const { type, id, svg, width, height, label, error } = event.data || {};
  if (type === channel + "ready") {
    initialize?.();
    return;
  }
  if (type !== channel + "result") return;
  const done = pending.get(id);
  if (!done) return;
  pending.delete(id);
  if (
    error ||
    typeof svg !== "string" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  )
    done(Error(error || "Некорректное изображение Mermaid."));
  else {
    try {
      done(null, {
        svg,
        url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
        width,
        height,
        label: typeof label === "string" ? label : "",
      });
    } catch {
      done(Error("Некорректная кодировка изображения Mermaid."));
    }
  }
}

export function mermaidGraphic(source) {
  if (!source.trim()) return Promise.reject(Error("Введите код диаграммы."));
  if (source.length > 48_000)
    return Promise.reject(Error("Код диаграммы превышает 48 000 символов."));
  const configured = configureMermaid(source);
  const key = JSON.stringify(configured);
  if (!cached.has(key)) {
    const result = engine().then(
      () =>
        new Promise((resolve, reject) => {
          const id = ++serial;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(Error("Диаграмма не построилась за отведённое время."));
          }, 20_000);
          pending.set(id, (error, value) => {
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(value);
          });
          frame.contentWindow.postMessage(
            { type: channel + "render", id, ...configured },
            "*",
          );
        }),
    );
    cached.set(key, result);
    result.catch(() => {
      if (cached.get(key) === result) cached.delete(key);
    });
    if (cached.size > 24) cached.delete(cached.keys().next().value);
  }
  return cached.get(key);
}

export function mermaidControls(
  root,
  { edit, presentation, expanded, onExpand, resize } = {},
) {
  for (const card of root.querySelectorAll("[data-mermaid]")) {
    const expand = card.querySelector("[data-mermaid-expand]");
    const fit = card.querySelector("[data-mermaid-fit]");
    const change = card.querySelector("[data-mermaid-edit]");
    if (!expand) continue;
    if (!card.setExpanded) {
      card.setExpanded = (value) => {
        card.classList.toggle("diagram-expanded", value);
        expand.textContent = value ? "Свернуть" : "Развернуть";
        expand.setAttribute("aria-expanded", String(value));
      };
      card.setExpanded(!!expanded);
    }
    expand.onclick = () => {
      card.setExpanded(!card.classList.contains("diagram-expanded"));
      onExpand?.();
      card.scrollIntoView({ block: "nearest" });
    };
    fit.onclick = () => {
      const fitting = card.classList.toggle("mermaid-fit");
      fit.setAttribute("aria-pressed", String(fitting));
      fit.textContent = fitting ? "Исходный размер" : "Вписать";
    };
    change.hidden = !edit;
    if (edit) change.onclick = edit;
    if (!presentation) continue;
    const current = mermaidPresentation(
      card.querySelector(".mermaid-source code").textContent,
    );
    if (resize) {
      const handle = addHeightHandle(
        card,
        card.querySelector(".mermaid-window"),
        current.height,
        (height) => resize(height, card),
      );
      handle.hidden = true;
    }
    const setup = (selector, options, value) => {
      const label = card.querySelector(selector);
      const input = label.querySelector("select");
      input.append(
        ...Object.entries(options).map(([id, title]) => new Option(title, id)),
      );
      input.value = value;
      label.hidden = false;
      return input;
    };
    const theme = setup("[data-mermaid-theme]", mermaidThemes, current.theme);
    const layout =
      current.type &&
      setup("[data-mermaid-layout]", mermaidLayouts, current.layout);
    const direction =
      current.type &&
      setup("[data-mermaid-direction]", mermaidDirections, current.direction);
    const changePresentation = () => {
      presentation(
        layout?.value || "source",
        direction?.value || "source",
        theme.value,
        card,
      );
    };
    if (layout) {
      layout.onchange = direction.onchange = changePresentation;
    }
    theme.onchange = changePresentation;
  }
}

const paintings = new WeakMap();

export function keepMermaidImage(card, previous) {
  const image = previous?.querySelector(".mermaid-window img");
  if (!card || !image) return;
  const surface = card.querySelector(".mermaid-window");
  surface.append(image.cloneNode());
  surface.hidden = false;
  card.querySelector(".mermaid-status").hidden = true;
}

export function updateMermaidCard(card, source, repaint) {
  card.querySelector(".mermaid-source code").textContent = source;
  setDiagramHeight(card, mermaidPresentation(source).height);
  if (repaint) requestPaint(card);
}

function requestPaint(card, preview) {
  if (!paintings.has(card)) enableDiagramPan(card.querySelector(".mermaid-window"));
  const request = {};
  paintings.set(card, request);
  request.promise = paint(card, preview, request);
  return request.promise;
}

export function paintMermaid(root, preview = false) {
  return Promise.all(
    Array.from(root.querySelectorAll("[data-mermaid]"), (card) => {
      return paintings.get(card)?.promise || requestPaint(card, preview);
    }),
  );
}

async function paint(card, preview, request) {
  const state = card.querySelector(".mermaid-status");
  const surface = card.querySelector(".mermaid-window");
  const details = card.querySelector(".mermaid-source");
  const download = card.querySelector("[data-mermaid-svg]");
  const source = details.querySelector("code").textContent;
  const controls = [
    "[data-mermaid-fit]",
    "[data-mermaid-expand]",
    ".diagram-height-grip",
  ];
  const isCurrent = () => card.isConnected && paintings.get(card) === request;
  card.setAttribute("aria-busy", "true");
  download.disabled = true;
  try {
    const result = await mermaidGraphic(source);
    if (!isCurrent()) return;
    const image = new Image();
    image.draggable = false;
    image.alt = result.label || "Диаграмма Mermaid";
    image.width = result.width;
    image.height = result.height;
    image.src = result.url;
    await image.decode();
    if (!isCurrent()) return;
    surface.replaceChildren(image);
    surface.hidden = false;
    state.hidden = true;
    if (!preview) {
      for (const selector of controls)
        card.querySelector(selector)?.removeAttribute("hidden");
      download.onclick = () =>
        downloadSvg(result.svg, result.label || "Mermaid");
      download.disabled = false;
      download.hidden = false;
    } else details.hidden = true;
  } catch (error) {
    if (!isCurrent()) return;
    surface.hidden = !surface.firstChild;
    state.hidden = false;
    state.textContent = "Ошибка Mermaid · " + error.message;
    details.open = true;
  } finally {
    if (isCurrent()) card.removeAttribute("aria-busy");
  }
}
