import { normalize, draw, graphEditor, escapeHtml as esc } from "./graph.js";
import { examples, blocksToInsert, fence, aiPrompt } from "./documents.js";
const $ = (s) => document.querySelector(s),
  modal = $("#modal"),
  host = $("#blocks"),
  source = $("#source"),
  viewport = $("#scroll");
const md = window.markdownit({
  html: false,
  linkify: false,
  typographer: false,
});
const prefix = "buro:doc:",
  sessionKey = "buro:active",
  icons = () => window.lucide?.createIcons();
const icon = (n) => '<i aria-hidden="true" data-lucide="' + n + '"></i>';
const docs = new Map(),
  history = new Map(),
  revision = new Map();
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
try {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(prefix)) continue;
    const d = JSON.parse(localStorage.getItem(k));
    if (typeof d?.body === "string" && d.id && typeof d.name === "string") {
      docs.set(d.id, d);
      revision.set(d.id, d.updated);
    }
  }
  doc =
    docs.get(localStorage.getItem(sessionKey)) || docs.values().next().value;
} catch {
  loaded = false;
}
if (!doc) {
  const e = examples.spec;
  doc = newDoc(e.name, e.body, e.label);
  docs.set(doc.id, doc);
}
function save() {
  clearTimeout(timer);
  try {
    const k = prefix + doc.id,
      raw = localStorage.getItem(k);
    if (raw) {
      const old = JSON.parse(raw);
      if (old.updated !== revision.get(doc.id)) {
        const conflict = newDoc(
          doc.name.replace(/\.md$/i, "") + " (копия).md",
          doc.body,
          doc.kind,
        );
        conflict.style = doc.style;
        docs.set(old.id, old);
        revision.set(old.id, old.updated);
        doc = conflict;
        docs.set(doc.id, doc);
        notice("Файл изменён в другой вкладке. Ваши правки сохранены в копии.");
        nav();
      }
    }
    doc.updated = Date.now();
    localStorage.setItem(prefix + doc.id, JSON.stringify(doc));
    revision.set(doc.id, doc.updated);
    localStorage.setItem(sessionKey, doc.id);
    $("#save").textContent = "Сохранено на устройстве";
  } catch {
    $("#save").textContent = "Локальное сохранение недоступно · скачайте .md";
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
function parse() {
  const starts = [0];
  for (const m of doc.body.matchAll(/\r\n|\r|\n/g))
    starts.push(m.index + m[0].length);
  const tokens = md.parse(doc.body, {}),
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
      rawEnd = starts[t.map[1]] ?? doc.body.length;
    let end = rawEnd;
    const tail = doc.body.slice(start, end).match(/(?:\r\n|\n|\r)$/);
    if (tail) end -= tail[0].length;
    res.push({
      t,
      tokens: tokens.slice(i, j + 1),
      start,
      end,
      text: doc.body.slice(start, end),
    });
    i = j;
  }
  return res;
}
function nav() {
  const files = $("#files");
  files.replaceChildren();
  for (const d of docs.values()) {
    const b = document.createElement("button");
    b.className = "file";
    b.setAttribute("aria-current", String(d.id === doc.id));
    b.innerHTML = icon("file-text") + '<span class="file-name"></span>';
    b.lastChild.textContent = d.name;
    b.title = d.name;
    b.onclick = () => switchDoc(d);
    files.append(b);
  }
  $("#filename").textContent = doc.name;
  $("#kind").textContent = doc.kind;
  icons();
}
function switchDoc(d) {
  flush();
  save();
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
      : 'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  );
  p.style.setProperty("--doc-size", (Number(s.size) || 16) + "px");
  p.style.setProperty(
    "--doc-accent",
    /^#[a-f\d]{6}$/i.test(s.accent) ? s.accent : "#6353bb",
  );
  p.style.setProperty("--doc-leading", Number(s.leading) || 1.65);
}
function render() {
  editor = tableEdit = null;
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
      box.innerHTML =
        '<div class="diagram-card"><div class="diagram-title">' +
        icon("workflow") +
        '<span></span><span class="spacer"></span><button>' +
        icon("sliders-horizontal") +
        'Изменить</button></div><div class="graph-bg"></div></div>';
      box.querySelector(".diagram-title span").textContent =
        g.title || "Блок-схема";
      box.querySelector(".graph-bg").append(draw(g));
      const edit = () => {
        if (mode === "read") return;
        flush();
        resetModal();
        const entry = parts[i];
        graphEditor(g, modal, (next) => {
          patch(entry.start, entry.end, fence(next));
          render();
        });
      };
      box.querySelector("button").onclick = edit;
      box.ondblclick = edit;
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
  ta.setAttribute("aria-label", "Редактировать блок Markdown");
  ta.value = p.text;
  editor = { i, ta, baseline: p.text, start: p.start, end: p.end };
  const toolbar = document.createElement("div");
  toolbar.className = "inline-tools";
  for (const [label, mark, symbol] of [
    ["Полужирный", "**", "bold"],
    ["Курсив", "*", "italic"],
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
  modal.onclick = null;
  modal.oncancel = null;
  modal.className = "";
  modal.replaceChildren();
}
function dialog(title, html) {
  flush();
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
  if (!modal.open) modal.showModal();
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
    option("md", "Скачать Markdown (.md)", "file-text") +
      option("pdf", "Печать / сохранить PDF", "printer"),
  );
  b.onclick = (e) => {
    const id = e.target.closest("[data-id]")?.dataset.id;
    if (!id) return;
    modal.close();
    if (id === "md") download(doc.name, doc.body);
    else printDoc();
  };
}
function styleDialog() {
  const s = doc.style || {};
  const b = dialog(
    "Оформление документа",
    '<label>Шрифт<select id="font"><option value="sans">Без засечек</option><option value="serif">С засечками</option></select></label><label>Размер текста<select id="font-size">' +
      [14, 16, 18, 20].map((v) => "<option>" + v + "</option>").join("") +
      '</select></label><label>Цвет акцента<input type="color" id="accent"></label><button class="primary">Применить</button>',
  );
  $("#font").value = s.font || "sans";
  $("#font-size").value = s.size || 16;
  $("#accent").value = s.accent || "#6353bb";
  b.querySelector("button").onclick = () => {
    doc.style = {
      font: $("#font").value,
      size: Number($("#font-size").value),
      accent: $("#accent").value,
    };
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
const actions = {
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
  rename: () => {
    const b = dialog(
        "Имя файла",
        '<label>Название<input></label><button class="primary">Сохранить</button>',
      ),
      inp = b.querySelector("input");
    inp.value = doc.name;
    b.querySelector("button").onclick = () => {
      doc.name = nameOf(inp.value);
      nav();
      save();
      modal.close();
    };
  },
};
document.addEventListener("click", (e) => {
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
  if (modal.open) return;
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
    undo(e.shiftKey);
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
window.addEventListener("pagehide", () => {
  if (tableEdit) finishCell();
  save();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (tableEdit) finishCell(true);
    save();
  }
});
nav();
render();
save();
if (!loaded) notice("Не удалось восстановить часть локальных данных");
