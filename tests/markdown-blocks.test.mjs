import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  headingSpan,
  outlineHierarchy,
  reorderMarkdown,
} from "../public/block-order.js";
import { reorderTable } from "../public/table-order.js";
import { drawingFence, drawingPresentation, excalidrawBlocks, readDrawing } from "../public/excalidraw.js";
import { documentParts } from "../public/document-parts.js";
import { latexProjection } from "../public/latex-source.js";
import { setTaskChecked, taskLists } from "../public/task-lists.js";
import { mergeFolders, readFolders } from "../public/workspace-folders.js";
import { isMermaid, mermaidMarkdown } from "../public/mermaid.js";
import { enableDiagramPan } from "../public/diagram-pan.js";
import { formatPdfRules, pdfRules } from "../public/pdf-rules.js";
import {
  bibliographyEntries,
  bibliographyMarkdown,
  materializeToc,
  portableBlocks,
} from "../public/portable-blocks.js";
import {
  projectTreeMarkdown,
  readProjectTree,
} from "../public/project-tree.js";
import {
  configureMermaid,
  mermaidPresentation,
  setMermaidPresentation,
} from "../public/mermaid-presentation.js";

test("task markers round-trip in nested lists, standalone paragraphs and LaTeX", () => {
  const scope = {};
  runInNewContext(readFileSync(new URL("../public/vendor/markdown-it.min.js", import.meta.url), "utf8"), scope);
  const md = scope.markdownit().use(taskLists);
  const body = "- [ ] Первая\r\n  - [X] **Вторая**\r\n\r\n[ ] Отдельно\r\n\r\n`[x] Код`";
  const html = md.render(body);
  assert.match(html, /data-task-line="0"[^>]* disabled>/);
  assert.match(html, /data-task-line="1"[^>]* disabled checked><strong>Вторая<\/strong>/);
  assert.match(html, /data-task-line="3"[^>]* disabled>/);
  assert.match(html, /<code>\[x\] Код<\/code>/);
  assert.equal(setTaskChecked(body, 1, false), body.replace("[X]", "[ ]"));
  assert.equal(setTaskChecked(body, 3, true), body.replace("[ ] Отдельно", "[x] Отдельно"));
  const flat = "- [x] Текст\n- [ ] Другой";
  const projection = latexProjection(flat, documentParts(md, flat));
  assert.match(projection.text, /\\item \\fbox\{x\} Текст/);
  assert.equal(projection.apply(projection.text.replace("Текст", "Правка")), flat.replace("Текст", "Правка"));
});

test("Excalidraw preserves scene assets and escapes drawing text in Markdown rendering", () => {
  const scope = {};
  runInNewContext(readFileSync(new URL("../public/vendor/markdown-it.min.js", import.meta.url), "utf8"), scope);
  const md = scope.markdownit({ html: false }).use(excalidrawBlocks);
  const scene = {
    type: "excalidraw",
    version: 2,
    elements: [{ type: "text", text: "</code><strong>\n```" }],
    appState: { viewBackgroundColor: "#fff" },
    files: { sample: { mimeType: "image/png", dataURL: "data:image/png;base64,QQ==" } },
  };
  const markdown = drawingFence(scene);
  const parts = documentParts(md, markdown + "\n\nАбзац");
  assert.equal(parts.length, 2);
  assert.deepEqual(readDrawing(parts[0].t.content), scene);
  assert.match(md.render(markdown), /&lt;\/code&gt;&lt;strong&gt;/);
});

test("Excalidraw ignores legacy width and falls back to automatic cropping when a frame is removed", () => {
  const scene = { type: "excalidraw", elements: [] };
  assert.deepEqual(drawingPresentation(scene), { height: 0, crop: "" });
  const frame = { type: "frame", id: "detail", width: 180, height: 120 };
  const existing = {
    ...scene,
    elements: [frame],
    specCraft: { width: 75, height: 360, crop: "detail" },
  };
  assert.deepEqual(drawingPresentation(existing), { height: 360, crop: "detail" });
  assert.deepEqual(drawingPresentation({ ...existing, elements: [{ ...frame, isDeleted: true }] }),
    { height: 360, crop: "" });
});

