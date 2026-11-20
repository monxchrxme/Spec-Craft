import { highlightColors } from "./formatting.js";
import { formulaSvg } from "./math.js";
import { specIndex } from "./spec-index.js";
import { draw, normalize, frameLayout } from "./graph.js";

const a4 = { width: 595.28, height: 841.89 };
const margin = 38;
const contentWidth = a4.width - margin * 2;
const families = { sans: "Sans", serif: "Serif", mono: "Mono" };

function fontFiles(name) {
  return Object.fromEntries(
    Object.entries({
      normal: "Regular",
      bold: "Bold",
      italics: "Italic",
      bolditalics: "BoldItalic",
    }).map(([style, suffix]) => [
      style,
      new URL(
        "./vendor/pdf/fonts/Liberation" + name + "-" + suffix + ".ttf",
        import.meta.url,
      ).href,
    ]),
  );
}

async function imageBlock(element) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = new URL(element.getAttribute("src"), document.baseURI).href;
  try {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return {
      image: canvas.toDataURL("image/png"),
      fit: [
        Math.min(img.naturalWidth * 0.75, contentWidth),
        a4.height - 2 * margin - 24,
      ],
    };
  } catch {
    throw Error(
      "Не удалось встроить изображение «" +
        (element.alt || element.getAttribute("src")) +
        "». Проверьте адрес и разрешение сайта на загрузку изображения.",
    );
  }
}

async function pdfFormula(element, size, widthLimit) {
  const display = element.classList.contains("math-display");
  const content = element.dataset.tex;
  try {
    const svg = await formulaSvg(content, display);
    if (!svg.hasAttribute("viewBox")) {
      // MathJax uses a responsive SVG for tagged equations. Give it the PDF
      // column's viewport before serializing it as a self-contained image.
      svg.style.cssText = "position:fixed;visibility:hidden;font-size:16px";
      svg.setAttribute("width", widthLimit / 0.75);
      document.body.append(svg);
      const box = svg.getBoundingClientRect();
      svg.remove();
      svg.removeAttribute("style");
      svg.setAttribute("viewBox", [0, 0, box.width, box.height].join(" "));
      svg.setAttribute("width", box.width * 0.75);
      svg.setAttribute("height", box.height * 0.75);
      return {
        svg: svg.outerHTML,
        width: box.width * 0.75,
        font: "Sans",
        alignment: "center",
        margin: [0, 2, 0, 5],
      };
    }
    const { y, width, height } = svg.viewBox.baseVal;
    const scale = Math.min(
      size / 1000,
      widthLimit / width,
      (a4.height - 2 * margin - 24) / height,
    );
    if (!Number.isFinite(scale) || width <= 0 || height <= 0)
      throw Error("Пустая формула.");
    svg.setAttribute("width", width * scale);
    svg.setAttribute("height", height * scale);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const math = { svg: svg.outerHTML, font: "Sans" };
    if (display)
      return {
        ...math,
        width: width * scale,
        alignment: "center",
        margin: [0, 2, 0, 5],
      };
    return {
      text: "\uFFFC",
      inlineSvg: {
        ...math,
        _width: width * scale,
        _height: height * scale,
        ascent: -y * scale,
      },
    };
  } catch {
    return {
      text: content + " [Ошибка LaTeX]",
      font: "Mono",
      color: "#8b2841",
      fontSize: size * 0.9,
    };
  }
}

