import { previewCanvas, openPdfTask } from "./pdf-pages.js";
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
  { profile, numbering, download, print, edit, select, rules, addSpacer, resizeSpacer, removeSpacer },
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
  let task, pdf, layout, request, sheetObserver, thumbnailObserver, scrollFrame;
  let sheets = [],
    byIndex = new Map();
  const thumbnailDrawings = new Map();
  let page = 0,
    selected = null,
    lastWidth = 0,
    jumpedTo,
    pendingReveal = null;

  function clearSheet(sheet) {
    sheet.pending = null;
    sheet.drawing?.cancel();
    sheet.drawing = null;
    sheet.canvas?.remove();
    sheet.canvas = null;
  }
  function stop() {
    sheetObserver?.disconnect();
    thumbnailObserver?.disconnect();
    for (const thumbnail of thumbnailDrawings.values())
      thumbnail.drawing?.cancel();
    thumbnailDrawings.clear();
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    sheets.forEach(clearSheet);
    if (task) void task.destroy().catch(() => {});
    task = pdf = request = null;
    selected = null;
    pendingReveal = null;
    page = 0;
    sheets = [];
    byIndex = new Map();
    stage.replaceChildren();
    thumbnails.replaceChildren();
  }
  function state(enabled) {
    spacerInsert.hidden = !enabled;
    if (!enabled) {
      spacerInsert.open = false;
      spacerSize.hidden = spacerRemove.hidden = true;
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
    if (!sheets.length) return;
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
    if (!sheets.length || Math.abs(stage.scrollTop - (jumpedTo ?? -10)) < 1)
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
    if (!pdf || sheet.pending || sheet.canvas) return;
    const current = pdf;
    const token = {};
    sheet.pending = token;
    try {
      const source = await current.getPage(sheet.number);
      if (sheet.pending !== token) return;
      const view = source.getViewport({ scale: sheet.scale });
      const pixels = Math.min(
        Math.max(1.5, (devicePixelRatio || 1) * 1.25),
        3,
        Math.sqrt(10e6 / (view.width * view.height)),
      );
      const canvas = previewCanvas(view, pixels);
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Страница " + sheet.number);
      sheet.drawing = source.render({
        canvas,
        viewport: view,
        transform: [pixels, 0, 0, pixels, 0, 0],
      });
      await sheet.drawing.promise;
      if (sheet.pending !== token) return;
      sheet.canvas = canvas;
      sheet.paper.prepend(canvas);
      stage.setAttribute("aria-busy", "false");
    } catch (error) {
      if (
        sheet.pending !== token ||
        error.name === "RenderingCancelledException"
      )
        return;
      stage.setAttribute("aria-busy", "false");
      status.textContent =
        "Не удалось показать страницу " + sheet.number + ". PDF можно скачать.";
    } finally {
      if (sheet.pending === token) sheet.pending = sheet.drawing = null;
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
      clearSheet(sheet);
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
  function makeSheets() {
    const current = pdf;
    sheetObserver = new IntersectionObserver(
      (entries) => {
        if (pdf !== current) return;
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
    for (let number = 1; number <= current.numPages; number++) {
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
      sheets.push(sheet);
      paper.onclick = (event) => {
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
    const current = pdf;
    thumbnailObserver = new IntersectionObserver(
      (entries) => {
        if (pdf !== current) return;
        for (const { isIntersecting, target } of entries) {
          const surface = target.firstElementChild;
          const pending = thumbnailDrawings.get(target);
          if (!isIntersecting) {
            pending?.drawing?.cancel();
            thumbnailDrawings.delete(target);
            surface.replaceChildren();
            continue;
          }
          if (pending || surface.firstChild) continue;
          const request = {};
          thumbnailDrawings.set(target, request);
          void (async () => {
            const sheet = await current.getPage(Number(target.dataset.page));
            if (thumbnailDrawings.get(target) !== request) return;
            const { width, height } = sheet.getViewport({ scale: 1 });
            const viewport = sheet.getViewport({
              scale: Math.min(96 / width, 128 / height),
            });
            const density = Math.max(2.5, Math.min(3, devicePixelRatio || 1));
            const canvas = previewCanvas(viewport, density);
            request.drawing = sheet.render({
              canvas,
              viewport,
              transform: [density, 0, 0, density, 0, 0],
            });
            await request.drawing.promise;
            if (thumbnailDrawings.get(target) === request)
              surface.append(canvas);
          })()
            .catch(() => {})
            .finally(() => {
              if (thumbnailDrawings.get(target) === request)
                thumbnailDrawings.delete(target);
            });
        }
      },
      { root: thumbnails, rootMargin: "128px 0px" },
    );
    for (let number = 1; number <= current.numPages; number++) {
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
  by("download").onclick = () => {
    if (layout) download(layout);
  };
  by("print").onclick = () => {
    if (layout) print(layout);
  };
  by("edit").onclick = () => {
    if (selected !== null) edit(selected);
  };
  by("clear").onclick = () => {
    if (selected !== null) rules(selected, []);
  };
  blockPicker.onchange = () => selectBlock(Number(blockPicker.value));
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
      if (sheets.length) revealBlock(index);
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
        if (sheets.length && layout.blocksOnPages.has(block))
          jump(layout.blocksOnPages.get(block)[0], block);
        return;
      }
      stop();
      layout = null;
      state(false);
      placementInfo.hidden = true;
      by("clear").hidden = true;
      by("placement").textContent = by("placement-help").textContent = "";
      warnings.hidden = retry.hidden = true;
      stage.setAttribute("aria-busy", "true");
      profilePicker.value = settings.profile;
      request = pending;
      status.textContent = "Формируем PDF…";
      retry.onclick = () => profile(settings.profile, true);
      try {
        const data = await pending;
        if (request !== pending) return;
        layout = includeZeroSpacers(data);
        byIndex = new Map(data.blocks.map((entry) => [entry.index, entry]));
        by("download").disabled = by("print").disabled = false;
        const nextTask = await openPdfTask(data.blob);
        if (request !== pending) {
          void nextTask.destroy().catch(() => {});
          return;
        }
        task = nextTask;
        const loaded = await task.promise;
        if (request !== pending) return;
        pdf = loaded;
        state(true);
        pagePicker.replaceChildren(
          ...Array.from(
            { length: pdf.numPages },
            (_, i) => new Option("Страница " + (i + 1), i + 1),
          ),
        );
        status.textContent = "Страниц: " + pdf.numPages;
        makeSheets();
        makeThumbnails();
        listWarnings();
        const revealed = pendingReveal !== null && revealBlock(pendingReveal);
        pendingReveal = null;
        if (!revealed) jump(layout.blocksOnPages.get(block)?.[0] || 1, block);
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
