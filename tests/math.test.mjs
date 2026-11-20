import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { latex } from "../public/math.js";

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
