import { paintMath } from "./math.js";
import { mermaidControls, paintMermaid } from "./mermaid.js";
import { specIndex } from "./spec-index.js";
import { diagramView } from "./diagram-view.js";
import { normalize } from "./graph.js";
import { workflowPanel } from "./workflow-panel.js";
import { participantName } from "./presence.js";

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
function authorLabel(item) {
  const label = element("strong", item.author);
  if (item.owner) label.append(element("span", "Владелец", "review-owner"));
  return label;
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
export function reviewTargets(parts, live = false) {
  const { requirements, components } = specIndex(parts);
  const targets = [
    { key: "document", label: "Весь документ", index: -1 },
    ...requirements.map((r) => ({
      ...r,
      key: "requirement:" + (live ? r.id : r.key),
    })),
    ...components.map((c) => ({
      ...c,
      key: live
        ? "figure:" + JSON.stringify([c.diagramId || "", c.node])
        : "figure:" + c.index + ":" + c.node,
      label: c.diagram + " · " + c.label,
    })),
  ].filter((t) => t.key.length <= 500);
  if (!live) return targets;
  const counts = new Map();
  for (const target of targets)
    counts.set(target.key, (counts.get(target.key) || 0) + 1);
  return targets.filter((target) => counts.get(target.key) === 1);
}
export async function reviewRequest(share, input) {
  const headers = {};
  if (share.owner) headers["X-Review-Owner"] = share.owner;
  if (input) headers["Content-Type"] = "application/json";
  const url = "/api/review?id=" + encodeURIComponent(share.id);
  const options = {
    method: input ? "POST" : "GET",
    headers,
    body: input ? JSON.stringify(input) : undefined,
    cache: "no-store",
  };
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(url, options);
    } catch {
      throw Error("Не удалось подключиться к согласованию. Проверьте сеть.");
    }
    if (![502, 503, 504].includes(response.status) || attempt === 2) break;
    // Publication and feedback mutations reuse the same identifiers on retry.
    await new Promise((resolve) =>
      setTimeout(resolve, 300 * (attempt + 1) + Math.random() * 200),
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.snapshot)
    throw Error(data?.error || "Согласование временно недоступно.");
  return data;
}

