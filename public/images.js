const maxEmbeddedLength = 400_000;
const widthMarker = /^[ \t]*\{width=(\d{1,3})%\}/;
const embedded = /^data:image\/(?:jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;

export const fullCrop = Object.freeze({ left: 0, top: 0, right: 1, bottom: 1 });
export const clampImageWidth = (value) =>
  Math.min(100, Math.max(10, Math.round(value)));

export function imageSizes(md) {
  md.core.ruler.after("inline", "image_width", (state) => {
    for (const { children } of state.tokens) {
      if (!children) continue;
      for (let i = 0; i < children.length; i++) {
        const image = children[i],
          suffix = children[i + 1];
        if (image.type !== "image") continue;
        for (const label of image.children || [])
          if (label.type === "text_special") label.type = "text";
        if (suffix?.type !== "text") continue;
        const match = widthMarker.exec(suffix.content);
        const width = Number(match?.[1]);
        if (!(width >= 10 && width <= 100)) continue;
        image.attrSet("data-image-width", String(width));
        image.attrSet("style", "width:" + width + "%;height:auto");
        suffix.content = suffix.content.slice(match[0].length);
      }
    }
  });
}

export function imageWidthMarkdown(markdown, width) {
  const source = markdown
    .trimEnd()
    .replace(/[ \t]*\{width=(\d{1,3})%\}$/, (marker, size) =>
      Number(size) >= 10 && Number(size) <= 100 ? "" : marker,
    );
  return (
    source + (width == null ? "" : "{width=" + clampImageWidth(width) + "%}")
  );
}

export function imageUrl(value) {
  if (embedded.test(value)) return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw Error("Введите полный адрес изображения.");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw Error("Используйте ссылку HTTP или HTTPS.");
  return parsed.href;
}

export function imageMarkdown(url, alt, { width, title } = {}) {
  const label = alt
    .trim()
    .replace(/[\\\[\]]/g, "\\$&")
    .replace(/[\r\n]+/g, " ");
  const caption = title
    ? ' "' + title.replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ") + '"'
    : "";
  return imageWidthMarkdown(
    "![" + label + "](<" + imageUrl(url) + ">" + caption + ")",
    width,
  );
}

export function supportedImage(file) {
  return /^image\/(png|jpeg|webp|gif)$/i.test(file.type);
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(Error("Не удалось прочитать файл изображения."));
    reader.readAsDataURL(file);
  });
}

export async function loadImage(url, cors = false) {
  const image = new Image();
  if (cors) image.crossOrigin = "anonymous";
  image.referrerPolicy = "no-referrer";
  image.src = url;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight)
    throw Error("Изображение пустое.");
  return image;
}

export function cropPixels(crop, width, height) {
  const x = Math.min(width - 1, Math.round(crop.left * width));
  const y = Math.min(height - 1, Math.round(crop.top * height));
  const endX = Math.max(x + 1, Math.round(crop.right * width));
  const endY = Math.max(y + 1, Math.round(crop.bottom * height));
  return { x, y, width: endX - x, height: endY - y };
}

export function cropChanged(crop) {
  return Object.keys(fullCrop).some((key) => fullCrop[key] !== crop[key]);
}

export function moveCrop(rect, handle, dx, dy, minWidth, minHeight) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  if (handle === "move") {
    const x = clamp(dx, -rect.left, 1 - rect.right);
    const y = clamp(dy, -rect.top, 1 - rect.bottom);
    return {
      left: rect.left + x,
      right: rect.right + x,
      top: rect.top + y,
      bottom: rect.bottom + y,
    };
  }
  const next = { ...rect };
  if (handle.includes("w"))
    next.left = clamp(rect.left + dx, 0, rect.right - minWidth);
  if (handle.includes("e"))
    next.right = clamp(rect.right + dx, rect.left + minWidth, 1);
  if (handle.includes("n"))
    next.top = clamp(rect.top + dy, 0, rect.bottom - minHeight);
  if (handle.includes("s"))
    next.bottom = clamp(rect.bottom + dy, rect.top + minHeight, 1);
  return next;
}

export function rasterImage(image, crop = fullCrop) {
  const region = cropPixels(crop, image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  try {
    for (const longest of [1600, 1200, 900, 640]) {
      const scale = Math.min(
        1,
        longest / Math.max(region.width, region.height),
      );
      canvas.width = Math.max(1, Math.round(region.width * scale));
      canvas.height = Math.max(1, Math.round(region.height * scale));
      canvas
        .getContext("2d")
        .drawImage(
          image,
          region.x,
          region.y,
          region.width,
          region.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      const data = canvas.toDataURL("image/webp", 0.84);
      if (embedded.test(data) && data.length <= maxEmbeddedLength) return data;
    }
  } catch {
    throw Error(
      "Не удалось обработать изображение. Для обрезки загрузите файл.",
    );
  }
  throw Error("Изображение слишком велико. Укажите ссылку или уменьшите файл.");
}

export async function embeddedImage(file, image, crop = fullCrop) {
  if (!supportedImage(file))
    throw Error("Выберите изображение PNG, JPEG, WebP или GIF.");
  if (!cropChanged(crop) && file.size <= 290_000) return readImage(file);
  if (image) return rasterImage(image, crop);
  const url = URL.createObjectURL(file);
  try {
    return rasterImage(await loadImage(url), crop);
  } finally {
    URL.revokeObjectURL(url);
  }
}
