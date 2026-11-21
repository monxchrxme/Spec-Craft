import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { documentParts } from "../public/document-parts.js";
import { markdownSource } from "../public/markdown-source.js";
import { latexProjection } from "../public/latex-source.js";
import {
  bindTocExceptions,
  materializeToc,
  portableBlocks,
} from "../public/portable-blocks.js";
import { setTableWidthMarker, tableWidths } from "../public/table-widths.js";
import { reorderMarkdown } from "../public/block-order.js";
import { latex } from "../public/math.js";

import { readProject } from "../public/project-import.js";

const scope = {};
runInNewContext(
  readFileSync(
    new URL("../public/vendor/markdown-it.min.js", import.meta.url),
    "utf8",
  ),
  scope,
);
const md = scope.markdownit().use(latex).use(portableBlocks).use(tableWidths);
const parts = (body) => documentParts(md, body);
const tex = (body) => latexProjection(body, parts(body));
test("old TOC exceptions stay with the same section after moving duplicate headings and renaming", () => {
  const original = [
    "<!-- spec-toc numbered unnumbered=terms-1 -->",
    "old",
    "<!-- /spec-toc -->",
    "<!-- spec-toc numbered -->",
    "old",
    "<!-- /spec-toc -->",
    "## Terms",
    "First section",
    "## Terms",
    "Second section",
  ].join("\r\n\r\n");
  const bound = bindTocExceptions(original, parts(original));
  const parsed = parts(bound);
  const id = parsed[4].t.meta.tocId;
  assert.match(id, /^id:/);
  assert.equal(bindTocExceptions(bound, parsed), bound);
  const moved = reorderMarkdown(bound, parsed, 4, 6, 2).body;
  const afterMove = parts(moved);
  assert.equal(afterMove[2].t.meta.tocId, id);
  assert.deepEqual(
    afterMove[0].t.meta.entries.map((entry) => [entry.slug, entry.marker]),
    [
      ["terms", ""],
      ["terms-1", "1."],
    ],
  );
  assert.equal(afterMove[1].t.meta.entries[0].marker, "1.");

  const projection = tex(moved);
  const renamed = projection.apply(
    projection.text.replace("\\subsection{Terms}", "\\subsection{Glossary}"),
  );
  const materialized = materializeToc(renamed, md);
  assert(materialized.includes("[Glossary](#glossary)"));
  assert.deepEqual(
    parts(materialized)[0].t.meta.entries.map((entry) => [
      entry.slug,
      entry.marker,
    ]),
    [
      ["glossary", ""],
      ["terms", "1."],
    ],
  );
  assert(!md.render(renamed).includes("spec-heading-id"));
});

test("table width metadata survives LaTeX edits and leaves the header clean", () => {
  const plain = "| ID\\|копия | Название |\r\n| --- | --- |\r\n| КЛП | Токен |";
  const sized = setTableWidthMarker(plain, [125, 375]);
  assert.equal(setTableWidthMarker(sized, null), plain);
  assert.equal(parts(sized)[0].t.attrGet("data-column-widths"), "125,375");
  assert.match(md.render(sized), /<col style="width:25%">/);
  assert(!md.render(sized).includes("spec-table-widths"));
  const view = tex(sized);
  const updated = view.apply(view.text.replace("Токен", "Вектор"));
  assert.equal(parts(updated)[0].t.attrGet("data-column-widths"), "125,375");
  assert.match(updated, /Вектор/);
});

test("editing one TeX section preserves unedited Markdown, CRLF, definitions and opaque diagrams", () => {
  const body =
    "# One\r\n\r\nText _here_ and [link][id].\r\n\r\n~~~mermaid\r\nflowchart TD\r\nA-->B\r\n~~~\r\n\r\n[id]: /docs\r\n";
  const view = tex(body);
  assert.match(view.text, /\\SpecListing/);
  assert.equal(
    view.apply(view.text.replace("One", "Two")),
    body.replace("One", "Two"),
  );
  const custom = view.apply(
    view.text.replace("\\section{One}", "\\newcommand{\\foo}{A}"),
  );
  assert.match(custom, /~~~speccraft-latex\r\n\\newcommand/);
  assert.match(tex(custom).text, /\\newcommand\{\\foo\}/);
});
test("LaTeX table and formula edits change their respective Markdown blocks", () => {
  const body = "| A | B |\n| --- | --- |\n| x | y |\n\n$$\nx+y\n$$";
  const view = tex(body);
  assert.match(view.apply(view.text.replace("x & y", "x & z")), /\| x \| z \|/);
  assert.equal(
    view.apply(view.text.replace("x+y", "x-y")),
    body.replace("x+y", "x-y"),
  );
});
test("editing text beside inline code, links and escaped asterisks keeps their content", () => {
  const body =
    "Before `data_x` and [test](<https://example.com/a_b>) and \\*text\\*";
  const view = tex(body),
    next = view.apply(view.text.replace("Before", "After"));
  assert.equal(md.render(next), md.render(body.replace("Before", "After")));
});

test("existing project files retain text, assets and metadata as ordinary Markdown", () => {
  const uri = "data:image/png;base64,QUJD";
  const project = {
    format: "speccraft",
    version: 1,
    name: "Example.md",
    markdown: "\r\n\r\n![A](speccraft-asset:1)",
    assets: { "speccraft-asset:1": uri },
    profile: { standard: "ГОСТ 19.106-78", fields: { program: "A > B" } },
  };
  const imported = readProject(JSON.stringify(project));
  assert.ok(imported.body.startsWith("<!-- speccraft: ГОСТ 19.106-78"));
  assert.ok(imported.body.endsWith("![A](" + uri + ")"));
  assert.equal(
    tex(imported.body).apply(tex(imported.body).text),
    imported.body,
  );
  assert.throws(() => readProject(JSON.stringify({ ...project, version: 2 })));
});

test("folded image destinations survive edits, CRLF conversion and full-source copy", () => {
  const url = "https://example.org/image?name=" + "x".repeat(150);
  const body = [
    "# One",
    "⟪фото 1⟫",
    "![direct](<" + url + '> "caption"){width=40%}',
    "![second][photo]",
    "[photo]: " + url,
    "Last",
  ].join("\r\n\r\n");
  const short = markdownSource(body, parts(body), true);
  assert.equal(short.changes.filter((item) => item.image).length, 2);
  assert.ok(short.text.includes("⟪фото 2⟫"));
  assert(!short.text.includes(url));
  assert.equal(short.apply(short.text).body, body);
  assert.equal(
    short.apply(short.text.replace("One", "First").replace("Last", "End")).body,
    body.replace("One", "First").replace("Last", "End"),
  );
  for (const part of parts(body)) {
    assert.equal(short.raw(short.display(part.start)), part.start);
    assert.equal(short.raw(short.display(part.end)), part.end);
  }
  assert.equal(
    markdownSource(body, parts(body), false).text,
    body.replaceAll("\r\n", "\n"),
  );
});
test("image examples in code and ordinary hyperlinks retain their literal URLs", () => {
  const url = "https://example.org/" + "x".repeat(130);
  const literal = "![sample](" + url + ")";
  const body = [
    "~~~md",
    literal,
    "~~~",
    "",
    "`" + literal + "` and " + literal,
    "",
    "[reference](" + url + ")",
  ].join("\n");
  const view = markdownSource(body, parts(body), true);
  assert.equal(view.changes.filter((item) => item.image).length, 1);
  assert.ok(view.text.includes("`" + literal + "`"));
  assert.ok(view.text.endsWith("[reference](" + url + ")"));
});
