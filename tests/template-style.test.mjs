import test from "node:test";
import assert from "node:assert/strict";
import { pageMargins, templateStyle } from "../public/document-style.js";
import {
  readTemplates,
  restoreTemplates,
  saveTemplate,
} from "../public/templates.js";

test("old and styled templates with the same body survive backup and repeat restore", () => {
  const items = new Map();
  const storage = {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i],
    getItem: (k) => items.get(k),
    setItem: (k, v) => items.set(k, v),
  };
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  try {
    const base = { label: "Отчёт", body: "# {{Название}}" };
    saveTemplate(base);
    const styled = {
      ...base,
      defaults: { Название: "Пример", Лишнее: "удалено" },
      style: {
        pdfOrientation: "landscape",
        pdfMarginLeft: 25,
        accentHeadings: true,
      },
    };
    assert.equal(restoreTemplates([styled]), 1);
    const exported = JSON.parse(JSON.stringify(readTemplates()));
    items.clear();
    assert.equal(restoreTemplates(exported), 2);
    assert.equal(restoreTemplates(exported), 0);
    const restored = readTemplates().find((t) => t.style);
    assert.deepEqual(restored.style, styled.style);
    assert.deepEqual(restored.defaults, { Название: "Пример" });
  } finally {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else delete globalThis.localStorage;
  }
});

test("template style imports only supported values and legacy margins retain exact size", () => {
  const style = templateStyle({
    font: ["serif"],
    pdfPageNumbers: false,
    pdfOrientation: "strange",
    pdfMarginRight: 50,
    pdfMarginLeft: 25,
    pdfMarginBottom: 5,
    unknown: "ignore",
  });
  assert.deepEqual(style, {
    pdfPageNumbers: false,
    pdfMarginLeft: 25,
    pdfMarginBottom: 5,
  });
  assert.deepEqual(pageMargins(style), [
    (25 * 72) / 25.4,
    38,
    38,
    (5 * 72) / 25.4,
  ]);
  assert.deepEqual(pageMargins({}), [38, 38, 38, 38]);
});
