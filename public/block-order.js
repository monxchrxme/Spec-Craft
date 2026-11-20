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
}) {
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
    if (
      drag.x < bounds.left ||
      drag.x > bounds.right ||
      drag.y < bounds.top ||
      drag.y > bounds.bottom
    ) {
      paint(null);
      return;
    }
    for (let i = 0; i < drag.entries.length; i++) {
      const node = drag.entries[i],
        rect = node.getBoundingClientRect();
      if (drag.y < rect.top + rect.height / 2) {
        paint(Number(node.dataset.idx) === drag.origin ? null : node, false);
        return;
      }
      if (drag.y < rect.bottom || i === drag.entries.length - 1) {
        paint(Number(node.dataset.idx) === drag.origin ? null : node, true);
        return;
      }
    }
  }

  function autoScroll() {
    if (!drag?.started || !scrolling) return;
    scroller.scrollTop += scrolling;
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
    const node = grip?.closest("[data-idx]");
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
    const speed =
      drag.x < rect.left || drag.x > rect.right
        ? 0
        : drag.y < rect.top + 50
          ? Math.max(-17, (drag.y - rect.top - 50) / 4)
          : drag.y > rect.bottom - 50
            ? Math.min(17, (drag.y - rect.bottom + 50) / 4)
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
    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const node = event.target.closest("[data-idx]");
    if (!node || (node !== event.target && !event.target.closest(handle)))
      return;
    const state = prepare(Number(node.dataset.idx));
    if (!state) return;
    event.preventDefault();
    const list = entries(state.origin);
    const at = list.findIndex(
      (entry) => Number(entry.dataset.idx) === state.origin,
    );
    const below = event.key === "ArrowDown";
    const next = list[at + (below ? 1 : -1)];
    if (next) move(state, Number(next.dataset.idx), below);
  });
  return { active: () => !!drag, cancel: () => cancel(null, false) };
}
