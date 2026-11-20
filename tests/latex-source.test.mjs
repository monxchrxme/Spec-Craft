import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { documentParts } from "../public/document-parts.js";
import { latexProjection } from "../public/latex-source.js";
import { portableBlocks } from "../public/portable-blocks.js";
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
const md = scope.markdownit().use(latex).use(portableBlocks);
const parts = (body) => documentParts(md, body);
const tex = (body) => latexProjection(body, parts(body));
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