async function markdownBlocks(html, settings) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const { size, accent, gap, align, tabSize } = settings;

  async function flow(parent, defaults = {}, widthLimit = contentWidth) {
    const stack = [];
    let runs = [];
    const flush = () => {
      if (runs.some((r) => r.text.trim()))
        stack.push({ text: runs, ...defaults });
      runs = [];
    };
    async function visit(node, style) {
      if (node.nodeType === Node.TEXT_NODE) {
        runs.push({ text: node.data.replace(/[\t\n\r ]+/g, " "), ...style });
        return;
      }
      const tag = node.localName;
      if (node.hasAttribute?.("data-tex")) {
        const formula = await pdfFormula(node, size, widthLimit);
        if (node.classList.contains("math-display")) {
          flush();
          stack.push(formula);
        } else runs.push({ ...style, ...formula });
      } else if (tag === "img") {
        flush();
        stack.push(await imageBlock(node));
      } else if (/^(p|h[1-6]|ul|ol|table|blockquote|pre|hr)$/.test(tag)) {
        flush();
        stack.push(await block(node));
      } else if (tag === "br") {
        runs.push({ text: "\n" });
      } else {
        const childStyle = { ...style };
        if (tag === "strong") childStyle.bold = true;
        if (tag === "em") childStyle.italics = true;
        if (tag === "s" || tag === "del") childStyle.decoration = "lineThrough";
        if (tag === "mark")
          childStyle.background = (
            highlightColors[node.dataset.highlight] || highlightColors.yellow
          ).color;
        if (tag === "code")
          Object.assign(childStyle, { font: "Mono", background: "#f0eef4" });
        if (tag === "a" && node.hasAttribute("data-wiki")) {
          const hits = settings.index.resolve(node.dataset.wiki);
          if (hits.length === 1)
            Object.assign(childStyle, {
              linkToDestination: "spec-" + hits[0].key,
              color: accent,
              decoration: "underline",
            });
        } else if (tag === "a")
          Object.assign(childStyle, {
            link: node.getAttribute("href"),
            color: accent,
            decoration: "underline",
          });
        for (const child of node.childNodes) await visit(child, childStyle);
      }
    }
    for (const child of parent.childNodes) await visit(child, {});
    flush();
    return stack;
  }
  async function block(el) {
    const tag = el.localName;
    if (tag === "table") {
      const rows = Array.from(el.rows);
      const weights = Array.from(rows[0].cells, (_, i) =>
        Math.sqrt(
          Math.max(
            6,
            ...rows.map((row) =>
              Math.min(65, row.cells[i]?.textContent.length || 0),
            ),
          ),
        ),
      );
      const total = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (100 * w) / total + "%");
      const body = [];
      for (const row of rows) {
        const cells = [];
        for (const cell of row.cells) {
          const header = cell.localName === "th";
          const width = Math.max(
            8,
            (contentWidth * weights[cell.cellIndex]) / total - 12,
          );
          cells.push({
            stack: await flow(cell, {}, width),
            bold: header,
            alignment: cell.style.textAlign || "left",
            fillColor: header ? "#efedf7" : null,
          });
        }
        body.push(cells);
      }
      return {
        table: { headerRows: el.tHead?.rows.length || 0, widths, body },
        layout: {
          hLineWidth: () => 0.55,
          vLineWidth: () => 0.55,
          hLineColor: () => "#cbc8d3",
          vLineColor: () => "#cbc8d3",
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
        fontSize: size * 0.92,
        margin: [0, 3, 0, gap],
      };
    }
    if (tag === "ul" || tag === "ol") {
      const items = [];
      for (const li of el.children) items.push({ stack: await flow(li) });
      return {
        [tag]: items,
        start: Number(el.getAttribute("start")) || 1,
        margin: [0, 1, 0, gap],
      };
    }
    if (tag === "pre")
      return {
        text: el.textContent
          .replace(/\n$/, "")
          .replaceAll("\t", " ".repeat(tabSize)),
        font: "Mono",
        fontSize: size * 0.9,
        preserveLeadingSpaces: true,
        margin: [8, 4, 4, gap],
      };
    if (tag === "blockquote")
      return { stack: await flow(el), margin: [14, 2, 0, 4], color: "#514e59" };
    if (tag === "hr")
      return {
        canvas: [
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: contentWidth,
            y2: 0,
            lineWidth: 0.7,
            lineColor: "#c9c6d0",
          },
        ],
        margin: [0, 4, 0, gap],
      };
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      const level = Number(heading[1]);
      return {
        stack: await flow(el),
        headlineLevel: level,
        fontSize: size * [1.95, 1.43, 1.19, 1.1, 1, 1][level - 1],
        bold: true,
        lineHeight: 1.05,
        margin: [0, level === 1 ? 0 : 8, 0, 5],
      };
    }
    return {
      stack: await flow(el, { alignment: align }),
      margin: [0, 0, 0, gap],
    };
  }
  return flow(template.content);
}

