import { previewCanvas } from "./pdf-pages.js";
import { documentOption, enhanceDocumentPicker } from "./document-picker.js";
import { maxPdfSpacerHeight } from "./pdf-rules.js";
export function printPdf(blob, filename, onFallback) {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.className = "pdf-print-frame";
  frame.title = "Печать PDF";
  const cleanup = () => {
    frame.remove();
    URL.revokeObjectURL(url);
  };
  frame.onload = () => {
    try {
      frame.contentWindow.addEventListener("afterprint", cleanup, {
        once: true,
      });
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      onFallback();
    }
  };
  frame.src = url;
  document.body.append(frame);
  setTimeout(cleanup, 300_000);
}

const placementHelp = {
  auto: "Блок продолжит общий поток документа. Заголовки автоматически остаются с началом следующего блока.",
  "landscape-sheet":
    "Блок займёт отдельный альбомный лист A4. Длинный блок продолжится на таких же листах.",
  "break-after": "Следующий блок начнётся на новой странице.",
  "break-before":
    "Перед блоком начнётся новая страница. Остальной текст сможет продолжиться под ним.",
  "separate-sheet":
    "Блок займёт отдельный лист или несколько листов. Следующий блок начнётся на новой странице.",
};

function formatSheet({ width, height }) {
  if (Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1)
    return "A4";
  if (Math.abs(width - 841.89) < 1 && Math.abs(height - 595.28) < 1)
    return "A4 · альбомный";
  return "Увеличенный лист";
}

// Zero-height intervals have no printed position. List each one on the
// following block's first page, or on the last page for trailing intervals.
function includeZeroSpacers(data) {
  const blocksOnPages = new Map(data.blocksOnPages);
  const zeroSpacers = new Map();
  let page = data.pageSizes.length || 1;
  for (let i = data.blocks.length - 1; i >= 0; i--) {
    const block = data.blocks[i];
    const first = data.blocksOnPages.get(block.index)?.[0];
    if (first) page = first;
    else if (block.spacer && (block.spacer.height ?? block.spacer.fallback) === 0) {
      if (!zeroSpacers.has(page)) zeroSpacers.set(page, []);
      zeroSpacers.get(page).push(block);
      blocksOnPages.set(block.index, [page]);
    }
  }
  return { ...data, blocksOnPages, zeroSpacers };
}

