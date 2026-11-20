export function highlightCode(code, language) {
  const highlighter = globalThis.hljs;
  const name = language?.toLowerCase();
  if (!name || !highlighter?.getLanguage(name)) return "";
  return highlighter.highlight(code, { language: name }).value;
}

// Use the same token colors as the document's code blocks in studio.css.
const tokenColors = {
  "hljs-keyword": "#7a367f",
  "hljs-selector-tag": "#7a367f",
  "hljs-string": "#146447",
  "hljs-regexp": "#146447",
  "hljs-addition": "#146447",
  "hljs-number": "#9a411e",
  "hljs-literal": "#9a411e",
  "hljs-type": "#1e58a3",
  "hljs-built_in": "#1e58a3",
  "hljs-title": "#1e58a3",
  "hljs-comment": "#626b79",
  "hljs-quote": "#626b79",
  "hljs-meta": "#784a11",
  "hljs-attr": "#784a11",
  "hljs-attribute": "#784a11",
  "hljs-symbol": "#784a11",
  "hljs-variable": "#8f334b",
  "hljs-deletion": "#8f334b",
};

export function codeLines(pre, tabSize) {
  const lines = [[]];
  const indentation = " ".repeat(tabSize);
  function append(node, color) {
    if (node.nodeType === 3) {
      const segments = node.textContent
        .replaceAll("\t", indentation)
        .split("\n");
      segments.forEach((text, index) => {
        if (index) lines.push([]);
        if (text) lines.at(-1).push(color ? { text, color } : { text });
      });
    } else if (node.nodeType === 1) {
      const ownColor = Array.from(
        node.classList,
        (name) => tokenColors[name],
      ).find(Boolean);
      for (const child of node.childNodes) append(child, ownColor ?? color);
    }
  }

  append(pre);
  if (lines.length > 1 && !lines.at(-1).length) lines.pop();
  return lines.map((runs) => (runs.length ? runs : [{ text: "\u00a0" }]));
}