function diagramBlock(raw, enlarge) {
  let graph;
  try {
    graph = normalize(JSON.parse(raw));
  } catch (error) {
    throw Error("Проверьте блок studio-diagram. " + error.message);
  }
  const svg = draw(graph);
  const { width, height } = svg.viewBox.baseVal;
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.querySelectorAll('[stroke="transparent"]').forEach((el) => el.remove());
  // A light backing keeps labels legible where a connector passes behind the text.
  // The PDF renderer does not implement SVG paint-order for outlined letters.
  svg.style.cssText = "position:fixed;visibility:hidden;pointer-events:none";
  document.body.append(svg);
  try {
    for (const label of svg.querySelectorAll("text[paint-order]")) {
      const { x, y, width, height } = label.getBBox();
      const backing = document.createElementNS(svg.namespaceURI, "rect");
      for (const [key, value] of Object.entries({
        x: x - 2,
        y,
        width: width + 4,
        height,
        rx: 2,
        fill: "#fff",
      }))
        backing.setAttribute(key, value);
      label.before(backing);
      label.removeAttribute("stroke");
    }
  } finally {
    svg.remove();
    svg.removeAttribute("style");
  }
  for (const label of svg.querySelectorAll("text"))
    label.setAttribute("font-family", "Sans");
  const layout = frameLayout(graph);
  const labelSizes = Array.from(svg.querySelectorAll("text"), (el) =>
    Number(el.getAttribute("font-size")),
  ).filter((n) => n > 0);
  const smallest = labelSizes.reduce((min, size) => Math.min(min, size), 16);
  const desiredScale = Math.min(1, 9 / smallest);
  const availableHeight = a4.height - 2 * margin - 54;
  const scale = Math.min(
    (contentWidth * layout.width) / 100 / width,
    availableHeight / height,
    layout.height ? (layout.height * 0.75) / height : Infinity,
    1,
  );
  const large = enlarge && scale + 0.01 < desiredScale;
  const finalScale = large
    ? Math.min(
        desiredScale,
        (14400 - 2 * margin - 55) / Math.max(width, height),
      )
    : scale;
  const drawing = {
    svg: svg.outerHTML,
    width: width * finalScale,
    font: "Sans",
    alignment: layout.align,
  };
  const stack = [drawing];
  if (graph.title)
    stack.push({
      text: graph.title,
      fontSize: 9,
      color: "#585363",
      alignment: layout.align,
      margin: [0, 3, 0, 0],
    });
  const node = { stack, unbreakable: true, margin: [0, 2, 0, 8] };
  return {
    node,
    pageSize: large
      ? {
          width: Math.max(a4.width, Math.ceil(drawing.width + 2 * margin + 1)),
          height: Math.max(
            360,
            Math.ceil(height * finalScale + 2 * margin + 55),
          ),
        }
      : null,
  };
}

export async function exportPdf(parts, md, doc, enlarge) {
  await import("./vendor/pdf/pdfmake.min.js");
  const style = doc.style || {};
  const settings = {
    index: specIndex(parts),
    size: (Number(style.size) || 16) * 0.75,
    gap: (Number(style.gap) || 12) * 0.75,
    align: style.align === "justify" ? "justify" : "left",
    accent: style.accent || "#6353bb",
    tabSize: Number(style.tabSize) || 4,
  };
  const sections = [];
  let normal = [];
  const flush = () => {
    if (normal.length) sections.push({ section: normal, pageSize: a4 });
    normal = [];
  };
  for (const [i, part] of parts.entries()) {
    if (part.t.type === "fence" && part.t.info.trim() === "studio-diagram") {
      const { node, pageSize } = diagramBlock(part.t.content, enlarge);
      if (pageSize) {
        const heading = normal.at(-1)?.headlineLevel ? normal.pop() : null;
        flush();
        sections.push({
          section: heading ? [heading, node] : [node],
          pageSize,
        });
      } else normal.push(node);
    } else {
      const blocks = await markdownBlocks(
        md.renderer.render(part.tokens, md.options, {}),
        settings,
      );
      const root = blocks[0];
      if (root?.headlineLevel || root?.table) {
        for (const t of settings.index.targets.filter((t) => t.index === i)) {
          const stack =
            t.row < 0
              ? root.stack
              : root.table.body[t.row].flatMap((cell) => cell.stack);
          const text = stack.find((node) => node.text);
          if (text) text.id = "spec-" + t.key;
        }
      }
      normal.push(...blocks);
    }
  }
  flush();
  const font = families[style.font] || "Sans";
  const fonts = Object.fromEntries(
    [...new Set(["Sans", "Mono", font])].map((name) => [name, fontFiles(name)]),
  );
  const pdf = window.pdfMake;
  pdf.setFonts(fonts);
  pdf.setUrlResourceCaching(true);
  return pdf
    .createPdf({
      info: { title: doc.name.replace(/\.md$/i, ""), creator: "SpecCraft" },
      pageSize: sections[0]?.pageSize || a4,
      pageMargins: margin,
      defaultStyle: {
        font,
        fontSize: settings.size,
        color: "#262431",
        lineHeight: (Number(style.leading) || 1.65) * 0.74,
      },
      content: sections.length ? sections : [{ text: "" }],
      pageBreakBefore: (node, container) =>
        !!node.headlineLevel &&
        container.getFollowingNodesOnPage().length === 0 &&
        container.getNodesOnNextPage().length > 0,
    })
    .getBlob();
}
