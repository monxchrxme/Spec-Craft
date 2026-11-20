import test from "node:test";
import assert from "node:assert/strict";
import { headingSpan, reorderMarkdown } from "../public/block-order.js";
import { isMermaid, mermaidMarkdown } from "../public/mermaid.js";

test("moving an outline section retains its descendants and CRLF Markdown", () => {
  const blocks = [
    ["# Документ", "h1"],
    ["## Первый", "h2"],
    ["Текст.", ""],
    ["### Детали", "h3"],
    ["Детали.", ""],
    ["## Второй", "h2"],
    ["Итог.", ""],
  ];
  let offset = 0;
  const parts = blocks.map(([text, tag]) => {
    const start = offset;
    offset += text.length + 4;
    return {
      t: { type: tag ? "heading_open" : "paragraph_open", tag },
      start,
      end: start + text.length,
    };
  });
  const body = blocks.map(([text]) => text).join("\r\n\r\n") + "\r\n";
  assert.deepEqual(headingSpan(parts, 1), [1, 5]);
  assert.deepEqual(headingSpan(parts, 5), [5, 7]);
  assert.equal(reorderMarkdown(body, parts, 1, 5, 3), null);
  const moved = reorderMarkdown(body, parts, 1, 5, 7);
  assert.equal(
    moved.body,
    [blocks[0], ...blocks.slice(5), ...blocks.slice(1, 5)]
      .map(([text]) => text)
      .join("\r\n\r\n") + "\r\n",
  );
  assert(moved.body.startsWith("## Первый", moved.offset));
});

test("moving blocks keeps a diagram fence intact and separates text blocks", () => {
  const graph = "```mermaid\nflowchart TD\n  A --> B\n```";
  const body = "До\n" + graph + "\nПосле";
  const parts = [
    { start: 0, end: 2 },
    { start: 3, end: 3 + graph.length },
    { start: 4 + graph.length, end: body.length },
  ];
  const moved = reorderMarkdown(body, parts, 1, 2, 3);
  assert.equal(moved.body, "До\n\nПосле\n\n" + graph);
  assert.equal(moved.body.slice(moved.offset), graph);
});

test("raw Mermaid imports use a fence longer than fence-like lines in the source", () => {
  const source = "\uFEFFflowchart TD\n  A --> B\n````\n";
  assert.equal(
    mermaidMarkdown(source),
    "`````mermaid\nflowchart TD\n  A --> B\n````\n`````",
  );
  assert(isMermaid({ type: "fence", info: " Mermaid " }));
  assert(!isMermaid({ type: "code_block", info: "mermaid" }));
  assert(!isMermaid({ type: "fence", info: "javascript" }));
});
