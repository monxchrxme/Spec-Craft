export const highlightColors = {
  yellow: { label: "Жёлтый", color: "#fff0a8" },
  green: { label: "Зелёный", color: "#d1f1d8" },
  blue: { label: "Голубой", color: "#d2eafa" },
  pink: { label: "Розовый", color: "#fadde7" },
  violet: { label: "Сиреневый", color: "#eaddfb" },
  orange: { label: "Оранжевый", color: "#ffdfbf" },
};

export function finishEditingKey(event) {
  return event.key === "Enter" && !event.isComposing && !event.altKey &&
    (event.shiftKey || event.metaKey || event.ctrlKey);
}

const suffixPattern = /^\{([a-z]+)\}/;

export function coloredHighlights(md) {
  md.core.ruler.after("inline", "colored_highlights", (state) => {
    for (const block of state.tokens) {
      if (!block.children) continue;
      const opens = [];
      for (const [index, token] of block.children.entries()) {
        if (token.type === "mark_open") opens.push(token);
        if (token.type !== "mark_close") continue;
        const opening = opens.pop();
        const next = block.children[index + 1];
        if (!opening || next?.type !== "text") continue;
        const match = suffixPattern.exec(next.content);
        if (!match || !Object.hasOwn(highlightColors, match[1])) continue;
        opening.attrSet("data-highlight", match[1]);
        next.content = next.content.slice(match[0].length);
      }
    }
  });
}

function replaceText(input, from, to, text, selectionStart, selectionEnd) {
  input.focus({ preventScroll: true });
  input.setSelectionRange(from, to);
  // insertText keeps the replacement in the browser's native textarea undo history.
  if (!document.execCommand?.("insertText", false, text)) {
    input.setRangeText(text, from, to, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  input.setSelectionRange(from + selectionStart, from + selectionEnd);
}

export function formatSelection(input, open, close = open, placeholder = "") {
  const { selectionStart: from, selectionEnd: to, value } = input;
  const selected = value.slice(from, to);
  if (!selected && !placeholder) return false;
  // Markdown requires most inline delimiters to touch the text they format.
  const [leading, text, trailing] = selected.trim()
    ? [selected.match(/^\s*/)[0], selected.trim(), selected.match(/\s*$/)[0]]
    : ["", placeholder || selected, ""];
  const start = leading.length + open.length;
  replaceText(
    input,
    from,
    to,
    leading + open + text + close + trailing,
    start,
    start + text.length,
  );
  return true;
}

export function highlightSelection(input, color) {
  if (!Object.hasOwn(highlightColors, color)) return;
  const { selectionStart: from, selectionEnd: to, value } = input;
  const suffix = color === "yellow" ? "" : "{" + color + "}";
  if (
    from !== to &&
    value.slice(from - 2, from) === "==" &&
    value.startsWith("==", to)
  ) {
    const old = suffixPattern.exec(value.slice(to + 2));
    const end =
      to +
      2 +
      (old && Object.hasOwn(highlightColors, old[1]) ? old[0].length : 0);
    const text = value.slice(from, to);
    replaceText(
      input,
      from - 2,
      end,
      "==" + text + "==" + suffix,
      2,
      2 + text.length,
    );
  } else formatSelection(input, "==", "==" + suffix, "текст");
}

const pairs = new Map([
  [String.fromCharCode(96), [String.fromCharCode(96), String.fromCharCode(96)]],
  ["*", ["*", "*"]],
  ["_", ["_", "_"]],
  ["~", ["~~", "~~"]],
  ["=", ["==", "=="]],
  ["$", ["\\(", "\\)"]],
  ["(", ["(", ")"]],
  ["[", ["[", "]"]],
  ["{", ["{", "}"]],
  ['"', ['"', '"']],
  ["'", ["'", "'"]],
]);

export function wrapTypedSelection(event) {
  const input = event.target;
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing ||
    input.selectionStart === input.selectionEnd
  )
    return false;
  const pair = pairs.get(event.key);
  if (!pair) return false;
  event.preventDefault();
  const [open, close] = pair;
  const alreadyWrapped =
    ["~", "=", "$"].includes(event.key) &&
    input.value.slice(
      input.selectionStart - open.length,
      input.selectionStart,
    ) === open &&
    input.value.startsWith(close, input.selectionEnd);
  if (!alreadyWrapped) formatSelection(input, open, close);
  return true;
}
