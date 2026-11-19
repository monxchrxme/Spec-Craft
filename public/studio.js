import { showReview } from "./review.js";
import { enableWikiSuggestions } from "./wiki-suggestions.js";
import { wikiLinks, specIndex } from "./spec-index.js";
import { specPanels } from "./spec-panels.js";
import { diagramView } from "./diagram-view.js";
import { graphEditor } from "./graph-editor.js";
import { normalize, escapeHtml as esc } from "./graph.js";
import { examples, blocksToInsert, fence, aiPrompt } from "./documents.js";
const $ = (s) => document.querySelector(s),
  modal = $("#modal"),
  host = $("#blocks"),
  source = $("#source"),
  viewport = $("#scroll");
const md = window
  .markdownit({
    html: false,
    linkify: false,
    typographer: false,
  })
  .use(window.markdownitMark)
  .use(wikiLinks);
const prefix = "buro:doc:",
  sessionKey = "buro:active",
  icons = () => window.lucide?.createIcons();
const icon = (n) => '<i aria-hidden="true" data-lucide="' + n + '"></i>';
const docs = new Map(),
  history = new Map(),
  savedRecords = new Map();
let doc,
  mode = "edit",
  parts = [],
  selected = 0,
  editor = null,
  tableEdit = null,
  timer,
  feedbackTimer,
  loaded = true;
