import { sidebarSearchPattern } from "./sidebar-navigation.js";

function textRanges(blocks, pattern) {
  const ranges = [];
  for (const block of blocks) {
    if (block.hidden) continue;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const segments = [];
    let text = "", previousGroup;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!node.length || parent.closest(
        "[hidden], button, textarea, select, script, style, svg, [data-tex], .math-preview",
      )) continue;
      const group = parent.closest("p, li, td, th, h1, h2, h3, h4, h5, h6, pre, figcaption");
      if (segments.length && group !== previousGroup) text += "\n";
      const start = text.length;
      text += node.data;
      segments.push({ node, start, end: text.length });
      previousGroup = group;
    }
    let first = 0, last = 0;
    for (const match of text.matchAll(pattern)) {
      const end = match.index + match[0].length;
      while (segments[first].end <= match.index) first++;
      last = Math.max(first, last);
      while (segments[last].end < end) last++;
      const range = new Range();
      range.setStart(segments[first].node, match.index - segments[first].start);
      range.setEnd(segments[last].node, end - segments[last].start);
      ranges.push(range);
    }
  }
  return ranges;
}

export function enableDocumentSearch({
  panel, toggle, blocks, viewport, source, showSourceMatch, prepare,
  files, projectFile, showFileMatch,
}) {
  const input = panel.querySelector("input");
  const status = panel.querySelector("[role=status]");
  const previous = panel.querySelector('[data-find="previous"]');
  const next = panel.querySelector('[data-find="next"]');
  const scope = panel.querySelector('[data-find="scope"]');
  const results = panel.querySelector(".document-search-results");
  const highlights = globalThis.CSS?.highlights;
  const projections = new Map();
  const pageSize = 30;
  let id, inSource, returnFocus, frame, currentBlock, fromResult = -1;
  let currentMode, searchMode, canvasResult;
  let allFiles = false, localEnabled = false, filesEnabled = false;
  let matches = [], index = 0;

  function fileMatches(pattern) {
    const found = [];
    for (const file of files()) {
      let projection = projections.get(file.id);
      if (projection?.body !== file.body) {
        const { text, raw, changes } = projectFile(file);
        projection = { body: file.body, text, raw, assets: changes.filter((item) => item.asset) };
        projections.set(file.id, projection);
      }
      const { text, raw } = projection;
      for (const match of text.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        if (projection.assets.some((asset) =>
          asset.from < end && asset.to > start
        )) continue;
        found.push({
          id: file.id, name: file.name, text, start, end,
          from: raw(start), to: raw(end, true),
        });
      }
    }
    return found;
  }

  function paintResults(rebuild = false) {
    results.hidden = !allFiles || !matches.length;
    if (results.hidden) {
      fromResult = -1;
      results.replaceChildren();
      return;
    }
    const first = index - index % pageSize;
    if (first !== fromResult || rebuild) {
      fromResult = first;
      results.replaceChildren(...matches.slice(first, first + pageSize).map((match, offset) => {
        const row = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.findIndex = first + offset;
        const title = document.createElement("b");
        title.textContent = match.name;
        title.title = match.name;
        const snippet = document.createElement("span");
        const mark = document.createElement("mark");
        const left = Math.max(match.text.lastIndexOf("\n", match.start - 1) + 1, match.start - 38);
        const lineEnd = match.text.indexOf("\n", match.end);
        const right = lineEnd < 0 ? match.end + 62 : Math.min(match.end + 62, lineEnd);
        mark.textContent = match.text.slice(match.start, match.end);
        snippet.append(match.text.slice(left, match.start), mark, match.text.slice(match.end, right));
        button.append(title, snippet);
        row.append(button);
        return row;
      }));
    }
    for (const button of results.querySelectorAll("button"))
      button.setAttribute("aria-current", String(Number(button.dataset.findIndex) === index));
  }

  function paintActive() {
    if (canvasResult && !canvasResult.block.isConnected) canvasResult = null;
    const range = allFiles ? canvasResult?.range : inSource ? null : matches[index];
    currentBlock?.removeAttribute("data-find-active");
    currentBlock = null;
    if (range && highlights) {
      const active = new Highlight(range);
      active.priority = 1;
      highlights.set("document-find-active", active);
    } else {
      highlights?.delete("document-find-active");
      currentBlock = allFiles ? canvasResult?.block
        : range && range.startContainer.parentElement.closest(".block");
      currentBlock?.setAttribute("data-find-active", "");
    }
    const counter = matches.length ? `${index + 1} / ${matches.length}`
      : input.value.trim() ? "Нет совпадений" : "";
    if (status.textContent !== counter) status.textContent = counter;
    previous.disabled = next.disabled = matches.length < 2;
  }

  function reveal() {
    const match = matches[index];
    if (!match) return;
    if (allFiles) {
      results.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (inSource) {
      showSourceMatch(match.index, match.index + match[0].length);
      return;
    }
    revealOnCanvas(match);
  }

  function revealOnCanvas(target) {
    const bounds = target.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    if (bounds.top < view.top + 24 || bounds.bottom > view.bottom - 24)
      viewport.scrollTop += bounds.top - view.top - viewport.clientHeight / 3;
  }

  function refresh(revealFirst = false) {
    cancelAnimationFrame(frame);
    if (panel.hidden) return;
    if (revealFirst) canvasResult = null;
    const pattern = sidebarSearchPattern(input);
    matches = !pattern ? [] : allFiles ? fileMatches(pattern)
      : inSource ? [...source.value.matchAll(pattern)] : textRanges(blocks.children, pattern);
    index = revealFirst ? 0 : Math.min(index, Math.max(0, matches.length - 1));
    if (highlights) {
      if (allFiles || inSource || !matches.length) highlights.delete("document-find");
      else {
        const all = new Highlight();
        for (const range of matches) all.add(range);
        highlights.set("document-find", all);
      }
    }
    paintActive();
    paintResults(true);
    if (revealFirst) {
      results.scrollTop = 0;
      reveal();
    }
  }

  function schedule() {
    if (panel.hidden) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => refresh());
  }

  function step(direction) {
    if (!matches.length) return;
    index = (index + direction + matches.length) % matches.length;
    paintActive();
    if (allFiles) paintResults();
    reveal();
  }

  const observer = new MutationObserver(schedule);
  function close(restore = false) {
    if (panel.hidden) return;
    panel.hidden = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
    toggle.setAttribute("aria-expanded", "false");
    highlights?.delete("document-find");
    canvasResult = null;
    matches = [];
    index = 0;
    input.value = "";
    projections.clear();
    paintActive();
    paintResults();
    if (restore) (returnFocus?.isConnected ? returnFocus : toggle).focus({ preventScroll: true });
    returnFocus = null;
  }
  function open(searchAll = false) {
    if (searchAll ? !filesEnabled : !localEnabled) return;
    const changedScope = allFiles !== searchAll;
    if (searchAll) searchMode = currentMode;
    allFiles = searchAll;
    scope.setAttribute("aria-pressed", String(allFiles));
    const label = allFiles ? "Найти во всех файлах" : "Найти в документе";
    input.placeholder = label;
    input.setAttribute("aria-label", label);
    if (panel.hidden) {
      returnFocus = document.activeElement;
      prepare();
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      observer.observe(blocks, { childList: true, characterData: true, subtree: true });
    }
    refresh(changedScope);
    input.focus({ preventScroll: true });
    input.select();
  }
  function openResult() {
    const match = matches[index];
    if (!match) return;
    const pattern = sidebarSearchPattern(input);
    const target = showFileMatch(match, searchMode, pattern);
    if (target) {
      const { block, occurrence, count } = target;
      const ranges = textRanges([block], pattern);
      const range = ranges.length === count ? ranges[occurrence] : null;
      canvasResult = { block, range };
      revealOnCanvas(range || block);
    } else canvasResult = null;
    paintActive();
    input.focus({ preventScroll: true });
  }

  toggle.onclick = () => panel.hidden ? open() : close(true);
  scope.onclick = () => open(!allFiles);
  panel.querySelector('[data-find="close"]').onclick = () => close(true);
  previous.onclick = () => step(-1);
  next.onclick = () => step(1);
  input.oninput = () => refresh(true);
  results.onclick = (event) => {
    const button = event.target.closest("[data-find-index]");
    if (!button) return;
    index = Number(button.dataset.findIndex);
    paintActive();
    paintResults();
    openResult();
  };
  source.addEventListener("input", schedule);
  panel.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") close(true);
    else if (event.target === input && event.key === "Enter") {
      if (allFiles) openResult();
      else step(event.shiftKey ? -1 : 1);
    } else if (event.target === input && allFiles &&
               (event.key === "ArrowUp" || event.key === "ArrowDown"))
      step(event.key === "ArrowUp" ? -1 : 1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  return {
    open,
    schedule,
    update(documentId, mode, documentEnabled, workspaceEnabled) {
      if (allFiles ? !workspaceEnabled : (!documentEnabled || id !== documentId)) close();
      id = documentId;
      currentMode = mode;
      inSource = mode === "source" || mode === "latex";
      localEnabled = documentEnabled;
      filesEnabled = workspaceEnabled;
      scope.hidden = !filesEnabled;
      scope.disabled = allFiles && !localEnabled;
      schedule();
    },
  };
}
