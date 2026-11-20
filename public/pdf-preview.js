import { pdfRuleNames } from "./pdf-rules.js";

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

export function pdfPreview(root, { profile, download, print, edit, rules }) {
  const by = (name) => root.querySelector('[data-pdf="' + name + '"]');
  const pagePicker = by("page");
  const zoom = by("zoom");
  const status = by("status");
  const stage = by("stage");
  const thumbnails = by("thumbnails");
  const blockPicker = by("block");
  const warnings = by("warnings");
  const profilePicker = by("profile");
  const retry = by("retry");
  const ruleButtons = [...root.querySelectorAll("[data-pdf-rule]")];
  let task, pdf, layout, request, observer, drawing;
  let page = 1;
  let tick = 0;
  let ready = false;
  let lastWidth = 0;

  function stop() {
    tick++;
    observer?.disconnect();
    drawing?.cancel();
    if (task) void task.destroy().catch(() => {});
    task = pdf = drawing = request = null;
    ready = false;
    stage.replaceChildren();
    thumbnails.replaceChildren();
  }
  function state(enabled) {
    for (const name of [
      "download",
      "print",
      "page",
      "zoom",
      "previous",
      "next",
      "block",
      "edit",
    ])
      by(name).disabled = !enabled;
    ruleButtons.forEach((button) => (button.disabled = !enabled));
  }
  function selectBlock(index) {
    const entry = layout?.blocks.find((block) => block.index === index);
    blockPicker.value = entry ? String(index) : "";
    by("edit").disabled = !entry;
    for (const button of ruleButtons) {
      button.disabled = !entry;
      button.setAttribute(
        "aria-pressed",
        String(entry?.rules.includes(button.dataset.pdfRule) || false),
      );
    }
    by("clear").hidden = !entry?.rules.length;
  }
  function showPage(next, preferred) {
    if (!pdf) return;
    page = Math.max(1, Math.min(pdf.numPages, next));
    pagePicker.value = String(page);
    by("previous").disabled = page <= 1;
    by("next").disabled = page >= pdf.numPages;
    updateThumbnails();
    const candidates = layout.blocks.filter((block) =>
      layout.blocksOnPages.get(block.index)?.includes(page),
    );
    blockPicker.replaceChildren(
      ...candidates.map((block) => new Option(block.label, block.index)),
    );
    selectBlock(
      candidates.some((block) => block.index === preferred)
        ? preferred
        : candidates[0]?.index,
    );
    lastWidth = stage.clientWidth;
    void drawPage();
  }
  function updateThumbnails() {
    for (const button of thumbnails.children) {
      if (Number(button.dataset.page) === page) {
        button.setAttribute("aria-current", "page");
        const item = button.getBoundingClientRect();
        const frame = thumbnails.getBoundingClientRect();
        if (item.top < frame.top) thumbnails.scrollTop += item.top - frame.top;
        else if (item.bottom > frame.bottom)
          thumbnails.scrollTop += item.bottom - frame.bottom;
      } else button.removeAttribute("aria-current");
    }
  }
  async function drawPage() {
    const current = pdf,
      number = page;
    drawing?.cancel();
    drawing = null;
    const token = ++tick;
    try {
      const sheet = await current.getPage(number);
      if (token !== tick) return;
      const original = sheet.getViewport({ scale: 1 });
      const scale =
        zoom.value === "fit"
          ? Math.min(
              1.4,
              Math.max(100, stage.clientWidth - 24) / original.width,
            )
          : Number(zoom.value) * (4 / 3);
      const viewport = sheet.getViewport({ scale });
      const pixels = Math.min(
        devicePixelRatio || 1,
        2,
        Math.sqrt(12e6 / (viewport.width * viewport.height)),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width * pixels));
      canvas.height = Math.max(1, Math.floor(viewport.height * pixels));
      canvas.style.width = viewport.width + "px";
      canvas.style.height = viewport.height + "px";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Страница " + number);
      drawing = sheet.render({
        canvas,
        viewport,
        transform: [pixels, 0, 0, pixels, 0, 0],
      });
      await drawing.promise;
      if (token !== tick) return;
      const preserveScroll =
        stage.firstElementChild?.getAttribute("aria-label") ===
        canvas.getAttribute("aria-label");
      stage.replaceChildren(canvas);
      stage.setAttribute("aria-busy", "false");
      if (!preserveScroll) stage.scrollTo(0, 0);
    } catch (error) {
      if (token !== tick || error.name === "RenderingCancelledException")
        return;
      stage.setAttribute("aria-busy", "false");
      status.textContent =
        "Не удалось показать эту страницу. PDF можно скачать.";
    }
  }
  function makeThumbnails() {
    const current = pdf;
    observer = new IntersectionObserver(
      (entries) => {
        for (const { isIntersecting, target } of entries) {
          if (!isIntersecting) continue;
          observer?.unobserve(target);
          void (async () => {
            const sheet = await current.getPage(Number(target.dataset.page));
            if (pdf !== current || !target.isConnected) return;
            const { width, height } = sheet.getViewport({ scale: 1 });
            const viewport = sheet.getViewport({
              scale: Math.min(96 / width, 128 / height),
            });
            const canvas = target.querySelector("canvas");
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            await sheet.render({ canvas, viewport }).promise;
          })().catch(() => {});
        }
      },
      { root: thumbnails },
    );
    for (let number = 1; number <= current.numPages; number++) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.page = number;
      button.setAttribute("aria-label", "Страница " + number);
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 126;
      canvas.setAttribute("aria-hidden", "true");
      button.append(canvas, String(number));
      button.onclick = () => showPage(number);
      thumbnails.append(button);
      observer.observe(button);
    }
  }
  function listWarnings() {
    warnings.replaceChildren();
    for (const warning of layout.warnings) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = warning.message;
      button.onclick = () =>
        showPage(
          layout.blocksOnPages.get(warning.index)?.[0] || page,
          warning.index,
        );
      warnings.append(button);
    }
    warnings.hidden = !layout.warnings.length;
  }
  new ResizeObserver(() => {
    if (
      ready &&
      zoom.value === "fit" &&
      stage.clientWidth &&
      stage.clientWidth !== lastWidth
    ) {
      lastWidth = stage.clientWidth;
      void drawPage();
    }
  }).observe(stage);
  pagePicker.onchange = () => showPage(Number(pagePicker.value));
  zoom.onchange = () => {
    if (ready) void drawPage();
  };
  by("previous").onclick = () => showPage(page - 1);
  by("next").onclick = () => showPage(page + 1);
  by("download").onclick = () => {
    if (layout) download(layout);
  };
  by("print").onclick = () => {
    if (layout) print(layout);
  };
  by("edit").onclick = () => edit(Number(blockPicker.value));
  by("clear").onclick = () => rules(Number(blockPicker.value), null);
  blockPicker.onchange = () => selectBlock(Number(blockPicker.value));
  profilePicker.onchange = () => profile(profilePicker.value);
  for (const button of ruleButtons) {
    button.title = pdfRuleNames[button.dataset.pdfRule];
    button.onclick = () =>
      rules(Number(blockPicker.value), button.dataset.pdfRule);
  }
  return {
    hide() {
      if (!root.hidden) stop();
      by("rules").open = false;
      root.hidden = true;
    },
    async show(pending, settings, selected, force = false) {
      root.hidden = false;
      if (request === pending && !force) {
        if (ready && layout.blocksOnPages.has(selected))
          showPage(layout.blocksOnPages.get(selected)[0], selected);
        return;
      }
      stop();
      layout = null;
      state(false);
      by("clear").hidden = true;
      warnings.hidden = retry.hidden = true;
      stage.setAttribute("aria-busy", "true");
      profilePicker.value = settings;
      request = pending;
      status.textContent = "Формируем PDF…";
      retry.onclick = () => profile(settings, true);
      try {
        const data = await pending;
        if (request !== pending) return;
        layout = data;
        by("download").disabled = by("print").disabled = false;
        const lib = await import("./vendor/pdfjs/pdf.min.mjs");
        if (request !== pending) return;
        lib.GlobalWorkerOptions.workerSrc = new URL(
          "./vendor/pdfjs/pdf.worker.min.mjs",
          import.meta.url,
        ).href;
        const bytes = new Uint8Array(await data.blob.arrayBuffer());
        if (request !== pending) return;
        task = lib.getDocument({
          data: bytes,
          useWasm: false,
          isEvalSupported: false,
          enableXfa: false,
        });
        const loaded = await task.promise;
        if (request !== pending) return;
        pdf = loaded;
        ready = true;
        state(true);
        pagePicker.replaceChildren(
          ...Array.from(
            { length: pdf.numPages },
            (_, i) => new Option("Страница " + (i + 1), i + 1),
          ),
        );
        status.textContent = "Страниц: " + pdf.numPages;
        makeThumbnails();
        listWarnings();
        showPage(layout.blocksOnPages.get(selected)?.[0] || 1, selected);
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