test("diagram previews pan the same distance with all three mouse buttons", () => {
  for (const button of [0, 1, 2]) {
    let captured;
    let prevented = 0;
    const image = {};
    const surface = {
      scrollLeft: 100, scrollTop: 40,
      firstElementChild: image,
      setPointerCapture: (id) => { captured = id; },
      setAttribute() {},
      removeAttribute() {},
    };
    const pointer = {
      pointerType: "mouse", pointerId: 3, button, clientX: 200, clientY: 90,
      target: image,
      preventDefault: () => { prevented++; },
    };
    enableDiagramPan(surface);
    if (button === 0) {
      surface.onpointerdown({ ...pointer, target: surface });
      assert.equal(captured, undefined);
    }
    surface.onpointerdown(pointer);
    surface.onpointermove({ ...pointer, clientX: 150, clientY: 30 });
    assert.equal(captured, 3);
    assert.equal(surface.scrollLeft, 150);
    assert.equal(surface.scrollTop, 100);
    surface.onlostpointercapture();
    surface.onpointermove({ ...pointer, clientX: 20, clientY: 10 });
    assert.equal(surface.scrollLeft, 150);
    surface.oncontextmenu(pointer);
    surface.onauxclick(pointer);
    assert.equal(prevented, button === 1 ? 3 : 2);
  }
});

test("restoring workspace folders remaps documents and preserves nesting on ID conflicts", () => {
  const root = { id: "existing", name: "Учёба", parentId: "" };
  const imported = [
    { id: "child", name: "Лабораторные", parentId: "parent" },
    { id: "existing", name: "Материалы", parentId: "child" },
    { id: "parent", name: "Учёба", parentId: "" },
    { id: "loop", name: "Цикл", parentId: "loop" },
  ];
  assert.deepEqual(readFolders(imported).map((folder) => folder.id), ["parent", "child", "existing"]);
  const merged = mergeFolders([root], imported, () => "new");
  assert.deepEqual(merged.folders, [
    root,
    { id: "child", name: "Лабораторные", parentId: "existing" },
    { id: "new", name: "Материалы", parentId: "child" },
  ]);
  assert.equal(merged.ids.get("parent"), "existing");
  assert.equal(merged.ids.get("existing"), "new");
});

test("reordering table data keeps column widths and alignment with the values", () => {
  const table = {
    rows: [
      ["ID", "Name", "Code"],
      ["1", "Token", "A"],
      ["2", "Document", "B"],
    ],
    align: ["left", "center", "right"],
    widths: [95, 280, 120],
  };
  reorderTable(table, "column", 2, 0);
  reorderTable(table, "row", 1, 2);
  assert.deepEqual(table, {
    rows: [
      ["Code", "ID", "Name"],
      ["B", "2", "Document"],
      ["A", "1", "Token"],
    ],
    align: ["right", "left", "center"],
    widths: [120, 95, 280],
  });
});

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
  const numbered = materializeToc(
    input.replace("<!-- spec-toc -->", "<!-- spec-toc numbered -->") +
      "\r\n\r\n##### Ещё один подраздел",
    md,
  );
  assert.equal(materializeToc(numbered, md), numbered);
  assert(numbered.includes("[1. Проверка](#"));
  assert(numbered.includes("[1.1. Дочерний](#"));
  assert(numbered.includes("[2. Проверка](#"));
  assert(numbered.includes("[2.1. Ещё один подраздел](#"));
  assert(!numbered.includes("[Оглавление]"));
});

