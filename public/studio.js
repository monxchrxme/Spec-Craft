import {
  paintDocumentStyle,
  styleControls,
  templateStyle,
} from "./document-style.js";
import { documentParts } from "./document-parts.js";
import { readProject } from "./project-import.js";
import { sourceWorkspace } from "./source-workspace.js";
import { readTemplates, restoreTemplates, templateTools } from "./templates.js";
import { imageSizes, imageWidthMarkdown } from "./images.js";
import { imageCropForm, imageInspector } from "./image-editor.js";
import {
  coloredHighlights,
  finishEditingKey,
  formatSelection,
  highlightColors,
  highlightSelection,
  wrapTypedSelection,
} from "./formatting.js";
import { latex, normalizeMathDelimiters, paintMath } from "./math.js";
import {
  isMermaid,
  keepMermaidImage,
  mermaidBlocks,
  mermaidControls,
  mermaidMarkdown,
  paintMermaid,
  updateMermaidCard,
} from "./mermaid.js";
import {
  drawingControls,
  drawingFence,
  drawingPresentation,
  editDrawing,
  excalidrawBlocks,
  isExcalidraw,
  paintDrawings,
  readDrawing,
} from "./excalidraw.js";
import { setTaskChecked, taskLists } from "./task-lists.js";
import { makeShare, reviewTargets, showReview } from "./review.js";
import {
  blockAnchor,
  resolveAnchor,
  selectedTextAnchor,
  showAnchor,
  sourceTextAnchor,
  workflowSections,
} from "./review-anchors.js";
import {
  collaborationRequest,
  liveSession,
  roleLabels,
} from "./collaboration.js";
import { mergeDocument, sameSnapshot, snapshotOf } from "./merge-document.js";
import { sharePanel } from "./share-panel.js";
import { participantName, presencePanel, presenceSession } from "./presence.js";
import { enableWikiSuggestions } from "./wiki-suggestions.js";
import { wikiLinks, specIndex } from "./spec-index.js";
import { specPanels } from "./spec-panels.js";
import {
  diagramView,
  diagramViewport,
  restoreDiagramViewport,
} from "./diagram-view.js";
import {
  dragOrder,
  headingSpan,
  outlineHierarchy,
  removeMarkdownBlocks,
  reorderMarkdown,
} from "./block-order.js";
import { graphEditor } from "./graph-editor.js";
import { normalize, escapeHtml as esc } from "./graph.js";
import { examples, blocksToInsert, fence, aiPrompt } from "./documents.js";
import { formatPdfRules, pdfRules } from "./pdf-rules.js";
import { pdfPreview, printPdf } from "./pdf-preview.js";
import {
  bibliographyEntries,
  materializeToc,
  bindTocExceptions,
  formatHeadingIdentity,
  headingInline,
  isSpeakerNotes,
  plainHeading,
  portableBlocks,
} from "./portable-blocks.js";
import { isProjectTree } from "./project-tree.js";
import {
  bibliographyEditor,
  projectTreeEditor,
  tocControls,
} from "./document-block-editors.js";
import {
  mermaidPresentation,
  setMermaidPresentation,
} from "./mermaid-presentation.js";
import { highlightCode } from "./code-highlight.js";
import { enablePanelResize } from "./panel-width.js";
import {
  enableSidebarPanes,
  enableSidebarSearch,
  highlightSidebarContent,
  highlightSidebarMatches,
  sidebarSearchPattern,
} from "./sidebar-navigation.js";
import { mergeFolders, readFolders } from "./workspace-folders.js";
import {
  activeWorkspace, activeWorkspaceKey, isWorkspaceSource, readWorkspace, workspaceKeys, writeWorkspace,
} from "./private-workspace-storage.js";
import { privateRequest, personalSync } from "./private-sync.js";
import { addLocalWorkspace } from "./private-workspace-model.js";
import { privateSyncPanel } from "./private-sync-panel.js";
import { workspaceFileActions } from "./workspace-file-actions.js";
import {
  applyTableWidths,
  automaticColumnWidths,
  enableTableResize,
  isColumnBoundary,
  readColumnWidths,
  setTableWidthMarker,
  tableWidthMarker,
  tableWidths,
} from "./table-widths.js";
import {
  cellLineBreaks,
  cellSourceOffset,
  editableCellText,
  placeCellCaret,
  tableCellPoint,
} from "./table-editing.js";
import { reorderTable, tableOrderControls } from "./table-order.js";
const $ = (s) => document.querySelector(s),
  modal = $("#modal"),
  host = $("#blocks"),
  source = $("#source"),
  viewport = $("#scroll"),
  toolbar = $("#workspace-toolbar"),
  fileSearch = $("#files-search"),
  outlineSearch = $("#outline-search");
const md = window
  .markdownit({
    html: false,
    linkify: false,
    typographer: false,
    highlight: highlightCode,
  })
  .use(window.markdownitMark)
  .use(coloredHighlights)
  .use(wikiLinks)
  .use(latex)
  .use(mermaidBlocks)
  .use(excalidrawBlocks)
  .use(taskLists)
  .use(imageSizes)
  .use(pdfRules)
  .use(tableWidths)
  .use(cellLineBreaks)
  .use(portableBlocks);
const workspaceId = activeWorkspace();
const storageKeys = workspaceKeys(workspaceId);
const prefix = storageKeys.docs,
  folderStorageKey = storageKeys.folders,
  sessionKey = storageKeys.active,
  toolbarKey = "buro:topbar-collapsed",
  mobileLayout = matchMedia("(max-width: 760px)"),
  icons = () => window.lucide?.createIcons();
for (const [id, item] of Object.entries(highlightColors))
  document.documentElement.style.setProperty("--marker-" + id, item.color);
const icon = (n) => '<i aria-hidden="true" data-lucide="' + n + '"></i>';
const docs = new Map(),
  history = new Map(),
  savedRecords = new Map();