function notice(s) {
  clearTimeout(feedbackTimer);
  $("#notice").textContent = s;
  $("#notice").hidden = false;
  feedbackTimer = setTimeout(() => ($("#notice").hidden = true), 3000);
}
function newDoc(name, body, kind = "Markdown") {
  return { id: crypto.randomUUID(), name, body, kind, style: {}, updated: 0 };
}
const availableDocs = () => [...docs.values()].filter((d) => !d.trashed);
function readDocument(id, raw) {
  try {
    const record = JSON.parse(raw);
    if (
      record?.id === id &&
      typeof record.body === "string" &&
      typeof record.name === "string"
    )
      return record;
  } catch {
    // A damaged record must not prevent other documents from loading.
  }
  return null;
}
let firstVisit = true;
try {
  firstVisit = localStorage.getItem(sessionKey) === null;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(prefix)) continue;
    const raw = localStorage.getItem(k);
    const record = readDocument(k.slice(prefix.length), raw);
    if (!record) {
      loaded = false;
      continue;
    }
    docs.set(record.id, record);
    savedRecords.set(record.id, raw);
  }
  doc =
    availableDocs().find((d) => d.id === localStorage.getItem(sessionKey)) ||
    availableDocs()[0];
} catch {
  loaded = false;
}
if (!doc && firstVisit && !docs.size) {
  const e = examples.spec;
  doc = newDoc(e.name, e.body, e.label);
  docs.set(doc.id, doc);
}
function writeRecord(d) {
  const record = { ...d, updated: Date.now() };
  const raw = JSON.stringify(record);
  localStorage.setItem(prefix + d.id, raw);
  Object.assign(d, record);
  savedRecords.set(d.id, raw);
  docs.set(d.id, d);
}
function save() {
  clearTimeout(timer);
  try {
    if (doc && JSON.stringify(doc) !== savedRecords.get(doc.id)) {
      const base = savedRecords.get(doc.id);
      const raw = localStorage.getItem(prefix + doc.id);
      if (base !== undefined && raw !== base) {
        const incoming = readDocument(doc.id, raw);
        if (incoming) {
          docs.set(doc.id, incoming);
          savedRecords.set(doc.id, raw);
        } else {
          docs.delete(doc.id);
          savedRecords.delete(doc.id);
        }
        doc = { ...doc, id: crypto.randomUUID(), name: copyName(doc.name) };
        notice("Файл изменён в другой вкладке. Ваши правки сохранены в копии.");
        docs.set(doc.id, doc);
        nav();
      }
      writeRecord(doc);
    }
    localStorage.setItem(sessionKey, doc?.id || "");
    $("#save").textContent = doc ? "Сохранено на устройстве" : "";
    return true;
  } catch {
    $("#save").textContent = "Локальное сохранение недоступно · скачайте .md";
    return false;
  }
}
function changed() {
  const plain = doc.body.replace(
    /^`{3,}studio-diagram[^\n]*\n[\s\S]*?^`{3,}\s*$/gm,
    "",
  );
  $("#wordcount").textContent =
    (plain.match(/[\p{L}\p{N}]+/gu) || []).length + " слов";
  $("#save").textContent = "Сохранение…";
  clearTimeout(timer);
  timer = setTimeout(save, 300);
}
const stacks = () => {
  if (!history.has(doc.id)) history.set(doc.id, { back: [], forward: [] });
  return history.get(doc.id);
};
function snapshot() {
  const s = stacks();
  if (s.back.at(-1) !== doc.body) s.back.push(doc.body);
  if (s.back.length > 75) s.back.shift();
  s.forward.length = 0;
}
function setText(text, record = true) {
  if (text === doc.body) return;
  if (record) snapshot();
  doc.body = text;
  changed();
}
function patch(start, end, body) {
  setText(doc.body.slice(0, start) + body + doc.body.slice(end));
}
function parse(body = doc.body) {
  const starts = [0];
  for (const m of body.matchAll(/\r\n|\r|\n/g))
    starts.push(m.index + m[0].length);
  const tokens = md.parse(body, {}),
    res = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.level || !t.map) continue;
    let j = i;
    if (t.nesting === 1)
      while (
        j + 1 < tokens.length &&
        !(tokens[++j].level === 0 && tokens[j].nesting === -1)
      ) {}
    const start = starts[t.map[0]],
      rawEnd = starts[t.map[1]] ?? body.length;
    let end = rawEnd;
    const tail = body.slice(start, end).match(/(?:\r\n|\n|\r)$/);
    if (tail) end -= tail[0].length;
    res.push({
      t,
      tokens: tokens.slice(i, j + 1),
      start,
      end,
      text: body.slice(start, end),
    });
    i = j;
  }
  return res;
}
function nav() {
  const files = $("#files");
  files.replaceChildren();
  for (const d of availableDocs()) {
    const b = document.createElement("button");
    b.className = "file";
    b.setAttribute("aria-current", String(d.id === doc?.id));
    b.innerHTML = icon("file-text") + '<span class="file-name"></span>';
    b.lastChild.textContent = d.name;
    b.title = d.name;
    b.onclick = () => switchDoc(d);
    const row = document.createElement("div");
    row.className = "file-row";
    const menu = document.createElement("button");
    menu.className = "file-menu";
    menu.title = "Действия с файлом " + d.name;
    menu.setAttribute("aria-label", menu.title);
    menu.innerHTML = icon("ellipsis");
    menu.onclick = () => fileActions(d.id);
    row.append(b, menu);
    files.append(row);
  }
  $("#filename").textContent = doc?.name || "";
  $("#kind").textContent = doc?.kind || "";
  $("#trash-count").textContent =
    [...docs.values()].filter((d) => d.trashed).length || "";
  for (const b of document.querySelectorAll(
    '[data-action="ai"],[data-action="style"],[data-action="export"],[data-action="trace"],[data-action="links"],[data-action="versions"],#filename',
  ))
    b.disabled = !doc;
  icons();
}
function switchDoc(d) {
  flush();
  save();
  activate(d);
}
function activate(d) {
  closeGraph();
  if (modal.open) modal.close();
  doc = d;
  selected = 0;
  document.body.classList.remove("show-side");
  render();
  nav();
  viewport.scrollTop = 0;
  save();
}
function outline() {
  const panel = $("#outline");
  panel.replaceChildren();
  for (const [i, p] of parts.entries()) {
    if (p.t.type !== "heading_open") continue;
    const b = document.createElement("button");
    b.className = "outline-item";
    b.dataset.idx = i;
    b.style.paddingLeft = 8 + Math.min(3, Number(p.t.tag[1]) - 1) * 9 + "px";
    b.textContent =
      p.tokens.find((t) => t.type === "inline")?.content || "Заголовок";
    b.onclick = () => {
      flush();
      selected = i;
      if (mode === "source") {
        source.focus();
        source.setSelectionRange(parts[i].start, parts[i].end);
        source.scrollTop =
          source.scrollHeight * (parts[i].start / Math.max(1, doc.body.length));
      } else host.children[i]?.scrollIntoView({ block: "start" });
      document.body.classList.remove("show-side");
      highlight(i);
    };
    panel.append(b);
  }
  highlight(selected);
}
function highlight(i) {
  const headings = [...$("#outline").children];
  const active = headings.filter((b) => Number(b.dataset.idx) <= i).at(-1);
  headings.forEach((b) => b.classList.toggle("active", b === active));
}
viewport.onscroll = () => {
  if (mode === "source") return;
  const top = viewport.getBoundingClientRect().top + 55;
  let active = 0;
  for (const b of host.children) {
    if (b.getBoundingClientRect().top > top) break;
    active = Number(b.dataset.idx);
  }
  highlight(active);
};
function styles() {
  const p = $(".paper"),
    s = doc.style || {};
  p.style.setProperty(
    "--doc-font",
    s.font === "serif"
      ? 'Georgia,"Times New Roman",serif'
      : s.font === "mono"
        ? "ui-monospace, Menlo, Consolas, monospace"
        : 'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  );
  p.style.setProperty("--doc-size", (Number(s.size) || 16) + "px");
  p.style.setProperty(
    "--doc-accent",
    /^#[a-f\d]{6}$/i.test(s.accent) ? s.accent : "#6353bb",
  );
  p.style.setProperty("--doc-leading", Number(s.leading) || 1.65);
  p.style.setProperty("--paragraph-gap", (Number(s.gap) || 12) + "px");
  p.style.setProperty(
    "--reading-width",
    s.lineLength ? Number(s.lineLength) + "ch" : "none",
  );
  p.style.setProperty(
    "--prose-align",
    s.align === "justify" ? "justify" : "left",
  );
  p.style.tabSize = Number(s.tabSize) || 4;
  source.spellcheck = !!s.spellcheck;
  source.wrap = s.wrap === false ? "off" : "soft";
}
let inlineGraph = null;
function closeGraph(restore = true) {
  if (!inlineGraph) return;
  const session = inlineGraph;
  session.publish?.();
  inlineGraph = null;
  const dock = $("#graph-dock");
  dock.hidden = true;
  dock.querySelector(".props").onkeydown = null;
  dock.querySelector(".props").replaceChildren();
  if (restore && session.panel.isConnected) {
    const p = parts[session.index];
    if (p) session.panel.parentElement.replaceWith(block(p, session.index));
    icons();
  }
}
function render() {
  closeGraph(false);
  editor = tableEdit = null;
  $("#empty-workspace").hidden = !!doc;
  $(".paper").hidden = !doc;
  $(".controls").hidden = !doc;
  if (!doc) {
    parts = [];
    host.replaceChildren();
    source.value = "";
    $("#outline").replaceChildren();
    $("#wordcount").textContent = "";
    return;
  }
  parts = parse();
  selected = Math.min(selected, Math.max(0, parts.length - 1));
  host.replaceChildren();
  styles();
  document.body.classList.toggle("read-view", mode === "read");
  $("#workspace")
    .querySelectorAll("[data-mode]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode)),
    );
  $(".add-end").hidden = mode !== "edit";
  $("[data-action=insert]").disabled = mode === "read";
  host.hidden = mode === "source";
  source.hidden = mode !== "source";
  if (mode === "source") {
    if (source.value !== doc.body) source.value = doc.body;
  } else parts.forEach((p, i) => host.append(block(p, i)));
  outline();
  icons();
  $("#wordcount").textContent =
    (
      doc.body
        .replace(/^`{3,}studio-diagram[^\n]*\n[\s\S]*?^`{3,}\s*$/gm, "")
        .match(/[\p{L}\p{N}]+/gu) || []
    ).length + " слов";
}
function block(p, i) {
  const box = document.createElement("div");
  box.className = "block";
  box.dataset.idx = i;
  box.onpointerdown = () => {
    selected = i;
  };
  if (p.t.type === "fence" && p.t.info.trim() === "studio-diagram") {
    try {
      const g = normalize(JSON.parse(p.t.content));
      const edit = (initialNode) => {
        if (mode === "read") return;
        flush();
        if (modal.open) modal.close();
        const target = host.children[i],
          panel = document.createElement("section");
        target.replaceChildren(panel);
        const dock = $("#graph-dock");
        dock.hidden = false;
        const session = { index: i, panel };
        inlineGraph = session;
        selected = i;
        session.publish = graphEditor(
          normalize(JSON.parse(parts[i].t.content)),
          panel,
          dock.querySelector(".props"),
          (next) => {
            if (inlineGraph !== session) return;
            const entry = parts[i];
            const serialized = fence(next).replace(
              /\n/g,
              doc.body.includes("\r\n") ? "\r\n" : "\n",
            );
            patch(entry.start, entry.end, serialized);
            parts = parse();
          },
          () => closeGraph(),
          typeof initialNode === "string" ? initialNode : null,
          {
            requirements: specIndex(parts).requirements,
            open: (id) => {
              const matches = specIndex(parts).resolve(id);
              if (matches.length === 1) panels.trace(matches[0].key);
              else panels.links(id);
            },
          },
        );
      };
      box.openGraph = edit;
      box.append(diagramView(g, { edit: mode === "read" ? undefined : edit }));
      return box;
    } catch (err) {
      box.textContent = "Ошибка схемы · " + err.message;
      box.classList.add("diagram-error");
    }
  } else if (p.t.type === "table_open") {
    buildTable(box, p, i);
    return box;
  } else box.innerHTML = md.renderer.render(p.tokens, md.options, {});
  if (mode === "edit") {
    box.tabIndex = 0;
    box.title = "Нажмите, чтобы редактировать";
    box.onclick = (e) => {
      if (e.target.closest("textarea,.inline-tools")) return;
      if (e.target.closest("a") && (e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      editBlock(i);
    };
    box.onkeydown = (e) => {
      if (e.target === box && e.key === "Enter") {
        e.preventDefault();
        editBlock(i);
      }
    };
  }
  return box;
}
function editBlock(i, selectAll = false) {
  if (editor?.i === i) return;
  flush();
  const p = parts[i],
    box = host.children[i];
  if (!p || !box) return;
  const ta = document.createElement("textarea");
  ta.className = "source-edit";
  ta.spellcheck = !!doc.style?.spellcheck;
  ta.setAttribute("aria-label", "Редактировать блок Markdown");
  ta.value = p.text;
  editor = { i, ta, baseline: p.text, start: p.start, end: p.end };
  const toolbar = document.createElement("div");
  toolbar.className = "inline-tools";
  for (const [label, mark, symbol] of [
    ["Полужирный", "**", "bold"],
    ["Курсив", "*", "italic"],
    ["Зачёркнутый", "~~", "strikethrough"],
    ["Маркер", "==", "highlighter"],
    ["Строчный код", String.fromCharCode(96), "code"],
    ["Ссылка", "link", "link"],
  ]) {
    const btn = document.createElement("button");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = icon(symbol);
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = (e) => {
      e.stopPropagation();
      const a = ta.selectionStart,
        b = ta.selectionEnd,
        part = ta.value.slice(a, b) || "текст";
      const insert =
        mark === "link" ? "[" + part + "](https://)" : mark + part + mark;
      ta.setRangeText(insert, a, b, "end");
      ta.focus();
      if (mark === "link")
        ta.setSelectionRange(a + part.length + 3, a + insert.length - 1);
      else ta.setSelectionRange(a + mark.length, a + mark.length + part.length);
      liveBlock();
    };
    toolbar.append(btn);
  }
  box.replaceChildren(toolbar, ta);
  icons();
  ta.style.height = Math.max(52, ta.scrollHeight + 4) + "px";
  ta.focus();
  if (selectAll) ta.select();
  else ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.oninput = () => {
    liveBlock();
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + 4 + "px";
    if (ta.value === "/") {
      ta.value = "";
      liveBlock();
      insertDialog();
    }
  };
  ta.onblur = () => {
    setTimeout(() => {
      if (editor?.ta === ta && document.activeElement !== ta) flush();
    }, 0);
  };
  ta.onkeydown = (e) => {
    const shortcut =
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      !e.shiftKey &&
      { b: "Полужирный", i: "Курсив" }[e.key.toLowerCase()];
    if (shortcut) {
      e.preventDefault();
      toolbar.querySelector('[aria-label="' + shortcut + '"]').click();
      return;
    }
    if (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key === "Enter")) {
      e.preventDefault();
      flush();
    } else if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !ta.value.includes("\n") &&
      !/^[-*\d>]/.test(ta.value) &&
      ta.selectionStart === ta.value.length
    ) {
      e.preventDefault();
      flush();
      insertBlock("paragraph", i);
    }
  };
}
function liveBlock() {
  if (!editor) return;
  const { ta, start, end } = editor;
  const value = ta.value.replace(
    /\n/g,
    doc.body.includes("\r\n") ? "\r\n" : "\n",
  );
  if (doc.body.slice(start, end) === value) return;
  if (!editor.started) {
    snapshot();
    editor.started = true;
  }
  setText(doc.body.slice(0, start) + value + doc.body.slice(end), false);
  editor.end = start + value.length;
}
function flush() {
  closeGraph();
  if (editor) {
    liveBlock();
    editor = null;
    render();
  } else if (tableEdit) {
    finishCell();
    render();
  }
}
function tableRows(p) {
  const rows = [];
  let row;
  for (const t of p.tokens) {
    if (t.type === "tr_open") {
      row = [];
      rows.push(row);
    }
    if (t.type === "inline") row.push(t.content);
  }
  const align = p.tokens
    .filter((t) => t.type === "th_open")
    .map((t) => t.attrGet("style")?.replace("text-align:", "") || "");
  return { rows, align };
}
function tableText(data) {
  const format = (r) =>
    "| " +
    r
      .map((s) => s.replace(/\\?\|/g, "\\|").replace(/[\r\n]+/g, " "))
      .join(" | ") +
    " |";
  const [head, ...tail] = data.rows;
  return [
    format(head),
    format(
      head.map(
        (_, i) =>
          ({ left: ":---", right: "---:", center: ":---:" })[data.align[i]] ||
          "---",
      ),
    ),
    ...tail.map(format),
  ].join(doc.body.includes("\r\n") ? "\r\n" : "\n");
}
function finishCell(keepFocus = false) {
  if (!tableEdit) return;
  const e = tableEdit;
  if (!keepFocus) tableEdit = null;
  e.rows.rows[e.r][e.c] = e.cell.textContent.replace(/[\r\n]+/g, " ");
  if (e.rows.rows[e.r][e.c] !== e.original) {
    const p = parts[e.i];
    patch(p.start, p.end, tableText(e.rows));
    e.original = e.rows.rows[e.r][e.c];
    parts = parse();
  }
}
function buildTable(box, p, i) {
  box.innerHTML =
    '<div class="table-scroll">' +
    md.renderer.render(p.tokens, md.options, {}) +
    "</div>";
  if (mode !== "edit") return;
  const data = tableRows(p),
    cells = [...box.querySelector("table").rows];
  let activeCol = 0,
    activeRow = 1;
  cells.forEach((row, r) =>
    [...row.cells].forEach((cell, c) => {
      cell.contentEditable = "plaintext-only";
      cell.setAttribute(
        "aria-label",
        "Строка " + (r + 1) + ", столбец " + (c + 1),
      );
      cell.onfocus = () => {
        closeGraph();
        finishCell();
        selected = i;
        activeCol = c;
        activeRow = r;
        cell.textContent = data.rows[r][c] || "";
        tableEdit = { cell, r, c, rows: data, i, original: cell.textContent };
      };
      cell.onpaste = (e) => {
        const text = e.clipboardData?.getData("text/plain") || "";
        if (!text.includes("\t")) return;
        e.preventDefault();
        finishCell();
        const pasted = text
          .replace(/\r\n?/g, "\n")
          .replace(/\n$/, "")
          .split("\n")
          .map((line) => line.split("\t"));
        const width = Math.max(
          data.rows[0].length,
          c + Math.max(...pasted.map((row) => row.length)),
        );
        for (const existing of data.rows)
          while (existing.length < width) existing.push("");
        for (const [dr, values] of pasted.entries()) {
          while (data.rows.length <= r + dr)
            data.rows.push(Array(width).fill(""));
          values.forEach((value, dc) => (data.rows[r + dr][c + dc] = value));
        }
        update();
      };
      cell.onblur = () => {
        if (tableEdit?.cell === cell) {
          finishCell();
          cell.innerHTML = md.renderInline(data.rows[r][c]);
        }
      };
      cell.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          cell.blur();
        }
        if (
          e.key === "Tab" &&
          !e.shiftKey &&
          r === cells.length - 1 &&
          c === row.cells.length - 1
        ) {
          e.preventDefault();
          cell.blur();
          data.rows.push(data.rows[0].map(() => ""));
          update();
          host.children[i]?.querySelector("tr:last-child td")?.focus();
        }
      };
    }),
  );
  const actions = document.createElement("div");
  actions.className = "table-tools";
  function update() {
    finishCell();
    patch(parts[i].start, parts[i].end, tableText(data));
    render();
  }
  for (const [name, act] of [
    [
      "+ Строка",
      () =>
        data.rows.splice(
          Math.max(1, activeRow + 1),
          0,
          data.rows[0].map(() => ""),
        ),
    ],
    [
      "+ Столбец",
      () => {
        data.rows.forEach((r, j) =>
          r.splice(activeCol + 1, 0, j ? "" : "Столбец"),
        );
        data.align.splice(activeCol + 1, 0, "");
      },
    ],
    [
      "− Строка",
      () => {
        if (activeRow > 0 && activeRow < data.rows.length)
          data.rows.splice(activeRow, 1);
      },
    ],
    [
      "− Столбец",
      () => {
        if (data.rows[0].length > 1) {
          data.rows.forEach((r) => r.splice(activeCol, 1));
          data.align.splice(activeCol, 1);
        }
      },
    ],
  ]) {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = () => {
      act();
      update();
    };
    actions.append(b);
  }
  box.append(actions);
}
source.onfocus = () => {
  source.dataset.group = "";
};
source.oninput = () => {
  if (!source.dataset.group) {
    snapshot();
    source.dataset.group = "yes";
  }
  setText(source.value, false);
  parts = parse();
  outline();
};
source.onkeyup = source.onclick = () => {
  const i = parts.findLastIndex((p) => p.start <= source.selectionStart);
  selected = Math.max(0, i);
  highlight(i);
};
function setMode(next) {
  flush();
  const offset =
    mode === "source" ? source.selectionStart : parts[selected]?.start || 0;
  mode = next;
  selected = Math.max(
    0,
    parts.findLastIndex((p) => p.start <= offset),
  );
  render();
  if (next === "source") {
    source.focus();
    source.setSelectionRange(offset, offset);
  } else host.children[selected]?.scrollIntoView({ block: "nearest" });
}
function insertBlock(type, idx = selected) {
  flush();
  const item = blocksToInsert[type];
  if (!item) return;
  let body = item[1];
  if (type === "requirement") {
    const max = Math.max(
      0,
      ...[...doc.body.matchAll(/\bFR-(\d+)/g)].map((m) => Number(m[1])),
    );
    body = body.replace("FR-01", "FR-" + String(max + 1).padStart(2, "0"));
  }
  const pos =
      mode === "source"
        ? source.selectionStart
        : (parts[idx]?.end ?? doc.body.length),
    before = doc.body.slice(0, pos),
    after = doc.body.slice(pos);
  const add =
    (before.trim() ? "\n\n" : "") + body + (after.trim() ? "\n\n" : "\n");
  patch(pos, pos, add);
  render();
  selected = Math.max(
    0,
    parts.findIndex((p) => p.start >= pos && p.end > pos),
  );
  if (mode === "source") {
    source.focus();
    source.setSelectionRange(pos + add.length, pos + add.length);
  } else {
    host.children[selected]?.scrollIntoView({ block: "nearest" });
    if (["paragraph", "heading", "code", "list"].includes(type))
      editBlock(selected, true);
    if (type === "diagram")
      host.children[selected]?.querySelector("button")?.click();
  }
}
function resetModal() {
  modal.removeAttribute("aria-label");
  modal.onclick = null;
  modal.oncancel = null;
  modal.className = "";
  modal.replaceChildren();
}
function dialog(title, html) {
  flush();
  document.body.classList.remove("show-side");
  resetModal();
  modal.innerHTML =
    '<div class="dialog-head"><h2>' +
    esc(title) +
    '</h2><button aria-label="Закрыть" data-close>' +
    icon("x") +
    '</button></div><div class="dialog-body">' +
    html +
    "</div>";
  modal.querySelector("[data-close]").onclick = () => modal.close();
  icons();
  if (!modal.open) modal.show();
  return modal.querySelector(".dialog-body");
}
function option(id, label, symbol) {
  return (
    '<button class="option" data-id="' +
    id +
    '">' +
    icon(symbol) +
    esc(label) +
    "</button>"
  );
}
function insertDialog() {
  const b = dialog(
    "Вставить блок",
    Object.entries(blocksToInsert)
      .map(([k, v]) =>
        option(
          k,
          v[0],
          {
            paragraph: "pilcrow",
            heading: "heading",
            table: "table",
            diagram: "workflow",
            requirement: "list-checks",
            code: "code",
            list: "list",
          }[k],
        ),
      )
      .join(""),
  );
  b.onclick = (e) => {
    const k = e.target.closest("[data-id]")?.dataset.id;
    if (k) {
      modal.close();
      insertBlock(k);
    }
  };
}
function download(name, body, type = "text/markdown;charset=utf-8") {
  const a = document.createElement("a");
  a.download = name;
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function create(name, body, kind) {
  const next = newDoc(name, body, kind);
  docs.set(next.id, next);
  mode = "edit";
  switchDoc(next);
}
function nameOf(s) {
  return (
    (s
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\.md$/i, "") || "Документ") + ".md"
  );
}
function copyName(name) {
  const stem = name.replace(/\.md$/i, "");
  const names = new Set(availableDocs().map((d) => d.name));
  let count = 1;
  while (true) {
    const candidate =
      stem + (count === 1 ? " (копия)" : " (копия " + count + ")") + ".md";
    if (!names.has(candidate)) return candidate;
    count++;
  }
}
// File actions may target a background document. Read its latest saved state
// before changing metadata so edits made in another tab are preserved.
function updateFile(id, mutate) {
  flush();
  if (doc?.id === id && !save()) return false;
  try {
    const raw = localStorage.getItem(prefix + id);
    if (!raw) {
      notice("Файл уже удалён.");
      return false;
    }
    const latest = readDocument(id, raw);
    if (!latest) {
      notice("Не удалось прочитать сохранённый файл.");
      return false;
    }
    const next = mutate(latest);
    if (next) {
      writeRecord(next);
      if (doc?.id === id) doc = next;
    } else {
      localStorage.removeItem(prefix + id);
      docs.delete(id);
      savedRecords.delete(id);
      history.delete(id);
    }
    return true;
  } catch {
    notice("Не удалось сохранить изменение на устройстве.");
    return false;
  }
}
function fileActions(id) {
  const d = docs.get(id);
  if (!d || d.trashed) return;
  const body = dialog(
    d.name,
    option("rename", "Переименовать", "pencil") +
      option("copy", "Создать копию", "copy") +
      option("trash", "Переместить в корзину", "trash-2"),
  );
  body.onclick = (event) => {
    const action = event.target.closest("[data-id]")?.dataset.id;
    if (action && (!docs.has(id) || docs.get(id).trashed)) {
      modal.close();
      notice("Файл удалён в другой вкладке.");
      return;
    }
    if (action === "rename") return renameFile(id);
    if (action === "copy") {
      const next = {
        ...structuredClone(docs.get(id)),
        id: crypto.randomUUID(),
        name: copyName(docs.get(id).name),
      };
      modal.close();
      docs.set(next.id, next);
      switchDoc(next);
    }
    if (
      action === "trash" &&
      updateFile(id, (latest) => ({ ...latest, trashed: true }))
    ) {
      modal.close();
      if (doc?.id === id) activate(availableDocs()[0]);
      else nav();
      notice("Документ перемещён в корзину");
    }
  };
}
function renameFile(id) {
  const body = dialog(
    "Имя файла",
    '<label>Название<input></label><button class="primary">Сохранить</button>',
  );
  const input = body.querySelector("input");
  input.value = docs.get(id).name;
  body.querySelector("button").onclick = () => {
    if (
      updateFile(id, (latest) => ({ ...latest, name: nameOf(input.value) }))
    ) {
      modal.close();
      nav();
    }
  };
}
function trashDialog() {
  const body = dialog("Корзина", "");
  const trash = [...docs.values()].filter((d) => d.trashed);
  if (!trash.length) body.textContent = "Корзина пуста.";
  for (const d of trash) {
    const row = document.createElement("div");
    row.className = "trash-row";
    row.innerHTML =
      '<strong></strong><div><button>Восстановить</button><button class="danger">Удалить навсегда</button></div>';
    row.querySelector("strong").textContent = d.name;
    const [restore, remove] = row.querySelectorAll("button");
    restore.onclick = () => {
      if (!updateFile(d.id, (latest) => ({ ...latest, trashed: false })))
        return;
      modal.close();
      if (!doc) activate(docs.get(d.id));
      else nav();
      notice("Документ восстановлен");
    };
    remove.onclick = () => {
      const confirm = dialog(
        "Удалить документ навсегда?",
        '<p></p><div class="dialog-actions"><button>Отмена</button><button class="danger">Удалить навсегда</button></div>',
      );
      confirm.querySelector("p").textContent =
        "Вы удаляете «" +
        d.name +
        "» из хранилища этого браузера. Восстановление из корзины станет недоступно.";
      const [cancel, apply] = confirm.querySelectorAll("button");
      cancel.onclick = trashDialog;
      apply.onclick = () => {
        if (!updateFile(d.id, (latest) => (latest.trashed ? null : latest)))
          return;
        nav();
        trashDialog();
      };
    };
    body.append(row);
  }
}
function newDialog() {
  const b = dialog(
    "Новый документ",
    '<label>Шаблон<select id="template">' +
      Object.entries(examples)
        .map(
          ([k, v]) => '<option value="' + k + '">' + esc(v.label) + "</option>",
        )
        .join("") +
      '</select></label><label>Имя файла<input id="new-name" value="Техническое задание.md"></label><div class="dialog-actions"><button class="primary">Создать</button></div>',
  );
  b.querySelector("select").onchange = (e) =>
    ($("#new-name").value = examples[e.target.value].label + ".md");
  b.querySelector("button").onclick = () => {
    const key = $("#template").value,
      t = examples[key],
      name = nameOf($("#new-name").value);
    const text =
      key === "spec"
        ? "# Техническое задание\n\n## Назначение\n\nОпишите цель системы.\n\n## Функциональные требования\n\n" +
          blocksToInsert.table[1] +
          "\n\n## Критерии приёмки\n\nУкажите условия приёмки.\n"
        : t.body;
    modal.close();
    create(name, text, t.label);
  };
}
function printDoc() {
  flush();
  const old = mode;
  mode = "read";
  render();
  const sheet = $(".paper").cloneNode(true);
  sheet.removeAttribute("id");
  sheet.classList.add("print-surface");
  document.body.append(sheet);
  mode = old;
  render();
  const clean = () => sheet.remove();
  window.addEventListener("afterprint", clean, { once: true });
  window.print();
}
function exportDialog() {
  const b = dialog(
    "Экспорт документа",
    option("pdf", "Скачать PDF", "file-down") +
      '<label class="style-check"><input type="checkbox" checked name="largeSheets">Увеличивать лист для крупных схем</label>' +
      option("md", "Скачать Markdown (.md)", "file-text") +
      option("print", "Печать", "printer") +
      '<p role="status" hidden></p>',
  );
  b.onclick = async (e) => {
    const target = e.target.closest("[data-id]");
    if (!target) return;
    if (target.dataset.id === "pdf") {
      const data = structuredClone(doc),
        blocks = parse(),
        enlarge = b.querySelector("[name=largeSheets]").checked;
      const status = b.querySelector("[role=status]");
      target.disabled = true;
      status.hidden = false;
      status.textContent = "Подготовка PDF…";
      try {
        const { exportPdf } = await import("./pdf-export.js");
        const blob = await exportPdf(blocks, md, data, enlarge);
        download(
          data.name.replace(/\.md$/i, "") + ".pdf",
          blob,
          "application/pdf",
        );
        if (b.isConnected) modal.close();
      } catch (error) {
        status.textContent = "Не удалось создать PDF. " + error.message;
      } finally {
        target.disabled = false;
      }
      return;
    }
    modal.close();
    if (target.dataset.id === "md") download(doc.name, doc.body);
    else printDoc();
  };
}
function styleDialog() {
  const s = doc.style || {};
  const body = dialog("Оформление документа", "");
  const options = [
    [
      "font",
      "Шрифт текста",
      "sans",
      { sans: "Без засечек", serif: "С засечками", mono: "Моноширинный" },
    ],
    ["size", "Размер текста, px", 16, [14, 15, 16, 17, 18, 20, 22, 24]],
    ["leading", "Межстрочный интервал", 1.65, [1.25, 1.45, 1.65, 1.85, 2]],
    ["gap", "Интервал между абзацами, px", 12, [6, 10, 12, 16, 20, 24]],
    [
      "lineLength",
      "Ширина строки для чтения",
      0,
      {
        0: "Вся ширина",
        55: "Узкая · 55 знаков",
        70: "Средняя · 70 знаков",
        85: "Широкая · 85 знаков",
      },
    ],
    [
      "align",
      "Выравнивание абзацев",
      "left",
      { left: "По левому краю", justify: "По ширине" },
    ],
    ["tabSize", "Ширина табуляции", 4, [2, 4, 8]],
  ];
  const form = document.createElement("form");
  form.className = "style-form";
  body.append(form);
  for (const [key, label, initial, values] of options) {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement("select");
    input.name = key;
    for (const [v, title] of Array.isArray(values)
      ? values.map((x) => [x, x])
      : Object.entries(values))
      input.add(new Option(title, v));
    input.value = s[key] ?? initial;
    wrap.append(input);
    form.append(wrap);
  }
  form.insertAdjacentHTML(
    "beforeend",
    '<label>Цвет акцента<input type="color" name="accent"></label><label class="style-check"><input type="checkbox" name="wrap">Перенос строк в исходнике</label><label class="style-check"><input type="checkbox" name="spellcheck">Проверка орфографии при вводе</label><button class="primary">Применить</button>',
  );
  form.elements.accent.value = s.accent || "#6353bb";
  form.elements.wrap.checked = s.wrap !== false;
  form.elements.spellcheck.checked = !!s.spellcheck;
  form.onsubmit = (e) => {
    e.preventDefault();
    const fields = new FormData(form);
    doc.style = {
      ...s,
      accent: fields.get("accent"),
      wrap: fields.has("wrap"),
      spellcheck: fields.has("spellcheck"),
    };
    for (const [key, , initial] of options)
      doc.style[key] =
        typeof initial === "number" ? Number(fields.get(key)) : fields.get(key);
    styles();
    save();
    modal.close();
  };
}
function aiDialog() {
  const b = dialog(
    "Работа с другим чатом",
    '<p>Скопируйте задание вместе с документом и правилами схем. Готовый Markdown можно вернуть в эту студию.</p><label>Что нужно написать или изменить?<textarea id="brief" rows="3" placeholder="Например, опиши обработку отказа и добавь ветку на схеме"></textarea></label><label>Запрос для другого чата<textarea readonly class="prompt"></textarea></label><div class="dialog-actions"><button id="return">Вставить результат</button><button id="copy" class="primary">Скопировать запрос</button></div>',
  );
  const out = b.querySelector(".prompt");
  const update = () => (out.value = aiPrompt(doc, $("#brief").value));
  $("#brief").oninput = update;
  update();
  $("#copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(out.value);
      $("#copy").textContent = "Скопировано";
    } catch {
      out.select();
      $("#copy").textContent = "Выделено · Ctrl/Cmd + C";
    }
  };
  $("#return").onclick = () => importDialog();
}
function importDialog() {
  const b = dialog(
    "Вернуть документ из чата",
    '<label>Полный Markdown<textarea class="prompt" placeholder="# Название документа"></textarea></label><div class="dialog-actions"><button class="primary">Сравнить</button></div>',
  );
  b.querySelector("button").onclick = () => {
    let value = b.querySelector("textarea").value;
    if (!value.trim()) return;
    const wrap = value
      .trim()
      .match(/^(`{3,})(?:markdown|md)?\s*\n([\s\S]*)\n\1$/i);
    if (wrap) value = wrap[2];
    review(value);
  };
}
function sections(s) {
  const tokens = md.parse(s, {}),
    lines = s.split(/\r\n?|\n/),
    out = [];
  let start = 0,
    title = "Введение";
  for (const t of tokens) {
    if (
      t.level === 0 &&
      t.type === "heading_open" &&
      ["h1", "h2"].includes(t.tag)
    ) {
      if (t.map[0] > start)
        out.push({
          title,
          body: lines.slice(start, t.map[0]).join("\n").trim(),
        });
      start = t.map[0];
      title = lines[start].replace(/^#+\s*/, "").trim();
    }
  }
  out.push({ title, body: lines.slice(start).join("\n").trim() });
  return out;
}
function review(value) {
  const old = sections(doc.body),
    next = sections(value),
    items = [];
  const used = new Set();
  for (const s of next) {
    const i = old.findIndex((o, j) => !used.has(j) && o.title === s.title);
    if (i >= 0) used.add(i);
    if (i < 0 || old[i].body !== s.body)
      items.push([i < 0 ? "Добавлен" : "Изменён", s.title]);
  }
  old.forEach((s, i) => {
    if (!used.has(i)) items.push(["Удалён", s.title]);
  });
  const b = dialog(
    "Изменения документа",
    '<div class="review">' +
      (items.length
        ? items
            .map(([a, t]) => "<p>" + esc(a) + " · " + esc(t) + "</p>")
            .join("")
        : "Изменений в содержании разделов нет.") +
      '</div><details><summary>Полный текст результата</summary><pre></pre></details><div class="dialog-actions"><button id="as-new">Открыть копией</button><button class="primary" id="apply-import">Применить</button></div>',
  );
  b.querySelector("pre").textContent = value;
  $("#as-new").onclick = () => {
    modal.close();
    create(doc.name.replace(/\.md$/i, "") + " (копия).md", value, doc.kind);
  };
  $("#apply-import").onclick = () => {
    modal.close();
    setText(value);
    render();
    save();
  };
}
function undo(forward) {
  flush();
  const s = stacks(),
    from = forward ? s.forward : s.back,
    to = forward ? s.back : s.forward;
  if (!from.length) return;
  to.push(doc.body);
  setText(from.pop(), false);
  render();
  source.dataset.group = "";
}
function jumpTo(target) {
  flush();
  if (modal.open) modal.close();
  if (mode === "source") {
    mode = "edit";
    render();
  }
  selected = target.index;
  const box = host.children[target.index];
  if (!box) return;
  if (target.node && mode === "edit") {
    box.openGraph?.(target.node);
    return;
  }
  const item = target.node
    ? box.querySelector('[data-node="' + CSS.escape(target.node) + '"]')
    : target.row >= 0
      ? box.querySelector("table")?.rows[target.row]
      : box;
  (item || box).scrollIntoView({ block: "center", inline: "center" });
  (item || box).animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 650 });
  highlight(target.index);
}
enableWikiSuggestions(() => specIndex(parse()).targets);
let stopReview;
function openSharedReview(share, onClose) {
  if (!share?.id) return;
  flush();
  modal.close();
  stopReview?.();
  stopReview = showReview({
    share,
    parse,
    renderMarkdown: (block) => md.renderer.render(block.tokens, md.options, {}),
    onClose: () => {
      stopReview = null;
      if (location.hash.startsWith("#review="))
        window.history.replaceState(
          null,
          "",
          location.pathname + location.search,
        );
      onClose?.();
    },
  });
}
function syncReviewLink() {
  const match = /^#review=([a-f0-9]{48})$/.exec(location.hash);
  if (match) openSharedReview({ id: match[1] });
  else if (stopReview) {
    stopReview();
    stopReview = null;
  }
}
window.addEventListener("hashchange", syncReviewLink);
const panels = specPanels({
  openReview: openSharedReview,
  open: dialog,
  parse,
  document: () => doc,
  jump: jumpTo,
  notice,
  download,
  fence,
  addRequirement: () => {
    modal.close();
    if (mode === "read") setMode("edit");
    insertBlock("requirement");
  },
  commit: (start, end, text) => {
    const newline = doc.body.includes("\r\n") ? "\r\n" : "\n";
    patch(start, end, text.replace(/\r\n|\n/g, newline));
    render();
    save();
  },
  update: (mutate, id = doc.id) => updateFile(id, mutate),
});
host.addEventListener("mousedown", (e) => {
  if (e.target.closest("[data-wiki]")) e.preventDefault();
});
host.addEventListener(
  "click",
  (e) => {
    const link = e.target.closest("[data-wiki]");
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    flush();
    const name = link.dataset.wiki,
      matches = specIndex(parse()).resolve(name);
    if (matches.length === 1) jumpTo(matches[0]);
    else panels.links(name);
  },
  true,
);
function transferDialog() {
  const box = dialog(
    "Перенос данных",
    "<p>Резервная копия включает документы, версии и доступ автора к замечаниям. Храните её у себя.</p>" +
      option("backup", "Скачать резервную копию", "download") +
      '<label>Загрузить резервную копию<input type="file" accept=".json,application/json"></label>',
  );
  box.querySelector("button").onclick = () => {
    if (save())
      download(
        "SpecCraft-резервная-копия.json",
        JSON.stringify({
          format: "speccraft-backup",
          version: 1,
          active: doc?.id,
          documents: [...docs.values()],
        }),
        "application/json",
      );
  };
  box.querySelector("input").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    let imported = 0,
      chosen;
    try {
      const bundle = JSON.parse(await file.text());
      if (
        bundle?.format !== "speccraft-backup" ||
        bundle.version !== 1 ||
        !Array.isArray(bundle.documents) ||
        bundle.documents.some(
          (d) =>
            !d ||
            typeof d.id !== "string" ||
            typeof d.name !== "string" ||
            typeof d.body !== "string" ||
            (d.versions !== undefined &&
              (!Array.isArray(d.versions) ||
                d.versions.some(
                  (v) =>
                    !v ||
                    typeof v.id !== "string" ||
                    typeof v.name !== "string" ||
                    typeof v.body !== "string",
                ))),
        )
      )
        throw Error("Выберите резервную копию SpecCraft.");
      for (const record of bundle.documents) {
        const existing = docs.get(record.id);
        if (
          existing &&
          JSON.stringify({ ...existing, updated: 0 }) ===
            JSON.stringify({ ...record, updated: 0 })
        )
          continue;
        const next = {
          ...record,
          id: existing ? crypto.randomUUID() : record.id,
          name: existing ? copyName(record.name) : record.name,
        };
        writeRecord(next);
        if (record.id === bundle.active && !next.trashed) chosen = next;
        imported++;
      }
      if (chosen) switchDoc(chosen);
      else nav();
      modal.close();
      notice(
        imported
          ? "Загружено документов: " + imported
          : "Эти документы уже есть в студии.",
      );
    } catch (error) {
      nav();
      notice(
        imported
          ? "Загружено " +
              imported +
              ". Для остальных документов не хватило места."
          : error.message,
      );
    }
    event.target.value = "";
  };
}
const actions = {
  transfer: transferDialog,
  trace: () => panels.trace(),
  links: () => {
    flush();
    const h = specIndex(parse()).headings.findLast((h) => h.index <= selected);
    panels.links(h?.id || h?.label);
  },
  versions: () => panels.versions(),
  files: () =>
    document.body.classList.toggle(
      matchMedia("(max-width:760px)").matches ? "show-side" : "hide-side",
    ),
  open: () => $("#file-input").click(),
  new: newDialog,
  ai: aiDialog,
  export: exportDialog,
  style: styleDialog,
  insert: insertDialog,
  append: () => insertBlock("paragraph", parts.length - 1),
  undo: () => undo(false),
  redo: () => undo(true),
  rename: () => renameFile(doc.id),
  trash: trashDialog,
};
document.addEventListener("click", (e) => {
  if (stopReview) return;
  const b = e.target.closest("[data-action],[data-mode]");
  if (!b) return;
  if (b.dataset.mode) setMode(b.dataset.mode);
  else actions[b.dataset.action]?.();
});
$("#file-input").onchange = async (e) => {
  for (const f of e.target.files) {
    try {
      create(nameOf(f.name), await f.text(), "Markdown");
    } catch {
      notice("Не удалось открыть файл");
    }
  }
  e.target.value = "";
};
document.addEventListener("keydown", (e) => {
  if (stopReview) return;
  if (modal.open && e.key === "Escape") {
    modal.close();
    e.preventDefault();
    return;
  }
  if (inlineGraph && e.key === "Escape") {
    closeGraph();
    e.preventDefault();
    return;
  }
  if (modal.open || !doc) return;
  const cmd = e.ctrlKey || e.metaKey;
  if (cmd && e.key.toLowerCase() === "s") {
    e.preventDefault();
    flush();
    save();
    download(doc.name, doc.body);
  }
  if (
    cmd &&
    e.key.toLowerCase() === "z" &&
    !e.target.closest("textarea,input,[contenteditable]")
  ) {
    e.preventDefault();
    if (inlineGraph) {
      inlineGraph.panel
        .querySelector(e.shiftKey ? '[data-cmd="redo"]' : '[data-cmd="undo"]')
        .click();
    } else undo(e.shiftKey);
  }
  if (
    e.key === "/" &&
    mode === "edit" &&
    !e.target.closest("textarea,input,[contenteditable]")
  ) {
    e.preventDefault();
    insertDialog();
  }
});
function syncFile(id) {
  const raw = localStorage.getItem(prefix + id);
  if (savedRecords.get(id) === raw) return;
  const incoming = readDocument(id, raw);
  if (raw !== null && !incoming) {
    notice("Не удалось прочитать изменение из другой вкладки.");
    return;
  }
  const active = id === doc?.id;
  if (active) {
    if (
      incoming &&
      !incoming.trashed &&
      (editor ||
        tableEdit ||
        inlineGraph ||
        modal.open ||
        document.activeElement === source)
    )
      return;
    flush();
    if (JSON.stringify(doc) !== savedRecords.get(id) && !save()) return;
  }
  if (incoming) {
    docs.set(id, incoming);
    savedRecords.set(id, raw);
  } else {
    docs.delete(id);
    savedRecords.delete(id);
    history.delete(id);
  }
  if (id === doc?.id) {
    if (modal.open) modal.close();
    activate(incoming && !incoming.trashed ? incoming : availableDocs()[0]);
  } else if (!doc && incoming && !incoming.trashed) activate(incoming);
  else nav();
}
window.addEventListener("storage", (event) => {
  if (event.key?.startsWith(prefix)) syncFile(event.key.slice(prefix.length));
});
window.addEventListener("pagehide", () => {
  inlineGraph?.publish?.();
  if (tableEdit) finishCell();
  save();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    inlineGraph?.publish?.();
    if (tableEdit) finishCell(true);
    save();
  }
});
nav();
render();
save();
if (!loaded) notice("Не удалось восстановить часть локальных данных");

syncReviewLink();
