import { imageMarkdown } from "./images.js";
import { pastedMermaid } from "./mermaid.js";

export function clipboardBlocks(data) {
  const files = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
  if (!files.length)
    for (const item of data.items) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  if (files.length) return { files, images: true };

  const text = data.getData("text/plain");
  const html = data.getData("text/html");
  if (html) {
    const fragment = document.createElement("template");
    fragment.innerHTML = html;
    if (!fragment.content.textContent.trim() || !text.trim()) {
      const images = [];
      for (const image of fragment.content.querySelectorAll("img[src]")) {
        try {
          images.push(imageMarkdown(image.getAttribute("src"),
            image.alt || "Изображение"));
        } catch {
          // A clipboard reference to a local or expired blob URL is not portable.
        }
      }
      if (images.length) return { body: images.join("\n\n"), images: true };
    }
  }
  if (!text.trim()) return null;
  return { body: pastedMermaid(text) ?? text };
}