const fileActionsUI = workspaceFileActions($(".documents-wrap"), {
  open: (id) => switchDoc(docs.get(id)),
  rename: renameSidebarItem,
  move: moveFilesToFolder,
});
let folders = [];
const foldedFolders = new Set();
try {
  folders = readFolders(JSON.parse(localStorage.getItem(folderStorageKey)));
  const folds = JSON.parse(localStorage.getItem("buro:folder-folds"));
  if (Array.isArray(folds)) folds.forEach((id) => foldedFolders.add(id));
} catch {
  // Documents remain accessible in the root if folder metadata is unavailable.
}
let doc,
  mode = "edit",
  parts = [],
  selected = 0,
  editor = null,
  tableEdit = null,
  timer,
  feedbackTimer,
  loaded = true,
  expandAll = false,
  liveEdit = null,
  privateSync;
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
let firstVisit = !workspaceId;
try {
  firstVisit = !workspaceId && localStorage.getItem(sessionKey) === null;
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
  privateSync?.queue();
}
function save() {
  clearTimeout(timer);
  if (liveEdit) {
    liveEdit.client?.queue();
    return true;
  }
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
        delete doc.collaboration;
        notice("Файл изменён в другой вкладке. Ваши правки сохранены в копии.");
        docs.set(doc.id, doc);
        nav();
      }
      writeRecord(doc);
    }
    localStorage.setItem(sessionKey, doc?.id || "");
    $("#save").textContent = "";
    return true;
  } catch {
    $("#save").textContent = "Локальное сохранение недоступно · скачайте .md";
    return false;
  }
}
function updateWordcount() {
  const plain = doc.body
    .replace(/^`{3,}(?:studio-diagram|excalidraw)[^\n]*\n[\s\S]*?^`{3,}\s*$/gim, "")
    .replace(/data:image\/[a-z]+;base64,[A-Za-z\d+/=]+/gi, "");
  $("#wordcount").textContent =
    (plain.match(/[\p{L}\p{N}]+/gu) || []).length + " слов";
}
function changed() {
  updateWordcount();
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
const parse = (body = doc.body) => documentParts(md, body);
function updateDocumentLabel() {
  const label = typeof doc?.kind === "string" ? doc.kind : "";
  const text = $("#kind");
  const button = $("[data-action=edit-doc-label]");
  text.textContent = label;
  text.hidden = mode !== "read" || !label;
  button.firstElementChild.textContent = label || "Добавить надпись";
  button.hidden = mode === "read";
  $(".doc-label-stroke").hidden = !label;
}
function filterFiles() {
  const pattern = sidebarSearchPattern(fileSearch);
  let hasMatch = false;
  for (const row of $("#files").querySelectorAll("[data-document-row]")) {
    const file = row.firstElementChild;
    const match = highlightSidebarMatches(
      file.lastElementChild,
      file.title,
      pattern,
    );
    row.hidden = Boolean(pattern) && !match;
    if (!row.hidden) hasMatch = true;
  }
  for (const entry of [...$("#files").querySelectorAll(".folder-entry")].reverse()) {
    const [row, contents] = entry.children;
    const matching = [...contents.children].some((child) => !child.hidden);
    const expanded = pattern ? matching : !foldedFolders.has(entry.dataset.folder);
    entry.hidden = Boolean(pattern) && !matching;
    contents.hidden = !expanded;
    row.firstElementChild.setAttribute("aria-expanded", String(expanded));
  }
  $("#files-empty").hidden = !pattern || hasMatch;
}
function nav() {
  const files = $("#files");
  files.replaceChildren();
  const levels = new Map([["", files]]);
  for (const folder of folders) {
    const entry = document.createElement("div");
    entry.className = "folder-entry";
    entry.dataset.folder = folder.id;
    const row = document.createElement("div");
    row.className = "file-row";
    const button = document.createElement("button");
    button.className = "file folder-toggle";
    button.innerHTML = '<span class="folder-caret">' + icon("chevron-right") +
      "</span>" + icon("folder") + '<span class="file-name"></span>';
    button.querySelector(".file-name").textContent = folder.name;
    button.title = folder.name;
    button.onclick = () => {
      if (fileSearch.value.trim()) return;
      if (foldedFolders.has(folder.id)) foldedFolders.delete(folder.id);
      else foldedFolders.add(folder.id);
      try {
        localStorage.setItem("buro:folder-folds", JSON.stringify([...foldedFolders]));
      } catch {
        // The folder remains folded in this tab.
      }
      filterFiles();
    };
    row.append(
      button,
      fileMenu("Действия с папкой " + folder.name, "folder:" + folder.id, () =>
        folderActions(folder.id),
      ),
    );
    const contents = document.createElement("div");
    contents.className = "folder-contents";
    entry.append(row, contents);
    (levels.get(folder.parentId) || files).append(entry);
    levels.set(folder.id, contents);
  }
  for (const d of availableDocs()) {
    const b = document.createElement("button");
    b.className = "file";
    b.setAttribute("aria-current", String(d.id === doc?.id));
    b.innerHTML = icon("file-text") + '<span class="file-name"></span>';
    b.title = d.name;
    b.draggable = true;
    const row = document.createElement("div");
    row.className = "file-row";
    row.dataset.documentRow = d.id;
    row.append(
      b,
      fileMenu("Действия с файлом " + d.name, "file:" + d.id, () =>
        fileActions(d.id),
      ),
    );
    (levels.get(d.folderId) || files).append(row);
  }
  filterFiles();
  fileActionsUI.paint();
  $("#filename").textContent = doc?.name || "";
  updateDocumentLabel();
  $("#trash-count").textContent =
    [...docs.values()].filter((d) => d.trashed).length || "";
  for (const b of document.querySelectorAll(
    '[data-action="ai"],[data-action="style"],[data-action="export"],[data-action="trace"],[data-action="links"],[data-action="versions"],[data-action="share"],#filename',
  ))
    b.disabled = !doc;
  icons();
}
function fileMenu(label, key, action) {
  const menu = document.createElement("button");
  menu.className = "file-menu";
  menu.title = label;
  menu.setAttribute("aria-label", label);
  menu.innerHTML = icon("ellipsis");
  bindPanelButton(menu, key);
  menu.onclick = () => togglePanel(key, action);
  return menu;
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
  expandAll = false;
  selected = 0;
  outlineScrollPosition = undefined;
  document.body.classList.remove("show-side");
  render();
  nav();
  viewport.scrollTop = source.scrollTop = 0;
  save();
}
const outlineFolds = new Map();
let outlineScrollPosition;
function foldedSections(id) {
  if (!outlineFolds.has(id)) {
    let keys;
    try {
      keys = JSON.parse(localStorage.getItem("buro:outline:" + id));
    } catch {
      // Folding is still available during the current session.
    }
    outlineFolds.set(id, new Set(Array.isArray(keys) ? keys : []));
  }
  return outlineFolds.get(id);
}
function outline() {
  const panel = $("#outline");
  panel.replaceChildren();
  const id = doc?.id;
  const folded = id ? foldedSections(id) : new Set();
  const headings = outlineHierarchy(parts);
  const entries = new Map();
  const toggleAll = $("#outline-toggle-all");
  const searchToggle = $("#outline-search-toggle");
  const empty = $("#outline-empty");
  const remove = $("#outline-remove");
  const chosen = new Set();
  let selectionAnchor;
  const visible = () => headings.filter((heading) => !entries.get(heading).row.hidden);
  function paintSelection() {
    for (const [heading, { button }] of entries)
      if (mode === "edit")
        button.setAttribute("aria-pressed", String(chosen.has(heading)));
    remove.hidden = mode !== "edit" || !chosen.size;
  }
  function selectHeading(heading, event) {
    if (event.shiftKey && selectionAnchor) {
      const order = visible();
      const from = order.indexOf(selectionAnchor);
      const to = order.indexOf(heading);
      if (from >= 0 && to >= 0) {
        if (!event.metaKey && !event.ctrlKey) chosen.clear();
        for (const item of order.slice(Math.min(from, to), Math.max(from, to) + 1))
          chosen.add(item);
        paintSelection();
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      if (chosen.has(heading)) chosen.delete(heading);
      else chosen.add(heading);
    } else {
      chosen.clear();
      chosen.add(heading);
    }
    selectionAnchor = heading;
    paintSelection();
  }
  function deleteSections(items) {
    const spans = items.map(({ index }) => headingSpan(parts, index));
    if (!spans.length) return;
    const start = Math.min(...spans.map(([first]) => first));
    removeBlocks(spans, start);
    const remaining = [...panel.querySelectorAll(".outline-row:not([hidden]) > .outline-item")];
    (remaining.find((item) => Number(item.dataset.idx) >= start) ??
      remaining.at(-1) ?? $("#outline-section-toggle")).focus({ preventScroll: true });
  }
  remove.onclick = () => deleteSections(visible().filter((heading) => chosen.has(heading)));
  panel.onkeydown = (event) => {
    if (mode !== "edit" || event.isComposing || event.altKey) return;
    const heading = headings.find((item) => entries.get(item).button === event.target);
    if (!heading) return;
    if (["Backspace", "Delete"].includes(event.key) && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      if (!event.repeat)
        deleteSections(chosen.has(heading) ? visible().filter((item) => chosen.has(item)) : [heading]);
    } else if (["ArrowUp", "ArrowDown"].includes(event.key)) {
      const order = visible();
      const next = order[order.indexOf(heading) + (event.key === "ArrowUp" ? -1 : 1)];
      if (!next) return;
      event.preventDefault();
      if (event.shiftKey) selectionAnchor ??= heading;
      selectHeading(next, event);
      entries.get(next).button.focus();
    } else if (event.key === "Escape" && chosen.size) {
      chosen.clear();
      selectionAnchor = undefined;
      paintSelection();
    }
  };
  const branches = headings.filter((heading) => heading.hasChildren);
  const canCollapse = () =>
    branches.some((heading) => !heading.parent && !folded.has(heading.key));
  function saveFolds() {
    applyFolds();
    try {
      localStorage.setItem("buro:outline:" + id, JSON.stringify([...folded]));
    } catch {
      // The visible outline remains usable.
    }
  }
  toggleAll.onclick = () => {
    const collapse = canCollapse();
    for (const { key } of branches) {
      if (collapse) folded.add(key);
      else folded.delete(key);
    }
    saveFolds();
  };
  function applyFolds() {
    const pattern = sidebarSearchPattern(outlineSearch);
    const matches = new Set();
    for (const heading of headings) {
      const { label, html } = entries.get(heading);
      label.innerHTML = html;
      if (!highlightSidebarContent(label, pattern)) continue;
      for (
        let entry = heading;
        entry && !matches.has(entry);
        entry = entry.parent
      )
        matches.add(entry);
    }
    panel.classList.toggle("is-filtering", Boolean(pattern));
    toggleAll.disabled = Boolean(pattern) || !branches.length;
    searchToggle.disabled = outlineSearch.hidden && !headings.length;
    empty.hidden = pattern ? matches.size > 0 : headings.length > 0;
    empty.textContent = pattern
      ? "Разделы не найдены."
      : doc
        ? "В документе нет заголовков."
        : "Нет открытого документа.";
    toggleAll.title = canCollapse()
      ? "Свернуть все подразделы"
      : "Развернуть все подразделы";
    toggleAll.setAttribute("aria-label", toggleAll.title);
    for (const heading of headings) {
      const { row, toggle } = entries.get(heading);
      const parent = heading.parent;
      row.hidden = pattern
        ? !matches.has(heading)
        : Boolean(
            parent && (entries.get(parent).row.hidden || folded.has(parent.key)),
          );
      if (row.hidden) chosen.delete(heading);
      if (!toggle) continue;
      const expanded = !folded.has(heading.key);
      const label =
        (expanded ? "Свернуть подразделы: " : "Развернуть подразделы: ") +
        heading.title;
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    }
    paintSelection();
    void paintMath(panel);
    highlight(
      (mode === "edit" || mode === "read") &&
        outlineScrollPosition === undefined
        ? visibleBlock()
        : selected,
    );
  }
  for (const heading of headings) {
    const { index, key } = heading;
    const row = document.createElement("div");
    row.className = "outline-row";
    row.style.setProperty(
      "--outline-indent",
      Math.min(heading.depth, 5) * 9 + "px",
    );
    const toggle = heading.hasChildren
      ? document.createElement("button")
      : null;
    if (toggle) {
      toggle.type = "button";
      toggle.className = "outline-toggle";
      toggle.innerHTML = icon("chevron-right");
      toggle.onclick = () => {
        if (folded.has(key)) folded.delete(key);
        else folded.add(key);
        saveFolds();
      };
      row.append(toggle);
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "outline-item";
    b.dataset.idx = index;
    const label = document.createElement("span");
    label.className = "outline-label";
    const inline = parts[index].tokens.find((token) => token.type === "inline");
    const html = md.renderer.renderInline(headingInline(inline), md.options, {}) ||
      md.utils.escapeHtml(heading.title);
    const plain = plainHeading(inline) || "Заголовок";
    b.setAttribute("aria-label", plain);
    b.append(label);
    if (mode === "edit") b.append(sortGrip("Перетащить раздел", false));
    b.onclick = (event) => {
      if (event.target.closest("[data-order-grip]")) return;
      flush();
      if (!b.isConnected) {
        const replacement = outlineHierarchy(parts).find((item) => item.key === key);
        panel.querySelector('[data-idx="' + replacement?.index + '"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, shiftKey: event.shiftKey,
            metaKey: event.metaKey, ctrlKey: event.ctrlKey }),
        );
        return;
      }
      if (mode === "edit") {
        selectHeading(heading, event);
        if (event.shiftKey || event.metaKey || event.ctrlKey) return;
      }
      selected = index;
      if (isSource()) {
        sourcePane.select(index);
      } else if (mode === "pdf") showPdfPreview();
      else {
        host.children[index]?.scrollIntoView({ block: "start" });
        outlineScrollPosition = viewport.scrollTop;
      }
      document.body.classList.remove("show-side");
      highlight(index);
    };
    row.append(b);
    entries.set(heading, { row, toggle, button: b, label, html });
    panel.append(row);
  }
  outlineSearch.oninput = () => {
    $("#outline-scroll").scrollTop = 0;
    applyFolds();
  };
  applyFolds();
}
function highlight(i) {
  const headings = [...$("#outline").querySelectorAll(".outline-item")];
  const active = headings.findLast(
    (button) => !button.parentElement.hidden && Number(button.dataset.idx) <= i,
  );
  headings.forEach((button) =>
    button.classList.toggle("active", button === active),
  );
}
function sortGrip(label, block) {
  const grip = document.createElement(block ? "button" : "span");
  grip.className = block ? "block-grip" : "outline-grip";
  grip.dataset.orderGrip = "";
  grip.title = label + " · Alt+↑ / Alt+↓";
  if (block) {
    grip.type = "button";
    grip.setAttribute("aria-label", label);
  } else grip.setAttribute("aria-hidden", "true");
  grip.innerHTML = icon("grip-vertical");
  grip.onclick = (event) => event.stopPropagation();
  return grip;
}
function prepareBlockChange(index) {
  if (mode !== "edit" || modal.open || !parts[index]) return null;
  finishDrawing();
  let offset = parts[index].start;
  if (inlineBibliography) {
    const { origin } = inlineBibliography.state;
    const length = doc.body.length;
    closeBibliography();
    if (origin < index) offset += doc.body.length - length;
  }
  if (editor) {
    liveBlock();
    if (editor.i < index) offset += editor.end - parts[editor.i].end;
  }
  const cell = tableEdit;
  if (cell) {
    const length = doc.body.length;
    finishCell();
    if (cell.i < index) offset += doc.body.length - length;
  }
  flush();
  if (cell) render();
  const origin = parts.findIndex((part) => part.start === offset);
  return origin < 0 ? null : { origin, id: doc.id, body: doc.body };
}
function moveOrder(state, index, below, section) {
  if (doc.id !== state.id || doc.body !== state.body) {
    notice("Документ изменился. Перетащите блок ещё раз.");
    return;
  }
  const [start, end] = section
    ? headingSpan(parts, state.origin)
    : [state.origin, state.origin + 1];
  const boundary = below
    ? section
      ? headingSpan(parts, index)[1]
      : index + 1
    : index;
  const next = reorderMarkdown(doc.body, parts, start, end, boundary);
  if (!next) return;
  setText(next.body);
  render();
  selected = Math.max(
    0,
    parts.findLastIndex((part) => part.fullStart <= next.offset),
  );
  highlight(selected);
  const destination = section
    ? $("#outline").querySelector('[data-idx="' + selected + '"]')
    : host.children[selected]?.querySelector(".block-grip");
  destination?.scrollIntoView({ block: "nearest" });
  destination?.focus({ preventScroll: true });
}
const blockSorting = dragOrder({
  container: host,
  scroller: viewport,
  item: ":scope > .block",
  handle: ".block-grip",
  prepare: prepareBlockChange,
  targets: () => parts.map((_, index) => index),
  move: (state, index, below) => moveOrder(state, index, below, false),
});
const outlineSorting = dragOrder({
  container: $("#outline"),
  scroller: $("#outline-scroll"),
  item: ".outline-row:not([hidden]) > .outline-item",
  handle: ".outline-grip",
  prepare: (index) =>
    outlineSearch.value.trim() ? null : prepareBlockChange(index),
  targets: (index) =>
    parts.flatMap((part, i) =>
      part.t.type === "heading_open" && part.t.tag === parts[index].t.tag
        ? [i]
        : [],
    ),
  move: (state, index, below) => moveOrder(state, index, below, true),
});
function visibleBlock() {
  const top = viewport.getBoundingClientRect().top + 55;
  let index = 0;
  for (const block of host.children) {
    if (block.hidden) continue;
    if (block.getBoundingClientRect().top > top) break;
    index = Number(block.dataset.idx);
  }
  return index;
}
function insertionBlock() {
  if (isSource()) return sourcePane.cursorBlock();
  const current = host.children[selected]?.getBoundingClientRect();
  const bounds = viewport.getBoundingClientRect();
  return current && current.bottom > bounds.top && current.top < bounds.bottom
    ? selected
    : visibleBlock();
}
viewport.onscroll = () => {
  if (Math.abs(viewport.scrollTop - (outlineScrollPosition ?? -10)) < 1) return;
  outlineScrollPosition = undefined;
  if (mode === "edit" || mode === "read") highlight(visibleBlock());
};
viewport.addEventListener("click", (event) => {
  if (
    editor &&
    (event.target === viewport ||
      event.target === host ||
      event.target.matches(".paper, .doc-label, .doc-label-stroke, #kind"))
  )
    flush();
});
function updateAutocorrect(field) {
  const enabled =
    doc?.style?.spellcheck === true &&
    field.getAttribute("spellcheck") !== "false";
  field.setAttribute("autocorrect", enabled ? "on" : "off");
  if (enabled) field.removeAttribute("autocapitalize");
  else field.setAttribute("autocapitalize", "none");
}
$("#workspace").addEventListener("focusin", ({ target }) => {
  if (
    target.matches(
      "textarea, input:is(:not([type]), [type=text]), [contenteditable=true], [contenteditable=plaintext-only]",
    )
  )
    updateAutocorrect(target);
});
function styles() {
  const p = $(".paper"),
    s = doc.style || {};
  paintDocumentStyle(p, s);
  $("#workspace").spellcheck = s.spellcheck === true;
  $("#workspace").setAttribute(
    "writingsuggestions",
    String(s.spellcheck === true),
  );
  updateAutocorrect(source);
  host.querySelectorAll("[contenteditable]").forEach(updateAutocorrect);
  source.wrap = s.wrap === false ? "off" : "soft";
}
let inlineGraph = null;
let inlineDrawing = null;
let inlineBibliography = null;
let graphTransition = 0;
let renderedDocumentId;
let activeTableOrder;
const diagramCards = () =>
  [...host.querySelectorAll(".diagram-card:not(.inline-graph)")].filter(
    (card) => card.setExpanded,
  );
const isExpanded = (card) => card.classList.contains("diagram-expanded");
function updateExpandButton() {
  const button = $("[data-action=expand-diagrams]");
  const cards = diagramCards();
  const allExpanded =
    cards.every(isExpanded) && (!inlineGraph || inlineGraph.expanded);
  button.hidden = !cards.length && !inlineGraph;
  button.lastChild.textContent = allExpanded
    ? "Свернуть все схемы"
    : "Развернуть все схемы";
}
function toggleAllDiagrams() {
  const cards = diagramCards();
  expandAll =
    cards.some((card) => !isExpanded(card)) ||
    (inlineGraph !== null && !inlineGraph.expanded);
  if (inlineGraph) {
    keepGraphPosition(inlineGraph, () => {
      cards.forEach((card) => card.setExpanded(expandAll));
      setGraphExpanded(inlineGraph, expandAll);
    });
  } else cards.forEach((card) => card.setExpanded(expandAll));
  updateExpandButton();
}
const blockTop = (box) =>
  box.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
function restoreBlockTop(box, top) {
  const delta = blockTop(box) - top;
  if (Math.abs(delta) > 0.5) viewport.scrollTop += delta;
}
function suspendGraphScrollAnchoring() {
  const current = ++graphTransition;
  viewport.dataset.graphTransition = "";
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (current === graphTransition) delete viewport.dataset.graphTransition;
    }),
  );
}
function setGraphExpanded(session, value) {
  session.expanded = value;
  session.panel.classList.toggle("diagram-expanded", value);
  const button = session.panel.querySelector("[data-view-expand]");
  const label = value ? "Свернуть" : "Развернуть";
  button.lastElementChild.textContent = label;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.setAttribute("aria-expanded", String(value));
  session.panel.querySelector(".frame-grip").title = value
    ? "Потяните для изменения высоты"
    : "Потяните для изменения ширины и высоты";
}
function keepGraphPosition(session, change) {
  const box = session.panel.parentElement;
  const stage = session.panel.querySelector(".graph-stage");
  const top = blockTop(box);
  const position = diagramViewport(stage);
  suspendGraphScrollAnchoring();
  change();
  restoreDiagramViewport(stage, position);
  restoreBlockTop(box, top);
}
function closeGraph(restore = true) {
  if (!inlineGraph) return;
  const session = inlineGraph;
  const box = session.panel.parentElement;
  const top = restore && box?.isConnected ? blockTop(box) : null;
  const position =
    top === null
      ? null
      : diagramViewport(session.panel.querySelector(".graph-stage"));
  if (top !== null) suspendGraphScrollAnchoring();
  session.editor?.publish();
  inlineGraph = null;
  const dock = $("#graph-dock");
  dock.hidden = true;
  const props = dock.querySelector(".props");
  props.inert = false;
  props.onkeydown = null;
  props.replaceChildren();
  if (top !== null) {
    const p = parts[session.index];
    if (p) {
      const restored = block(p, session.index, session.expanded);
      box.replaceWith(restored);
      restoreDiagramViewport(
        restored.querySelector(".diagram-window"),
        position,
      );
      updateExpandButton();
      restoreBlockTop(restored, top);
    }
    icons();
  }
}
const isSource = () => mode === "source" || mode === "latex";
const sourcePane = sourceWorkspace({
  source,
  requestPdf,
  current: () => ({ mode, body: doc?.body || "", id: doc?.id, parts }),
  choose: (i) => {
    selected = i;
    highlight(i);
  },
  renderBlock: block,
  paint: (blocks) => {
    icons();
    for (const block of blocks) {
      void paintMath(block);
      void paintMermaid(block);
      paintDrawings(block);
    }
  },
});
function diagramViewKey(card) {
  if (card.matches("[data-mermaid]")) {
    return "mermaid:" + card.querySelector(".mermaid-source code").textContent;
  }
  const index = Number(card.closest(".block")?.dataset.idx);
  return parts[index]?.text;
}
function captureDiagramViews() {
  const views = new Map();
  if (renderedDocumentId !== doc?.id) return views;
  // Keep separate entries for diagrams with identical source.
  for (const card of diagramCards()) {
    const key = diagramViewKey(card);
    if (!views.has(key)) views.set(key, []);
    views.get(key).push(card);
  }
  return views;
}
function render() {
  activeTableOrder?.cancel();
  activeTableOrder = null;
  const scrollTop = viewport.scrollTop;
  const previousDiagrams = captureDiagramViews();
  finishDrawing(true, false);
  renderedDocumentId = doc?.id;
  closeGraph(false);
  inlineBibliography = null;
  editor = tableEdit = null;
  $("#empty-workspace").hidden = !!doc;
  $(".paper").hidden = !doc || mode === "pdf";
  $(".controls").hidden = !doc;
  if (!doc) {
    pdfViewer.hide();
    parts = [];
    host.replaceChildren();
    sourcePane.show(false);
    source.value = "";
    outline();
    $("#wordcount").textContent = "";
    return;
  }
  updateDocumentLabel();
  parts = parse();
  const bound = bindTocExceptions(doc.body, parts);
  if (bound !== doc.body) {
    setText(bound, false);
    parts = parse();
  }
  selected = Math.min(selected, Math.max(0, parts.length - 1));
  styles();
  document.body.classList.toggle("read-view", mode === "read");
  $("#workspace")
    .querySelectorAll("[data-mode]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode)),
    );
  $(".add-end").hidden = mode !== "edit";
  $("[data-action=insert]").disabled = mode === "read" || mode === "pdf";
  $(".controls").classList.toggle("pdf-mode", mode === "pdf");
  host.hidden = isSource() || mode === "pdf";
  sourcePane.show(isSource());
  if (mode === "pdf") {
    host.replaceChildren();
    showPdfPreview();
  } else if (isSource()) {
    pdfViewer.hide();
    host.replaceChildren();
  } else {
    pdfViewer.hide();
    const blocks = document.createDocumentFragment();
    parts.forEach((p, i) => blocks.append(block(p, i)));
    for (const card of blocks.querySelectorAll(".diagram-card")) {
      if (!card.setExpanded) continue;
      const previous = previousDiagrams.get(diagramViewKey(card))?.shift();
      if (!previous) continue;
      card.setExpanded(isExpanded(previous));
      if (card.matches("[data-mermaid]")) keepMermaidImage(card, previous);
    }
    host.replaceChildren(blocks);
  }
  updateExpandButton();
  outline();
  icons();
  viewport.scrollTop = scrollTop;
  void paintMath(host);
  void paintMermaid(host);
  paintDrawings(host);
  updateWordcount();
}
function removeBlocks(spans, focusIndex, { focusCanvas = false } = {}) {
  const scrollTop = viewport.scrollTop;
  setText(removeMarkdownBlocks(doc.body, parts, spans));
  selected = focusIndex;
  render();
  viewport.scrollTop = scrollTop;
  const block = focusCanvas && host.children[selected];
  if (!block) return;
  if (!block.hasAttribute("tabindex")) block.tabIndex = -1;
  block.dataset.focusAfterDelete = "";
  block.addEventListener("blur", () => delete block.dataset.focusAfterDelete, { once: true });
  block.focus({ preventScroll: true });
}

