import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { documentParts } from "../public/document-parts.js";
import {
  espdBlocks,
  readProfile,
  declaration,
  encodeProject,
  decodeProject,
  documentTypes,
  templateBody,
  markdownCopy,
} from "../public/espd.js";
import { latexProjection } from "../public/latex-source.js";
import { portableBlocks } from "../public/portable-blocks.js";
import { latex } from "../public/math.js";

import {
  frontMatter,
  pageFurniture,
  registrationTable,
} from "../public/espd-print.js";

const scope = {};
runInNewContext(
  readFileSync(
    new URL("../public/vendor/markdown-it.min.js", import.meta.url),
    "utf8",
  ),
  scope,
);
const md = scope.markdownit().use(latex).use(portableBlocks).use(espdBlocks);
const parts = (body) => documentParts(md, body);
const tex = (body) => latexProjection(body, parts(body));
test("ordinary Markdown including examples of GOST declarations remains ordinary", () => {
  for (const body of [
    "# ГОСТ 19.106-78",
    "Введение\n\n<!-- speccraft: ГОСТ 19.106-78 -->",
    "~~~md\n<!-- speccraft: ГОСТ 19.106-78 -->\n~~~",
    "<!-- speccraft: ГОСТ 19.106-78\n{invalid}\n-->",
  ]) {
    assert.equal(readProfile(body), null);
    assert.equal(markdownCopy(body), body);
    assert(!parts(body).some((p) => p.t.type === "espd_title"));
  }
});
test("all nine templates carry their own content standard and editable change register", () => {
  assert.equal(Object.keys(documentTypes).length, 9);
  for (const [type, [, first]] of Object.entries(documentTypes)) {
    const body = templateBody(type),
      entries = parts(body);
    assert.equal(entries[0].t.meta.type, type);
    assert(entries.some((p) => p.t.meta?.espd?.label === first));
    assert(entries.at(-1).t.meta.changeRegister);
    assert.equal(tex(body).apply(tex(body).text), body);
  }
});
test("versioned project preserves declared metadata spelling, embedded assets and CRLF", () => {
  for (const header of [
    "",
    "\uFEFF<!-- speccraft: ГОСТ 19.106-78 -->\r\n\r\n",
    declaration({ program: "A --> B" }).replaceAll("\n", "\r\n") + "\r\n\r\n",
  ]) {
    const body =
      header +
      "# Example\r\n\r\n![pic](data:image/png;base64,QUJD)\r\n\r\nspeccraft-asset:1\r\n![duplicate](data:image/png;base64,QUJD)\n";
    const doc = {
      name: "test.md",
      kind: "Пример",
      body,
      style: { size: 16 },
      token: "private",
    };
    const serialized = encodeProject(doc),
      project = JSON.parse(serialized);
    assert.equal(Object.keys(project.assets).length, 1);
    assert(!serialized.includes("private"));
    assert.equal(decodeProject(serialized).body, body);
    assert.throws(() =>
      decodeProject(JSON.stringify({ ...project, version: 2 })),
    );
  }
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
test("supported LaTeX table, formula and title edits change their respective blocks", () => {
  const body =
    declaration({ program: "Test", type: "19.201-78" }) +
    "\n\n| A | B |\n| --- | --- |\n| x | y |\n\n$$\nx+y\n$$";
  const view = tex(body);
  assert.equal(
    readProfile(
      view.apply(view.text.replace("{program}{Test}", "{program}{Changed}")),
    ).data.program,
    "Changed",
  );
  assert.match(view.apply(view.text.replace("x & y", "x & z")), /\| x \| z \|/);
  assert.equal(
    view.apply(view.text.replace("x+y", "x-y")),
    body.replace("x+y", "x-y"),
  );
});
test("appendices, tables and equation references are numbered in their print scopes", () => {
  const table = "| a |\n| --- |\n| b |";
  const body = [
    declaration({}),
    "# Main",
    table,
    "$$\na\\label{eq:a}\n$$",
    "См. [@eq:a].",
    "# Приложение — One",
    table,
    "# Приложение — Two",
    table,
  ].join("\n\n");
  const entries = parts(body);
  assert.deepEqual(
    entries
      .filter((p) => p.t.type === "table_open")
      .map((p) => p.t.meta.object.number),
    [1, 1, 1],
  );
  assert.deepEqual(
    entries
      .filter((p) => p.t.meta?.espd?.appendixMark)
      .map((p) => p.t.meta.espd.appendixMark),
    ["ПРИЛОЖЕНИЕ 1", "ПРИЛОЖЕНИЕ 2"],
  );
  assert.match(md.render(body), /href="#equation-eq:a">\(1\)/);
});
test("GOST inline notes retain numbering and TeX edits in paragraphs and tables", () => {
  const body =
    declaration({}) + "\n\nслово^[Смысл].\n\n| A |\n| --- |\n| X^[Значение] |";
  const view = tex(body);
  assert.match(view.text, /\\footnote\{Смысл\}/);
  assert.equal(
    view.apply(view.text.replace("Смысл", "Комментарий")),
    body.replace("Смысл", "Комментарий"),
  );
  assert.match(md.render(body), /data-espd-note="2"/);
  assert(!md.render("слово^[Смысл]").includes("data-espd-note"));
});
test("editing text beside inline code, links and escaped asterisks keeps their content", () => {
  const body =
    "Before `data_x` and [test](<https://example.com/a_b>) and \\*text\\*";
  const view = tex(body),
    next = view.apply(view.text.replace("Before", "After"));
  assert.equal(md.render(next), md.render(body.replace("Before", "After")));
});

test("the explanatory note starts with its title, while legacy projects retain the approval sheet", () => {
  const template = readProfile(templateBody("19.404-79")).data;
  const sample = {
    ...template,
    program: "Комплекс\nКомпонент",
    approvalId: "ЛУ-123",
    inventory: "А&Б",
  };
  const numbers = { total: 7, approval: 0 };
  const front = frontMatter(sample, numbers);
  assert.deepEqual(
    front.map((page) => page.section[0].id),
    ["espd-title"],
  );
  assert.match(JSON.stringify(front), /ЛУ-123/);
  assert.match(JSON.stringify(front), /Листов 7/);
  const legacy = frontMatter(
    { type: template.type },
    { total: 8, approval: 1 },
  );
  assert.deepEqual(
    legacy.map((page) => page.section[0].id),
    ["espd-approval", "espd-title"],
  );
  assert.match(
    pageFurniture(sample, numbers).background(1).stack[0].svg,
    /А&amp;Б/,
  );
  assert.equal(pageFurniture(sample, numbers).background(2), null);
  assert.equal(registrationTable([]).table.body[0][0].colSpan, 10);
});
