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
import { materializeToc, portableBlocks } from "../public/portable-blocks.js";
import {
  projectTreeMarkdown,
  readProjectTree,
} from "../public/project-tree.js";
import {
  configureMermaid,
  setMermaidPresentation,
} from "../public/mermaid-presentation.js";

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

test("project trees round-trip comments, folders and file names in plain text fences", () => {
  const input =
    "Example/\n├── README.md  # Notes\n└── api/\n    ├── тест.py\n    └── docs/\n";
  const tree = readProjectTree(input);
  assert.equal(tree.children[1].children[0].name, "тест.py");
  assert.equal(tree.children[0].note, "Notes");
  const markdown = projectTreeMarkdown(tree);
  assert(markdown.startsWith("```text\n"));
  assert.deepEqual(
    readProjectTree(markdown.split("\n").slice(1, -1).join("\n")),
    tree,
  );
  assert.equal(readProjectTree("Example/\n    └── orphan.js"), null);
});

test("the generated Markdown table of contents uses stable duplicate heading anchors", () => {
  const scope = {};
  runInNewContext(
    readFileSync(
      new URL("../public/vendor/markdown-it.min.js", import.meta.url),
      "utf8",
    ),
    scope,
  );
  const md = scope.markdownit({ html: false }).use(portableBlocks);
  const input =
    "## Оглавление\r\n\r\n<!-- spec-toc -->\r\n\r\nOld\r\n\r\n<!-- /spec-toc -->\r\n\r\n## Проверка\r\n\r\n### Дочерний\r\n\r\n## Проверка";
  const markdown = materializeToc(input, md);
  assert.equal(materializeToc(markdown, md), markdown);
  assert(
    markdown.includes(
      "  - [Дочерний](#" + encodeURIComponent("дочерний") + ")",
    ),
  );
  assert(
    markdown.includes("[Проверка](#" + encodeURIComponent("проверка-1") + ")"),
  );
  assert(!markdown.includes("[Оглавление]"));
  assert(
    materializeToc(input.replace("## Оглавление", "## Начало"), md).includes(
      "[Начало](#",
    ),
  );
  assert(md.render(markdown).includes('id="doc-heading-проверка-1"'));
  assert(md.render(markdown).includes('<nav class="document-toc"'));
});

test("Mermaid view settings preserve front matter and nested state directions", () => {
  const source =
    "---\ntitle: Example\n---\nstateDiagram-v2\n  direction LR\n  state A {\n    direction LR\n  }\n";
  const changed = setMermaidPresentation(source, "elk", "vertical");
  assert(
    changed.startsWith(
      "---\ntitle: Example\n---\n%% speccraft-render: elk vertical\n",
    ),
  );
  const settings = configureMermaid(changed);
  assert.equal(settings.layout, "elk");
  assert(settings.source.includes("stateDiagram-v2\n    direction TB\n"));
  assert(settings.source.includes("state A {\n    direction LR"));
  assert.equal(setMermaidPresentation(changed, "source", "source"), source);
  assert.equal(
    configureMermaid(
      setMermaidPresentation("flowchart TD; A --> B", "compact", "horizontal"),
    ).source,
    "flowchart LR; A --> B",
  );
});
