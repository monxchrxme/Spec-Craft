import { sourcePages } from "./pdf-pages.js";
import { latexProjection } from "./latex-source.js";

export function sourceWorkspace({
  source,
  renderBlock,
  paint,
  requestPdf,
  current,
  choose,
}) {
  const root = document.querySelector("#source-workspace"),
    preview = document.querySelector("#source-preview"),
    view = document.querySelector("#source-view"),
    sync = document.querySelector("#source-sync"),
    divider = document.querySelector("#source-divider");
  let tex,
    timer,
    generation = 0,
    visible = false,
    lastDoc,
    lastMode,
    mirror;
  const active = () => current().mode === "latex";
  let spans = [],
    measured,
    scrollFrame = 0;
  function indexSpans() {
    const { body, parts } = current();
    if (active()) {
      const live = latexProjection(body, parts);
      // Keep original assets and opaque block references available throughout a draft.
      // A half-typed command can temporarily stop referring to its image or diagram.
      // Even a partial command has a corresponding literal block in the document.
      spans = live.entries
        .filter((e) => e.block !== null)
        .map((e) => [e.from, e.to]);
    } else {
      let cursor = 0,
        offset = 0;
      spans = parts.map((p) => {
        offset += body.slice(cursor, p.start).replace(/\r\n?/g, "\n").length;
        const from = offset;
        offset += p.text.replace(/\r\n?/g, "\n").length;
        cursor = p.end;
        return [from, offset];
      });
    }
    measured = null;
  }
  const span = (i) => spans[i] || [0, 0];
  let selectedScrollTop;
  const pages = sourcePages(preview, (i) => select(i, false));
  function schedule(delay = 120) {
    clearTimeout(timer);
    const stamp = ++generation;
    if (!visible) return;
    root.dataset.preview = view.value;
    sync.disabled = view.value === "off";
    if (view.value !== "pdf") pages.hide();
    timer = setTimeout(async () => {
      if (stamp !== generation) return;
      if (view.value === "off") return;
      if (view.value === "pdf") {
        const { body, id } = current();
        await pages.show(
          requestPdf(),
          () =>
            visible &&
            view.value === "pdf" &&
            current().body === body &&
            current().id === id,
        );
        return;
      }
      const oldTop = preview.scrollTop,
        { parts } = current(),
        nodes = [];
      const existing = [...preview.children];
      parts.forEach((p, i) => {
        const contents = p.t.meta?.espd?.contents
          ? parts
              .filter((h) => h.t.meta?.espd)
              .map((h) => h.text)
              .join("\n")
          : "";
        const signature = [
          contents,
          p.text,
          JSON.stringify(p.t.meta),
          p.tokens
            .flatMap((t) =>
              (t.children || [])
                .filter(
                  (c) =>
                    c.type === "espd_ref" ||
                    c.type === "espd_note" ||
                    c.type === "link_open" ||
                    c.type === "image",
                )
                .map((c) =>
                  [c.content, c.meta?.number, JSON.stringify(c.attrs)].join(
                    "/",
                  ),
                ),
            )
            .join(","),
        ].join("\u0000");
        let box = existing[i];
        if (box?.sourceSignature !== signature) {
          box = renderBlock(p, i);
          box.sourceSignature = signature;
        }
        nodes.push(box);
      });
      nodes.forEach((node, i) => {
        if (preview.children[i] !== node)
          preview.insertBefore(node, preview.children[i] || null);
      });
      while (preview.children.length > nodes.length) preview.lastChild.remove();
      preview.scrollTop = oldTop;
      paint(preview);
    }, delay);
  }
  function cursorBlock() {
    const pos = source.selectionStart;
    return Math.max(
      0,
      current().parts.findLastIndex((_, i) => span(i)[0] <= pos),
    );
  }
  function reveal(i) {
    if (sync.checked && view.value === "pdf") {
      pages.scrollToBlock(i);
      return;
    }
    const box = preview.children[i];
    if (sync.checked && view.value === "document" && box) {
      const delta =
        box.getBoundingClientRect().top - preview.getBoundingClientRect().top;
      if (delta < 0 || delta > preview.clientHeight - 45)
        preview.scrollTop += delta - 12;
    }
  }
  function blockTops() {
    const width = source.clientWidth;
    if (measured?.width === width) return measured.tops;
    if (!mirror) {
      mirror = document.createElement("div");
      mirror.setAttribute("aria-hidden", "true");
      document.body.append(mirror);
    }
    const css = getComputedStyle(source);
    Object.assign(mirror.style, {
      position: "fixed",
      visibility: "hidden",
      pointerEvents: "none",
      left: "-100000px",
      width: width + "px",
      boxSizing: "border-box",
      font: css.font,
      lineHeight: css.lineHeight,
      padding: css.padding,
      whiteSpace: source.wrap === "off" ? "pre" : "pre-wrap",
      overflowWrap: "break-word",
      tabSize: css.tabSize,
    });
    const fragment = document.createDocumentFragment(),
      marks = [];
    let previous = 0;
    for (const [from] of spans) {
      fragment.append(source.value.slice(previous, from));
      const mark = document.createElement("span");
      fragment.append(mark);
      marks.push(mark);
      previous = from;
    }
    fragment.append(source.value.slice(previous));
    mirror.replaceChildren(fragment);
    const tops = marks.map((mark) => mark.offsetTop);
    measured = { width, tops };
    return tops;
  }
  source.addEventListener("scroll", () => {
    if (selectedScrollTop === source.scrollTop) {
      selectedScrollTop = undefined;
      return;
    }
    if (!visible || !sync.checked || view.value === "off" || scrollFrame)
      return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!visible || !sync.checked || view.value === "off") return;
      const tops = blockTops(),
        index = Math.max(
          0,
          tops.findLastIndex((y) => y <= source.scrollTop + 8),
        );
      if (view.value === "pdf") {
        pages.scrollToBlock(index);
        return;
      }
      const box = preview.children[index];
      if (!box) return;
      const fraction = Math.max(
        0,
        Math.min(
          1,
          (source.scrollTop - tops[index]) /
            Math.max(1, (tops[index + 1] ?? source.scrollHeight) - tops[index]),
        ),
      );
      preview.scrollTop +=
        box.getBoundingClientRect().top -
        preview.getBoundingClientRect().top +
        fraction * box.offsetHeight -
        8;
    });
  });
  function select(i, follow = true) {
    const [from, to] = span(i);
    source.focus({ preventScroll: true });
    source.setSelectionRange(from, to);
    source.scrollTop = Math.max(
      0,
      (blockTops()[i] || 0) - source.clientHeight * 0.25,
    );
    if (!follow) selectedScrollTop = source.scrollTop;
    choose(i);
    if (follow) reveal(i);
  }
  preview.onclick = (e) => {
    if (e.target.closest("a,button,input,summary,iframe")) return;
    const box = e.target.closest(".block[data-idx]");
    if (box) select(Number(box.dataset.idx));
  };
  view.onchange = () => schedule(0);
  let dragging = false;
  function width(n) {
    const value = Math.max(22, Math.min(78, n));
    root.style.setProperty("--source-share", value + "%");
    divider.setAttribute("aria-valuenow", Math.round(value));
  }
  width(48);
  divider.onpointerdown = (e) => {
    if (e.button !== 0) return;
    dragging = true;
    divider.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  divider.onpointermove = (e) => {
    if (dragging) {
      const r = divider.parentElement.getBoundingClientRect();
      width(((e.clientX - r.left) * 100) / r.width);
    }
  };
  divider.onlostpointercapture = () => (dragging = false);
  divider.ondblclick = () => width(48);
  divider.onkeydown = (e) => {
    if (["ArrowLeft", "ArrowRight", "Enter"].includes(e.key)) {
      e.preventDefault();
      width(
        e.key === "Enter"
          ? 48
          : Number(divider.getAttribute("aria-valuenow")) +
              (e.key === "ArrowLeft" ? -3 : 3),
      );
    }
  };
  return {
    show(on) {
      visible = on;
      root.hidden = !on;
      generation++;
      clearTimeout(timer);
      const { body, mode, id, parts } = current();
      if (lastDoc !== id || mode !== lastMode) source.dataset.group = "";
      if (lastDoc !== id) {
        pages.hide();
        preview.scrollTop = 0;
      }
      lastDoc = id;
      lastMode = mode;
      if (!on) {
        tex = null;
        measured = null;
        mirror?.replaceChildren();
        pages.hide();
        preview.replaceChildren();
        return;
      }
      tex = active() ? latexProjection(body, parts) : null;
      const value = (tex?.text ?? body).replace(/\r\n?/g, "\n");
      if (source.value !== value) source.value = value;
      source.setAttribute(
        "aria-label",
        active() ? "Исходник LaTeX" : "Исходный Markdown",
      );
      indexSpans();
      schedule(0);
    },
    read() {
      if (active()) return tex.apply(source.value);
      const { body } = current(),
        old = body.replace(/\r\n?/g, "\n"),
        next = source.value;
      if (old === next) return body;
      if (!body.includes("\r")) return next;
      let a = 0,
        b = old.length,
        c = next.length;
      while (a < b && a < c && old[a] === next[a]) a++;
      while (b > a && c > a && old[b - 1] === next[c - 1]) {
        b--;
        c--;
      }
      const boundaries = [0];
      for (const m of body.matchAll(/\r\n|[\s\S]/g))
        boundaries.push(m.index + m[0].length);
      const newline = body.match(/\r\n|\r|\n/)?.[0] || "\n";
      return (
        body.slice(0, boundaries[a]) +
        next.slice(a, c).replaceAll("\n", newline) +
        body.slice(boundaries[b])
      );
    },
    update() {
      indexSpans();
      schedule(view.value === "pdf" ? 650 : 100);
    },
    bodyOffset(offset) {
      const { body } = current();
      if (!body.includes("\r\n")) return offset;
      let raw = offset;
      for (const match of body.matchAll(/\r\n/g)) {
        if (match.index >= raw) break;
        raw++;
      }
      return raw;
    },
    cursorBlock,
    select,
    reveal,
    span,
  };
}