function canvasTextRange() {
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  return range.intersectsNode(host) ? range : null;
}

function canvasBlockSpan(range) {
  let first = -1, last = -1;
  for (const block of host.children) {
    if (!range.intersectsNode(block)) continue;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.data || text.parentElement.closest("button,.inline-tools,.table-tools"))
        continue;
      if (!range.intersectsNode(text) ||
        (range.startContainer === text && range.startOffset === text.length) ||
        (range.endContainer === text && range.endOffset === 0)) continue;
      last = Number(block.dataset.idx);
      if (first < 0) first = last;
      break;
    }
  }
  return first < 0 ? null : [first, last + 1];
}

function deleteBlockButton(index, label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon("trash-2");
  button.onmousedown = (event) => event.preventDefault();
  button.onclick = (event) => {
    event.stopPropagation();
    const entry = parts[index];
    if (!entry || mode !== "edit") return;
    const length = doc.body.length;
    const editingBefore =
      editor?.i < index ? editor.end - parts[editor.i].end : 0;
    const cellBefore = tableEdit?.i < index;
    flush();
    const start =
      entry.start + editingBefore + (cellBefore ? doc.body.length - length : 0);
    const nextIndex = parts.findIndex((part) => part.start === start);
    if (nextIndex < 0) return;
    removeBlocks([[nextIndex, nextIndex + 1]], nextIndex, { focusCanvas: true });
  };
  return button;
}
function block(p, i, expanded = expandAll) {
  const box = buildBlock(p, i, expanded);
  const editableMermaid = mode === "edit" && isMermaid(p.t);
  mermaidControls(box, {
    edit: mode === "edit" ? () => editMermaidCode(i) : undefined,
    presentation: editableMermaid
      ? (layout, direction, theme, card) =>
          saveMermaidPresentation(i, card, { layout, direction, theme }, true)
      : undefined,
    resize: editableMermaid
      ? (height, card) => saveMermaidPresentation(i, card, { height }, false)
      : undefined,
    expanded,
    onExpand: updateExpandButton,
  });
  if (mode === "edit") {
    for (const input of box.querySelectorAll(".task-checkbox")) input.disabled = false;
    box.append(sortGrip("Перетащить блок", true));
  }
  return box;
}
function saveMermaidPresentation(index, card, changes, repaint) {
  const raw = card.querySelector(".mermaid-source code").textContent;
  const options = { ...mermaidPresentation(raw), ...changes };
  const next = setMermaidPresentation(
    raw,
    options.layout,
    options.direction,
    options,
  );
  if (next === raw) return true;
  const state = prepareBlockChange(index);
  if (!state || parts[state.origin]?.t.content !== raw) return false;
  if (!patchStructuredBlock(state, mermaidMarkdown(next))) return false;
  if (card.isConnected)
    updateMermaidCard(card, parts[state.origin].t.content, repaint);
  else replaceStructuredView(state.origin, isExpanded(card));
  return true;
}
function editMermaidCode(index, selectExample = false) {
  editBlock(index);
  if (!editor || !isMermaid(parts[index]?.t)) return;
  const ta = editor.ta;
  const start = ta.value.indexOf("\n") + 1;
  const end = Math.max(start, ta.value.lastIndexOf("\n"));
  ta.setSelectionRange(start, selectExample ? end : start);
}
function openDrawing(index, { crop = false, fullscreen = false } = {}) {
  const state = prepareBlockChange(index);
  const token = state && parts[state.origin].t;
  if (!isExcalidraw(token)) return;
  const box = host.children[state.origin];
  const card = box?.querySelector("[data-excalidraw]");
  if (!card) return;
  try {
    const scene = readDrawing(token.content);
    const layout = drawingPresentation(scene);
    const top = blockTop(box);
    const editor = editDrawing(card, scene, {
      crop,
      fullscreen,
      save: () => finishDrawing(true, true, true),
      cancel: () => finishDrawing(false),
    });
    inlineDrawing = { card, editor, state, scene, layout };
    restoreBlockTop(box, top);
  } catch {
    notice("Не удалось открыть рисунок. Проверьте исходный блок в Markdown.");
  }
}
function finishDrawing(commit = true, restore = true, keepOpenOnError = false) {
  if (!inlineDrawing) return;
  const { card, editor, state, scene, layout } = inlineDrawing;
  if (commit) {
    try {
      const previous = JSON.stringify({ ...scene, specCraft: drawingPresentation(scene) });
      const next = editor.snapshot(layout, keepOpenOnError);
      if (!next) return;
      if (JSON.stringify(next) !== previous) {
        if (patchStructuredBlock(state, drawingFence(next))) save();
        else if (keepOpenOnError) return;
      }
    } catch {
      notice("Не удалось сохранить рисунок Excalidraw.");
      if (keepOpenOnError) return;
    }
  }
  inlineDrawing = null;
  const expanded = isExpanded(card);
  editor.stop();
  if (restore && card.isConnected) replaceStructuredView(state.origin, expanded);
}
function changeDrawing(index, card, change) {
  if (inlineDrawing?.card === card) {
    Object.assign(inlineDrawing.layout, change);
    return true;
  }
  const expanded = isExpanded(card);
  const state = prepareBlockChange(index);
  const token = state && parts[state.origin]?.t;
  if (!isExcalidraw(token)) return false;
  const scene = readDrawing(token.content);
  scene.specCraft = { ...drawingPresentation(scene), ...change };
  if (!patchStructuredBlock(state, drawingFence(scene))) return false;
  if (change.crop !== undefined || !card.isConnected)
    replaceStructuredView(state.origin, expanded);
  return true;
}
function patchStructuredBlock(state, markup) {
  if (doc?.id !== state.id || doc.body !== state.body || !parts[state.origin]) {
    notice("Блок изменился. Откройте его заново.");
    return false;
  }
  const { start, end } = parts[state.origin];
  const newline = doc.body.match(/\r\n|\r|\n/)?.[0] || "\n";
  patch(start, end, markup.replace(/\r\n|\r|\n/g, newline));
  parts = parse();
  return true;
}
function replaceStructuredView(index, expanded, previousMermaid) {
  const old = host.children[index];
  const part = parts[index];
  if (!old || !part) return;
  const top = blockTop(old);
  const replacement = block(part, index, expanded);
  keepMermaidImage(
    replacement.querySelector("[data-mermaid]"),
    previousMermaid,
  );
  old.replaceWith(replacement);
  restoreBlockTop(replacement, top);
  updateExpandButton();
  icons();
  void paintMath(replacement);
  void paintMermaid(replacement);
  paintDrawings(replacement);
}
function openStructuredBlock(index, kind) {
  const state = prepareBlockChange(index);
  if (!state) return;
  const part = parts[state.origin];
  const data =
    kind === "projectTree"
      ? isProjectTree(part.t)
      : bibliographyEntries(part.t.content);
  if (!data) return editBlock(state.origin);
  if (kind === "projectTree") {
    const panel = dialog("Структура проекта", "");
    projectTreeEditor(panel, data, (markdown) => {
      modal.close();
      if (patchStructuredBlock(state, markdown))
        replaceStructuredView(state.origin);
    });
    return;
  }
  const box = host.children[state.origin];
  const top = blockTop(box);
  selected = state.origin;
  box.replaceChildren();
  const form = bibliographyEditor(
    box,
    data,
    () => closeBibliography(),
    () => closeBibliography(false),
  );
  inlineBibliography = { state, form };
  restoreBlockTop(box, top);
  form.focus();
}
function closeBibliography(save = true) {
  if (!inlineBibliography) return;
  const { state, form } = inlineBibliography;
  inlineBibliography = null;
  if (save) patchStructuredBlock(state, form.markdown());
  replaceStructuredView(state.origin);
}
function documentBlockTools(box, part, index, kind) {
  const tools = document.createElement("div");
  tools.className = "document-block-tools";
  if (kind === "toc") {
    tocControls(tools, part.t.meta, (options, focus) => {
      const state = prepareBlockChange(index);
      if (!state) return;
      const current = parts[state.origin];
      if (current?.t.type !== "spec_toc") return;
      const bound = bindTocExceptions(doc.body, parts, {
        start: current.start,
        options,
      });
      setText(bound);
      render();
      host.children[state.origin]
        ?.querySelector(focus)
        ?.focus({ preventScroll: true });
    });
  } else {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.innerHTML = icon("square-pen");
    edit.append(
      kind === "projectTree" ? "Изменить структуру" : "Изменить список",
    );
    edit.onmousedown = (event) => event.preventDefault();
    if (kind === "projectTree") {
      const key = "project-tree:" + index;
      bindPanelButton(edit, key);
      edit.onclick = () => togglePanel(key, () => openStructuredBlock(index, kind));
    } else {
      edit.onclick = () => openStructuredBlock(index, kind);
    }
    tools.append(edit);
  }
  const copy = document.createElement("button");
  copy.type = "button";
  copy.innerHTML = icon("copy");
  copy.append("Скопировать Markdown");
  copy.onclick = async () => {
    const markdown = kind === "toc" ? part.t.meta.markdown : part.text;
    try {
      await navigator.clipboard.writeText(markdown);
      notice("Markdown скопирован");
    } catch {
      const panel = dialog("Скопировать Markdown", "");
      const field = document.createElement("textarea");
      field.readOnly = true;
      field.rows = 10;
      field.value = markdown;
      panel.append(field);
      field.focus();
      field.select();
    }
  };
  tools.append(copy);
  box.prepend(tools);
  box.append(deleteBlockButton(index, "Удалить блок", "block-remove"));
}
function buildBlock(p, i, expanded) {
  const box = document.createElement("div");
  box.className = "block";
  box.dataset.idx = i;
  box.hidden = mode !== "edit" && isSpeakerNotes(p.t);
  box.onpointerdown = () => {
    selected = i;
  };
  box.addEventListener("focusin", () => {
    selected = i;
  });
  if (p.t.type === "fence" && p.t.info.trim() === "studio-diagram") {
    try {
      const g = normalize(JSON.parse(p.t.content));
      const edit = (initialNode) => {
        if (mode !== "edit") return;
        const top = blockTop(box);
        const openedWide = isExpanded(card);
        const position = diagramViewport(card.querySelector(".diagram-window"));
        suspendGraphScrollAnchoring();
        flush();
        if (modal.open) modal.close();
        const target = host.children[i],
          panel = document.createElement("section");
        const removeButton = deleteBlockButton(i, "Удалить схему", "block-remove");
        target.replaceChildren(panel, removeButton);
        const dock = $("#graph-dock");
        dock.hidden = false;
        const session = { index: i, panel, expanded: openedWide };
        inlineGraph = session;
        selected = i;
        session.editor = graphEditor(
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
          { expanded: openedWide, zoom: position?.zoom, removeButton },
        );
        setGraphExpanded(session, openedWide);
        panel.querySelector("[data-view-expand]").onclick = () => {
          keepGraphPosition(session, () =>
            setGraphExpanded(session, !session.expanded),
          );
          updateExpandButton();
        };
        icons();
        updateExpandButton();
        if (typeof initialNode !== "string") {
          const stage = panel.querySelector(".graph-stage");
          stage.focus({ preventScroll: true });
          restoreDiagramViewport(stage, position);
          restoreBlockTop(target, top);
        }
      };
      box.openGraph = edit;
      const card = diagramView(g, {
        edit: mode === "edit" ? edit : undefined,
        expanded,
        onExpand: updateExpandButton,
        resize:
          mode === "edit"
            ? (height) => {
                const state = prepareBlockChange(i);
                const entry = state && parts[state.origin];
                if (!entry || entry.t.info !== p.t.info) return false;
                const next = normalize(JSON.parse(entry.t.content));
                next.layout = { ...next.layout, height };
                if (!patchStructuredBlock(state, fence(next))) return false;
                if (!card.isConnected)
                  replaceStructuredView(state.origin, isExpanded(card));
                return true;
              }
            : undefined,
      });
      box.append(card);
      if (mode === "edit")
        box.append(deleteBlockButton(i, "Удалить схему", "block-remove"));
      return box;
    } catch (err) {
      box.textContent = "Ошибка схемы · " + err.message;
      box.classList.add("diagram-error");
    }
  } else if (p.t.type === "table_open") {
    buildTable(box, p, i);
    return box;
  } else box.innerHTML = md.renderer.render(p.tokens, md.options, { speakerNotes: mode === "edit" });
  if (isExcalidraw(p.t)) {
    const card = box.querySelector("[data-excalidraw]");
    try {
      drawingControls(card, {
        expanded,
        onExpand: updateExpandButton,
        edit: mode === "edit" ? (options) => openDrawing(i, options) : undefined,
        change: (change) => changeDrawing(i, card, change),
      });
    } catch {
      // Invalid scene JSON still appears in the Markdown editor.
    }
    if (mode === "edit")
      box.append(deleteBlockButton(i, "Удалить рисунок", "block-remove"));
    return box;
  }
  if (mode === "edit") {
    const kind =
      p.t.type === "spec_toc"
        ? "toc"
        : p.t.type === "spec_bibliography"
          ? "bibliography"
          : isProjectTree(p.t)
            ? "projectTree"
            : "";
    if (kind) {
      documentBlockTools(box, p, i, kind);
      return box;
    }
    const paragraph = box.firstElementChild;
    const image =
      paragraph?.matches("p") &&
      paragraph.querySelector(":scope > img:only-child");
    if (image && !paragraph.textContent.trim()) {
      const initial = {
        url: image.src,
        alt: image.alt,
        title: image.title,
        width: Number(image.dataset.imageWidth) || null,
        source: p.text,
      };
      const replacePanelKey = "image:" + i;
      box.showImageSettings = imageInspector(paragraph, image, p.text, {
        reopen: (options) => {
          if (!editor && !tableEdit && !inlineGraph) return false;
          const state = imagePosition(i, initial.source);
          if (state)
            host.children[state.origin]?.showImageSettings?.(true, options);
          return true;
        },
        width: (value, open, focus) => {
          const state = imagePosition(i, initial.source);
          if (!state) return false;
          const markup = imageWidthMarkdown(initial.source, value);
          if (host.children[state.origin] !== box) {
            replaceImage(state.origin, markup, open);
            if (focus)
              host.children[state.origin]
                ?.querySelector(".image-grip")
                ?.focus({ preventScroll: true });
          } else {
            const { start, end } = parts[state.origin];
            patch(start, end, markup);
            parts = parse();
          }
          initial.width = value;
          initial.source = markup;
          return markup;
        },
        source: (value) => {
          const state = imagePosition(i, initial.source);
          if (state) replaceImage(state.origin, value, true);
        },
        replace: () =>
          togglePanel(replacePanelKey, () => {
            const state = imagePosition(i, initial.source);
            if (state) imageDialog(state.origin, initial);
          }),
      });
      bindPanelButton(box.querySelector("[data-image-replace]"), replacePanelKey);
      box.append(deleteBlockButton(i, "Удалить изображение", "block-remove"));
      return box;
    }
    box.tabIndex = 0;
    box.title = "Нажмите, чтобы редактировать";
    box.append(deleteBlockButton(i, "Удалить блок", "block-remove"));
    box.onclick = (e) => {
      if (e.target.closest("textarea,.inline-tools,.mermaid-figure,.task-checkbox")) return;
      if (canvasTextRange()?.intersectsNode(box)) return;
      if (
        e.target.closest('a[href^="#"]') ||
        (e.target.closest("a") && (e.metaKey || e.ctrlKey))
      )
        return;
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
function imagePosition(index, expected) {
  const state = prepareBlockChange(index);
  if (state && parts[state.origin]?.text === expected) return state;
  notice("Изображение изменилось. Откройте его настройки снова.");
  return null;
}
function replaceImage(index, markdown, open) {
  const { start, end } = parts[index];
  const newline = doc.body.includes("\r\n") ? "\r\n" : "\n";
  const updated = markdown.replace(/\r\n|\n/g, newline);
  if (doc.body.slice(start, end) === updated) return;
  patch(start, end, updated);
  render();
  if (open) host.children[index]?.showImageSettings?.(true);
}
function editBlock(i, selectAll = false) {
  if (editor?.i === i) return;
  flush();
  const p = parts[i],
    box = host.children[i];
  if (!p || !box) return;
  const originalMermaid = isMermaid(p.t)
    ? box.querySelector("[data-mermaid]")
    : null;
  const mermaidTop = originalMermaid ? blockTop(box) : null;
  if (originalMermaid) suspendGraphScrollAnchoring();
  selected = i;
  const ta = document.createElement("textarea");
  ta.className = "source-edit";
  updateAutocorrect(ta);
  ta.setAttribute("aria-label", "Редактировать блок Markdown");
  ta.value = p.text;
  const embeddedImage = /data:image\/[a-z]+;base64,/i.test(ta.value);
  if (embeddedImage) ta.wrap = "off";
  editor = {
    i,
    ta,
    baseline: p.text,
    start: p.start,
    end: p.end,
    expanded: originalMermaid ? isExpanded(originalMermaid) : undefined,
  };
  const toolbar = document.createElement("div");
  toolbar.className = "inline-tools";
  function finish() {
    flush();
    host.children[i]?.focus({ preventScroll: true });
  }
  const preview = document.createElement("div");
  preview.className = "math-preview";
  let previewTimer;
  function updatePreview() {
    const template = document.createElement("template");
    template.innerHTML = md.render(ta.value);
    const mermaid = template.content.querySelector("[data-mermaid]");
    keepMermaidImage(
      mermaid,
      preview.querySelector("[data-mermaid]") || originalMermaid,
    );
    if (originalMermaid && mermaid) {
      mermaid.setExpanded = (value) => {
        editor.expanded = value;
        mermaid.classList.toggle("diagram-expanded", value);
      };
      mermaid.setExpanded(editor.expanded);
    }
    preview.replaceChildren(
      ...template.content.querySelectorAll(
        "[data-tex], [data-mermaid], pre:has(> code[class^='language-'])",
      ),
    );
    preview.hidden = !preview.childElementCount;
    preview.setAttribute(
      "aria-label",
      preview.querySelector("[data-mermaid]")
        ? "Предпросмотр диаграммы Mermaid"
        : preview.querySelector("pre")
          ? "Предпросмотр кода"
          : "Предпросмотр формул",
    );
    if (!preview.hidden) {
      void paintMath(preview);
      void paintMermaid(preview, true);
      paintDrawings(preview);
    }
    if (originalMermaid) updateExpandButton();
  }
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (preview.isConnected) updatePreview();
    }, 140);
  }
  for (const [label, mark, symbol] of [
    ["Полужирный", "**", "bold"],
    ["Курсив", "*", "italic"],
    ["Зачёркнутый", "~~", "strikethrough"],
    ["Маркер", "==", "highlighter"],
    ["Строчный код", String.fromCharCode(96), "code"],
    ["Ссылка", "link", "link"],
    ["Формула в строке", "math", "sigma"],
  ]) {
    const btn = document.createElement("button");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = icon(symbol);
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = (e) => {
      e.stopPropagation();
      if (mark === "math") formatSelection(ta, "\\(", "\\)", "x^2");
      else if (mark === "link") {
        formatSelection(ta, "[", "](https://)", "текст");
        const start = ta.selectionEnd + 2;
        ta.setSelectionRange(start, start + "https://".length);
      } else if (mark === "==") highlightSelection(ta, "yellow");
      else formatSelection(ta, mark, mark, "текст");
    };
    if (mark === "==") {
      const tools = document.createElement("div");
      tools.className = "marker-tool";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.title = "Цвет маркера";
      toggle.setAttribute("aria-label", toggle.title);
      toggle.setAttribute("aria-expanded", "false");
      toggle.innerHTML = icon("chevron-down");
      const palette = document.createElement("div");
      palette.className = "highlight-palette";
      palette.setAttribute("role", "group");
      palette.setAttribute("aria-label", "Цвета маркера");
      palette.hidden = true;
      function showPalette(open) {
        palette.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
      }
      toggle.onmousedown = (e) => e.preventDefault();
      toggle.onclick = () => {
        showPalette(palette.hidden);
        if (!palette.hidden)
          palette.firstElementChild.focus({ preventScroll: true });
      };
      for (const [id, item] of Object.entries(highlightColors)) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.title = item.label;
        swatch.setAttribute("aria-label", item.label);
        swatch.style.setProperty("--swatch", item.color);
        swatch.onmousedown = (e) => e.preventDefault();
        swatch.onclick = () => {
          showPalette(false);
          highlightSelection(ta, id);
        };
        palette.append(swatch);
      }
      tools.onkeydown = (e) => {
        if (e.key === "Escape" && !palette.hidden) {
          e.stopPropagation();
          e.preventDefault();
          showPalette(false);
          ta.focus({ preventScroll: true });
        }
      };
      tools.onfocusout = () => {
        setTimeout(() => {
          if (!tools.contains(document.activeElement)) showPalette(false);
        }, 0);
      };
      tools.append(btn, toggle, palette);
      toolbar.append(tools);
    } else toolbar.append(btn);
  }
  if (liveEdit) {
    for (const [label, symbol, getTarget] of [
      ["Комментарий к выделению", "message-square-plus", liveTextSelection],
      ["Комментарий к блоку", "messages-square", liveFocusedBlock],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = icon(symbol);
      button.onpointerdown = (event) => event.preventDefault();
      button.onclick = () => {
        const target = getTarget();
        if (target) toggleLiveComments(target);
        else notice("Выделите текст в одном блоке.");
      };
      toolbar.append(button);
    }
  }
  const done = document.createElement("button");
  done.type = "button";
  done.className = "inline-done";
  done.title = "Готово · Shift+Enter";
  done.setAttribute("aria-keyshortcuts", "Shift+Enter Control+Enter Meta+Enter");
  done.innerHTML = icon("check");
  done.append("Готово");
  done.onmousedown = (event) => event.preventDefault();
  done.onclick = finish;
  toolbar.append(done);
  box.replaceChildren(toolbar, ta, preview);
  updatePreview();
  icons();
  const resizeText = () => {
    ta.style.height = "auto";
    const height = Math.max(52, ta.scrollHeight + 4);
    ta.style.height = (embeddedImage ? Math.min(height, 84) : height) + "px";
  };
  resizeText();
  ta.focus({ preventScroll: true });
  if (mermaidTop === null)
    ta.scrollIntoView({ block: "nearest", inline: "nearest" });
  else restoreBlockTop(box, mermaidTop);
  if (selectAll) ta.select();
  else ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.oninput = () => {
    liveBlock();
    schedulePreview();
    resizeText();
    if (ta.value === "/") {
      ta.value = "";
      liveBlock();
      insertDialog();
    }
  };
  box.onfocusout = () => {
    setTimeout(() => {
      if (editor?.ta === ta && !box.contains(document.activeElement)) flush();
    }, 0);
  };
  ta.onkeydown = (e) => {
    if (e.isComposing) return;
    if (wrapTypedSelection(e)) return;
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
    if (e.key === "Escape" || finishEditingKey(e)) {
      e.preventDefault();
      finish();
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
  finishDrawing();
  closeGraph();
  closeBibliography();
  if (editor) {
    liveBlock();
    const { i, expanded } = editor;
    editor = null;
    if (expanded !== undefined) {
      const next = parse();
      if (
        next.length === parts.length &&
        next[i]?.start === parts[i].start &&
        isMermaid(next[i]?.t)
      ) {
        const preview = host.children[i]?.querySelector("[data-mermaid]");
        parts = next;
        suspendGraphScrollAnchoring();
        replaceStructuredView(i, expanded, preview);
        return;
      }
    }
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
  return {
    rows,
    align,
    widths: readColumnWidths(p.t.attrGet("data-column-widths"), align.length),
  };
}
function tableText(data) {
  const format = (r, marker = "") =>
    "| " +
    r
      .map(
        (s, index) =>
          s.replace(/\\?\|/g, "\\|").replace(/[\r\n]+/g, " ") +
          (index === 0 ? marker : ""),
      )
      .join(" | ") +
    " |";
  const [head, ...tail] = data.rows;
  return [
    format(head, tableWidthMarker(data.widths)),
    format(
      head.map(
        (_, i) =>
          ({ left: ":---", right: "---:", center: ":---:" })[data.align[i]] ||
          "---",
      ),
    ),
    ...tail.map((row) => format(row)),
  ].join(doc.body.includes("\r\n") ? "\r\n" : "\n");
}
function finishCell(keepFocus = false) {
  if (!tableEdit) return;
  const e = tableEdit;
  if (!keepFocus) tableEdit = null;
  const text = e.field.innerText;
  if (text !== e.original) {
    const p = parts[e.i];
    e.rows.rows[e.r][e.c] = text.replace(/\r\n?|\n/g, "<br>");
    patch(p.start, p.end, tableText(e.rows));
    e.original = text;
    parts = parse();
  }
}
function focusTableCell(field) {
  field?.focus({ preventScroll: true });
  field?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function replaceTable(index, data) {
  const box = host.children[index];
  const top = viewport.scrollTop;
  const left = box.querySelector(".table-scroll").scrollLeft;
  patch(parts[index].start, parts[index].end, tableText(data));
  parts = parse();
  const next = block(parts[index], index);
  box.replaceWith(next);
  void paintMath(next);
  next.querySelector(".table-scroll").scrollLeft = left;
  viewport.scrollTop = top;
  icons();
  return next;
}
function buildTable(box, p, i) {
  box.innerHTML =
    '<div class="table-scroll">' +
    md.renderer.render(p.tokens, md.options, {}) +
    "</div>";
  const scroller = box.querySelector(".table-scroll");
  const table = scroller.querySelector("table");
  if (mode !== "edit") {
    enableTableResize(table, false);
    return;
  }
  scroller.classList.add("table-scroll-editable");
  const data = tableRows(p),
    cells = [...table.rows];
  const fields = cells.map((row, r) =>
    Array.from(row.cells, (cell, c) => {
      const field = document.createElement("div");
      field.className = "table-cell-content";
      field.contentEditable = "plaintext-only";
      field.setAttribute(
        "aria-label",
        "Строка " + (r + 1) + ", столбец " + (c + 1),
      );
      field.append(...cell.childNodes);
      cell.append(field);
      updateAutocorrect(field);
      return field;
    }),
  );
  let activeCol = 0,
    activeRow = Math.min(1, cells.length - 1);
  const alignment = document.createElement("select");
  for (const [label, value] of [
    ["По левому краю", "left"],
    ["По центру", "center"],
    ["По правому краю", "right"],
  ])
    alignment.add(new Option(label, value));
  box.selectTableCell = (row, column) => {
    activeRow = row;
    activeCol = column;
    selected = Number(box.dataset.idx);
    alignment.value = data.align[column] || "left";
    alignment.title = "Столбец " + (column + 1);
  };
  alignment.value = data.align[0] || "left";
  function changeTable(change) {
    const state = prepareBlockChange(i);
    if (!state || parts[state.origin]?.t.type !== "table_open") return null;
    const current = tableRows(parts[state.origin]);
    change(current);
    return replaceTable(state.origin, current);
  }
  alignment.onchange = () => {
    const value = alignment.value;
    const next = changeTable((current) => {
      current.align[activeCol] = value;
    });
    next?.selectTableCell(activeRow, activeCol);
    next
      ?.querySelector(".table-alignment select")
      .focus({ preventScroll: true });
  };
  const order = tableOrderControls(
    table,
    scroller,
    viewport,
    (axis, from, to, keyboard) => {
      const next = changeTable((current) =>
        reorderTable(current, axis, from, to),
      );
      if (!next) return;
      const [row, column] = axis === "row" ? [to, activeCol] : [activeRow, to];
      next.selectTableCell(row, column);
      const grip = next.querySelector(
        "[data-table-" + axis + '][data-idx="' + to + '"] .table-order-grip',
      );
      grip?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (keyboard) grip?.focus({ preventScroll: true });
    },
  );
  table.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".table-order-grip")) activeTableOrder = order;
  });
  cells.forEach((row, r) =>
    [...row.cells].forEach((cell, c) => {
      const field = fields[r][c];
      let pointerCaret;
      field.addEventListener("pointerdown", (event) => {
        pointerCaret = undefined;
        if (
          event.button !== 0 ||
          tableEdit?.field === field ||
          event.metaKey ||
          event.ctrlKey
        )
          return;
        const offset = tableCellPoint(field, event.clientX, event.clientY);
        if (offset !== null) {
          const raw = editableCellText(data.rows[r][c] || "", md);
          pointerCaret = cellSourceOffset(field.textContent, raw, offset);
        }
      });
      field.onfocus = () => {
        if (editor || inlineBibliography) {
          const state = prepareBlockChange(i);
          const replacement =
            state &&
            host.children[state.origin]
              .querySelector("table")
              ?.rows[r]?.cells[c]?.querySelector(".table-cell-content");
          if (replacement) {
            replacement.focus({ preventScroll: true });
            if (pointerCaret !== undefined)
              placeCellCaret(replacement, pointerCaret);
          }
          return;
        }
        closeGraph();
        finishCell();
        box.selectTableCell(r, c);
        const raw = editableCellText(data.rows[r][c] || "", md);
        if (
          field.childNodes.length !== 1 ||
          field.firstChild.nodeType !== Node.TEXT_NODE ||
          field.textContent !== raw
        )
          field.textContent = raw;
        cell.classList.add("table-cell-editing");
        tableEdit = { field, r, c, rows: data, i, original: raw };
        placeCellCaret(field, pointerCaret ?? raw.length);
      };
      cell.addEventListener("click", (event) => {
        if (event.target === cell && !isColumnBoundary(cell, event))
          field.focus({ preventScroll: true });
      });
      field.addEventListener("click", () => {
        if (
          pointerCaret !== undefined &&
          tableEdit?.field === field &&
          document.getSelection()?.isCollapsed
        )
          placeCellCaret(field, pointerCaret);
        pointerCaret = undefined;
      });
      field.onpaste = (e) => {
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
        while (data.widths && data.widths.length < width)
          data.widths.push(data.widths[c]);
        for (const existing of data.rows)
          while (existing.length < width) existing.push("");
        for (const [dr, values] of pasted.entries()) {
          while (data.rows.length <= r + dr)
            data.rows.push(Array(width).fill(""));
          values.forEach((value, dc) => (data.rows[r + dr][c + dc] = value));
        }
        update(r, c);
      };
      field.onblur = () => {
        if (tableEdit?.field === field) {
          finishCell();
          cell.classList.remove("table-cell-editing");
          field.innerHTML = md.renderInline(data.rows[r][c]);
          void paintMath(field);
          const next = automaticColumnWidths(data.rows).join(",");
          if (next !== table.dataset.autoColumnWidths) {
            table.dataset.autoColumnWidths = next;
            if (!data.widths) applyTableWidths(table, null);
          }
        }
      };
      function deleteEmptyRow(event) {
        if (
          event.defaultPrevented ||
          event.isComposing ||
          (event.type === "beforeinput" && !event.cancelable) ||
          r === 0 ||
          tableEdit?.field !== field ||
          !document.getSelection()?.isCollapsed ||
          field.innerText.trim() ||
          data.rows[r].some(
            (value, column) =>
              column !== c && editableCellText(value, md).trim(),
          )
        )
          return;
        event.preventDefault();
        if (event.repeat) return;
        field.blur();
        removeRow(r);
        const previous = update(r - 1, c);
        if (previous) placeCellCaret(previous, 0);
      }
      field.addEventListener("beforeinput", (event) => {
        if (event.inputType === "deleteContentBackward") deleteEmptyRow(event);
      });
      field.onkeydown = (event) => {
        if (event.target !== field) return;
        if (finishEditingKey(event)) {
          event.preventDefault();
          field.blur();
          return;
        }
        if (
          event.key === "Enter" && event.altKey &&
          !event.ctrlKey && !event.metaKey && !event.isComposing
        ) {
          event.preventDefault();
          document.execCommand("insertLineBreak");
          return;
        }
        if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
          return;
        if (event.key === "Backspace") {
          deleteEmptyRow(event);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          field.blur();
          return;
        }
        const tab = event.key === "Tab";
        if (!tab && (event.key !== "Enter" || event.shiftKey)) return;
        const columns = row.cells.length;
        const index = tab
          ? r * columns + c + (event.shiftKey ? -1 : 1)
          : (r + 1) * columns + c;
        if (index < 0) return;
        event.preventDefault();
        const nextRow = Math.floor(index / columns);
        const nextColumn = index % columns;
        if (nextRow >= cells.length) {
          field.blur();
          data.rows.push(data.rows[0].map(() => ""));
          update(nextRow, nextColumn);
          return;
        }
        focusTableCell(fields[nextRow][nextColumn]);
      };
    }),
  );
  const actions = document.createElement("div");
  actions.className = "table-tools";
  function update(row, column) {
    const next = replaceTable(i, data);
    const field = next
      .querySelector("table")
      .rows[row]?.cells[column]?.querySelector(".table-cell-content");
    focusTableCell(field);
    return field;
  }
  function removeRow(row) {
    if (row < 1 || row >= data.rows.length) return;
    data.rows.splice(row, 1);
    return [Math.min(row, data.rows.length - 1), activeCol];
  }
  const structure = document.createElement("div");
  structure.className = "table-tool-group";
  for (const [name, act] of [
    [
      "+ Строка",
      () => {
        const row = Math.min(data.rows.length, activeRow + 1);
        data.rows.splice(
          row,
          0,
          data.rows[0].map(() => ""),
        );
        return [row, activeCol];
      },
    ],
    [
      "+ Столбец",
      () => {
        data.rows.forEach((r, j) =>
          r.splice(activeCol + 1, 0, j ? "" : "Столбец"),
        );
        data.align.splice(activeCol + 1, 0, "");
        data.widths?.splice(activeCol + 1, 0, data.widths[activeCol]);
        return [Math.min(activeRow, data.rows.length - 1), activeCol + 1];
      },
    ],
    ["− Строка", () => removeRow(activeRow)],
    [
      "− Столбец",
      () => {
        if (data.rows[0].length <= 1) return;
        data.rows.forEach((r) => r.splice(activeCol, 1));
        data.align.splice(activeCol, 1);
        data.widths?.splice(activeCol, 1);
        return [
          Math.min(activeRow, data.rows.length - 1),
          Math.min(activeCol, data.rows[0].length - 1),
        ];
      },
    ],
  ]) {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = () => {
      finishCell();
      const target = act();
      if (target) update(...target);
    };
    structure.append(b);
  }
  const reset = document.createElement("button");
  reset.textContent = "Сбросить ширину";
  reset.disabled = !data.widths;
  function saveWidths(widths) {
    finishCell(true);
    data.widths = widths;
    const part = parts[i];
    patch(part.start, part.end, setTableWidthMarker(part.text, widths));
    parts = parse();
    reset.disabled = !widths;
  }
  reset.onclick = () => {
    applyTableWidths(table, null);
    saveWidths(null);
  };
  enableTableResize(table, true, saveWidths);
  const alignLabel = document.createElement("label");
  alignLabel.className = "table-alignment";
  alignLabel.append("Выравнивание столбца ", alignment);
  const formatting = document.createElement("div");
  formatting.className = "table-tool-group";
  formatting.append(alignLabel, reset);
  actions.append(structure, formatting);
  box.append(actions, deleteBlockButton(i, "Удалить таблицу", "block-remove"));
}
let sourceOutlineSignature;
source.onfocus = () => {
  sourceOutlineSignature = undefined;
  source.dataset.group = "";
};
source.oninput = () => {
  if (!source.dataset.group) {
    snapshot();
    source.dataset.group = "yes";
  }
  setText(sourcePane.read(), false);
  parts = parse();
  sourcePane.update();
  const signature = JSON.stringify(
    parts.flatMap((part, i) =>
      part.t.type === "heading_open" ? [[i, part.text]] : [],
    ),
  );
  if (signature !== sourceOutlineSignature) {
    outline();
    sourceOutlineSignature = signature;
  }
};
source.onkeydown = (event) => {
  if (mode === "source") wrapTypedSelection(event);
};
source.onbeforeinput = (event) => {
  if (
    !["historyUndo", "historyRedo"].includes(event.inputType) ||
    !event.cancelable
  )
    return;
  event.preventDefault();
  historyStep(event.inputType === "historyRedo");
};
source.onkeyup = source.onclick = () => {
  const i = sourcePane.cursorBlock();
  sourcePane.reveal(i, true);
  selected = Math.max(0, i);
  highlight(i);
};
function setMode(next) {
  flush();
  if (isSource()) selected = sourcePane.cursorBlock();
  if ((next === "source" || next === "latex") && next !== mode) {
    const synchronized = materializeToc(doc.body, md);
    if (synchronized !== doc.body) setText(synchronized, false);
  }
  mode = next;
  outlineScrollPosition = undefined;
  render();
  if (next === "pdf") return;
  if (isSource()) {
    sourcePane.select(selected);
    source.setSelectionRange(source.selectionStart, source.selectionStart);
  } else host.children[selected]?.scrollIntoView({ block: "nearest" });
}
// Panel widths change line wrapping throughout the document. Keep the chosen
// block at its screen coordinate across that reflow and editor teardown.
function prepareInsertion(index) {
  const box = mode === "edit" && host.children[index];
  const top = box ? blockTop(box) : null;
  let end = parts[index]?.end ?? doc.body.length;
  if (editor && editor.i <= index) {
    liveBlock();
    end += editor.end - parts[editor.i].end;
  }
  const length = doc.body.length;
  const changesBeforeEnd =
    (tableEdit && tableEdit.i <= index) ||
    (inlineBibliography && inlineBibliography.state.origin <= index);
  flush();
  if (changesBeforeEnd) end += doc.body.length - length;
  if (box) index = parts.findLastIndex((part) => part.start < end);
  return { index, top, id: doc?.id };
}
function restoreInsertion({ index, top, id }) {
  const box = host.children[index];
  if (top !== null && box && mode === "edit" && id === doc?.id)
    restoreBlockTop(box, top);
}
function anchorInsertPanel(panel, anchor) {
  restoreInsertion(anchor);
  const restoreOnCancel = () => {
    if (!modal.open && panel.isConnected) restoreInsertion(anchor);
  };
  modal.addEventListener("close", restoreOnCancel, { once: true });
  return () => {
    modal.removeEventListener("close", restoreOnCancel);
    modal.close();
    restoreInsertion(anchor);
  };
}
function insertBlock(type, idx = insertionBlock(), content) {
  const anchor = prepareInsertion(idx);
  idx = anchor.index;
  const item = content === undefined ? blocksToInsert[type] : ["", content];
  if (!item) return;
  let body = item[1];
  if (type === "diagram" && liveEdit) body = identifyDiagrams(body);
  if (type === "requirement") {
    const max = Math.max(
      0,
      ...[...doc.body.matchAll(/\bFR-(\d+)/g)].map((m) => Number(m[1])),
    );
    body = body.replace("FR-01", "FR-" + String(max + 1).padStart(2, "0"));
  }
  const pos =
      mode === "source"
        ? sourcePane.bodyOffset(source.selectionStart)
        : (parts[idx]?.end ?? (idx < 0 ? 0 : doc.body.length)),
    before = doc.body.slice(0, pos),
    after = doc.body.slice(pos);
  const newline = doc.body.match(/\r\n|\r|\n/)?.[0] || "\n";
  const leading = before.trim() ? newline + newline : "";
  const add =
    leading +
    body.replace(/\r\n|\r|\n/g, newline) +
    (after.trim() ? newline + newline : newline);
  patch(pos, pos, add);
  if (type === "toc") setText(materializeToc(doc.body, md), false);
  render();
  selected = Math.max(
    0,
    parts.findIndex((p) => p.start >= pos && p.end > pos),
  );
  if (mode === "source") {
    source.focus({ preventScroll: true });
    const insertedToc =
      type === "toc" &&
      parts.find((part) => part.start >= pos && part.t.type === "spec_toc");
    const caret = insertedToc ? insertedToc.end : pos + add.length;
    const offset = sourcePane.displayOffset(caret);
    source.setSelectionRange(offset, offset);
  } else if (mode === "latex") {
    sourcePane.select(selected);
  } else {
    restoreInsertion(anchor);
    host.children[selected]?.scrollIntoView({ block: "nearest" });
    if (["paragraph", "heading", "code", "list", "math", "speakerNotes"].includes(type))
      editBlock(selected, true);
    if (type === "speakerNotes" && editor) {
      const { ta } = editor;
      ta.setSelectionRange(ta.value.indexOf("\n") + 1, ta.value.lastIndexOf("\n"));
    }
    if (type === "mermaid") editMermaidCode(selected, true);
    if (type === "excalidraw") openDrawing(selected);
    if (type === "math" && editor) {
      editor.ta.setSelectionRange(3, editor.ta.value.length - 3);
    }
    if (type === "diagram")
      host.children[selected]?.querySelector("button")?.click();
    if (type === "projectTree") openStructuredBlock(selected, type);
    if (type === "bibliography")
      openStructuredBlock(
        parts.findIndex(
          (part) => part.start >= pos && part.t.type === "spec_bibliography",
        ),
        type,
      );
  }
}
let disposeImageDialog, stopComments, composeLiveComment;
let openPanelKey = "";

