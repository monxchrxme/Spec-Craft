import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  headingSpan,
  outlineHierarchy,
  reorderMarkdown,
} from "../public/block-order.js";
import { isMermaid, mermaidMarkdown } from "../public/mermaid.js";
import { formatPdfRules, pdfRules } from "../public/pdf-rules.js";

test("outline branches follow heading levels and distinguish duplicate titles", () => {
  const titles = [
    [1, "Документ"],
    [3, "Раздел"],
    [5, "Подраздел"],
    [3, "Раздел"],
    [4, "Подраздел"],
  ];
  const headings = outlineHierarchy(
    titles.map(([level, content]) => ({
      t: { type: "heading_open", tag: "h" + level },
      tokens: [{ type: "inline", content }],
    })),
  );
  assert.deepEqual(
    headings.map((heading) => heading.parent?.index),
    [undefined, 0, 1, 0, 3],
  );
  assert.deepEqual(
    headings.map((heading) => heading.depth),
    [0, 1, 2, 1, 2],
  );
  assert.equal(
    new Set(headings.map((heading) => heading.key)).size,
    headings.length,
  );
  assert(headings[1].hasChildren && headings[3].hasChildren);
  assert(!headings[2].hasChildren);
});

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

test("PDF rules apply after paragraphs and move with the annotated block", () => {
  const scope = {};
  runInNewContext(
    readFileSync(
      new URL("../public/vendor/markdown-it.min.js", import.meta.url),
      "utf8",
    ),
    scope,
  );
  const md = scope.markdownit({ html: false }).use(pdfRules);
  const marker = formatPdfRules(["break-before", "keep-next"], "\r\n");
  const before = "Введение";
  const attached = "## Приложение";
  const after = "## Итог";
  const gap = "\r\n\r\n";
  const body = before + gap + marker + attached + gap + after;
  const start = before.length + gap.length;
  const end = start + marker.length + attached.length;
  const rules = md.parse(body, {}).filter((token) => token.type === "spec_pdf");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].meta.join(" "), "break-before keep-next");
  assert(!md.render(body).includes("spec-pdf"));
  assert.equal(
    reorderMarkdown(
      body,
      [
        { start: 0, end: before.length },
        { fullStart: start, start: start + marker.length, end },
        { start: end + gap.length, end: body.length },
      ],
      1,
      2,
      3,
    ).body,
    before + gap + after + gap + marker + attached,
  );
  assert(
    !md
      .parse("> " + marker + "\n```md\n" + marker + "```", {})
      .some((token) => token.type === "spec_pdf"),
  );
});
