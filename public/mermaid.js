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
    return `<figure class="diagram-card mermaid-figure" data-mermaid>
      <header class="diagram-title"><strong>Mermaid</strong>
        <button type="button" data-mermaid-edit hidden>Изменить код</button>
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
  if (!cached.has(source)) {
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
            { type: channel + "render", id, source },
            "*",
          );
        }),
    );
    cached.set(source, result);
    result.catch(() => {
      if (cached.get(source) === result) cached.delete(source);
    });
    if (cached.size > 24) cached.delete(cached.keys().next().value);
  }
  return cached.get(source);
}

export function mermaidControls(root, { edit, expanded, onExpand } = {}) {
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
  }
}

const paintings = new WeakMap();
export function paintMermaid(root, preview = false) {
  return Promise.all(
    Array.from(root.querySelectorAll("[data-mermaid]"), (card) => {
      if (!paintings.has(card)) paintings.set(card, paint(card, preview));
      return paintings.get(card);
    }),
  );
}

async function paint(card, preview) {
  const state = card.querySelector(".mermaid-status");
  const surface = card.querySelector(".mermaid-window");
  const details = card.querySelector(".mermaid-source");
  const source = details.querySelector("code").textContent;
  const controls = ["[data-mermaid-fit]", "[data-mermaid-expand]"];
  try {
    const result = await mermaidGraphic(source);
    if (!card.isConnected) return;
    const image = new Image();
    image.alt = result.label || "Диаграмма Mermaid";
    image.width = result.width;
    image.height = result.height;
    image.src = result.url;
    await image.decode();
    if (!card.isConnected) return;
    surface.replaceChildren(image);
    surface.hidden = false;
    state.hidden = true;
    if (!preview)
      controls.forEach(
        (selector) => (card.querySelector(selector).hidden = false),
      );
    else details.hidden = true;
  } catch (error) {
    if (!card.isConnected) return;
    surface.hidden = true;
    state.hidden = false;
    state.textContent = "Ошибка Mermaid · " + error.message;
    details.open = true;
  }
}
