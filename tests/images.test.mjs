import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  cropPixels,
  fullCrop,
  imageMarkdown,
  imageSizes,
  imageWidthMarkdown,
  moveCrop,
} from "../public/images.js";

const browser = vm.createContext({});
vm.runInContext(
  readFileSync(
    new URL("../public/vendor/markdown-it.min.js", import.meta.url),
    "utf8",
  ),
  browser,
);
const md = browser.markdownit().use(imageSizes);

test("image widths round-trip independently of the URL, alternative text and title", () => {
  const original = String.raw`![Схема \[API\]](<https://example.test/path?a=b> "Кадр"){width=065%}`;
  assert.match(md.render(original), /data-image-width="65"/);
  const resized = imageWidthMarkdown(original, 43);
  assert.match(resized, /\{width=43%\}$/);
  assert.equal((resized.match(/\{width=/g) || []).length, 1);
  assert.match(
    md.render(resized),
    /alt="Схема \[API\]" title="Кадр" data-image-width="43"/,
  );
  assert.equal(
    imageWidthMarkdown(resized, null),
    original.replace("{width=065%}", ""),
  );
  assert.match(
    md.render("![x](https://example.test/p.png){width=9%}"),
    /\{width=9%\}/,
  );
  assert.doesNotMatch(
    md.render(String.raw`![x](https://example.test/p.png)\{width=50%}`),
    /data-image-width/,
  );
});

test("serialized image Markdown escapes metadata and accepts the supported image sources", () => {
  const serialized = imageMarkdown("data:image/png;base64,AAAA", "Вид [A]", {
    width: 55,
    title: 'Снимок "A"',
  });
  assert.match(
    md.render(serialized),
    /alt="Вид \[A\]" title="Снимок &quot;A&quot;"/,
  );
  assert.match(md.render(serialized), /data-image-width="55"/);
  assert.throws(() => imageMarkdown("javascript:alert(1)", "x"), /HTTP/);
});

test("a crop converts normalized coordinates to source pixels while keeping a nonempty region", () => {
  const next = moveCrop(fullCrop, "nw", 0.5, 0.25, 1 / 400, 1 / 240);
  assert.deepEqual(cropPixels(next, 400, 240), {
    x: 200,
    y: 60,
    width: 200,
    height: 180,
  });
  const shifted = moveCrop(next, "move", -1, -1, 1 / 400, 1 / 240);
  assert.deepEqual(cropPixels(shifted, 400, 240), {
    x: 0,
    y: 0,
    width: 200,
    height: 180,
  });
  const minimum = moveCrop(next, "se", -2, -2, 1 / 400, 1 / 240);
  assert.deepEqual(cropPixels(minimum, 400, 240), {
    x: 200,
    y: 60,
    width: 1,
    height: 1,
  });
});
