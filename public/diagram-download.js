export function downloadSvg(content, title) {
  const filename = String(title || "")
    .replace(/[\\/:*?"<>|\r\n]/g, "-")
    .trim()
    .slice(0, 100);
  const url = URL.createObjectURL(
    new Blob([content], { type: "image/svg+xml" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = (filename || "Диаграмма") + ".svg";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
