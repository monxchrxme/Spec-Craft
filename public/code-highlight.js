export function highlightCode(code, language) {
  const highlighter = globalThis.hljs;
  const name = language?.toLowerCase();
  if (!name || !highlighter?.getLanguage(name)) return "";
  return highlighter.highlight(code, { language: name }).value;
}

// Use the same token colors as the document's code blocks in studio.css.
const tokenColors = {
  "hljs-keyword": "#7815a0",
  "hljs-selector-tag": "#7815a0",
  "hljs-string": "#00623b",
  "hljs-regexp": "#00623b",
  "hljs-addition": "#00623b",
  "hljs-number": "#a43b08",
  "hljs-literal": "#a43b08",
  "hljs-type": "#004da8",
  "hljs-built_in": "#004da8",
  "hljs-title": "#004da8",
  "hljs-comment": "#535e71",
  "hljs-quote": "#535e71",
  "hljs-meta": "#7f4500",
  "hljs-attr": "#7f4500",
  "hljs-attribute": "#7f4500",
  "hljs-symbol": "#7f4500",
  "hljs-variable": "#a21949",
  "hljs-deletion": "#a21949",
};
const boldTokens = new Set([
  "hljs-keyword",
  "hljs-selector-tag",
  "hljs-type",
  "hljs-built_in",
]);

export function codeLines(pre, tabSize) {
  const lines = [[]];
  const indentation = " ".repeat(tabSize);
  function append(node, style = {}) {
    if (node.nodeType === 3) {
      const segments = node.textContent
        .replaceAll("\t", indentation)
        .split("\n");
      segments.forEach((text, index) => {
        if (index) lines.push([]);
        if (text) lines.at(-1).push({ text, ...style });
      });
    } else if (node.nodeType === 1) {
      const color = Array.from(
        node.classList,
        (name) => tokenColors[name],
      ).find(Boolean);
      const bold = Array.from(node.classList).some((name) =>
        boldTokens.has(name),
      );
      const nested = { ...style };
      if (color) nested.color = color;
      if (bold) nested.bold = true;
      for (const child of node.childNodes) append(child, nested);
    }
  }

  append(pre);
  if (lines.length > 1 && !lines.at(-1).length) lines.pop();
  return lines.map((runs) => (runs.length ? runs : [{ text: "\u00a0" }]));
}
