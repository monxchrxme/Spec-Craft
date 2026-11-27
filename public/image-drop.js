import { supportedImage } from "./images.js";

function fileTransfer(event) {
  const data = event.dataTransfer;
  if (event.defaultPrevented || !data?.types.includes("Files") ||
      event.target.closest?.('input[type="file"], [data-excalidraw] .excalidraw'))
    return null;
  return data;
}

export function enableImageDrop(viewport, blocks, canInsert, insert) {
  let marked, marker, placement, y, frame, idle;

  function mark(element, className) {
    if (marked === element && marker === className) return;
    if (marked) marked.classList.remove(marker);
    marked = element;
    marker = className;
    if (marked) marked.classList.add(marker);
  }

  function targetAt(position) {
    let previous;
    for (const block of blocks.children) {
      if (block.hidden) continue;
      const { top, bottom } = block.getBoundingClientRect();
      const index = Number(block.dataset.idx);
      if (position < (top + bottom) / 2)
        return { index: index - 1, block, marker: "image-drop-before" };
      previous = { index, block, marker: "image-drop-after" };
      if (position <= bottom) break;
    }
    return previous || { index: -1, block: blocks, marker: "image-drop-empty" };
  }

  function paint() {
    placement = targetAt(y);
    mark(placement.block, placement.marker);
  }

  function clear() {
    if (frame) cancelAnimationFrame(frame);
    clearTimeout(idle);
    frame = y = placement = null;
    mark(null);
  }

  function scroll() {
    frame = null;
    if (y === null || !canInsert()) {
      clear();
      return;
    }
    const { top, bottom, height } = viewport.getBoundingClientRect();
    const edge = Math.min(48, height / 4);
    const delta = Math.max(0, y - bottom + edge) - Math.max(0, top + edge - y);
    if (!delta) return;
    const before = viewport.scrollTop;
    viewport.scrollTop += Math.sign(delta) * Math.min(18, Math.abs(delta) / 2);
    if (viewport.scrollTop === before) return;
    paint();
    frame = requestAnimationFrame(scroll);
  }

  viewport.addEventListener("dragover", (event) => {
    const data = fileTransfer(event);
    if (!data) return;
    event.preventDefault();
    const items = Array.from(data.items || []).filter((item) => item.kind === "file");
    const possible = canInsert() &&
      (!items.length || items.some((item) => !item.type || supportedImage(item)));
    data.dropEffect = possible ? "copy" : "none";
    if (!possible) {
      clear();
      return;
    }
    y = event.clientY;
    paint();
    // Native file drags can end without dispatching dragend in this window.
    clearTimeout(idle);
    idle = setTimeout(clear, 800);
    if (!frame) frame = requestAnimationFrame(scroll);
  });
  viewport.addEventListener("dragleave", (event) => {
    if (!viewport.contains(event.relatedTarget)) clear();
  });
  viewport.addEventListener("scroll", () => {
    if (placement && canInsert()) paint();
  }, { passive: true });
  viewport.addEventListener("drop", (event) => {
    // Keep the boundary shown by the marker if native scrolling ends on drop.
    const target = placement?.block.isConnected ? placement : null;
    clear();
    const data = fileTransfer(event);
    if (!data) return;
    event.preventDefault();
    if (!canInsert()) return;
    const files = Array.from(data.files);
    if (files.length) insert((target ?? targetAt(event.clientY)).index, files);
  });
  window.addEventListener("blur", clear);
  window.addEventListener("dragend", clear);
}