function bindPanelButton(button, key) {
  button.dataset.panelKey = key;
  button.setAttribute("aria-controls", modal.id);
  button.setAttribute("aria-expanded", String(modal.open && openPanelKey === key));
}

function setPanelKey(key) {
  openPanelKey = key;
  for (const button of document.querySelectorAll("[data-panel-key]")) {
    button.setAttribute("aria-expanded", String(button.dataset.panelKey === key));
  }
}

function togglePanel(key, open) {
  if (modal.open && openPanelKey === key) {
    modal.close();
    setPanelKey("");
    return;
  }
  const previous = modal.firstElementChild;
  open();
  if (modal.open && modal.firstElementChild !== previous) setPanelKey(key);
}

function closeComments() {
  stopComments?.();
  stopComments = null;
  composeLiveComment = null;
}
modal.addEventListener("close", () => {
  if (modal.open) return;
  setPanelKey("");
  closeComments();
});
function resetModal() {
  closeComments();
  disposeImageDialog?.();
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
function normalizeDocumentMath() {
  if (!doc || mode === "read" || mode === "pdf") return;
  flush();
  const body = normalizeMathDelimiters(doc.body, md);
  if (body === doc.body) {
    notice("Совместимые разделители уже используются.");
    return;
  }
  setText(body);
  render();
  notice("Разделители формул обновлены.");
}

function openSpeakerNotes() {
  if (!doc) return;
  flush();
  const notes = document.createDocumentFragment();
  let heading = "";
  for (const { t, tokens } of parse()) {
    if (t.type === "heading_open")
      heading = plainHeading(tokens.find((token) => token.type === "inline"));
    if (!isSpeakerNotes(t)) continue;
    const section = document.createElement("section");
    const title = document.createElement("h2");
    title.textContent = heading || doc.name;
    const text = document.createElement("p");
    text.textContent = t.content.trimEnd();
    section.append(title, text);
    notes.append(section);
  }
  if (!notes.childElementCount) {
    notice("Добавьте блок «Заметка докладчика» через меню «Вставить».");
    return;
  }
  const popup = window.open("about:blank", "_blank", "popup,width=520,height=640");
  if (!popup) {
    notice("Браузер заблокировал окно заметок.");
    return;
  }
  popup.opener = null;
  const page = popup.document;
  page.documentElement.lang = "ru";
  page.title = "Заметки докладчика — " + doc.name;
  const styles = page.createElement("style");
  styles.textContent = "html{color-scheme:light dark}body{font:16px/1.55 system-ui;margin:24px}h1{font-size:24px}h2{font-size:18px}section+section{border-top:1px solid GrayText}p{white-space:pre-wrap;overflow-wrap:anywhere}";
  const title = page.createElement("h1");
  title.textContent = "Заметки докладчика";
  page.head.append(styles);
  page.body.append(title, notes);
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
  const anchor = prepareInsertion(insertionBlock());
  const index = anchor.index;
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
            mermaid: "git-fork",
            excalidraw: "pencil-ruler",
            requirement: "list-checks",
            code: "code",
            math: "sigma",
            list: "list",
            projectTree: "folder-tree",
            toc: "list-ordered",
            bibliography: "book-open",
            speakerNotes: "notebook-pen",
          }[k],
        ),
      )
      .join("") + option("image", "Изображение", "image"),
  );
  const close = anchorInsertPanel(b, anchor);
  b.onclick = (e) => {
    const k = e.target.closest("[data-id]")?.dataset.id;
    if (k === "image") imageDialog(index, null, anchor);
    else if (k) {
      close();
      insertBlock(k, index);
    }
  };
}
function imageDialog(index, initial, anchor) {
  const id = doc.id;
  const panel = dialog(
    initial ? "Изменить изображение" : "Вставить изображение",
    '<form class="template-form"><label>Файл изображения<input name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>' +
      '<label>Или ссылка на изображение<input name="url" type="url" placeholder="https://"></label>' +
      '<label>Описание для изображения<input name="alt" placeholder="Например, схема подключения"></label>' +
      '<div class="image-crop-actions" hidden><button type="button" data-crop>Обрезать</button><button type="button" data-reset-crop hidden>Сбросить обрезку</button></div>' +
      '<div class="image-crop-preview" hidden></div><p class="image-crop-status" role="status"></p>' +
      '<button type="submit" class="primary">' +
      (initial ? "Сохранить изображение" : "Вставить изображение") +
      "</button></form>",
  );
  const close = anchor ? anchorInsertPanel(panel, anchor) : () => modal.close();
  modal.classList.add("image-dialog");
  const release = imageCropForm(panel, initial, (markdown) => {
    if (!modal.open || doc?.id !== id) return;
    if (initial && parts[index]?.text !== initial.source)
      throw Error("Изображение изменилось. Откройте его настройки снова.");
    close();
    if (initial) replaceImage(index, markdown, false);
    else insertBlock("image", index, markdown);
  });
  function cleanup() {
    release();
    modal.removeEventListener("close", cleanup);
    disposeImageDialog = null;
  }
  disposeImageDialog = cleanup;
  modal.addEventListener("close", cleanup);
}
function download(name, body, type = "text/markdown;charset=utf-8") {
  const a = document.createElement("a");
  a.download = name;
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function create(name, body, kind, style = {}) {
  const next = newDoc(name, body, kind);
  next.style = style;
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
  if (liveEdit && id === doc.id) {
    const next = mutate(doc);
    if (!next) return false;
    doc = next;
    save();
    return true;
  }
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
      privateSync?.queue();
    }
    return true;
  } catch {
    notice("Не удалось сохранить изменение на устройстве.");
    return false;
  }
}
function changeFolders(change) {
  try {
    const current = readFolders(JSON.parse(localStorage.getItem(folderStorageKey)));
    const next = change(current);
    localStorage.setItem(folderStorageKey, JSON.stringify(next));
    folders = next;
    privateSync?.queue();
    nav();
    return true;
  } catch (error) {
    notice(error.message || "Не удалось сохранить папки.");
    return false;
  }
}
function folderNameDialog(parentId = "") {
  const body = dialog("Новая папка",
    '<form class="template-form"><label>Название папки<input required maxlength="100"></label><button class="primary">Сохранить</button></form>');
  const form = body.querySelector("form");
  const input = form.querySelector("input");
  input.focus();
  form.onsubmit = (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    const saved = changeFolders((current) => {
      if (parentId && !current.some((item) => item.id === parentId))
        throw Error("Папка уже удалена.");
      if (current.some((item) => item.parentId === parentId &&
          item.name.toLowerCase() === name.toLowerCase()))
        throw Error("Папка с таким названием уже существует.");
      foldedFolders.delete(parentId);
      return [...current, { id: crypto.randomUUID(), name, parentId }];
    });
    if (saved) modal.close();
  };
}
function renameSidebarItem(id, folder, name) {
  if (folder) return changeFolders((current) => {
    const entry = current.find((item) => item.id === id);
    if (!entry) throw Error("Папка уже удалена.");
    if (current.some((item) => item.id !== id && item.parentId === entry.parentId &&
        item.name.toLowerCase() === name.toLowerCase()))
      throw Error("Папка с таким названием уже существует.");
    return current.map((item) => item.id === id ? { ...item, name } : item);
  });
  if (!updateFile(id, (latest) => ({ ...latest, name: nameOf(name) }))) return false;
  nav();
  return true;
}
function folderActions(id) {
  const folder = folders.find((item) => item.id === id);
  if (!folder) return;
  const body = dialog(folder.name,
    option("new", "Новая вложенная папка", "folder-plus") +
    option("rename", "Переименовать", "pencil") +
    option("remove", "Удалить пустую папку", "trash-2"));
  body.onclick = (event) => {
    const action = event.target.closest("[data-id]")?.dataset.id;
    if (action === "new") return folderNameDialog(id);
    if (action === "rename") {
      modal.close();
      return fileActionsUI.edit(id, true);
    }
    if (action === "remove" && changeFolders((current) => {
      if (current.some((item) => item.parentId === id) ||
          [...docs.values()].some((item) => item.folderId === id))
        throw Error("Папка содержит вложенные папки или документы, включая корзину.");
      return current.filter((item) => item.id !== id);
    })) modal.close();
  };
}
function moveFilesToFolder(ids, folderId) {
  if (folderId && !folders.some((item) => item.id === folderId)) {
    notice("Папка уже удалена.");
    return false;
  }
  let moved = true;
  for (const id of ids) {
    const file = docs.get(id);
    if (!file || file.trashed || (file.folderId || "") === folderId) continue;
    if (!updateFile(id, (latest) => ({ ...latest, folderId: folderId || undefined })))
      moved = false;
  }
  if (moved) {
    for (let folder = folders.find((item) => item.id === folderId); folder;
      folder = folders.find((item) => item.id === folder.parentId))
      foldedFolders.delete(folder.id);
  }
  nav();
  return moved;
}
function moveFileDialog(id) {
  const body = dialog("Переместить в папку",
    '<form class="template-form"><label>Папка<select></select></label><button class="primary">Переместить</button></form>');
  const form = body.querySelector("form");
  const select = form.querySelector("select");
  const paths = new Map();
  select.add(new Option("Без папки", ""));
  for (const folder of folders) {
    const path = [paths.get(folder.parentId), folder.name].filter(Boolean).join(" / ");
    paths.set(folder.id, path);
    select.add(new Option(path, folder.id));
  }
  select.value = paths.has(docs.get(id)?.folderId) ? docs.get(id).folderId : "";
  form.onsubmit = (event) => {
    event.preventDefault();
    if (moveFilesToFolder([id], select.value)) modal.close();
  };
}
function fileActions(id) {
  const d = docs.get(id);
  if (!d || d.trashed) return;
  const body = dialog(
    d.name,
    option("rename", "Переименовать", "pencil") +
      option("move", "Переместить в папку", "folder-input") +
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
    if (action === "rename") {
      modal.close();
      return fileActionsUI.edit(id);
    }
    if (action === "move") return moveFileDialog(id);
    if (action === "copy") {
      const next = {
        ...structuredClone(docs.get(id)),
        id: crypto.randomUUID(),
        name: copyName(docs.get(id).name),
      };
      delete next.collaboration;
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
function editDocumentLabel() {
  const body = dialog(
    "Надпись над документом",
    '<form class="template-form"><label>Текст надписи<input maxlength="80"></label><small>Оставьте поле пустым, чтобы скрыть надпись.</small><button class="primary">Сохранить</button></form>',
  );
  const id = doc.id;
  const form = body.querySelector("form");
  const input = form.querySelector("input");
  input.value = doc.kind || "";
  input.focus({ preventScroll: true });
  input.select();
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!updateFile(id, (latest) => ({ ...latest, kind: input.value.trim() })))
      return;
    modal.close();
    updateDocumentLabel();
    $("[data-action=edit-doc-label]").focus({ preventScroll: true });
  };
}
function trashDialog() {
  const body = dialog("Корзина", "");
  const trash = [...docs.values()].filter((d) => d.trashed);
  if (!trash.length) body.textContent = "Корзина пуста.";
  if (trash.length) {
    const clear = document.createElement("button");
    clear.textContent = "Очистить корзину";
    clear.className = "danger";
    clear.onclick = () => {
      const panel = dialog(
        "Очистить корзину?",
        '<p></p><div class="dialog-actions"><button>Отмена</button><button class="danger">Очистить корзину</button></div>',
      );
      panel.querySelector("p").textContent =
        "Будут удалены навсегда документы из корзины (" + trash.length + ").";
      const [cancel, confirm] = panel.querySelectorAll("button");
      cancel.onclick = trashDialog;
      confirm.onclick = () => {
        for (const item of trash)
          updateFile(item.id, (latest) => (latest.trashed ? null : latest));
        nav();
        trashDialog();
      };
    };
    body.append(clear);
  }
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
const templates = templateTools({
  dialog,
  close: () => modal.close(),
  create,
  nameOf,
  download,
  current: () => doc,
  applyAppearance,
  diagrams: (markdown) =>
    parse(markdown).filter(
      ({ t }) => t.type === "fence" && t.info.trim() === "studio-diagram",
    ),
  preview: (target, markdown) => {
    target.replaceChildren();
    for (const { t, tokens } of parse(markdown)) {
      const box = document.createElement("div");
      box.className = "block";
      target.append(box);
      if (t.type === "fence" && t.info.trim() === "studio-diagram") {
        try {
          box.append(diagramView(normalize(JSON.parse(t.content))));
          continue;
        } catch {
          // Keep invalid diagram source visible in the preview.
        }
      }
      const content = document.createElement("template");
      content.innerHTML = md.renderer.render(tokens, md.options, {});
      box.append(content.content);
    }
    icons();
    void paintMath(target);
    mermaidControls(target);
    void paintMermaid(target);
    paintDrawings(target);
  },
});
let pdfCache;
const currentPdfProfile = () =>
  doc?.style?.pdfProfile === "a4" ? "a4" : "screen";
function setPdfProfile(value) {
  doc.style = { ...doc.style, pdfProfile: value };
  save();
  if (isSource()) sourcePane.refreshPreview();
}
function requestPdf(force = false) {
  const key = JSON.stringify([doc.id, doc.name, doc.style]);
  if (!force && pdfCache?.key === key && pdfCache.body === doc.body)
    return pdfCache.result;
  const data = { name: doc.name, body: doc.body, style: { ...doc.style } };
  const blocks = isSource() ? parts : parse(data.body);
  const profile = currentPdfProfile();
  const result = import("./pdf-export.js").then(async ({ exportPdf }) => ({
    ...(await exportPdf(blocks, md, data, profile)),
    name: data.name.replace(/\.md$/i, "") + ".pdf",
    blocks: blocks.map((part, index) => {
      const readable = part.tokens.find(
        (token) => token.type === "inline",
      )?.content;
      const label =
        part.t.type === "spec_toc"
          ? "Оглавление"
          : part.t.type === "spec_bibliography"
            ? "Список литературы"
            : isProjectTree(part.t)
              ? "Структура проекта"
              : part.t.type === "table_open"
                ? "Таблица"
                : part.t.type === "math_block"
                  ? "Формула"
                  : part.t.type === "fence"
                    ? isExcalidraw(part.t)
                      ? "Рисунок Excalidraw"
                      : isMermaid(part.t)
                        ? "Mermaid"
                        : part.t.info.trim() === "studio-diagram"
                          ? "Блок-схема"
                          : "Код"
                    : readable?.startsWith("![")
                      ? "Изображение"
                      : (readable || part.text)
                          .replace(/\s+/g, " ")
                          .trim()
                          .slice(0, 75);
      return {
        index,
        label: label || "Блок " + (index + 1),
        rules: part.pdfRules,
        heading: part.t.type === "heading_open",
      };
    }),
  }));
  pdfCache = { key, body: data.body, result };
  void result.catch(() => {
    if (pdfCache?.result === result) pdfCache = null;
  });
  return result;
}
const savePdf = ({ name, blob }) => download(name, blob, "application/pdf");
const printGeneratedPdf = ({ name, blob }) =>
  printPdf(blob, name, () => notice("PDF скачан. Откройте файл для печати."));
function setPdfNumbering(enabled) {
  doc.style = { ...doc.style, pdfPageNumbers: enabled };
  save();
  if (isSource()) sourcePane.refreshPreview();
  showPdfPreview();
}
const pdfViewer = pdfPreview($("#pdf-preview"), {
  profile(value, force) {
    setPdfProfile(value);
    showPdfPreview(force);
  },
  download: savePdf,
  print: printGeneratedPdf,
  numbering: setPdfNumbering,
  select(index) {
    selected = index;
    highlight(index);
  },
  edit(index) {
    if (!parts[index]) return;
    selected = index;
    setMode("edit");
    host.children[selected]?.scrollIntoView({ block: "center" });
  },
  rules(index, rules) {
    const part = parts[index];
    if (!part) return;
    const newline = doc.body.match(/\r\n|\r|\n/)?.[0] || "\n";
    selected = index;
    const anchor = formatHeadingIdentity(part.t.meta?.tocId, newline);
    patch(part.fullStart, part.start, formatPdfRules(rules, newline) + anchor);
    render();
  },
});
function showPdfPreview(force = false) {
  if (doc && mode === "pdf")
    void pdfViewer.show(
      requestPdf(force),
      {
        profile: currentPdfProfile(),
        numbering: Boolean(doc.style?.pdfPageNumbers),
      },
      selected,
      force,
    );
}
function exportDialog() {
  const b = dialog(
    "Экспорт документа",
    option("preview", "Предпросмотр PDF", "eye") +
      option("pdf", "Скачать PDF", "file-down") +
      '<label>Профиль PDF <select name="pdfProfile"><option value="screen">PDF для экрана</option><option value="a4">Строго A4</option></select></label>' +
      '<label class="style-check"><input type="checkbox" name="pdfNumbers">Номера страниц</label>' +
      option("md", "Скачать Markdown (.md)", "file-text") +
      (liveEdit
        ? option("personal-copy", "Сохранить личную копию", "copy")
        : "") +
      option("print", "Печать", "printer") +
      '<p role="status" hidden></p>',
  );
  const profile = b.querySelector("[name=pdfProfile]");
  profile.value = currentPdfProfile();
  profile.onchange = () => {
    setPdfProfile(profile.value);
    showPdfPreview();
  };
  const numbers = b.querySelector("[name=pdfNumbers]");
  numbers.checked = Boolean(doc.style?.pdfPageNumbers);
  numbers.onchange = () => setPdfNumbering(numbers.checked);
  b.onclick = async (e) => {
    const target = e.target.closest("[data-id]");
    if (!target) return;
    const action = target.dataset.id;
    if (action === "personal-copy") {
      modal.close();
      await leaveLiveEditing(() => clearShareHash("document"), {
        personalCopy: true,
      });
      return;
    }
    if (action === "preview" || action === "md") {
      modal.close();
      if (action === "preview") setMode("pdf");
      else download(doc.name, materializeToc(doc.body, md));
      return;
    }
    const status = b.querySelector("[role=status]");
    const controls = [...b.querySelectorAll("button,select,input")];
    controls.forEach((control) => (control.disabled = true));
    status.hidden = false;
    status.textContent = "Подготовка PDF…";
    try {
      const result = await requestPdf();
      if (!b.isConnected || !modal.open) return;
      if (action === "print") printGeneratedPdf(result);
      else savePdf(result);
      modal.close();
    } catch (error) {
      status.textContent = "Не удалось создать PDF. " + error.message;
    } finally {
      controls.forEach((control) => (control.disabled = false));
    }
  };
}
function styleDialog(printOnly = false) {
  const s = doc.style || {};
  const body = dialog("Оформление документа", "");
  const form = document.createElement("form");
  form.className = "style-form";
  body.append(form);
  const controls = styleControls(
    form,
    s,
    printOnly === true ? "print" : "text",
  );
  const submit = document.createElement("button");
  submit.textContent = "Применить";
  submit.className = "primary";
  form.append(submit);
  form.onsubmit = (event) => {
    event.preventDefault();
    applyAppearance(controls());
  };
}
function applyAppearance(style, replace = false) {
  if (replace) {
    const stored = { ...doc.style };
    for (const key of Object.keys(templateStyle(stored))) delete stored[key];
    doc.style = stored;
  }
  doc.style = { ...doc.style, ...style };
  save();
  styles();
  if (isSource()) sourcePane.refreshPreview();
  showPdfPreview();
}
function aiDialog() {
  const b = dialog(
    "Работа с другим чатом",
    '<p>Скопируйте задание вместе с документом и правилами схем. Готовый Markdown можно вернуть в эту студию.</p><label>Что нужно написать или изменить?<textarea id="brief" rows="3" placeholder="Например, опиши обработку отказа и добавь ветку на схеме"></textarea></label><label>Запрос для другого чата<textarea readonly class="prompt"></textarea></label><div class="dialog-actions"><button id="return">Вставить результат</button><button id="copy" class="primary">Скопировать запрос</button></div>',
  );
  const out = b.querySelector(".prompt");
  const update = () =>
    (out.value = aiPrompt(
      { ...doc, body: materializeToc(doc.body, md) },
      $("#brief").value,
    ));
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
  const caret = isSource()
    ? [source.selectionStart, source.selectionEnd, source.selectionDirection]
    : null;
  to.push(doc.body);
  setText(from.pop(), false);
  render();
  if (caret) {
    source.setSelectionRange(...caret);
    source.onkeyup();
  }
  source.dataset.group = "";
}
function historyStep(forward) {
  if (inlineGraph) {
    inlineGraph.panel
      .querySelector(forward ? '[data-cmd="redo"]' : '[data-cmd="undo"]')
      .click();
  } else undo(forward);
}
function jumpTo(target) {
  flush();
  if (modal.open) modal.close();
  if (isSource()) {
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
function clearShareHash(kind) {
  if (location.hash.startsWith("#" + kind + "="))
    window.history.replaceState(null, "", location.pathname + location.search);
}
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
      clearShareHash("review");
      onClose?.();
    },
  }).stop;
}
function identifyDiagrams(markdown) {
  const replacements = [],
    ids = new Set();
  for (const entry of parse(markdown)) {
    if (entry.t.type !== "fence" || entry.t.info.trim() !== "studio-diagram")
      continue;
    try {
      const graph = JSON.parse(entry.t.content);
      if (graph.version !== 1 || !Array.isArray(graph.nodes)) continue;
      if (typeof graph.id !== "string" || !graph.id || ids.has(graph.id)) {
        graph.id = crypto.randomUUID();
        replacements.push({ ...entry, replacement: fence(graph) });
      }
      ids.add(graph.id);
    } catch {
      // Invalid diagrams remain available as Markdown.
    }
  }
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  for (const { start, end, replacement } of replacements.reverse())
    markdown =
      markdown.slice(0, start) +
      replacement.replace(/\n/g, newline) +
      markdown.slice(end);
  return markdown;
}

