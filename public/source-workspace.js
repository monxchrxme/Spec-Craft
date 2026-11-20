import { markdownSource } from "./markdown-source.js";
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
  const fold = document.querySelector("#source-fold");
  let markdown, nextSelection;
  let tex,
    frame,
    pdfTimer,
    pdfWork,
    generation = 0,
    visible = false,
    lastDoc,
    lastMode,
    mirror;
  const active = () => current().mode === "latex";
  let spans = [],
    measured,
    scrollFrame = 0;
  function indexSpans(projection) {
    const { body, parts } = current();
    if (active()) {
      const live = projection ?? latexProjection(body, parts);
      // Keep original assets and opaque block references available throughout a draft.
      // A half-typed command can temporarily stop referring to its image or diagram.
      // Even a partial command has a corresponding literal block in the document.
      if (live.text === source.value) tex = live;
      spans = live.entries
        .filter((e) => e.block !== null)
        .map((e) => [e.from, e.to]);
    } else {
      spans = parts.map((p) => [
        markdown.display(p.start),
        markdown.display(p.end),
      ]);
    }
    measured = null;
  }
  const span = (i) => spans[i] || [0, 0];
  let selectedScrollTop;
  const pages = sourcePages(preview, (i) => select(i, false));
  async function renderPdf(stamp) {
    if (pdfWork) await pdfWork;
    if (stamp !== generation) return;
    const pending = pages.show(requestPdf(), () => stamp === generation);
    pdfWork = pending;
    try {
      await pending;
    } finally {
      if (pdfWork === pending) pdfWork = null;
    }
  }
  function schedule(typing = false) {
    clearTimeout(pdfTimer);
    cancelAnimationFrame(frame);
    const stamp = ++generation;
    if (!visible) return;
    root.dataset.preview = view.value;
    sync.disabled = view.value === "off";
    if (view.value === "pdf") {
      if (typing) pdfTimer = setTimeout(() => renderPdf(stamp), 650);
      else void renderPdf(stamp);
      return;
    }
    pages.hide();
    if (view.value === "off") return;
    frame = requestAnimationFrame(() => {
      if (stamp !== generation) return;
      const initialized = preview.firstElementChild?.matches(".block");
      const oldTop = preview.scrollTop,
        { parts } = current(),
        nodes = [],
        changed = [];
      if (!preview.firstElementChild) preview.replaceChildren();
      const existing = [...preview.children];
      parts.forEach((p, i) => {
        const signature = [
          p.text,
          JSON.stringify(p.t.meta),
          p.tokens
            .flatMap((t) =>
              (t.children || [])
                .filter((c) => c.type === "link_open" || c.type === "image")
                .map((c) => [c.content, JSON.stringify(c.attrs)].join("/")),
            )
            .join(","),
        ].join("\u0000");
        let box = existing[i];
        if (box?.sourceSignature !== signature) {
          box = renderBlock(p, i);
          box.sourceSignature = signature;
          changed.push(box);
        }
        nodes.push(box);
      });
      nodes.forEach((node, i) => {
        if (preview.children[i] === node) return;
        if (preview.children[i]) preview.children[i].replaceWith(node);
        else preview.append(node);
      });
      while (preview.children.length > nodes.length) preview.lastChild.remove();
      preview.scrollTop = oldTop;
      if (changed.length) paint(changed);
      if (!initialized) followScroll();
    });
  }
  function cursorBlock() {
    const pos = source.selectionStart;
    return Math.max(
      0,
      current().parts.findLastIndex((_, i) => span(i)[0] <= pos),
    );
  }
  function reveal(i, caret = false) {
    const [start, end] = span(i);
    const fraction = caret
      ? Math.min(
          1,
          Math.max(
            0,
            (source.selectionStart - start) / Math.max(1, end - start),
          ),
        )
      : 0;
    if (sync.checked && view.value === "pdf") {
      pages.scrollToBlock(i, fraction, false, true);
      return;
    }
    const box = preview.children[i];
    if (sync.checked && view.value === "document" && box) {
      const delta =
        box.getBoundingClientRect().top -
        preview.getBoundingClientRect().top +
        fraction * box.offsetHeight;
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
    const value = source.value;
    let previous = 0;
    for (const [from] of spans) {
      fragment.append(value.slice(previous, from));
      const mark = document.createElement("span");
      fragment.append(mark);
      marks.push(mark);
      previous = from;
    }
    fragment.append(value.slice(previous));
    mirror.replaceChildren(fragment);
    const tops = marks.map((mark) => mark.offsetTop);
    measured = { width, tops };
    return tops;
  }
  function followScroll() {
    if (!visible || !sync.checked || view.value === "off") return;
    const tops = blockTops();
    if (!tops.length) return;
    const bottom =
      source.scrollHeight > source.clientHeight &&
      source.scrollTop + source.clientHeight >= source.scrollHeight - 1;
    const y =
      source.scrollTop + parseFloat(getComputedStyle(source).paddingTop);
    const index = Math.max(
      0,
      tops.findLastIndex((top) => top <= y),
    );
    const fraction = Math.max(
      0,
      Math.min(
        1,
        (y - tops[index]) /
          Math.max(1, (tops[index + 1] ?? source.scrollHeight) - tops[index]),
      ),
    );
    if (view.value === "pdf") pages.scrollToBlock(index, fraction, bottom);
    else {
      const box = preview.children[index];
      if (box)
        preview.scrollTop = bottom
          ? preview.scrollHeight
          : preview.scrollTop +
            box.getBoundingClientRect().top -
            preview.getBoundingClientRect().top +
            fraction * box.offsetHeight;
    }
  }
  source.addEventListener("scroll", () => {
    if (selectedScrollTop === source.scrollTop) {
      selectedScrollTop = undefined;
      return;
    }
    if (!visible || !sync.checked || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      followScroll();
    });
  });
  sync.onchange = () => {
    if (sync.checked) followScroll();
    else pages.cancelFollow();
  };
  function select(i, follow = true) {
    const [from, to] = span(i);
    source.focus({ preventScroll: true });
    source.setSelectionRange(from, to);
    source.scrollTop = Math.max(
      0,
      (blockTops()[i] || 0) - source.clientHeight * 0.25,
    );
    selectedScrollTop = source.scrollTop;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    choose(i);
    if (follow) reveal(i);
  }
  preview.onclick = (e) => {
    if (e.target.closest("a,button,input,summary,iframe")) return;
    const box = e.target.closest(".block[data-idx]");
    if (box) select(Number(box.dataset.idx));
  };
  fold.onchange = () => {
    if (!markdown) return;
    const { body, parts } = current();
    const start = markdown.raw(source.selectionStart),
      end = markdown.raw(source.selectionEnd, true);
    const block = cursorBlock();
    markdown = markdownSource(body, parts, fold.checked);
    source.value = markdown.text;
    indexSpans();
    source.setSelectionRange(
      markdown.display(start),
      markdown.display(end, true),
    );
    source.scrollTop = Math.max(
      0,
      (blockTops()[block] || 0) - source.clientHeight * 0.25,
    );
    selectedScrollTop = source.scrollTop;
  };
  // Expand the selection to the whole folded destination before replacing it.
  source.addEventListener("beforeinput", (e) => {
    if (!markdown || !fold.checked || e.inputType.startsWith("history")) return;
    let a = source.selectionStart,
      b = source.selectionEnd;
    for (const item of markdown.changes) {
      if (!item.image) continue;
      if (
        a === b &&
        ((a === item.to && e.inputType === "deleteContentBackward") ||
          (a === item.from && e.inputType === "deleteContentForward"))
      ) {
        a = item.from;
        b = item.to;
      }
      if (a > item.from && a < item.to) a = item.from;
      if (b > item.from && b < item.to) b = item.to;
    }
    if (a !== source.selectionStart || b !== source.selectionEnd)
      source.setSelectionRange(a, b);
  });
  for (const action of ["copy", "cut"])
    source.addEventListener(action, (e) => {
      if (
        !markdown ||
        !fold.checked ||
        source.selectionStart === source.selectionEnd ||
        !e.clipboardData
      )
        return;
      const a = markdown.raw(source.selectionStart),
        b = markdown.raw(source.selectionEnd, true);
      e.clipboardData.setData("text/plain", current().body.slice(a, b));
      e.preventDefault();
      if (action === "cut") {
        source.setRangeText(
          "",
          markdown.display(a),
          markdown.display(b, true),
          "start",
        );
        source.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  try {
    const saved = localStorage.getItem("speccraft:source-preview");
    if (["pdf", "document", "off"].includes(saved)) view.value = saved;
  } catch {}
  view.onchange = () => {
    try {
      localStorage.setItem("speccraft:source-preview", view.value);
    } catch {}
    schedule();
    if (view.value === "pdf") followScroll();
  };
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
      document.querySelector(".source-controls").hidden = !on;
      document.querySelector("#source-fold-control").hidden = active();
      visible = on;
      root.hidden = !on;
      generation++;
      clearTimeout(pdfTimer);
      cancelAnimationFrame(frame);
      const { body, mode, id, parts } = current();
      if (lastDoc !== id || mode !== lastMode) source.dataset.group = "";
      if (lastDoc !== id) {
        pages.hide();
        preview.scrollTop = 0;
      }
      lastDoc = id;
      lastMode = mode;
      if (!on) {
        tex = markdown = null;
        nextSelection = null;
        measured = null;
        mirror?.replaceChildren();
        pages.hide();
        preview.replaceChildren();
        return;
      }
      tex = active() ? latexProjection(body, parts) : null;
      markdown = active() ? null : markdownSource(body, parts, fold.checked);
      const value = tex?.text ?? markdown.text;
      if (source.value !== value) source.value = value;
      source.setAttribute(
        "aria-label",
        active() ? "Исходник LaTeX" : "Исходный Markdown",
      );
      indexSpans(tex);
      schedule();
    },
    read() {
      if (active()) return tex.apply(source.value);
      const next = markdown.apply(source.value);
      nextSelection = [
        next.caret(source.selectionStart),
        next.caret(source.selectionEnd),
        source.selectionDirection,
      ];
      return next.body;
    },
    update() {
      if (!active()) {
        const { body, parts } = current();
        markdown = markdownSource(body, parts, fold.checked);
        if (source.value !== markdown.text) {
          const top = source.scrollTop;
          source.value = markdown.text;
          if (nextSelection)
            source.setSelectionRange(
              markdown.display(nextSelection[0]),
              markdown.display(nextSelection[1], true),
              nextSelection[2],
            );
          source.scrollTop = top;
        }
        nextSelection = null;
      }
      indexSpans();
      schedule(true);
    },
    refreshPreview: schedule,
    bodyOffset(offset) {
      return markdown.raw(offset);
    },
    displayOffset(offset) {
      return markdown.display(offset);
    },
    cursorBlock,
    select,
    reveal,
    span,
  };
}
