import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { latex, normalizeMathDelimiters } from "../public/math.js";
import { portableBlocks } from "../public/portable-blocks.js";
import { coloredHighlights } from "../public/formatting.js";

const browser = vm.createContext({});
vm.runInContext(
  readFileSync(
    new URL("../public/vendor/markdown-it.min.js", import.meta.url),
    "utf8",
  ),
  browser,
);
const md = browser.markdownit().use(latex);

test("LaTeX uses inline and display delimiters and preserves TeX commands", () => {
  const source = String.raw`См. $x^2$ и \(\sqrt{x}\).

$$
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
$$

\[\int_0^1 t\,dt\]`;
  const tokens = md.parse(source, {});
  assert.deepEqual(
    Array.from(
      tokens[1].children.filter((token) => token.type === "math_inline"),
      (token) => token.content,
    ),
    ["x^2", String.raw`\sqrt{x}`],
  );
  assert.equal(tokens[3].type, "math_block");
  assert.match(tokens[3].content, /\\begin\{aligned\}/);
  assert.equal(tokens[4].content, String.raw`\int_0^1 t\,dt`);
});

test("ordinary dollars, escaped delimiters and code examples stay literal", () => {
  const dollars = String.raw`Цены $10 и $20. Экранирование \$x\$. Незакрытая $формула.`;
  assert.doesNotMatch(md.render(dollars), /data-tex=/);
  const fence = String.fromCharCode(96);
  assert.doesNotMatch(md.render(fence + "$x$" + fence), /data-tex=/);
  assert.doesNotMatch(
    md.render(fence.repeat(3) + "text\n$$\nx\n$$\n" + fence.repeat(3)),
    /data-tex=/,
  );
});

test("inline formulas work in table cells and source is escaped in HTML", () => {
  const html = md.render("| A | B |\n| --- | --- |\n| $x<y$ | $z^2$ |");
  assert.match(html, /<td><span class="math-inline" data-tex="x&lt;y">/);
  assert.match(html, /data-tex="z\^2"/);
  assert.doesNotMatch(md.render('$x"<img>$'), /<img>/);
});

test("copied math renders in headings, tables and display blocks before conversion", () => {
  const source = [
    String.raw`## **Порядок** \\(C\ne 0\\)`,
    "",
    "| Имя | Значение |",
    "| --- | --- |",
    String.raw`| A | \(C\) |`,
    "",
    String.raw`\\[`,
    String.raw`\frac{1}{2}`,
    String.raw`\\]`,
  ].join("\r\n");
  assert.match(md.render(source), /<strong>Порядок<\/strong> <span class="math-inline"/);
  assert.match(md.render(source), /<td><span class="math-inline" data-tex="C"/);
  assert.match(md.render(source), /<div class="math-display"/);
  const converted = normalizeMathDelimiters(source, md);
  assert.equal(md.render(converted), md.render(source));
  assert.match(converted, /\$\$\r\n\\frac\{1\}\{2\}\r\n\$\$/);
});

test("global conversion preserves code examples and math that needs bracket delimiters", () => {
  const fence = String.fromCharCode(96);
  const literal = String.raw`\\(x\\)`;
  const code = fence + literal + fence + "\n\n" +
    fence.repeat(3) + "text\n" + literal + "\n" + fence.repeat(3);
  const adjacent = String.raw`\(n\)2`;
  const body = code + "\n\n" + adjacent + " и " + literal;
  assert.equal(normalizeMathDelimiters(body, md), code + "\n\n" + adjacent + " и $x$");
});

test("heading and contents render as text with math while the source keeps inline formatting", () => {
  const mark = readFileSync(
    new URL("../public/vendor/markdown-it-mark.min.js", import.meta.url), "utf8",
  );
  vm.runInContext(mark, browser);
  const renderer = browser.markdownit()
    .use(browser.markdownitMark)
    .use(coloredHighlights)
    .use(latex)
    .use(portableBlocks);
  const heading = "# **1. Задача** *A* ~~B~~ [C](https://example.com) ==D=={pink} " +
    String.fromCharCode(96) + "E" + String.fromCharCode(96) + " $x^2$";
  const source = heading + "\n\n<!-- spec-toc numbered -->\n\nСписок\n\n<!-- /spec-toc -->";
  const parsed = renderer.parse(source, {});
  assert.ok(parsed[1].children.some((token) => token.type === "strong_open"));
  const html = renderer.renderer.render(parsed, renderer.options, {});
  assert.match(html, /<h1[^>]*>1\. Задача A B C D E <span class="math-inline"/);
  assert.match(html, /<span>Задача A B C D E <span class="math-inline"/);
  assert.doesNotMatch(html, /<(strong|em|s|code|mark)[ >]|\{pink\}|https:\/\/example\.com/);
});