function sharingDialog() {
  const panel = dialog("Поделиться документом", "");
  modal.classList.add("share-dialog");
  panel.classList.add("share-panel");
  if (liveEdit) {
    if (liveEdit.role === "owner")
      sharePanel({ panel, share: { ...liveEdit.share, published: true } });
    return;
  }
  const id = doc.id;
  sharePanel({
    panel,
    share: doc.collaboration,
    async publish() {
      let record = docs.get(id);
      let share = record?.collaboration;
      if (!record) throw Error("Файл недоступен.");
      if (!share) {
        share = makeShare();
        if (
          !updateFile(id, (latest) => ({
            ...latest,
            collaboration: (share = latest.collaboration || share),
          }))
        )
          throw Error("Не удалось сохранить доступ автора на этом устройстве.");
        record = docs.get(id);
      }
      if (!share.published) {
        const snapshot = snapshotOf(record);
        snapshot.body = identifyDiagrams(snapshot.body);
        await collaborationRequest(share, { action: "publish", snapshot });
        share = { ...share, published: true };
        if (!updateFile(id, (latest) => ({ ...latest, collaboration: share })))
          throw Error(
            "Документ опубликован. Повторите действие, чтобы открыть его.",
          );
      }
      return share;
    },
    open: (share) => {
      if (!panel.isConnected || !modal.open) return;
      openLiveReview(share);
    },
    pull: (share) => pullSharedChanges(panel, id, share),
  });
}

