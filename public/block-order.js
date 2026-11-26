export function headingSpan(parts, start) {
  const depth = Number(parts[start]?.t.tag?.[1]);
  if (!depth || parts[start].t.type !== "heading_open")
    return [start, start + 1];
  const next = parts.findIndex(
    (part, i) =>
      i > start &&
      part.t.type === "heading_open" &&
      Number(part.t.tag[1]) <= depth,
  );
  return [start, next < 0 ? parts.length : next];
}

export function removeMarkdownBlocks(body, parts, spans) {
  const removed = new Set();
  for (const [start, end] of spans)
    for (let i = start; i < end; i++) removed.add(i);
  const ranges = [];
  for (const i of [...removed].sort((a, b) => a - b)) {
    const { start, fullStart = start, end } = parts[i];
    const next = parts[i + 1]?.fullStart ?? parts[i + 1]?.start ?? body.length;
    // Preserve reference definitions and other unrendered source between blocks.
    const limit = /^\s*$/.test(body.slice(end, next)) ? next : end;
    if (ranges.at(-1)?.end === fullStart) ranges.at(-1).end = limit;
    else ranges.push({ start: fullStart, end: limit });
  }
  const chunks = [];
  let from = 0;
  for (const { start, end } of ranges) {
    chunks.push(body.slice(from, start));
    from = end;
  }
  return chunks.join("") + body.slice(from);
}

export function outlineHierarchy(parts) {
  const headings = [];
  const ancestors = [];
  const occurrences = new Map();
  for (const [index, part] of parts.entries()) {
    if (part.t.type !== "heading_open") continue;
    const level = Number(part.t.tag[1]);
    while (ancestors.length && ancestors.at(-1).level >= level) ancestors.pop();
    const parent = ancestors.at(-1);
    const title =
      part.tokens.find((token) => token.type === "inline")?.content ||
      "Заголовок";
    const path = (parent?.key || "") + "/" + JSON.stringify(title);
    const number = (occurrences.get(path) || 0) + 1;
    occurrences.set(path, number);
    const heading = {
      index,
      level,
      title,
      parent,
      key: path + ":" + number,
      depth: ancestors.length,
    };
    if (parent) parent.hasChildren = true;
    headings.push(heading);
    ancestors.push(heading);
  }
  return headings;
}

export function reorderMarkdown(body, parts, start, end, boundary) {
  const length = parts.length;
  if (
    start < 0 ||
    end > length ||
    start >= end ||
    boundary < 0 ||
    boundary > length ||
    (boundary >= start && boundary <= end)
  )
    return null;
  const earlier = boundary < start;
  const [first, pivot, last] = earlier
    ? [boundary, start, end]
    : [start, end, boundary];
  const firstStart = parts[first].fullStart ?? parts[first].start,
    firstEnd = parts[pivot - 1].end;
  const secondStart = parts[pivot].fullStart ?? parts[pivot].start,
    secondEnd = parts[last - 1].end;
  const newline = body.includes("\r\n")
    ? "\r\n"
    : body.includes("\n")
      ? "\n"
      : body.includes("\r")
        ? "\r"
        : "\n";
  const separator = (existing) => {
    const breaks = existing.match(/\r\n|\r|\n/g)?.length || 0;
    return existing + newline.repeat(Math.max(0, 2 - breaks));
  };
  const prefix = first
    ? body.slice(0, parts[first - 1].end) +
      separator(body.slice(parts[first - 1].end, firstStart))
    : body.slice(0, firstStart);
  const mid = separator(body.slice(firstEnd, secondStart));
  const firstText = body.slice(firstStart, firstEnd),
    secondText = body.slice(secondStart, secondEnd);
  const suffixStart = parts[last]?.fullStart ?? parts[last]?.start;
  const suffix =
    last < length
      ? separator(body.slice(secondEnd, suffixStart)) + body.slice(suffixStart)
      : body.slice(secondEnd);
  return {
    body: prefix + secondText + mid + firstText + suffix,
    offset: prefix.length + (earlier ? 0 : secondText.length + mid.length),
  };
}