export function pdfPreview(
  root,
  {
    profile, numbering, download, print, edit, select, rules,
    addSpacer, resizeSpacer, removeSpacer, blockStyle, group, ungroup,
  },
) {
  const by = (name) => root.querySelector('[data-pdf="' + name + '"]');
  const pagePicker = by("page");
  const zoom = by("zoom");
  const status = by("status");
  const stage = by("stage");
  const thumbnails = by("thumbnails");
  const blockPicker = by("block");
  const syncBlockPicker = enhanceDocumentPicker(blockPicker);
  const spacerInsert = by("spacer-insert");
  const spacerSize = by("spacer-size");
  const spacerHeight = by("spacer-height");
  const spacerRemove = by("remove-spacer");
  spacerHeight.max = maxPdfSpacerHeight;
  const warnings = by("warnings");
  const placementRule = by("placement-rule");
  const placementInfo = by("placement-info");
  const keepNext = by("keep-next");
  const profilePicker = by("profile");
  const numberingToggle = by("numbering");
  const retry = by("retry");
  let layout, request, sheetObserver, thumbnailObserver, scrollFrame;
  let paintedDocument;
  let exporting;
  let sheets = [],
    byIndex = new Map();
  const thumbnailDrawings = new Map();
  let page = 0,
    selected = null,
    lastWidth = 0,
    jumpedTo,
    pendingReveal = null,
    groupStart = null;

  function clearSheet(sheet, keepCanvas = false) {
    sheet.pending = null;
    if (keepCanvas) {
      if (sheet.canvas) {
        sheet.fallback = sheet.canvas;
        sheet.fallback.style.objectFit = "contain";
      }
    } else {
      sheet.canvas?.remove();
      sheet.fallback?.remove();
      sheet.fallback = null;
    }
    sheet.canvas = null;
  }
  function stop(keepView = false) {
    sheetObserver?.disconnect();
    thumbnailObserver?.disconnect();
    thumbnailDrawings.clear();
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    for (const sheet of sheets) clearSheet(sheet, keepView);
    layout = request = null;
    selected = null;
    groupStart = null;
    pendingReveal = null;
    page = 0;
    byIndex = new Map();
    if (!keepView) {
      sheets = [];
      paintedDocument = undefined;
      stage.replaceChildren();
      thumbnails.replaceChildren();
    }
  }
  function state(enabled) {
    spacerInsert.hidden = !enabled;
    if (!enabled) {
      spacerInsert.open = false;
      spacerSize.hidden = spacerRemove.hidden = true;
      groupControls();
    }
    for (const name of [
      "download",
      "print",
      "page",
      "zoom",
      "previous",
      "next",
      "block",
      "edit",
      "placement-rule",
      "keep-next",
    ])
      by(name).disabled = !enabled;
  }
  function groupControls() {
    const choosing = groupStart !== null;
    by("group-start").hidden = selected === null || choosing;
    by("group-hint").hidden = by("group-apply").hidden =
      by("group-cancel").hidden = !choosing;
    by("group-apply").disabled = selected === null || selected === groupStart;
    by("group-remove").hidden = choosing || !byIndex.get(selected)?.group;
    by("block-style").hidden = selected === null || Boolean(byIndex.get(selected)?.spacer);
  }
  function markSelection() {
    for (const sheet of sheets) {
      const position = layout.locations
        .get(sheet.number)
        ?.find((location) => location.index === selected);
      sheet.marker.hidden = !position;
      if (position)
        sheet.marker.style.top = (position.top / sheet.height) * 100 + "%";
    }
  }
  function selectBlock(index) {
    const entry = byIndex.get(index);
    selected = entry?.index ?? null;
    blockPicker.value = entry ? String(index) : "";
    syncBlockPicker();
    by("edit").disabled = placementRule.disabled = !entry;
    by("edit").hidden = Boolean(entry?.spacer);
    placementInfo.hidden = !entry;
    spacerSize.hidden = spacerRemove.hidden = !entry?.spacer;
    groupControls();
    if (entry?.spacer) {
      spacerHeight.placeholder = entry.spacer.fallback;
      spacerHeight.value = entry.spacer.height ?? "";
    }
    const activeRules = entry?.rules || [];
    placementRule.value =
      ["landscape-sheet", "separate-sheet", "break-before", "break-after"].find(
        (rule) => activeRules.includes(rule),
      ) || "auto";
    const endsPage = [
      "separate-sheet",
      "landscape-sheet",
      "break-after",
    ].includes(placementRule.value);
    keepNext.checked =
      !endsPage && Boolean(entry?.heading || activeRules.includes("keep-next"));
    keepNext.disabled = !entry || entry.heading || endsPage;
    by("clear").hidden = !activeRules.length;
    let description = "";
    if (entry) {
      const pages = layout.blocksOnPages.get(index) || [];
      description =
        pages.length > 1
          ? "Страницы " + pages[0] + "–" + pages.at(-1)
          : pages.length
            ? "Страница " + pages[0]
            : "";
      select(index);
    }
    by("placement").textContent = description;
    const help =
      placementRule.value === "auto" && layout.automaticSheets.has(index)
        ? "PDF-профиль вынес этот широкий блок на отдельный лист."
        : placementHelp[placementRule.value];
    by("placement-help").textContent = description ? help : "";
    markSelection();
  }
  function updateThumbnails(previous) {
    thumbnails.children[previous - 1]?.removeAttribute("aria-current");
    const button = thumbnails.children[page - 1];
    if (!button) return;
    button.setAttribute("aria-current", "page");
    const item = button.getBoundingClientRect(),
      frame = thumbnails.getBoundingClientRect();
    if (item.top < frame.top) thumbnails.scrollTop += item.top - frame.top;
    else if (item.bottom > frame.bottom)
      thumbnails.scrollTop += item.bottom - frame.bottom;
  }
  function setPage(number, preferred) {
    if (!sheets[number - 1]) return;
    const previous = page;
    page = number;
    pagePicker.value = String(page);
    by("previous").disabled = page <= 1;
    by("next").disabled = page >= sheets.length;
    if (previous !== page) {
      updateThumbnails(previous);
      const candidates = (layout.locations.get(page) || [])
        .map(({ index }) => byIndex.get(index))
        .filter(Boolean);
      const zeroSpacers = layout.zeroSpacers.get(page);
      if (zeroSpacers) {
        candidates.push(...zeroSpacers);
        candidates.sort((a, b) => a.index - b.index);
      }
      blockPicker.replaceChildren(
        ...candidates.map(
          (block) =>
            documentOption(block.label, block.index, {
              suffix: layout.blocksOnPages.get(block.index)[0] < page ? " · продолжение" : "",
            }),
        ),
      );
    }
    const value = preferred ?? selected;
    const option =
      Array.from(blockPicker.options).find(
        (item) => item.value === String(value),
      ) || blockPicker.options[0];
    selectBlock(option ? Number(option.value) : null);
  }
  function jump(next, preferred) {
    if (!layout || !sheets.length) return;
    const number = Math.max(1, Math.min(sheets.length, next));
    const sheet = sheets[number - 1];
    stage.scrollTop = Math.max(0, sheet.element.offsetTop - 8);
    jumpedTo = stage.scrollTop;
    setPage(number, preferred);
  }
  function revealBlock(index) {
    const number = layout.blocksOnPages.get(index)?.[0];
    if (!number) return false;
    jump(number, index);
    const sheet = sheets[number - 1];
    const position = layout.locations.get(number)?.find((item) => item.index === index);
    if (position) {
      stage.scrollTop += sheet.paper.getBoundingClientRect().top -
        stage.getBoundingClientRect().top + position.top * sheet.scale -
        Math.min(stage.clientHeight / 4, 130);
      jumpedTo = stage.scrollTop;
    }
    return true;
  }
  function onScroll() {
    if (!layout || !sheets.length || Math.abs(stage.scrollTop - (jumpedTo ?? -10)) < 1)
      return;
    jumpedTo = undefined;
    const target = stage.scrollTop + Math.min(stage.clientHeight * 0.32, 180);
    let low = 0,
      high = sheets.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const element = sheets[mid].element;
      if (element.offsetTop + element.offsetHeight <= target) low = mid + 1;
      else high = mid;
    }
    if (low + 1 !== page) setPage(low + 1);
  }
  stage.addEventListener(
    "scroll",
    () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        onScroll();
      });
    },
    { passive: true },
  );

  async function drawSheet(sheet) {
    if (!layout || sheet.pending || sheet.canvas) return;
    const token = {};
    sheet.pending = token;
    const valid = () => sheet.pending === token;
    try {
      const view = { width: sheet.width * sheet.scale, height: sheet.height * sheet.scale };
      const pixels = Math.min(
        Math.max(1.5, (devicePixelRatio || 1) * 1.25),
        3,
        Math.sqrt(10e6 / (view.width * view.height)),
      );
      const canvas = previewCanvas(view, pixels);
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Страница " + sheet.number);
      await layout.paintPage(sheet.number, canvas, valid);
      if (!valid()) return;
      sheet.fallback?.remove();
      sheet.fallback = null;
      sheet.canvas = canvas;
      sheet.paper.prepend(canvas);
      stage.setAttribute("aria-busy", "false");
    } catch (error) {
      if (!valid()) return;
      stage.setAttribute("aria-busy", "false");
      status.textContent =
        "Не удалось показать страницу " + sheet.number + ". PDF можно скачать.";
    } finally {
      if (valid()) sheet.pending = null;
    }
  }
  function layoutSheets() {
    lastWidth = stage.clientWidth;
    const current = sheets[page - 1];
    const offset = current
      ? (stage.scrollTop - current.element.offsetTop) /
        Math.max(1, current.element.offsetHeight)
      : 0;
    for (const sheet of sheets) {
      const scale =
        zoom.value === "fit"
          ? Math.min(1.4, Math.max(100, lastWidth - 28) / sheet.width)
          : Number(zoom.value) * (4 / 3);
      if (scale === sheet.scale) continue;
      clearSheet(sheet, true);
      sheet.scale = scale;
      sheet.element.style.width = sheet.width * scale + "px";
      sheet.paper.style.height = sheet.height * scale + "px";
      if (sheet.near) void drawSheet(sheet);
    }
    if (current) {
      stage.scrollTop = Math.max(
        0,
        current.element.offsetTop + offset * current.element.offsetHeight,
      );
      jumpedTo = stage.scrollTop;
    }
  }
  function makeSheets(previous) {
    const current = layout;
    sheetObserver = new IntersectionObserver(
      (entries) => {
        if (layout !== current) return;
        for (const { target, isIntersecting } of entries) {
          const sheet = sheets[Number(target.dataset.page) - 1];
          sheet.near = isIntersecting;
          if (isIntersecting) void drawSheet(sheet);
          else clearSheet(sheet);
        }
      },
      { root: stage, rootMargin: "440px 0px" },
    );
    const fragment = document.createDocumentFragment();
    for (let number = 1; number <= current.pageSizes.length; number++) {
      const {
        width,
        height,
        marginLeft = 38,
      } = layout.pageSizes[number - 1] || {
        width: 595.28,
        height: 841.89,
      };
      const element = document.createElement("section");
      element.className = "pdf-sheet";
      element.setAttribute("aria-label", "Лист " + number);
      const header = document.createElement("div");
      header.className = "pdf-sheet-title";
      header.textContent =
        "Страница " + number + " · " + formatSheet({ width, height });
      const paper = document.createElement("div");
      paper.className = "pdf-sheet-paper";
      paper.dataset.page = number;
      paper.style.setProperty(
        "--pdf-page-margin-left",
        (marginLeft / width) * 100 + "%",
      );
      const marker = document.createElement("div");
      marker.className = "pdf-block-marker";
      marker.hidden = true;
      marker.setAttribute("aria-hidden", "true");
      paper.append(marker);
      element.append(header, paper);
      fragment.append(element);
      const sheet = { number, width, height, element, paper, marker };
      const old = previous[number - 1];
      if (old?.fallback) {
        sheet.fallback = old.fallback;
        paper.prepend(sheet.fallback);
      }
      sheets.push(sheet);
      paper.onclick = (event) => {
        if (!layout) return;
        const blocks = layout.locations.get(number) || [];
        const position =
          (event.clientY - paper.getBoundingClientRect().top) / sheet.scale;
        const location =
          blocks.findLast((item) => item.top <= position + 2) || blocks[0];
        if (location) setPage(number, location.index);
      };
    }
    stage.append(fragment);
    layoutSheets();
    sheets.forEach((sheet) => sheetObserver.observe(sheet.paper));
  }
  function makeThumbnails() {
    const current = layout;
    thumbnailObserver = new IntersectionObserver(
      (entries) => {
        if (layout !== current) return;
        for (const { isIntersecting, target } of entries) {
          const surface = target.firstElementChild;
          const pending = thumbnailDrawings.get(target);
          if (!isIntersecting) {
            thumbnailDrawings.delete(target);
            surface.replaceChildren();
            continue;
          }
          if (pending || surface.firstChild) continue;
          const token = {};
          thumbnailDrawings.set(target, token);
          const valid = () => thumbnailDrawings.get(target) === token;
          void (async () => {
            const number = Number(target.dataset.page);
            const { width, height } = current.pageSizes[number - 1];
            const scale = Math.min(96 / width, 128 / height);
            const viewport = { width: width * scale, height: height * scale };
            const density = Math.max(2.5, Math.min(3, devicePixelRatio || 1));
            const canvas = previewCanvas(viewport, density);
            await current.paintPage(number, canvas, valid);
            if (valid()) surface.append(canvas);
          })()
            .catch(() => {})
            .finally(() => {
              if (valid()) thumbnailDrawings.delete(target);
            });
        }
      },
      { root: thumbnails, rootMargin: "128px 0px" },
    );
    for (let number = 1; number <= current.pageSizes.length; number++) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.page = number;
      button.setAttribute("aria-label", "Страница " + number);
      const surface = document.createElement("span");
      surface.className = "pdf-thumbnail-sheet";
      surface.setAttribute("aria-hidden", "true");
      const { width, height } = sheets[number - 1];
      const scale = Math.min(96 / width, 128 / height);
      surface.style.width = width * scale + "px";
      surface.style.height = height * scale + "px";
      button.append(surface, String(number));
      button.onclick = () => jump(number);
      thumbnails.append(button);
      thumbnailObserver.observe(button);
    }
  }
  function listWarnings() {
    warnings.replaceChildren();
    for (const warning of layout.warnings) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = warning.message;
      button.onclick = () =>
        jump(
          layout.blocksOnPages.get(warning.index)?.[0] || page,
          warning.index,
        );
      warnings.append(button);
    }
    warnings.hidden = !layout.warnings.length;
  }
  new ResizeObserver(() => {
    if (
      layout &&
      sheets.length &&
      zoom.value === "fit" &&
      stage.clientWidth &&
      stage.clientWidth !== lastWidth
    )
      layoutSheets();
  }).observe(stage);
  pagePicker.onchange = () => jump(Number(pagePicker.value));
  zoom.onchange = () => {
    if (sheets.length) layoutSheets();
  };
  by("previous").onclick = () => jump(page - 1);
  by("next").onclick = () => jump(page + 1);
  async function output(action) {
    if (!layout || exporting === layout) return;
    const current = layout;
    exporting = current;
    by("download").disabled = by("print").disabled = true;
    status.textContent = "Подготовка PDF…";
    let message = "Страниц: " + current.pageSizes.length;
    try {
      action({ name: current.name, blob: await current.getBlob() });
    } catch (error) {
      message = "Не удалось создать PDF. " + error.message;
    } finally {
      if (exporting === current) exporting = null;
      if (layout === current) {
        by("download").disabled = by("print").disabled = false;
        status.textContent = message;
      }
    }
  }
  by("download").onclick = () => void output(download);
  by("print").onclick = () => void output(print);
  by("edit").onclick = () => {
    if (selected !== null) edit(selected);
  };
  by("clear").onclick = () => {
    if (selected !== null) rules(selected, []);
  };
  blockPicker.onchange = () => selectBlock(Number(blockPicker.value));
  by("block-style").onclick = () => {
    if (selected !== null) blockStyle(selected);
  };
  by("group-start").onclick = () => {
    if (selected === null) return;
    groupStart = selected;
    groupControls();
    (blockPicker.previousElementSibling?.querySelector(".document-picker-trigger") ?? blockPicker).focus();
  };
  by("group-cancel").onclick = () => {
    groupStart = null;
    groupControls();
    by("group-start").focus();
  };
  by("group-apply").onclick = () => {
    if (selected === null || groupStart === null || selected === groupStart) return;
    group(groupStart, selected);
  };
  by("group-remove").onclick = () => {
    if (selected !== null) ungroup(selected);
  };
  const insertSpacer = (before) => {
    spacerInsert.open = false;
    addSpacer(selected, before);
  };
  by("spacer-before").onclick = () => insertSpacer(true);
  by("spacer-after").onclick = () => insertSpacer(false);
  spacerRemove.onclick = () => {
    if (selected !== null) removeSpacer(selected);
  };
  spacerHeight.onchange = () => {
    if (!spacerHeight.reportValidity() || selected === null || !byIndex.get(selected)?.spacer) return;
    resizeSpacer(selected, spacerHeight.value === "" ? null : spacerHeight.valueAsNumber);
  };
  profilePicker.onchange = () => profile(profilePicker.value);
  numberingToggle.onchange = () => numbering(numberingToggle.checked);
  const saveRule = () => {
    if (selected === null) return;
    const next = [];
    if (placementRule.value !== "auto") next.push(placementRule.value);
    if (
      keepNext.checked &&
      !byIndex.get(selected)?.heading &&
      !["separate-sheet", "landscape-sheet", "break-after"].includes(
        placementRule.value,
      )
    )
      next.push("keep-next");
    rules(selected, next);
  };
  placementRule.onchange = keepNext.onchange = saveRule;
  root.addEventListener("pointerdown", (event) => {
    if (!placementInfo.contains(event.target)) placementInfo.open = false;
    if (!spacerInsert.contains(event.target)) spacerInsert.open = false;
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = spacerInsert.open ? spacerInsert : placementInfo.open ? placementInfo : null;
    if (!open) return;
    event.preventDefault();
    open.open = false;
    open.querySelector("summary").focus();
  });
  return {
    reveal(index) {
      if (layout && sheets.length) revealBlock(index);
      else pendingReveal = index;
    },
    hide() {
      if (!root.hidden) stop();
      placementInfo.open = false;
      spacerInsert.open = false;
      root.hidden = true;
    },
    async show(pending, settings, block, force = false) {
      root.hidden = false;
      numberingToggle.checked = settings.numbering;
      if (request === pending && !force) {
        if (layout && sheets.length && layout.blocksOnPages.has(block))
          jump(layout.blocksOnPages.get(block)[0], block);
        return;
      }
      const keepView = paintedDocument === settings.documentId && sheets.some((sheet) => sheet.canvas || sheet.fallback);
      stop(keepView);
      state(false);
      placementInfo.hidden = true;
      by("clear").hidden = true;
      by("placement").textContent = by("placement-help").textContent = "";
      warnings.hidden = retry.hidden = true;
      stage.setAttribute("aria-busy", "true");
      profilePicker.value = settings.profile;
      request = pending;
      status.textContent = keepView ? "Обновляем страницы…" : "Размечаем страницы…";
      retry.onclick = () => profile(settings.profile, true);
      try {
        const data = await pending;
        if (request !== pending) return;
        const previous = sheets;
        const old = previous.findLast((sheet) => sheet.element.offsetTop <= stage.scrollTop);
        const offset = old
          ? (stage.scrollTop - old.element.offsetTop) / Math.max(1, old.element.offsetHeight)
          : 0;
        sheets = [];
        stage.replaceChildren();
        thumbnails.replaceChildren();
        layout = includeZeroSpacers(data);
        byIndex = new Map(data.blocks.map((entry) => [entry.index, entry]));
        paintedDocument = settings.documentId;
        state(true);
        pagePicker.replaceChildren(
          ...Array.from(
            { length: layout.pageSizes.length },
            (_, i) => new Option("Страница " + (i + 1), i + 1),
          ),
        );
        status.textContent = "Страниц: " + layout.pageSizes.length;
        makeSheets(previous);
        makeThumbnails();
        listWarnings();
        const revealed = pendingReveal !== null && revealBlock(pendingReveal);
        pendingReveal = null;
        if (!revealed) {
          const pages = layout.blocksOnPages.get(block);
          const current = old && (pages?.includes(old.number) || !pages) && sheets[old.number - 1];
          if (current) {
            stage.scrollTop = current.element.offsetTop + offset * current.element.offsetHeight;
            jumpedTo = stage.scrollTop;
            setPage(current.number, block);
          } else if (!old || !revealBlock(block)) jump(pages?.[0] || 1, block);
        }
      } catch (error) {
        if (request !== pending) return;
        stage.setAttribute("aria-busy", "false");
        status.textContent =
          "Не удалось открыть предпросмотр. " + error.message;
        retry.hidden = false;
      }
    },
  };
}
