import {
  clampImageWidth,
  cropChanged,
  cropPixels,
  embeddedImage,
  fullCrop,
  imageMarkdown,
  imageUrl,
  loadImage,
  moveCrop,
  rasterImage,
  supportedImage,
} from "./images.js";

export function imageInspector(paragraph, image, markdown, actions) {
  const stage = document.createElement("span");
  stage.className = "image-stage";
  image.replaceWith(stage);
  stage.append(image);
  image.draggable = false;
  const settings = document.createElement("button");
  settings.type = "button";
  settings.className = "image-settings-toggle";
  settings.setAttribute("aria-label", "Настройки изображения");
  settings.setAttribute("aria-expanded", "false");
  settings.title = "Настройки изображения";
  settings.innerHTML =
    '<i data-lucide="sliders-horizontal" aria-hidden="true"></i>';
  stage.append(settings);

  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = "image-grip";
  grip.textContent = "◢";
  grip.setAttribute("aria-label", "Изменить размер изображения");
  grip.title = "Потяните, чтобы изменить размер. Стрелки меняют ширину.";
  const measure = document.createElement("output");
  measure.className = "image-resize-measure";
  measure.setAttribute("aria-hidden", "true");
  stage.append(grip, measure);

  const options = document.createElement("div");
  options.className = "image-settings";
  options.hidden = true;
  options.innerHTML = `
    <div class="image-options">
      <label>Ширина, % <input type="number" min="10" max="100" step="1" placeholder="Авто"></label>
      <button type="button" data-image-auto>Авто</button>
      <button type="button" data-image-replace>Обрезать или заменить</button>
      <button type="button" data-image-done>Готово</button>
    </div>
    <details class="image-source">
      <summary>Исходник Markdown</summary>
      <textarea rows="2" wrap="off" spellcheck="false" aria-label="Исходник изображения"></textarea>
      <button type="button" data-image-apply>Применить исходник</button>
    </details>`;
  paragraph.after(options);
  const width = options.querySelector("input"),
    source = options.querySelector("textarea");
  source.value = markdown;
  let value = Number(image.dataset.imageWidth) || null;
  let drag = null;

  function display(size) {
    stage.style.width = size ? size + "%" : "";
    image.style.width = size ? "100%" : "";
    width.value = size || "";
    measure.textContent = size ? size + "%" : "";
  }
  function show(open) {
    options.hidden = !open;
    settings.setAttribute("aria-expanded", String(open));
    if (!open) options.querySelector("details").open = false;
  }
  const toggle = () => show(options.hidden);
  const changeWidth = (size) => {
    if (size === value) return;
    if (
      actions.width(size, !options.hidden, document.activeElement === grip) ===
      false
    ) {
      display(value);
      return;
    }
    value = size;
    display(size);
  };
  image.onpointerdown = (event) => event.preventDefault();
  image.onclick = settings.onclick = toggle;
  width.onchange = () =>
    changeWidth(
      width.value === "" ? null : clampImageWidth(Number(width.value)),
    );
  width.onkeydown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    width.blur();
  };
  options.querySelector("[data-image-auto]").onclick = () => changeWidth(null);
  options.querySelector("[data-image-replace]").onclick = actions.replace;
  options.querySelector("[data-image-done]").onclick = () => {
    show(false);
    settings.focus({ preventScroll: true });
  };
  options.querySelector("[data-image-apply]").onclick = () =>
    actions.source(source.value);

  grip.onpointerdown = (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    const available = paragraph.clientWidth;
    const bounds = stage.getBoundingClientRect();
    if (!available || !bounds.width || !bounds.height) return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      available,
      width: bounds.width,
      ratio: bounds.width / bounds.height,
      size: value,
    };
    stage.dataset.resizing = "";
    grip.setPointerCapture(event.pointerId);
  };
  grip.onpointermove = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x,
      dy = (event.clientY - drag.y) * drag.ratio;
    if (drag.size === value && Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    drag.size = clampImageWidth(((drag.width + delta) / drag.available) * 100);
    display(drag.size);
  };
  function finish(event, commit) {
    if (!drag || drag.id !== event.pointerId) return;
    const size = drag.size;
    drag = null;
    delete stage.dataset.resizing;
    if (commit) changeWidth(size);
    else display(value);
  }
  grip.onpointerup = (event) => finish(event, true);
  grip.onpointercancel = grip.onlostpointercapture = (event) =>
    finish(event, false);
  grip.onkeydown = (event) => {
    const direction = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const current =
      value ||
      (stage.getBoundingClientRect().width /
        Math.max(1, paragraph.clientWidth)) *
        100;
    changeWidth(
      clampImageWidth(current + direction * (event.shiftKey ? 10 : 2)),
    );
  };
  display(value);
  return show;
}

