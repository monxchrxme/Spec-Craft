let mirror;

function measure(field) {
  if (!mirror) {
    mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    Object.assign(mirror.style, {
      position: "fixed",
      visibility: "hidden",
      pointerEvents: "none",
      left: "-100000px",
      top: "0",
      boxSizing: "border-box",
      overflowWrap: "break-word",
    });
    document.body.append(mirror);
  }
  const css = getComputedStyle(field);
  Object.assign(mirror.style, {
    width: field.clientWidth + "px",
    padding: css.padding,
    font: css.font,
    lineHeight: css.lineHeight,
    letterSpacing: css.letterSpacing,
    wordSpacing: css.wordSpacing,
    textIndent: css.textIndent,
    direction: css.direction,
    tabSize: css.tabSize,
    whiteSpace: field.wrap === "off" ? "pre" : "pre-wrap",
  });
  const value = field.value;
  const text = document.createTextNode(!value || value.endsWith("\n") ? value + "\u200b" : value);
  mirror.replaceChildren(text);
  const position = field.selectionDirection === "backward" ? field.selectionStart : field.selectionEnd;
  const caret = document.createRange();
  caret.setStart(text, position);
  caret.collapse(true);
  const bounds = caret.getBoundingClientRect();
  const line = parseFloat(css.lineHeight);
  return {
    line,
    caret: bounds.top + bounds.height / 2,
    height: Math.ceil(mirror.getBoundingClientRect().height +
      parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth) + 2),
  };
}

export function keepBlockTextInView(field, viewport, maxHeight = Infinity) {
  let height = 52;
  let before;
  function grow(measured) {
    // Keep the space already used by this edit. Shrinking at the bottom of a
    // document would clamp the page scroll before the caret reaches mid-screen.
    height = Math.min(maxHeight, Math.max(height, measured.height));
    field.style.height = height + "px";
  }
  function screenCaret(measured) {
    return field.getBoundingClientRect().top + field.clientTop - field.scrollTop + measured.caret;
  }
  grow(measure(field));
  field.addEventListener("beforeinput", (event) => {
    const deleting = event.inputType?.startsWith("delete");
    before = {
      scroll: viewport.scrollTop,
      caret: deleting ? screenCaret(measure(field)) : null,
    };
  });
  field.addEventListener("input", (event) => {
    const old = before;
    before = null;
    const measured = measure(field);
    grow(measured);
    if (old && viewport.scrollTop !== old.scroll) viewport.scrollTop = old.scroll;
    const { top } = viewport.getBoundingClientRect();
    const visible = viewport.clientHeight;
    const middle = top + visible / 2;
    const { line } = measured;
    const caret = screenCaret(measured);
    const deleting = event.inputType?.startsWith("delete");
    const lower = top + visible - Math.min(line * (deleting ? 0.5 : 3), visible / 4);
    if (deleting && old?.caret >= middle - 1 && caret < middle)
      viewport.scrollTop += caret - middle;
    else if (caret > lower) viewport.scrollTop += caret - lower;
    else if (caret < top + line / 2) viewport.scrollTop += caret - top - line / 2;
  });
}
