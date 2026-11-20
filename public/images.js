const maxEmbeddedLength = 400_000;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function embeddedImage(file) {
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type))
    throw Error("Выберите изображение PNG, JPEG, WebP или GIF.");
  if (file.size <= 290_000) return readImage(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    for (const longest of [1600, 1200, 900, 640]) {
      const scale = Math.min(
        1,
        longest / Math.max(image.naturalWidth, image.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/webp", 0.78);
      if (data.length <= maxEmbeddedLength) return data;
    }
    throw Error(
      "Изображение слишком велико. Укажите ссылку или уменьшите файл.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function imageMarkdown(url, alt) {
  if (!/^data:image\/(?:jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw Error("Введите полный адрес изображения.");
    }
    if (!["http:", "https:"].includes(parsed.protocol))
      throw Error("Используйте ссылку HTTP или HTTPS.");
    url = parsed.href;
  }
  return (
    "![" +
    alt
      .trim()
      .replace(/[\\\[\]]/g, "\\$&")
      .replace(/[\r\n]+/g, " ") +
    "](<" +
    url +
    ">)"
  );
}