async function pullSharedChanges(panel, id, share) {
  const isOpen = () => panel.isConnected && modal.open && doc?.id === id;
  const revision = doc.collaboration?.syncedRevision ?? 0;
  const cloud = await collaborationRequest(share);
  if (!isOpen()) return "";
  if (cloud.revision <= revision) return "Новых правок в общем документе нет.";
  let base;
  try {
    const { version } = await collaborationRequest(
      share,
      undefined,
      undefined,
      { version: revision },
    );
    base = version.snapshot;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (!isOpen()) return "";
  flush();
  const local = snapshotOf(doc);
  const remote = { ...snapshotOf(cloud.snapshot), name: local.name };
  const merged = base
    ? mergeDocument({ ...snapshotOf(base), name: local.name }, local, remote)
    : sameSnapshot(local, remote)
      ? local
      : null;

  function apply(next, backup = false) {
    flush();
    if (
      doc?.id !== id ||
      doc.collaboration?.id !== share.id ||
      (doc.collaboration.syncedRevision ?? 0) !== revision ||
      !sameSnapshot(doc, local) ||
      !save() ||
      doc?.id !== id ||
      localStorage.getItem(prefix + id) !== savedRecords.get(id)
    )
      throw Error("Личный файл изменился. Подтяните правки ещё раз.");
    const updated = {
      ...doc,
      ...next,
      collaboration: { ...doc.collaboration, syncedRevision: cloud.revision },
    };
    if (backup) {
      updated.versions = [
        {
          id: crypto.randomUUID(),
          name: "До обновления из общего документа",
          state: "На согласовании",
          date: Date.now(),
          body: local.body,
          style: local.style,
        },
        ...(doc.versions || []),
      ];
    }
    writeRecord(updated);
    doc = updated;
    if (!sameSnapshot(local, next)) {
      render();
      nav();
    }
  }

  if (merged) {
    apply(merged);
    return sameSnapshot(local, merged)
      ? "Личный файл уже актуален."
      : "Правки добавлены в личный файл.";
  }

  const comparison = dialog(
    "Сравнить личный и общий документ",
    (base
      ? "<p>Изменения пересекаются. Сверьте оба текста перед заменой.</p>"
      : "<p>Общая версия, от которой разошлись правки, больше не хранится. Сверьте оба текста перед заменой.</p>") +
      '<label>Личный файл<textarea class="prompt" rows="8" readonly></textarea></label>' +
      '<label>Общий документ<textarea class="prompt" rows="8" readonly></textarea></label>' +
      "<p>Текущий текст и оформление личного файла будут сохранены в разделе «Версии».</p>" +
      '<button class="primary" data-apply>Применить общую версию</button><p role="status"></p>',
  );
  const [mine, theirs] = comparison.querySelectorAll("textarea");
  mine.value = local.body;
  theirs.value = remote.body;
  comparison.querySelector("[data-apply]").onclick = () => {
    try {
      apply({ ...remote, style: { ...local.style, ...remote.style } }, true);
      modal.close();
      notice("Правки добавлены в личный файл.");
    } catch (error) {
      comparison.querySelector('[role="status"]').textContent = error.message;
    }
  };
  return "";
}

function openLiveReview(share, { advanced = false } = {}) {
  flush();
  modal.close();
  stopReview?.();
  stopReview = showReview({
    share,
    parse,
    renderMarkdown: (block) => md.renderer.render(block.tokens, md.options, {}),
    request: collaborationRequest,
    labels: roleLabels,
    directEdit: !advanced,
    advanced,
    onEdit: (state) => startLiveEditing(share, state),
    onClose: () => {
      stopReview = null;
      clearShareHash("document");
    },
  }).stop;
}

function liveTextSelection() {
  if (host.hidden || tableEdit || inlineGraph || inlineDrawing) return null;
  if (!editor)
    return selectedTextAnchor(host, workflowSections(parts, doc.body));
  const { ta, start } = editor;
  if (ta.selectionStart === ta.selectionEnd) return null;
  liveBlock();
  const newline = doc.body.includes("\r\n") ? "\r\n" : "\n";
  const offset = (index) =>
    start + ta.value.slice(0, index).replace(/\n/g, newline).length;
  return sourceTextAnchor(
    parse(),
    doc.body,
    offset(ta.selectionStart),
    offset(ta.selectionEnd),
  );
}

function liveFocusedBlock() {
  if (host.hidden) return null;
  if (!editor) return blockAnchor(parts, doc.body, selected);
  const start = editor.start;
  liveBlock();
  const current = parse();
  return blockAnchor(
    current,
    doc.body,
    current.findIndex((part) => part.start === start),
  );
}

function toggleLiveComments(target) {
  const session = liveEdit;
  if (!session) return;
  if (modal.open && stopComments) {
    if (target) return composeLiveComment(target);
    modal.close();
    closeComments();
    return;
  }
  target ??= liveTextSelection();
  const container = dialog("Комментарии", "");
  modal.classList.add("comments-dialog");
  setPanelKey("collaboration-discussion");
  const showCanvas = () => {
    if (host.hidden) setMode("read");
  };
  const { stop, commentAt } = showReview({
    share: session.share,
    parse,
    request: collaborationRequest,
    labels: roleLabels,
    dock: {
      container,
      selection: liveTextSelection,
      block: liveFocusedBlock,
      locate(anchor, scroll) {
        if (scroll) showCanvas();
        if (host.hidden) return false;
        return showAnchor(
          host,
          resolveAnchor(host, parts, workflowSections(parts, doc.body), anchor),
          scroll,
        );
      },
      target(target) {
        if (!target || target.index < 0) return;
        showCanvas();
        const current = reviewTargets(parts, true).find(
          ({ key }) => key === target.key,
        );
        if (!current) return;
        const box = host.children[current.index];
        const element = current.node
          ? box?.querySelector('[data-node="' + CSS.escape(current.node) + '"]')
          : box?.querySelector("table")?.rows[current.row];
        if (box) showAnchor(host, { element: element || box });
      },
      clear: () => showAnchor(host, null),
      onTools: () =>
        leaveLiveEditing((share) => openLiveReview(share, { advanced: true })),
    },
  });
  composeLiveComment = commentAt;
  if (target) commentAt(target);
  stopComments = stop;
}

$("[data-action=collaboration-discussion]").addEventListener(
  "pointerdown",
  (event) => {
    if (liveEdit) event.preventDefault();
  },
);

const livePeoplePanel = $("#live-people");
const livePeopleButton = $("[data-action=collaboration-people]");

function hideLivePeople() {
  if (livePeoplePanel.contains(document.activeElement))
    document.activeElement.blur();
  livePeoplePanel.hidden = true;
  livePeopleButton.setAttribute("aria-expanded", "false");
  if (liveEdit) liveEdit.updatePeople = null;
}

function updateLiveControls() {
  for (const action of [
    "collaboration-discussion",
    "collaboration-exit",
    "collaboration-people",
  ])
    $("[data-action=" + action + "]").hidden = !liveEdit;
  $("[data-action=share]").hidden = !!liveEdit && liveEdit.role !== "owner";
  $("[data-action=collaboration-conflict]").hidden = true;
  hideLivePeople();
  livePeopleButton.querySelector("span").textContent = "";
  privateSave.hidden = !workspaceId || !!liveEdit;
  document.body.classList.toggle("live-editing", !!liveEdit);
}

function toggleLivePeople() {
  const session = liveEdit;
  if (!session) return;
  if (!livePeoplePanel.hidden) return hideLivePeople();
  session.updatePeople = presencePanel(
    livePeoplePanel,
    session.presence,
    session.role,
  );
  livePeoplePanel.hidden = false;
  livePeopleButton.setAttribute("aria-expanded", "true");
  void session.presence.pulse();
}

document.addEventListener(
  "pointerdown",
  (event) => {
    if (
      !livePeoplePanel.hidden &&
      !livePeoplePanel.contains(event.target) &&
      !livePeopleButton.contains(event.target)
    )
      hideLivePeople();
  },
  true,
);

function startLiveEditing(share, initial) {
  if (!["owner", "editor"].includes(initial.role)) return;
  stopReview?.();
  stopReview = null;
  const session = {
    share,
    role: initial.role,
    previous: doc?.id,
    mode,
    scroll: viewport.scrollTop,
  };
  liveEdit = session;
  doc = { ...initial.snapshot, id: "shared:" + share.id };
  mode = "edit";
  selected = 0;
  expandAll = false;
  updateLiveControls();
  render();
  nav();
  viewport.scrollTop = source.scrollTop = 0;
  session.client = liveSession({
    share,
    initial,
    get: () => snapshotOf(doc),
    author: participantName,
    apply(snapshot) {
      doc = { ...snapshot, id: doc.id };
      history.delete(doc.id);
      render();
      nav();
    },
    canApply: () =>
      !editor &&
      !tableEdit &&
      !inlineGraph &&
      !inlineDrawing &&
      (!modal.open || !!stopComments) &&
      !activeTableOrder?.active() &&
      !blockSorting.active() &&
      !outlineSorting.active() &&
      !host.querySelector(".image-stage[data-resizing]") &&
      document.activeElement !== source,
    status(message, conflict = false) {
      $("#save").textContent = message;
      $("[data-action=collaboration-conflict]").hidden = !conflict;
    },
  });
  session.presence = presenceSession({
    share,
    location: () => {
      const graph = inlineGraph?.panel.querySelector(
        ".diagram-title strong",
      )?.textContent;
      if (graph) return "Схема · " + graph;
      const index = isSource() ? selected : visibleBlock();
      return (
        specIndex(parts).headings.findLast((heading) => heading.index <= index)
          ?.label || "Редактирование документа"
      );
    },
    update: (people) => {
      if (liveEdit !== session) return;
      livePeopleButton.querySelector("span").textContent = people.length || "";
      session.updatePeople?.(people);
    },
  });
  $("#save").textContent = "Общий документ";
  session.client.queue();
}

async function leaveLiveEditing(next, { personalCopy = false } = {}) {
  const session = liveEdit;
  if (!session || session.leaving) return;
  session.leaving = true;
  source.blur();
  flush();
  const saved = await session.client.flush();
  if (
    !saved &&
    !personalCopy &&
    !confirm(
      "Часть правок ещё не отправлена. Оставить их в черновике этой вкладки и выйти?",
    )
  ) {
    session.leaving = false;
    return;
  }
  let copy;
  if (personalCopy) {
    flush();
    const { body, kind, name, style } = snapshotOf(doc);
    copy = { ...newDoc(copyName(name), body, kind), style };
    try {
      writeRecord(copy);
    } catch {
      session.leaving = false;
      notice("Не удалось сохранить личную копию на устройстве.");
      return;
    }
  }
  session.client.stop();
  session.presence.stop();
  history.delete(doc.id);
  liveEdit = null;
  updateLiveControls();
  mode = copy ? "edit" : session.mode;
  activate(copy || docs.get(session.previous) || availableDocs()[0]);
  if (copy)
    notice(
      saved
        ? "Личная копия сохранена."
        : "Личная копия сохранена. Неотправленные правки остались в черновике общего документа.",
    );
  else viewport.scrollTop = session.scroll;
  next?.(session.share);
}

function compareLiveEdits() {
  const session = liveEdit;
  const other = session?.client.conflict();
  if (!other) return;
  const panel = dialog(
    "Пересекающиеся правки",
    "<p>Коллега изменил тот же участок. Сравните версии. Можно вручную объединить текст в поле «Мой вариант» перед отправкой.</p>" +
      '<label>Текущий текст у коллег<textarea class="prompt" rows="9" readonly></textarea></label>' +
      '<label>Мой вариант<textarea class="prompt" rows="9"></textarea></label>' +
      '<div class="dialog-actions"><button data-keep>Принять вариант коллеги</button><button data-send class="primary">Сохранить мой вариант</button></div>',
  );
  const [theirs, mine] = panel.querySelectorAll("textarea");
  theirs.value = other.body;
  mine.value = doc.body;
  const metadata = ({ name, kind, style }) =>
    JSON.stringify(
      { "Имя файла": name, Надпись: kind, Оформление: style },
      null,
      2,
    );
  const otherMeta = metadata(snapshotOf(other)),
    mineMeta = metadata(snapshotOf(doc));
  if (otherMeta !== mineMeta) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const values = document.createElement("pre");
    summary.textContent = "Имя и оформление";
    values.textContent =
      "Вариант коллеги\n" + otherMeta + "\n\nМой вариант\n" + mineMeta;
    details.append(summary, values);
    panel.querySelector(".dialog-actions").before(details);
  }
  panel.querySelector("[data-keep]").onclick = () => {
    modal.close();
    session.client.resolve(false);
  };
  panel.querySelector("[data-send]").onclick = () => {
    modal.close();
    setText(mine.value);
    render();
    session.client.resolve(true);
  };
}

