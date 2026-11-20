export function previewCanvas(view, density) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(view.width * density));
  canvas.height = Math.max(1, Math.ceil(view.height * density));
  return canvas;
}

export async function openPdfTask(blob) {
  const lib = await import("./vendor/pdfjs/pdf.min.mjs");
  lib.GlobalWorkerOptions.workerSrc = new URL(
    "./vendor/pdfjs/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  return lib.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    useWasm: false,
    isEvalSupported: false,
    enableXfa: false,
  });
}
// Page dimensions and block locations come from the same export as the PDF bytes.
export function sourcePages(stage, onSelect) {
  let loading,
    layoutRequest,
    task,
    layout,
    observer,
    version = 0,
    sheets = [],
    lastWidth = 0,
    pendingBlock;
  function clear(sheet) {
    sheet.job?.cancel();
    sheet.revision++;
    sheet.job = null;
    sheet.canvas = null;
    sheet.element.replaceChildren();
  }
  function dispose() {
    observer?.disconnect();
    sheets.forEach(clear);
    sheets = [];
    if (task) void task.destroy().catch(() => {});
    task = null;
    layout = layoutRequest = null;
  }
  function hide() {
    version++;
    loading = null;
    pendingBlock = undefined;
    dispose();
  }
  async function draw(sheet, pdf) {
    if (sheet.canvas || !sheet.visible) return;
    const revision = ++sheet.revision;
    try {
      const page = await pdf.getPage(sheet.number);
      if (revision !== sheet.revision || !sheet.visible) return;
      const view = page.getViewport({
        scale: sheet.element.clientWidth / sheet.width,
      });
      const scale = Math.min(
        Math.max(1.5, devicePixelRatio || 1),
        3,
        Math.sqrt(10e6 / (view.width * view.height)),
      );
      const canvas = previewCanvas(view, scale);
      sheet.job = page.render({
        canvas,
        viewport: view,
        transform: [scale, 0, 0, scale, 0, 0],
      });
      await sheet.job.promise;
      if (revision !== sheet.revision) return;
      sheet.job = null;
      sheet.canvas = canvas;
      sheet.element.replaceChildren(canvas);
    } catch (error) {
      if (revision === sheet.revision)
        sheet.element.textContent =
          "Не удалось показать лист. " + error.message;
    }
  }
  new ResizeObserver(() => {
    if (lastWidth === stage.clientWidth) return;
    lastWidth = stage.clientWidth;
    for (const sheet of sheets)
      if (sheet.visible) {
        clear(sheet);
        void draw(sheet, sheet.pdf);
      }
  }).observe(stage);
  function pageY(index) {
    const number = layout.blocksOnPages.get(index)?.[0];
    const sheet = sheets[number - 1];
    if (!sheet) return null;
    const y =
      layout.locations.get(number)?.find((row) => row.index === index)?.top ||
      0;
    return (
      sheet.element.offsetTop + (y * sheet.element.clientWidth) / sheet.width
    );
  }
  function scrollToBlock(index, fraction = 0, bottom = false, ensure = false) {
    if (!layout || loading !== layoutRequest)
      pendingBlock = [index, fraction, bottom, ensure];
    if (!layout) return;
    const start = pageY(index);
    if (start === null) return;
    const end = pageY(index + 1) ?? stage.scrollHeight;
    const y = bottom
      ? stage.scrollHeight
      : start + fraction * Math.max(0, end - start);
    if (
      !ensure ||
      y < stage.scrollTop ||
      y > stage.scrollTop + stage.clientHeight - 32
    )
      stage.scrollTop = Math.max(0, y - (ensure ? 12 : 0));
  }
  return {
    hide,
    scrollToBlock,
    cancelFollow() {
      pendingBlock = undefined;
    },
    async show(pending, valid) {
      if (layoutRequest === pending) {
        loading = pending;
        return;
      }
      loading = pending;
      const key = ++version;
      const active = () => key === version && valid();
      if (!layout) stage.textContent = "Подготовка PDF…";
      let next;
      try {
        const data = await pending;
        if (!active()) return;
        next = await openPdfTask(data.blob);
        if (!active()) {
          await next.destroy();
          return;
        }
        const pdf = await next.promise;
        if (!active()) {
          await next.destroy();
          return;
        }
        const pos = stage.scrollTop,
          old = sheets.findLast((s) => s.element.offsetTop <= pos);
        const fraction = old
          ? (pos - old.element.offsetTop) / old.element.offsetHeight
          : 0;
        // Keep the last visible page in place until its replacement is painted.
        const previousCanvases = sheets.map(
          (sheet) => sheet.element.firstElementChild,
        );
        dispose();
        task = next;
        layout = data;
        layoutRequest = pending;
        const fragment = document.createDocumentFragment();
        for (const [i, { width, height }] of data.pageSizes.entries()) {
          const number = i + 1,
            element = document.createElement("div");
          element.className = "source-sheet";
          element.dataset.page = number;
          element.setAttribute("role", "img");
          element.setAttribute("aria-label", "Страница " + number);
          element.style.aspectRatio = width + "/" + height;
          element.onclick = (e) => {
            const y =
              ((e.clientY - element.getBoundingClientRect().top) * width) /
              element.clientWidth;
            const rows = data.locations.get(number) || [];
            const row = rows.findLast((r) => r.top <= y + 2) || rows[0];
            if (row) onSelect(row.index);
          };
          if (previousCanvases[i]) element.append(previousCanvases[i]);
          sheets.push({ number, width, element, pdf, revision: 0 });
          fragment.append(element);
        }
        stage.replaceChildren(fragment);
        if (old) {
          const el = sheets[Math.min(old.number, sheets.length) - 1]?.element;
          if (el) stage.scrollTop = el.offsetTop + fraction * el.offsetHeight;
        }
        if (pendingBlock !== undefined) {
          scrollToBlock(...pendingBlock);
          pendingBlock = undefined;
        }
        observer = new IntersectionObserver(
          (entries) => {
            if (task !== next) return;
            for (const entry of entries) {
              const sheet = sheets[Number(entry.target.dataset.page) - 1];
              sheet.visible = entry.isIntersecting;
              if (sheet.visible) void draw(sheet, pdf);
              else clear(sheet);
            }
          },
          { root: stage, rootMargin: "320px 0px" },
        );
        sheets.forEach((s) => observer.observe(s.element));
      } catch (error) {
        if (next && next !== task) void next.destroy().catch(() => {});
        if (active()) {
          dispose();
          loading = null;
          stage.textContent = "Не удалось показать PDF. " + error.message;
        }
      }
    },
  };
}