test("individual TOCs filter heading levels and preserve destinations of unnumbered rows", () => {
  const scope = {};
  runInNewContext(
    readFileSync(
      new URL("../public/vendor/markdown-it.min.js", import.meta.url),
      "utf8",
    ),
    scope,
  );
  const md = scope.markdownit({ html: false }).use(portableBlocks);
  const toc = (marker) =>
    [marker, "", "old", "", "<!-- /spec-toc -->"].join("\r\n");
  const source = [
    toc("<!-- spec-toc auto levels=2,4 unnumbered=terms -->"),
    toc("<!-- spec-toc -->"),
    "# Doc",
    "## 5. Scope",
    "### Hidden",
    "#### 1.2 Details",
    "## Terms",
    "## 3D",
    "## 2026 год",
  ].join("\r\n\r\n");
  const output = materializeToc(source, md);
  assert.equal(materializeToc(output, md), output);
  const [custom, original] = md
    .parse(output, {})
    .filter((token) => token.type === "spec_toc");
  assert.deepEqual(
    custom.meta.entries.map(({ marker, label, slug }) => [marker, label, slug]),
    [
      ["1.", "Scope", "5-scope"],
      ["1.1.", "Details", "12-details"],
      ["", "Terms", "terms"],
      ["2.", "3D", "3d"],
      ["3.", "2026 год", "2026-год"],
    ],
  );
  const authored = md
    .parse(source.replace("spec-toc auto", "spec-toc numbered"), {})
    .find((token) => token.type === "spec_toc");
  assert.deepEqual(
    authored.meta.entries.map((entry) => entry.marker),
    ["5.", "1.2.", "", "6.", "7."],
  );
  assert(custom.meta.markdown.includes("[Terms](#terms)"));
  assert.equal(original.meta.entries.length, 7);
  assert(output.includes("#### 1.2 Details"));
  assert.equal(
    md
      .parse(toc("<!-- spec-toc levels=none -->") + "\n\n# Doc", {})
      .find((token) => token.type === "spec_toc").meta.entries.length,
    0,
  );
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

test("the dark blue Mermaid theme round-trips alongside layout and height", () => {
  const source = "---\nconfig:\n  layout: elk\n---\nflowchart TD\nA --> B\n";
  const styled = setMermaidPresentation(source, "elk", "vertical", {
    theme: "midnight",
    height: 420,
  });
  assert.match(styled, /speccraft-render: elk vertical midnight 420/);
  assert.equal(mermaidPresentation(styled).height, 420);
  assert.deepEqual(configureMermaid(styled), {
    source: source.replace("flowchart TD", "flowchart TB"),
    layout: "elk",
    theme: "midnight",
  });
  assert.equal(
    setMermaidPresentation(styled, "source", "source", {
      theme: "source",
      height: 0,
    }),
    source,
  );
});

test("older Mermaid ELK Stress settings open as ordered ELK and retain appearance and height", () => {
  const source = "stateDiagram-v2\n  direction LR\n  A --> B\n";
  const styled = setMermaidPresentation(source, "elk", "vertical", {
    theme: "blue",
    height: 540,
  });
  const free = styled.replace(
    "speccraft-render: elk",
    "speccraft-render: free",
  );
  assert.equal(mermaidPresentation(free).height, 540);
  assert.equal(mermaidPresentation(free).layout, "elk");
  assert.deepEqual(configureMermaid(free), {
    source: "stateDiagram-v2\n    direction TB\n  A --> B\n",
    layout: "elk",
    theme: "blue",
  });
  assert.equal(
    setMermaidPresentation(free, "source", "source", {
      theme: "source",
      height: 0,
    }),
    source,
  );
});

test("bibliography formats remain editable after exporting portable Markdown", () => {
  const entries = [
    "*Book*.\nSecond line.",
    "[Documentation](https://example.com)",
  ];
  for (const style of ["numbered", "bullets", "references"]) {
    const source = bibliographyMarkdown(entries, style)
      .split("\n")
      .slice(2, -2)
      .join("\n");
    assert.deepEqual(bibliographyEntries(source), { style, entries });
  }
});