function syncReviewLink() {
  if (liveEdit) {
    void leaveLiveEditing(syncReviewLink);
    return;
  }
  const live = /^#document=([a-f0-9]{48})\.([a-f0-9]{48})$/.exec(location.hash);
  if (live) {
    openLiveReview({ id: live[1], key: live[2] });
    return;
  }
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
    if (mode === "read" || mode === "pdf") setMode("edit");
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
host.addEventListener("change", (event) => {
  const input = event.target;
  if (mode !== "edit" || !input.matches(".task-checkbox")) return;
  const index = Number(input.closest(".block").dataset.idx);
  const line = Number(input.dataset.taskLine) - parts[index].t.map[0];
  const checked = input.checked;
  const state = prepareBlockChange(index);
  if (!state) {
    input.checked = !checked;
    return;
  }
  const part = parts[state.origin];
  const next = setTaskChecked(part.text, line, checked);
  if (next === part.text || !patchStructuredBlock(state, next)) return;
  const current = host.children[state.origin]?.querySelector(
    `[data-task-line="${part.t.map[0] + line}"]`,
  );
  if (current) current.checked = checked;
  save();
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
    else {
      panels.links(name);
      setPanelKey("links");
    }
  },
  true,
);
function transferDialog() {
  const box = dialog(
    "Перенос данных",
    "<p>Резервная копия включает папки, документы, шаблоны, версии и доступ автора к замечаниям. Храните её у себя.</p>" +
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
          folders,
          templates: readTemplates(),
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
      const templateCount = restoreTemplates(bundle.templates ?? []);
      const restoredFolders = mergeFolders(folders, bundle.folders);
      if (restoredFolders.folders.length > folders.length) {
        localStorage.setItem(folderStorageKey, JSON.stringify(restoredFolders.folders));
        folders = restoredFolders.folders;
        privateSync?.queue();
      }
      for (const importedRecord of bundle.documents) {
        const record = {
          ...importedRecord,
          folderId: restoredFolders.ids.get(importedRecord.folderId),
        };
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
        imported || templateCount
          ? "Загружено документов: " +
              imported +
              ". Шаблонов: " +
              templateCount +
              "."
          : "Эти данные уже есть в студии.",
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

let privateStatus = "";
const privateSave = $("#private-save");
const privateWorkspaceDetails = () => "Файлов " + availableDocs().length + " · папок " + folders.length;

function updatePrivateStatus(message) {
  privateStatus = message;
  privateSave.textContent = message;
  privateSave.title = message;
  privateSave.hidden = !workspaceId || !!liveEdit;
  const status = modal.querySelector("[data-private-status]");
  if (status) status.textContent = message;
  const details = modal.querySelector("#private-sync-details");
  if (details) details.textContent = privateWorkspaceDetails();
}

function replacePrivateWorkspace(before, after) {
  if (JSON.stringify(readWorkspace(storageKeys)) !== JSON.stringify(before)) return false;
  writeWorkspace(storageKeys, after);
  const active = doc?.id;
  const changed = new Map(after.documents.map((item) => [item.id, item]));
  for (const id of docs.keys()) {
    const next = changed.get(id);
    if (JSON.stringify(next) !== savedRecords.get(id)) history.delete(id);
  }
  docs.clear();
  savedRecords.clear();
  for (const record of after.documents) {
    docs.set(record.id, record);
    savedRecords.set(record.id, localStorage.getItem(prefix + record.id));
  }
  folders = after.folders;
  const next = docs.get(active);
  doc = next && !next.trashed ? next : availableDocs()[0];
  nav();
  render();
  return true;
}

function privateWorkspaceDialog(message) {
  const panel = dialog("Личная синхронизация", "");
  if (liveEdit) {
    panel.textContent = "Чтобы сменить личное пространство, выйдите из общего документа.";
    return;
  }
  const saveFirst = () => {
    flush();
    if (!save()) throw Error("Сначала сохраните текущие правки.");
  };
  const addFromBrowser = (id) => {
    if (!isWorkspaceSource(id))
      throw Error("Локальные документы можно добавить в браузере, в котором создано пространство.");
    const target = workspaceKeys(id);
    const current = readWorkspace(target);
    const { workspace, documentsAdded, foldersAdded } =
      addLocalWorkspace(current, readWorkspace(workspaceKeys("")));
    if (!documentsAdded && !foldersAdded) return false;
    if (id !== workspaceId) writeWorkspace(target, workspace);
    else if (!replacePrivateWorkspace(current, workspace))
      throw Error("Данные изменились в другой вкладке. Повторите добавление.");
    return true;
  };
  void privateSyncPanel(panel, {
    active: workspaceId,
    status: () => privateStatus,
    details: privateWorkspaceDetails,
    message,
    connect(id, include) {
      saveFirst();
      if (include && id !== workspaceId) addFromBrowser(id);
      localStorage.setItem(activeWorkspaceKey, id);
      location.reload();
    },
    async addLocal() {
      saveFirst();
      if (!await privateSync.flush()) return;
      saveFirst();
      if (!addFromBrowser(workspaceId)) {
        updatePrivateStatus("Все локальные документы и папки уже в этом пространстве.");
        return;
      }
      if (await privateSync.flush())
        updatePrivateStatus("Локальные документы и папки добавлены и синхронизированы.");
    },
    async sync() {
      saveFirst();
      await privateSync?.flush();
    },
    async leave(id) {
      saveFirst();
      if (id && id === workspaceId && !await privateSync?.flush())
        throw Error("Дождитесь синхронизации перед выходом. Правки пока находятся в этом браузере.");
      if (id) await privateRequest("logout", {}, id);
      if (workspaceId) {
        localStorage.removeItem(activeWorkspaceKey);
        location.reload();
      } else {
        modal.close();
      }
    },
  });
}
function setToolbarCollapsed(collapsed) {
  const scrollTop = viewport.scrollTop;
  toolbar.hidden = collapsed;
  const label = collapsed ? "Показать верхнюю панель" : "Скрыть верхнюю панель";
  for (const button of document.querySelectorAll(
    '[data-action="toggle-topbar"]',
  )) {
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", label);
    button.title = label;
    button.firstElementChild.outerHTML = icon(
      collapsed ? "panel-top-open" : "panel-top-close",
    );
    const text = button.querySelector("span");
    if (text) text.textContent = label;
  }
  icons();
  viewport.scrollTop = scrollTop;
}
function toggleToolbar() {
  const collapsed = !toolbar.hidden;
  setToolbarCollapsed(collapsed);
  if (mobileLayout.matches) {
    document.body.classList.remove("show-side");
    $(
      collapsed
        ? ".compact-mobile-header .mobile-menu"
        : ".topbar .mobile-menu",
    ).focus({ preventScroll: true });
  }
  try {
    localStorage.setItem(toolbarKey, String(collapsed));
  } catch {
    // The current view still works when browser storage is unavailable.
  }
}
const panelActions = {
  share: sharingDialog,
  "collaboration-conflict": compareLiveEdits,
  "edit-doc-label": editDocumentLabel,
  transfer: transferDialog,
  "private-sync": () => privateWorkspaceDialog(),
  trace: () => panels.trace(),
  links: () => {
    flush();
    const h = specIndex(parse()).headings.findLast((h) => h.index <= selected);
    panels.links(h?.id || h?.label);
  },
  versions: () => panels.versions(),
  new: () => templates.createFrom(),
  "new-folder": () => folderNameDialog(),
  templates: () => templates.library(),
  ai: aiDialog,
  export: exportDialog,
  style: styleDialog,
  "pdf-settings": () => styleDialog(true),
  insert: insertDialog,
  rename: () => renameFile(doc.id),
  trash: trashDialog,
};
for (const button of document.querySelectorAll("button[data-action]")) {
  const action = button.dataset.action;
  if (Object.hasOwn(panelActions, action) || action === "collaboration-discussion")
    bindPanelButton(button, action);
}

const actions = {
  "normalize-math": normalizeDocumentMath,
  "speaker-notes": openSpeakerNotes,
  "collaboration-people": toggleLivePeople,
  "collaboration-discussion": toggleLiveComments,
  "collaboration-exit": () =>
    leaveLiveEditing(() => clearShareHash("document")),
  "expand-diagrams": toggleAllDiagrams,
  "toggle-topbar": toggleToolbar,
  "toggle-sidebar-tools": () => {
    const list = $("#sidebar-tool-list");
    list.hidden = !list.hidden;
    $('[data-action="toggle-sidebar-tools"]').setAttribute(
      "aria-expanded",
      String(!list.hidden),
    );
  },
  files: () =>
    document.body.classList.toggle(
      mobileLayout.matches ? "show-side" : "hide-side",
    ),
  open: () => $("#file-input").click(),
  append: () => insertBlock("paragraph", parts.length - 1),
  undo: () => historyStep(false),
  redo: () => historyStep(true),
};
document.addEventListener("click", (event) => {
  const link = event.target.closest('.paper a[href^="#"]');
  if (
    !link ||
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  let slug;
  try {
    slug = decodeURIComponent(link.getAttribute("href").slice(1));
  } catch {
    return;
  }
  const paper = link.closest(".paper");
  const heading = Array.from(
    paper.querySelectorAll("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]"),
  ).find((node) => node.id === "doc-heading-" + slug);
  if (!heading) return;
  event.preventDefault();
  heading.scrollIntoView({ block: "start" });
  const box = heading.closest("#blocks > .block");
  if (box) {
    selected = Number(box.dataset.idx);
    outlineScrollPosition = viewport.scrollTop;
    highlight(selected);
  }
});
document.addEventListener("click", (e) => {
  if (stopReview) return;
  const b = e.target.closest("[data-action],[data-mode]");
  if (!b) return;
  const action = b.dataset.action;
  if (b.dataset.mode) setMode(b.dataset.mode);
  else if (Object.hasOwn(panelActions, action))
    togglePanel(action, panelActions[action]);
  else actions[action]?.();
});
$("#file-input").onchange = async (e) => {
  for (const f of e.target.files) {
    try {
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
        await f.arrayBuffer(),
      );
      if (/\.speccraft$/i.test(f.name)) {
        const project = readProject(text);
        create(nameOf(project.name), project.body, project.kind, project.style);
        continue;
      }
      const diagram = /\.(mmd|mermaid)$/i.test(f.name);
      create(
        nameOf(diagram ? f.name.replace(/\.(mmd|mermaid)$/i, "") : f.name),
        diagram ? mermaidMarkdown(text) : text,
        diagram ? "Mermaid" : "Markdown",
      );
    } catch {
      notice("Не удалось открыть файл");
    }
  }
  e.target.value = "";
};
document.addEventListener("keydown", (e) => {
  if (stopReview) return;
  if (e.key === "Escape" && !livePeoplePanel.hidden) {
    e.preventDefault();
    hideLivePeople();
    livePeopleButton.focus({ preventScroll: true });
    return;
  }
  if (e.key === "Escape" && activeTableOrder?.cancel()) {
    e.preventDefault();
    return;
  }
  if (
    e.key === "Escape" &&
    (blockSorting.active() || outlineSorting.active())
  ) {
    blockSorting.cancel();
    outlineSorting.cancel();
    e.preventDefault();
    return;
  }
  if (modal.open && e.key === "Escape") {
    modal.close();
    e.preventDefault();
    return;
  }
  if (inlineDrawing && e.key === "Escape") {
    if (!inlineDrawing.editor.exitFullscreen()) finishDrawing();
    e.preventDefault();
    return;
  }
  if (inlineGraph && e.key === "Escape") {
    if (!inlineGraph.editor.cancelPreview()) closeGraph();
    e.preventDefault();
    return;
  }
  if (modal.open || !doc) return;
  const cmd = e.ctrlKey || e.metaKey;
  if (
    mode === "edit" && !editor && !tableEdit && !inlineGraph && !inlineDrawing &&
    !inlineBibliography && !e.defaultPrevented && !e.isComposing && !cmd &&
    !e.altKey && !e.shiftKey && ["Backspace", "Delete"].includes(e.key) &&
    !e.target.closest("textarea,input,select,button,[contenteditable],.sidebar")
  ) {
    const range = canvasTextRange();
    const span = range && canvasBlockSpan(range);
    if (span) {
      e.preventDefault();
      if (e.repeat) return;
      document.getSelection().removeAllRanges();
      removeBlocks([span], span[0], { focusCanvas: true });
      return;
    }
  }
  if (cmd && e.key.toLowerCase() === "s") {
    e.preventDefault();
    flush();
    save();
    download(doc.name, materializeToc(doc.body, md));
  }
  if (
    cmd &&
    !e.altKey &&
    !e.isComposing &&
    (e.key.toLowerCase() === "z" ||
      (e.code === "KeyZ" && !/^[a-z]$/i.test(e.key))) &&
    !e.defaultPrevented &&
    (e.target === source ||
      !e.target.closest("textarea,input,[contenteditable]"))
  ) {
    e.preventDefault();
    historyStep(e.shiftKey);
    return;
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
        inlineDrawing ||
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
  if (event.key === activeWorkspaceKey && activeWorkspace() !== workspaceId) {
    if (liveEdit) return;
    flush();
    save();
    location.reload();
    return;
  }
  if (event.key?.startsWith(prefix)) syncFile(event.key.slice(prefix.length));
  if (event.key === folderStorageKey) {
    try {
      folders = readFolders(JSON.parse(event.newValue));
      nav();
    } catch {
      notice("Не удалось прочитать папки из другой вкладки.");
    }
  }
  if (event.key?.startsWith(prefix) || event.key === folderStorageKey) privateSync?.queue();
});
window.addEventListener("pagehide", () => {
  finishDrawing(true, false);
  inlineGraph?.editor?.publish();
  closeBibliography();
  if (tableEdit) finishCell();
  save();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    inlineGraph?.editor?.publish();
    if (tableEdit) finishCell(true);
    save();
  } else liveEdit?.client?.queue();
});
enableSidebarSearch($("#files-search-toggle"), fileSearch, $("#files"));
enableSidebarSearch($("#outline-search-toggle"), outlineSearch, $("#outline"));
fileSearch.oninput = () => {
  $("#files-scroll").scrollTop = 0;
  filterFiles();
};
enableSidebarPanes(
  $(".sidebar-panes"),
  $("#sidebar-section-resizer"),
  $(".sidebar-tools"),
);
nav();
render();
enablePanelResize(
  $("#workspace"),
  [$("#workspace-sidebar")],
  $(".sidebar-resizer"),
  "left",
);
enablePanelResize(
  $("#workspace"),
  [modal, $("#graph-dock")],
  $(".inspector-resizer"),
  "right",
);
try {
  if (localStorage.getItem(toolbarKey) === "true") setToolbarCollapsed(true);
} catch {
  // Leave the toolbar visible if browser storage is unavailable.
}
save();
if (!loaded) notice("Не удалось восстановить часть локальных данных");

if (workspaceId) {
  privateSync = personalSync({
    workspace: workspaceId,
    read: () => readWorkspace(storageKeys),
    apply: replacePrivateWorkspace,
    canApply: () => !liveEdit && !editor && !tableEdit && !inlineGraph && !inlineDrawing &&
      !inlineBibliography && (!modal.open || openPanelKey === "private-sync") &&
      document.activeElement !== source,
    status: updatePrivateStatus,
  });
  updatePrivateStatus("Проверяем личное пространство…");
  privateSync.queue();
  window.addEventListener("online", privateSync.queue);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) privateSync.queue();
  });
  setInterval(() => {
    if (!document.hidden) privateSync.queue();
  }, 30_000);
}
const privateRedirect = new URLSearchParams(location.search).get("private-sync");
if (privateRedirect) {
  const url = new URL(location.href);
  url.searchParams.delete("private-sync");
  window.history.replaceState(null, "", url);
  togglePanel("private-sync", () => privateWorkspaceDialog(
    privateRedirect === "google" ? "Вход выполнен." : "Вход не завершён. Попробуйте снова.",
  ));
}

syncReviewLink();