export function showReview({
  share,
  parse,
  renderMarkdown,
  onClose,
  onEdit,
  request = reviewRequest,
  labels,
}) {
  const live = !!labels;
  const workspace = document.getElementById("workspace");
  const focusBefore = document.activeElement;
  const root = element("section");
  root.id = "review-workspace";
  const main = element("main"),
    header = element("header", undefined, "topbar");
  const title = element("h1", live ? "Общий документ" : "Согласование");
  const editButton = button("Редактировать документ", () => onEdit(data));
  const role = element("span", undefined, "review-role");
  editButton.hidden = role.hidden = true;
  header.append(button("← Студия", close), title, role, editButton);
  const viewport = element("div", undefined, "review-scroll");
  const paper = element("article", undefined, "paper");
  viewport.append(paper);
  main.append(header, viewport);
  const panel = element("aside", undefined, "review-dock");
  panel.setAttribute("aria-label", "Замечания");
  const commentsPane = live ? element("div") : panel;
  const panelTitle = element("h2", "Замечания");
  const picker = element("select");
  picker.setAttribute("aria-label", "Место замечания");
  const status = element(
    "p",
    live ? "Загрузка документа…" : "Загрузка версии…",
    "review-status",
  );
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
  const replyForm = element("form", undefined, "review-form review-reply-form");
  const replyContext = element("strong");
  const replyName = element("input");
  replyName.maxLength = 80;
  replyName.placeholder = "Имя";
  replyName.setAttribute("aria-label", "Имя для ответа");
  const replyNote = element("textarea");
  replyNote.maxLength = 2000;
  replyNote.required = true;
  replyNote.setAttribute("aria-label", "Текст ответа");
  const replySend = element("button", "Отправить ответ", "primary");
  replyForm.append(
    replyContext,
    replyName,
    replyNote,
    replySend,
    button("Отмена", () => {
      replying = null;
      replyForm.hidden = true;
    }),
  );
  replyForm.hidden = true;

  const refreshButton = button(
    "Обновить",
    () => refresh(true),
    "review-muted-button",
  );
  commentsPane.append(panelTitle, refreshButton, picker, list, form, replyForm);
  if (live) panel.append(commentsPane, status);
  else commentsPane.insertBefore(status, picker);
  root.append(main, panel);
  workspace.hidden = true;
  document.body.append(root);

  let data,
    targets = [],
    active = share.owner ? "all" : "document",
    timer,
    busy = false,
    revision = 0,
    replying = null;
  const markers = new Map(),
    drafts = new Map(),
    pending = new Map(),
    inlineTargets = new Map();
  const allTargets = () => [...targets, ...inlineTargets.values()];
  let workflow;
  if (live) {
    name.value = participantName();
    workflow = workflowPanel({
      share,
      panel,
      comments: commentsPane,
      paper,
      viewport,
      parse,
      request,
      mutate,
      state: () => data,
      status: (message) => {
        status.textContent = message;
      },
      commentAt(target) {
        const key = "anchor:" + crypto.randomUUID();
        inlineTargets.set(key, { ...target, key });
        updatePicker();
        select(key);
        note.focus({ preventScroll: true });
      },
    });
  }
  const closeLink =
    share.owner && !live
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
    workflow?.stop();
    root.remove();
    workspace.hidden = false;
    focusBefore?.focus({ preventScroll: true });
  };
  function close() {
    stop();
    onClose?.();
  }
  const isAuthor = () => (live ? data?.role === "owner" : !!share.owner);
  const canComment = () =>
    !live || ["owner", "editor", "commenter"].includes(data?.role);
  function composeReply(comment) {
    if (replying?.id !== comment.id) replyNote.value = "";
    replying = comment;
    replyContext.textContent = "Ответ на замечание · " + comment.author;
    replyName.hidden = isAuthor();
    replyName.required = !isAuthor();
    if (!replyName.value) replyName.value = name.value;
    replyForm.hidden = false;
    replyNote.focus();
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
    const anchor = inlineTargets.get(active)?.anchor;
    if (anchor) {
      if (!workflow?.locate(anchor, scroll))
        status.textContent =
          "Исходный фрагмент изменён или удалён. Ветка сохранена.";
    } else workflow?.clear();
    form.hidden = !canComment() || data.closed || active === "all";
    const items =
      active === "all"
        ? data.comments
        : data.comments.filter((c) => c.target === active);
    if (!items.length)
      list.append(element("p", "Здесь пока нет замечаний.", "review-status"));
    for (const c of items) {
      const card = element("article", undefined, "review-comment");
      card.append(
        authorLabel(c),
        element("small", new Date(c.date).toLocaleString("ru")),
        element("p", c.text),
      );
      if (active === "all") {
        const target = allTargets().find((t) => t.key === c.target);
        if (target)
          card.prepend(
            button(
              target.label,
              () => select(target.key, true),
              "review-comment-target",
            ),
          );
        else if (c.targetLabel)
          card.prepend(
            element("small", c.targetLabel + " · место в документе удалено"),
          );
      }
      if (c.resolved) card.append(element("small", "Учтено"));
      if (isAuthor())
        card.append(
          button(c.resolved ? "Открыть снова" : "Отметить учтённым", () =>
            mutate({ action: "resolve", comment: c.id, resolved: !c.resolved }),
          ),
        );
      if ((live && canComment()) || isAuthor())
        card.append(
          button("Ответить", () => composeReply(c), "review-reply-button"),
        );
      for (const reply of c.replies || []) {
        const thread = element("div", undefined, "review-reply");
        thread.append(
          authorLabel(reply),
          element("small", new Date(reply.date).toLocaleString("ru")),
          element("p", reply.text),
        );
        card.append(thread);
      }
      list.append(card);
    }
  }
  picker.onchange = () => select(picker.value, true);
  function renderSnapshot(snapshot) {
    title.textContent = live
      ? snapshot.name
      : snapshot.title + " · " + snapshot.name;
    paper.replaceChildren();
    markers.clear();
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
    paper.style.removeProperty("--doc-font");
    paper.style.removeProperty("--doc-accent");
    if (style.font === "serif")
      paper.style.setProperty("--doc-font", "Georgia, serif");
    if (style.font === "mono")
      paper.style.setProperty("--doc-font", "monospace");
    if (/^#[a-f0-9]{6}$/i.test(style.accent))
      paper.style.setProperty("--doc-accent", style.accent);
    targets = canComment()
      ? reviewTargets(parts, live).filter(
          (t) => live || data.anchors.includes(t.key),
        )
      : [];
    for (const [i, block] of parts.entries()) {
      const el = element("div", undefined, "block");
      if (live) el.dataset.workIndex = i;
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
    void paintMath(paper);
    mermaidControls(paper);
    void paintMermaid(paper);
    const structure = specIndex(parts);
    paper.onclick = (event) => {
      const cell = event.target.closest("td,th");
      if (
        cell &&
        !event.target.closest("button") &&
        workflow?.chooseCell(cell)
      ) {
        event.preventDefault();
        return;
      }
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
        const edge = live && event.target.closest("[data-edge]");
        press =
          (target || edge) && event.isPrimary && event.button === 0
            ? {
                id: event.pointerId,
                key: target?.dataset.reviewTarget,
                edge,
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
        if (press?.id === event.pointerId) {
          if (press.key) select(press.key);
          else if (press.edge) workflow?.chooseCell(press.edge);
        }
        press = null;
      });
    }
  }
  function apply(next) {
    const previous = data;
    if (live && !next.snapshot) next.snapshot = previous?.snapshot;
    next.comments ??= [];
    data = next;
    for (const comment of data.comments) {
      if (comment.anchor)
        inlineTargets.set(comment.target, {
          anchor: comment.anchor,
          key: comment.target,
          label: comment.targetLabel,
        });
    }
    status.textContent = data.closed
      ? "Доступ по ссылке закрыт."
      : "Открытых замечаний: " +
        data.comments.filter((c) => !c.resolved).length;
    if (
      previous &&
      previous.revision === next.revision &&
      previous.role === next.role &&
      previous.closed === next.closed &&
      JSON.stringify(previous.comments) === JSON.stringify(next.comments)
    ) {
      workflow?.update(data);
      return;
    }
    if (!previous || (live && previous.revision !== next.revision))
      renderSnapshot(data.snapshot);
    if (live) {
      role.hidden = false;
      role.textContent = labels[data.role];
      editButton.hidden = !["owner", "editor"].includes(data.role);
      panel.hidden = !canComment();
      name.hidden = isAuthor();
      name.required = !isAuthor();
    }
    if (active !== "all" && !allTargets().some((t) => t.key === active))
      active = "document";
    updatePicker();
    if (closeLink) closeLink.hidden = data.closed;
    select(active);
    workflow?.update(data);
  }
  function updatePicker() {
    const counts = new Map();
    for (const c of data.comments)
      if (!c.resolved) counts.set(c.target, (counts.get(c.target) || 0) + 1);
    picker.replaceChildren(
      ...allTargets().map(
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
    if (isAuthor() || (live && canComment()))
      picker.prepend(new Option("Все замечания", "all"));
    picker.hidden = false;
  }
  async function refresh(manual = false) {
    if (busy || (!manual && document.hidden)) return;
    const rev = ++revision;
    try {
      const next = await request(
        share,
        undefined,
        live ? data?.revision : undefined,
        live ? { workflow: true } : undefined,
      );
      if (rev === revision && root.isConnected) apply(next);
    } catch (error) {
      if (rev !== revision || !root.isConnected) return;
      status.textContent = error.message;
      if (!data && error.message.includes("закрыт")) clearInterval(timer);
      if (
        !share.owner &&
        (error.message.includes("закрыт") || (live && error.status === 404))
      ) {
        paper.replaceChildren();
        list.replaceChildren();
        picker.hidden = form.hidden = true;
        replyForm.hidden = editButton.hidden = true;
        panel.hidden = false;
        role.hidden = true;
        workflow?.stop();
        if (live) title.textContent = "Общий документ";
        clearInterval(timer);
      }
    }
  }
  async function mutate(input) {
    if (busy) return false;
    busy = true;
    revision++;
    if (live) status.textContent = "Сохранение…";
    send.disabled = replySend.disabled = refreshButton.disabled = true;
    try {
      const next = await request(
        share,
        input,
        undefined,
        live ? { workflow: true } : undefined,
      );
      if (root.isConnected) apply(next);
      return true;
    } catch (error) {
      status.textContent = error.message;
      return false;
    } finally {
      busy = false;
      send.disabled = replySend.disabled = refreshButton.disabled = false;
    }
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const input = {
      action: "comment",
      target: active,
      ...(live
        ? {
            targetLabel: (
              allTargets().find((t) => t.key === active)?.label ||
              "Весь документ"
            ).slice(0, 450),
            ...(inlineTargets.has(active)
              ? { anchor: inlineTargets.get(active).anchor }
              : {}),
          }
        : {}),
      author: live && isAuthor() ? "Автор" : name.value.trim(),
      text: note.value.trim(),
    };
    if (!input.text || !input.author) return;
    const signature = JSON.stringify(input);
    const previous = pending.get(input.target);
    const requestId =
      previous?.signature === signature ? previous.id : crypto.randomUUID();
    pending.set(input.target, { signature, id: requestId });
    const sent = await mutate({ ...input, requestId });
    if (sent) {
      if (active === input.target && note.value.trim() === input.text)
        note.value = "";
      if (drafts.get(input.target)?.trim() === input.text)
        drafts.delete(input.target);
      pending.delete(input.target);
    }
  };
  replyForm.onsubmit = async (event) => {
    event.preventDefault();
    if (!replying || busy) return;
    const input = {
      action: "reply",
      comment: replying.id,
      author: isAuthor() ? "Автор" : replyName.value.trim(),
      text: replyNote.value.trim(),
    };
    if (!input.author || !input.text) return;
    const signature = JSON.stringify(input);
    const key = "reply:" + input.comment;
    const previous = pending.get(key);
    const requestId =
      previous?.signature === signature ? previous.id : crypto.randomUUID();
    pending.set(key, { signature, id: requestId });
    if (await mutate({ ...input, requestId })) {
      pending.delete(key);
      if (
        replying?.id === input.comment &&
        replyNote.value.trim() === input.text
      ) {
        replyNote.value = "";
        replying = null;
        replyForm.hidden = true;
      }
    }
  };
  refresh(true);
  timer = setInterval(() => refresh(), live ? 5000 : 30_000);
  return stop;
}