export function imageCropForm(panel, initial, onSave) {
  const form = panel.querySelector("form");
  const { file, url, alt } = form.elements;
  const actions = panel.querySelector(".image-crop-actions");
  const preview = panel.querySelector(".image-crop-preview");
  const cropButton = panel.querySelector("[data-crop]");
  const reset = panel.querySelector("[data-reset-crop]");
  const status = panel.querySelector("[role=status]");
  const submit = form.querySelector("[type=submit]");
  const surface = document.createElement("div"),
    frame = document.createElement("div");
  const dimensions = document.createElement("output");
  surface.className = "image-crop-surface";
  frame.className = "image-crop-frame";
  dimensions.className = "image-crop-dimensions";
  preview.append(surface, dimensions);

  let asset = null,
    generation = 0,
    temporaryUrl,
    timer,
    loading;
  let active = false,
    rect = fullCrop,
    pointer = null,
    disposed = false;
  const hands = [
    ["nw", "Верхний левый угол"],
    ["ne", "Верхний правый угол"],
    ["sw", "Нижний левый угол"],
    ["se", "Нижний правый угол"],
  ];

  function minCrop() {
    return [1 / asset.image.naturalWidth, 1 / asset.image.naturalHeight];
  }

  for (const [handle, label] of hands) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.corner = handle;
    button.className = "crop-corner";
    button.setAttribute("aria-label", label);
    button.onkeydown = (event) => {
      const delta = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key];
      if (!delta || !active) return;
      event.preventDefault();
      const [x, y] = minCrop(),
        step = event.shiftKey ? 10 : 1;
      rect = moveCrop(
        rect,
        handle,
        delta[0] * x * step,
        delta[1] * y * step,
        x,
        y,
      );
      paint();
    };
    frame.append(button);
  }

  function paint() {
    frame.style.setProperty("--left", rect.left * 100 + "%");
    frame.style.setProperty("--top", rect.top * 100 + "%");
    frame.style.setProperty("--right", (1 - rect.right) * 100 + "%");
    frame.style.setProperty("--bottom", (1 - rect.bottom) * 100 + "%");
    frame.hidden = !active;
    reset.hidden = !active;
    cropButton.hidden = !asset?.croppable || active;
    actions.hidden = !asset?.croppable;
    if (asset) {
      const region = cropPixels(
        rect,
        asset.image.naturalWidth,
        asset.image.naturalHeight,
      );
      dimensions.textContent = region.width + " × " + region.height + " px";
    }
  }

  frame.onpointerdown = (event) => {
    if (!active || pointer || event.button !== 0) return;
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    event.preventDefault();
    pointer = {
      id: event.pointerId,
      handle: event.target.closest("[data-corner]")?.dataset.corner || "move",
      x: event.clientX,
      y: event.clientY,
      rect,
      width: bounds.width,
      height: bounds.height,
    };
    frame.setPointerCapture(event.pointerId);
  };
  frame.onpointermove = (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    rect = moveCrop(
      pointer.rect,
      pointer.handle,
      (event.clientX - pointer.x) / pointer.width,
      (event.clientY - pointer.y) / pointer.height,
      ...minCrop(),
    );
    paint();
  };
  const end = (event) => {
    if (pointer?.id === event.pointerId) pointer = null;
  };
  frame.onpointerup = frame.onlostpointercapture = end;
  frame.onpointercancel = (event) => {
    if (pointer?.id !== event.pointerId) return;
    rect = pointer.rect;
    end(event);
    paint();
  };

  cropButton.onclick = () => {
    active = true;
    paint();
  };
  reset.onclick = () => {
    rect = fullCrop;
    active = false;
    paint();
  };
  const source = () => file.files[0] || url.value.trim() || initial?.url || "";
  const current = (ticket) =>
    !disposed && ticket === generation && panel.isConnected;
  function clearPreview() {
    if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
    temporaryUrl = asset = null;
    rect = fullCrop;
    active = false;
    pointer = null;
    surface.replaceChildren();
    preview.hidden = actions.hidden = true;
  }

  async function previewImage(ticket, entry) {
    if (!entry || !current(ticket)) return;
    status.textContent = "Загрузка изображения…";
    try {
      const local = typeof entry !== "string";
      let src;
      if (local) {
        if (!supportedImage(entry))
          throw Error("Выберите изображение PNG, JPEG, WebP или GIF.");
        src = temporaryUrl = URL.createObjectURL(entry);
      } else src = imageUrl(entry);
      let image;
      let croppable = true;
      try {
        image = await loadImage(src, /^https?:/i.test(src));
      } catch (error) {
        if (local || !/^https?:/i.test(src)) throw error;
        if (!current(ticket)) return;
        image = await loadImage(src);
        croppable = false;
      }
      if (!current(ticket)) return;
      asset = { entry, image, croppable };
      image.draggable = false;
      image.alt = "Предпросмотр изображения";
      surface.replaceChildren(image, frame);
      preview.hidden = false;
      status.textContent = croppable
        ? ""
        : "Сервер разрешает просмотр изображения. Для обрезки загрузите файл.";
      paint();
    } catch (error) {
      if (!current(ticket)) return;
      status.textContent =
        error instanceof DOMException
          ? "Не удалось загрузить предпросмотр изображения."
          : error.message;
    }
  }

  function update(debounce = false) {
    clearTimeout(timer);
    const next = ++generation;
    clearPreview();
    status.textContent = "";
    const entry = source();
    if (debounce)
      timer = setTimeout(() => {
        loading = previewImage(next, entry);
      }, 250);
    else loading = previewImage(next, entry);
  }
  file.onchange = () => {
    if (file.files.length) url.value = "";
    update();
  };
  url.oninput = () => {
    if (file.files.length) file.value = "";
    update(true);
  };
  if (initial) {
    alt.value = initial.alt;
    if (/^https?:/i.test(initial.url)) url.value = initial.url;
    update();
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    status.textContent = "";
    const entry = source(),
      ticket = generation;
    try {
      let src;
      if (typeof entry !== "string") {
        await loading;
        if (!current(ticket)) return;
        if (!asset || asset.entry !== entry)
          throw Error("Не удалось прочитать файл изображения.");
        src = await embeddedImage(entry, asset.image, rect);
      } else {
        src = imageUrl(entry);
        if (cropChanged(rect) && asset?.entry === entry && asset.croppable)
          src = rasterImage(asset.image, rect);
      }
      if (current(ticket))
        onSave(
          imageMarkdown(src, alt.value, {
            title: initial?.title,
            width: initial?.width,
          }),
        );
    } catch (error) {
      if (current(ticket)) status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  };
  return () => {
    disposed = true;
    clearTimeout(timer);
    clearPreview();
  };
}
