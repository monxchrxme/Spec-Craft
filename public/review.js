import { specIndex } from "./spec-index.js";
import { diagramView } from "./diagram-view.js";
import { normalize } from "./graph.js";

const element = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
function button(label, click, className) {
  const el = element("button", label, className);
  el.type = "button";
  el.onclick = click;
  return el;
}
export function makeShare() {
  const token = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  return { id: token(), owner: token() };
}
export function reviewUrl(id) {
  const url = new URL(location.pathname, location.origin);
  url.hash = "review=" + id;
  return url.href;
}
export function reviewTargets(parts) {
  const { requirements, components } = specIndex(parts);
  return [
    { key: "document", label: "Весь документ", index: -1 },
    ...requirements.map((r) => ({ ...r, key: "requirement:" + r.key })),
    ...components.map((c) => ({
      ...c,
      key: "figure:" + c.index + ":" + c.node,
      label: c.diagram + " · " + c.label,
    })),
  ].filter((t) => t.key.length <= 500);
}
export async function reviewRequest(share, input) {
  const headers = {};
  if (share.owner) headers["X-Review-Owner"] = share.owner;
  if (input) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch("/api/review?id=" + encodeURIComponent(share.id), {
      method: input ? "POST" : "GET",
      headers,
      body: input ? JSON.stringify(input) : undefined,
      cache: "no-store",
    });
  } catch {
    throw Error("Не удалось подключиться к согласованию. Проверьте сеть.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.snapshot)
    throw Error(data?.error || "Согласование временно недоступно.");
  return data;
}

export function showReview({ share, parse, renderMarkdown, onClose }) {
  const workspace = document.getElementById("workspace");
  const focusBefore = document.activeElement;
  const root = element("section");
  root.id = "review-workspace";
  const main = element("main"),
    header = element("header", undefined, "topbar");
  const title = element("h1", "Согласование");
  header.append(button("← Студия", close), title);
  const viewport = element("div", undefined, "review-scroll");
  const paper = element("article", undefined, "paper");
  viewport.append(paper);
  main.append(header, viewport);
  const panel = element("aside", undefined, "review-dock");
  panel.setAttribute("aria-label", "Замечания");
  const panelTitle = element("h2", "Замечания");
  const picker = element("select");
  picker.setAttribute("aria-label", "Место замечания");
  const status = element("p", "Загрузка версии…", "review-status");
  status.setAttribute("role", "status");
  const list = element("div", undefined, "review-comments");
  const form = element("form", undefined, "review-form");
  const name = element("input"),
    note = element("textarea");
  name.required = note.required = true;
  name.maxLength = 80;
  note.maxLength = 2000;
  name.placeholder = "Имя";
  note.placeholder = "Что нужно уточнить или исправить?";
  name.setAttribute("aria-label", "Ваше имя");
  note.setAttribute("aria-label", "Текст замечания");
  const send = element("button", "Оставить замечание", "primary");
  form.append(name, note, send);
  form.hidden = picker.hidden = true;

  const refreshButton = button(
    "Обновить",
    () => refresh(true),
    "review-muted-button",
  );
  panel.append(panelTitle, refreshButton, status, picker, list, form);
  root.append(main, panel);
  workspace.hidden = true;
  document.body.append(root);

  let data,
    targets = [],
    active = share.owner ? "all" : "document",
    timer,
    busy = false,
    revision = 0,
    pending;
  const markers = new Map(),
    drafts = new Map();
  const closeLink = share.owner
    ? button(
        "Закрыть доступ по ссылке",
        () => {
          if (
            confirm(
              "Закрыть доступ коллегам? Замечания останутся доступны в студии.",
            )
          )
            mutate({ action: "close" });
        },
        "review-muted-button",
      )
    : null;
  if (closeLink) {
    closeLink.hidden = true;
    panel.append(closeLink);
  }
  const stop = () => {
    clearInterval(timer);
    root.remove();
    workspace.hidden = false;
    focusBefore?.focus({ preventScroll: true });
  };
  function close() {
    stop();
    onClose?.();
  }
  function select(key, scroll = false) {
    if (key !== active) {
      drafts.set(active, note.value);
      note.value = drafts.get(key) || "";
    }
    active = key;
    picker.value = key;
    list.replaceChildren();
    for (const [id, marker] of markers) {
      marker.classList.toggle("review-anchor-active", id === active);
      marker.setAttribute("aria-pressed", String(id === active));
    }
    const marker = markers.get(active);
    if (scroll) marker?.scrollIntoView({ block: "center", inline: "center" });
    form.hidden = data.closed || active === "all";
    const items =
      active === "all"
        ? data.comments
        : data.comments.filter((c) => c.target === active);
    if (!items.length)
      list.append(element("p", "Здесь пока нет замечаний.", "review-status"));
    for (const c of items) {
      const card = element("article", undefined, "review-comment");
      card.append(
        element("strong", c.author),
        element("small", new Date(c.date).toLocaleString("ru")),
        element("p", c.text),
      );
      if (active === "all") {
        const target = targets.find((t) => t.key === c.target);
        if (target)
          card.prepend(
            button(
              target.label,
              () => select(target.key, true),
              "review-comment-target",
            ),
          );
      }
      if (c.resolved) card.append(element("small", "Учтено"));
      if (share.owner)
        card.append(
          button(c.resolved ? "Открыть снова" : "Отметить учтённым", () =>
            mutate({ action: "resolve", comment: c.id, resolved: !c.resolved }),
          ),
        );
      list.append(card);
    }
  }
  picker.onchange = () => select(picker.value, true);
  function renderSnapshot(snapshot) {
    title.textContent = snapshot.title + " · " + snapshot.name;
    const parts = parse(snapshot.body);
    const style = snapshot.style || {};
    paper.style.setProperty("--doc-size", (Number(style.size) || 16) + "px");
    paper.style.setProperty("--doc-leading", Number(style.leading) || 1.65);
    paper.style.setProperty(
      "--paragraph-gap",
      (Number(style.gap) || 12) + "px",
    );
    paper.style.setProperty(
      "--reading-width",
      style.lineLength ? Number(style.lineLength) + "ch" : "none",
    );
    paper.style.setProperty(
      "--prose-align",
      style.align === "justify" ? "justify" : "left",
    );
    if (style.font === "serif")
      paper.style.setProperty("--doc-font", "Georgia, serif");
    if (style.font === "mono")
      paper.style.setProperty("--doc-font", "monospace");
    if (/^#[a-f0-9]{6}$/i.test(style.accent))
      paper.style.setProperty("--doc-accent", style.accent);
    targets = reviewTargets(parts).filter((t) => data.anchors.includes(t.key));
    for (const block of parts) {
      const el = element("div", undefined, "block");
      if (
        block.t.type === "fence" &&
        block.t.info.trim() === "studio-diagram"
      ) {
        try {
          el.append(diagramView(normalize(JSON.parse(block.t.content))));
        } catch {
          el.textContent = "Не удалось показать схему.";
        }
      } else {
        const template = element("template");
        template.innerHTML = renderMarkdown(block);
        template.content.querySelectorAll("img").forEach((image) => {
          image.referrerPolicy = "no-referrer";
          image.loading = "lazy";
        });
        el.append(template.content);
        const table = el.querySelector("table");
        if (table) {
          const wrap = element("div", undefined, "table-scroll");
          table.replaceWith(wrap);
          wrap.append(table);
        }
      }
      paper.append(el);
    }
    const structure = specIndex(parts);
    paper.onclick = (event) => {
      const link = event.target.closest("[data-wiki]");
      if (!link) return;
      event.preventDefault();
      const [target, ...duplicates] = structure.resolve(link.dataset.wiki);
      if (target && !duplicates.length) {
        const block = paper.children[target.index];
        (
          block?.querySelector("table")?.rows[target.row] || block
        )?.scrollIntoView({ block: "center" });
      }
    };
    for (const t of targets) {
      const block = paper.children[t.index];
      if (!block) continue;
      if (t.node) {
        const node = block.querySelector(
          '[data-node="' + CSS.escape(t.node) + '"]',
        );
        if (!node) continue;
        node.classList.add("review-figure");
        node.setAttribute("role", "button");
        node.setAttribute("tabindex", "0");
        node.setAttribute("aria-label", "Замечания · " + t.label);
        node.dataset.reviewTarget = t.key;
        node.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select(t.key);
          }
        };
        markers.set(t.key, node);
      } else {
        const marker = button(
          "Замечания",
          () => select(t.key),
          "review-anchor",
        );
        marker.setAttribute("aria-label", "Замечания · " + t.label);
        const cell = block.querySelector("table")?.rows[t.row]?.cells;
        const anchor = cell?.[cell.length - 1] || block;
        anchor.append(marker);
        markers.set(t.key, marker);
      }
    }
    for (const frame of paper.querySelectorAll(".diagram-window")) {
      let press;
      frame.addEventListener("pointerdown", (event) => {
        const target = event.target.closest("[data-review-target]");
        press =
          target && event.isPrimary && event.button === 0
            ? {
                id: event.pointerId,
                key: target.dataset.reviewTarget,
                x: event.clientX,
                y: event.clientY,
              }
            : null;
      });
      frame.addEventListener("pointermove", (event) => {
        if (
          press?.id === event.pointerId &&
          Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 5
        )
          press = null;
      });
      frame.addEventListener("pointercancel", () => {
        press = null;
      });
      frame.addEventListener("pointerup", (event) => {
        if (press?.id === event.pointerId) select(press.key);
        press = null;
      });
    }
  }
  function apply(next) {
    const first = !data;
    data = next;
    if (first) renderSnapshot(data.snapshot);
    const counts = new Map();
    for (const c of data.comments)
      if (!c.resolved) counts.set(c.target, (counts.get(c.target) || 0) + 1);
    picker.replaceChildren(
      ...targets.map(
        (t) =>
          new Option(
            t.label + (counts.has(t.key) ? " · " + counts.get(t.key) : ""),
            t.key,
          ),
      ),
    );
    for (const [key, marker] of markers) {
      marker.classList.toggle("has-review-comment", counts.has(key));
      if (marker instanceof HTMLButtonElement)
        marker.textContent =
          "Замечания" + (counts.has(key) ? " · " + counts.get(key) : "");
    }
    if (share.owner) picker.prepend(new Option("Все замечания", "all"));
    picker.hidden = false;
    if (closeLink) closeLink.hidden = data.closed;
    status.textContent = data.closed
      ? "Доступ по ссылке закрыт."
      : "Открытых замечаний: " +
        data.comments.filter((c) => !c.resolved).length;
    select(active);
  }
  async function refresh(manual = false) {
    if (busy || (!manual && document.hidden)) return;
    const rev = ++revision;
    try {
      const next = await reviewRequest(share);
      if (rev === revision && root.isConnected) apply(next);
    } catch (error) {
      if (rev !== revision || !root.isConnected) return;
      status.textContent = error.message;
      if (!data && error.message.includes("закрыт")) clearInterval(timer);
      if (!share.owner && error.message.includes("закрыт")) {
        paper.replaceChildren();
        list.replaceChildren();
        picker.hidden = form.hidden = true;
      }
    }
  }
  async function mutate(input) {
    if (busy) return false;
    busy = true;
    revision++;
    send.disabled = refreshButton.disabled = true;
    try {
      const next = await reviewRequest(share, input);
      if (root.isConnected) apply(next);
      return true;
    } catch (error) {
      status.textContent = error.message;
      return false;
    } finally {
      busy = false;
      send.disabled = refreshButton.disabled = false;
    }
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    const input = {
      action: "comment",
      target: active,
      author: name.value.trim(),
      text: note.value.trim(),
    };
    if (!input.text || !input.author) return;
    const signature = JSON.stringify(input);
    if (signature !== pending?.signature)
      pending = { signature, id: crypto.randomUUID() };
    const sent = await mutate({ ...input, requestId: pending.id });
    if (sent) {
      if (active === input.target && note.value.trim() === input.text)
        note.value = "";
      if (drafts.get(input.target)?.trim() === input.text)
        drafts.delete(input.target);
      pending = null;
    }
  };
  refresh(true);
  timer = setInterval(() => refresh(), 30_000);
  return stop;
}