export function dragOrder({
  container,
  scroller,
  item,
  handle,
  prepare,
  targets,
  move,
  axis = "vertical",
  indexSelector = "[data-idx]",
  region = scroller,
  keyboardOnItem = true,
}) {
  const sideways = axis === "horizontal";
  const leading = sideways ? "left" : "top";
  const trailing = sideways ? "right" : "bottom";
  const extent = sideways ? "width" : "height";
  const offset = sideways ? "scrollLeft" : "scrollTop";
  const forward = sideways ? "ArrowRight" : "ArrowDown";
  const backward = sideways ? "ArrowLeft" : "ArrowUp";
  let drag = null,
    mark = null,
    scrolling = 0,
    frame;
  const entries = (index) => {
    const allowed = new Set(targets(index));
    return [...container.querySelectorAll(item)].filter((node) =>
      allowed.has(Number(node.dataset.idx)),
    );
  };

  function paint(next, below) {
    if (mark?.node === next && mark?.below === below) return;
    if (mark)
      mark.node.classList.remove(mark.below ? "drop-after" : "drop-before");
    mark = next ? { node: next, below } : null;
    if (mark) mark.node.classList.add(below ? "drop-after" : "drop-before");
  }

  function hit() {
    const bounds = scroller.getBoundingClientRect();
    const area = region === scroller ? bounds : region.getBoundingClientRect();
    if (
      drag.x < Math.max(bounds.left, area.left) ||
      drag.x > Math.min(bounds.right, area.right) ||
      drag.y < Math.max(bounds.top, area.top) ||
      drag.y > Math.min(bounds.bottom, area.bottom)
    ) {
      paint(null);
      return;
    }
    const position = sideways ? drag.x : drag.y;
    for (let i = 0; i < drag.entries.length; i++) {
      const node = drag.entries[i],
        rect = node.getBoundingClientRect();
      if (position < rect[leading] + rect[extent] / 2) {
        paint(Number(node.dataset.idx) === drag.origin ? null : node, false);
        return;
      }
      if (position < rect[trailing] || i === drag.entries.length - 1) {
        paint(Number(node.dataset.idx) === drag.origin ? null : node, true);
        return;
      }
    }
  }

  function autoScroll() {
    if (!drag?.started || !scrolling) return;
    if (!container.isConnected) {
      cancel();
      return;
    }
    scroller[offset] += scrolling;
    hit();
    frame = requestAnimationFrame(autoScroll);
  }

  function cancel(event, drop) {
    if (!drag || (event && event.pointerId !== drag.pointer)) return;
    const state = drag,
      target = mark;
    drag = null;
    cancelAnimationFrame(frame);
    scrolling = 0;
    paint(null);
    scroller.classList.remove("is-reordering");
    if (container.hasPointerCapture(state.pointer))
      container.releasePointerCapture(state.pointer);
    if (drop && target && state.started && target.node.isConnected)
      move(state, Number(target.node.dataset.idx), target.below);
  }

  container.addEventListener("pointerdown", (event) => {
    const grip = event.target.closest(handle);
    const node = grip?.closest(indexSelector);
    if (
      !node ||
      !container.contains(node) ||
      event.button !== 0 ||
      !event.isPrimary ||
      drag
    )
      return;
    event.preventDefault();
    const state = prepare(Number(node.dataset.idx));
    if (!state) return;
    drag = {
      ...state,
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      entries: entries(state.origin),
      started: false,
    };
    container.setPointerCapture(event.pointerId);
  });

  container.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (
      !drag.started &&
      Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5
    )
      return;
    drag.started = true;
    scroller.classList.add("is-reordering");
    hit();
    const rect = scroller.getBoundingClientRect();
    const position = sideways ? drag.x : drag.y;
    const across = sideways ? drag.y : drag.x;
    const crossStart = sideways ? rect.top : rect.left;
    const crossEnd = sideways ? rect.bottom : rect.right;
    const speed =
      across < crossStart || across > crossEnd
        ? 0
        : position < rect[leading] + 50
          ? Math.max(-17, (position - rect[leading] - 50) / 4)
          : position > rect[trailing] - 50
            ? Math.min(17, (position - rect[trailing] + 50) / 4)
            : 0;
    cancelAnimationFrame(frame);
    scrolling = speed;
    if (scrolling) frame = requestAnimationFrame(autoScroll);
  });
  container.addEventListener("pointerup", (event) => cancel(event, true));
  container.addEventListener("pointercancel", (event) => cancel(event, false));
  container.addEventListener("lostpointercapture", (event) =>
    cancel(event, false),
  );
  container.addEventListener("keydown", (event) => {
    if (!event.altKey || ![backward, forward].includes(event.key)) return;
    const node = event.target.closest(indexSelector);
    if (
      !node ||
      (!(keyboardOnItem && node === event.target) &&
        !event.target.closest(handle))
    )
      return;
    const state = prepare(Number(node.dataset.idx));
    if (!state) return;
    event.preventDefault();
    const list = entries(state.origin);
    const at = list.findIndex(
      (entry) => Number(entry.dataset.idx) === state.origin,
    );
    const below = event.key === forward;
    const next = list[at + (below ? 1 : -1)];
    if (next)
      move({ ...state, keyboard: true }, Number(next.dataset.idx), below);
  });
  return { active: () => !!drag, cancel: () => cancel(null, false) };
}
