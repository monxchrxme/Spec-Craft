import { formulaSettings, pageMargins } from "./document-style.js";
import { highlightColors } from "./formatting.js";
import { formulaSvg } from "./math.js";
import { isMermaid, mermaidGraphic } from "./mermaid.js";
import { specIndex } from "./spec-index.js";
import { draw, normalize, frameLayout } from "./graph.js";
import { tableMeasurer } from "./pdf-table-flow.js";
import { readColumnWidths } from "./table-widths.js";
import { codeLines } from "./code-highlight.js";

const a4 = { width: 595.28, height: 841.89 };
const landscape = { width: a4.height, height: a4.width };

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

async function imageBlock(element, widthLimit, heightLimit) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = new URL(element.getAttribute("src"), document.baseURI).href;
  try {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    const width = Number(element.dataset.imageWidth);
    const caption = element.getAttribute("title")?.trim();
    const captionHeight = caption
      ? 16 + Math.ceil((caption.length * 6) / widthLimit) * 12
      : 0;
    const drawing = {
      image: canvas.toDataURL("image/png"),
      fit: [
        width >= 10 && width <= 100
          ? (widthLimit * width) / 100
          : Math.min(img.naturalWidth * 0.75, widthLimit),
        Math.max(24, heightLimit - captionHeight),
      ],
    };
    if (!caption) return drawing;
    const label = {
      text: caption,
      fontSize: 9,
      color: "#585363",
      margin: [0, 3, 0, 0],
    };
    return {
      stack: [drawing, label],
      // Overlong author-supplied captions remain readable as a text flow.
      unbreakable: captionHeight < heightLimit / 2,
      specMeasuredHeight: heightLimit,
    };
  } catch {
    throw Error(
      "Не удалось встроить изображение «" +
        (element.alt || element.getAttribute("src")) +
        "». Проверьте адрес и разрешение сайта на загрузку изображения.",
    );
  }
}

async function pdfFormula(element, settings, widthLimit, heightLimit) {
  const { math, note } = settings;
  const display = element.classList.contains("math-display");
  const size =
    (settings.size *
      (display ? math.formulaDisplaySize : math.formulaInlineSize)) /
    100;
  const margin = display
    ? [0, math.formulaSpaceBefore * 0.75, 0, math.formulaSpaceAfter * 0.75]
    : undefined;
  if (display) heightLimit = Math.max(1, heightLimit - margin[1] - margin[3]);
  const content = element.dataset.tex;
  try {
    const svg = await formulaSvg(content, display);
    if (!svg.hasAttribute("viewBox")) {
      // MathJax positions equation numbers in a responsive outer SVG. Give
      // that viewport the same 1000-units-per-em scale as unnumbered math.
      Object.assign(svg.style, {
        position: "fixed",
        visibility: "hidden",
        fontSize: "16px",
      });
      document.body.append(svg);
      try {
        const pixels = svg.getBoundingClientRect().height;
        const units =
          svg.querySelector("svg[data-table]")?.viewBox.baseVal.height ||
          (pixels * 1000) / 16;
        const minWidth = parseFloat(getComputedStyle(svg).minWidth) || 0;
        const width = Math.max(
          (widthLimit * 1000) / size,
          (minWidth * units) / pixels,
        );
        svg.setAttribute("viewBox", [0, 0, width, units].join(" "));
      } finally {
        svg.remove();
        svg.removeAttribute("style");
      }
    }
    const { y, width, height } = svg.viewBox.baseVal;
    const scale = Math.min(
      size / 1000,
      widthLimit / width,
      heightLimit / height,
    );
    if (!Number.isFinite(scale) || width <= 0 || height <= 0)
      throw Error("Пустая формула.");
    if (scale < (size / 1000) * 0.9)
      note(
        "Формула уменьшена, чтобы поместиться. Проверьте её или разбейте на строки.",
      );
    svg.setAttribute("width", width * scale);
    svg.setAttribute("height", height * scale);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const math = { svg: svg.outerHTML, font: "Sans" };
    if (display)
      return {
        ...math,
        width: width * scale,
        height: height * scale,
        alignment: "center",
        margin,
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
    note("В формуле есть ошибка LaTeX.");
    return {
      text: content + " [Ошибка LaTeX]",
      margin,
      font: "Mono",
      color: "#8b2841",
      fontSize: size * 0.9,
    };
  }
}

async function markdownBlocks(html, settings) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const { size, accent, gap, align, tabSize, note, pageSize } = settings;
  const pageWidth = pageSize.width - settings.horizontal;
  const pageHeight = pageSize.height - settings.vertical;
  let codeSpan = 0;

  async function flow(
    parent,
    defaults = {},
    widthLimit = pageWidth,
    heightLimit = pageHeight - 34,
  ) {
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
        const formula = await pdfFormula(
          node,
          settings,
          widthLimit,
          heightLimit,
        );
        if (node.classList.contains("math-display")) {
          flush();
          stack.push(formula);
        } else runs.push({ ...style, ...formula });
      } else if (node.hasAttribute?.("data-mermaid")) {
        flush();
        const drawing = await mermaidBlock(
          node.querySelector("code").textContent,
          {
            ...settings,
            basePage: pageSize,
            profile: "a4",
            labelWidth: widthLimit,
            note,
          },
        );
        stack.push(drawing.node);
      } else if (tag === "img") {
        flush();
        stack.push(await imageBlock(node, widthLimit, heightLimit));
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
          Object.assign(childStyle, {
            font: "Mono",
            background: "#f0eff6",
            specCodeSpan: ++codeSpan,
          });
        if (tag === "a" && node.hasAttribute("data-wiki")) {
          const hits = settings.index.resolve(node.dataset.wiki);
          if (hits.length === 1)
            Object.assign(childStyle, {
              linkToDestination: "spec-" + hits[0].key,
              color: accent,
              decoration: "underline",
            });
        } else if (tag === "a") {
          const href = node.getAttribute("href");
          let destination;
          if (href?.startsWith("#")) {
            try {
              destination = settings.headingDestinations.get(
                decodeURIComponent(href.slice(1)),
              );
            } catch {
              /* Keep the original link if it has no valid fragment. */
            }
          }
          Object.assign(childStyle, {
            ...(destination
              ? { linkToDestination: destination }
              : { link: href }),
            color: accent,
            decoration: "underline",
          });
        }
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
      const weights =
        readColumnWidths(el.dataset.columnWidths, rows[0].cells.length) ||
        Array.from(rows[0].cells, (_, i) =>
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
      if (!total) return { text: "" };
      const headerRows = el.tHead?.rows.length || 0;
      const sidePadding = Math.min(4, pageWidth / (weights.length * 10));
      const border = Math.min(0.55, pageWidth / (weights.length * 20));
      const gridWidth =
        pageWidth - (sidePadding * 2 + border) * weights.length - border;
      const columnWidths = weights.map((w) => (gridWidth * w) / total);
      const body = [];
      let headerHeight = 0;
      let unsafeHeight = false;
      let repeatHeaderRows = headerRows;
      for (const [rowIndex, row] of rows.entries()) {
        const cells = [];
        const isHeader = rowIndex < headerRows;
        const budget = isHeader
          ? pageHeight - 50
          : Math.max(30, pageHeight - headerHeight - 34);
        for (const cell of row.cells) {
          const header = cell.localName === "th";
          const width = Math.max(6, columnWidths[cell.cellIndex] - 2);
          const stack = await flow(
            cell,
            {},
            width,
            Math.max(20, Math.min(310, budget - 20)),
          );
          const measured = await settings.measureTable(
            stack,
            width,
            header,
            budget,
          );
          cells.push({
            stack,
            measured,
            bold: header,
            alignment: cell.style.textAlign || "left",
            fillColor: header ? "#efedf7" : null,
          });
        }
        const rowHeight = Math.max(
          0,
          ...cells.map((cell) => cell.measured.height),
        );
        const chunkCount = Math.max(
          1,
          ...cells.map((cell) => cell.measured.chunks.length),
        );
        if (isHeader && chunkCount > 1) repeatHeaderRows = 0;
        if (isHeader) headerHeight += rowHeight + 9;
        if (
          rowHeight > budget ||
          (isHeader && (chunkCount > 1 || headerHeight > pageHeight * 0.6))
        )
          unsafeHeight = true;
        const target = settings.targets.find((item) => item.row === rowIndex);
        const requirement =
          target?.id ||
          cells
            .map((_, i) => row.cells[i].textContent.trim())
            .find((text) => /^(FR|NFR|REQ|BR)-\d+$/i.test(text));
        const idColumn =
          requirement &&
          Array.from(row.cells).findIndex(
            (cell) =>
              cell.textContent.trim().toUpperCase() ===
              requirement.toUpperCase(),
          );
        if (!isHeader && chunkCount > 1) {
          note(
            requirement
              ? "Длинная строка " + requirement + " разбита на продолжения."
              : "Длинная строка таблицы разбита на продолжения.",
          );
        }
        for (let n = 0; n < chunkCount; n++) {
          const fragment = cells.map(({ measured, stack, ...cell }, index) => {
            let contents =
              isHeader && chunkCount === 1 ? stack : measured.chunks[n] || [];
            if (n && index === idColumn && contents.length === 0)
              contents = [
                { text: requirement + "\n(продолжение)", italics: true },
              ];
            else if (n && index === idColumn)
              contents = [
                { text: requirement + " (продолжение)", italics: true },
                ...contents,
              ];
            return {
              ...cell,
              stack: contents.length ? contents : [{ text: "" }],
            };
          });
          if (n === 0 && target) {
            const first = fragment
              .flatMap((cell) => cell.stack)
              .find((node) => node.text);
            if (first) first.id = "spec-" + target.key;
          }
          body.push(fragment);
        }
      }
      if (unsafeHeight)
        note("Высокая шапка или ячейка таблицы требует проверки разрывов.");
      return {
        table: {
          headerRows: repeatHeaderRows,
          widths: columnWidths,
          body,
          keepWithHeaderRows: !unsafeHeight && body.length > headerRows ? 1 : 0,
          dontBreakRows: !unsafeHeight,
        },
        layout: {
          hLineWidth: () => 0.55,
          vLineWidth: () => border,
          hLineColor: () => "#cbc8d3",
          vLineColor: () => "#cbc8d3",
          paddingTop: () => 4,
          paddingBottom: () => 4,
          paddingLeft: () => sidePadding,
          paddingRight: () => sidePadding,
        },
        fontSize: size * 0.92,
        margin: [0, 3, 0, gap],
      };
    }
    if (tag === "ul" || tag === "ol") {
      const items = [];
      for (const li of el.children)
        items.push({
          stack: await flow(li, { specParagraph: true, specKeepLines: true }),
        });
      return {
        [tag]: items,
        start: Number(el.getAttribute("start")) || 1,
        margin: [0, 1, 0, gap],
      };
    }
    if (tag === "pre")
      return {
        table: {
          widths: ["*"],
          body: [
            [
              {
                fillColor: "#f2f3f7",
                stack: codeLines(el, tabSize).map((text) => ({
                  text,
                  specParagraph: true,
                  specKeepLines: true,
                })),
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          paddingLeft: () => 9,
          paddingRight: () => 9,
          paddingTop: () => 9,
          paddingBottom: () => 9,
        },
        font: "Mono",
        fontSize: size * 0.9,
        preserveLeadingSpaces: true,
        margin: [0, 4, 0, gap],
      };
    if (tag === "blockquote")
      return {
        stack: await flow(el, { specParagraph: true }),
        margin: [14, 2, 0, 4],
        color: "#514e59",
      };
    if (tag === "hr")
      return {
        canvas: [
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: pageWidth,
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
        alignment: settings.headingAlign,
        color: settings.headingColor,
        fontSize: size * [1.95, 1.43, 1.19, 1.1, 1, 1][level - 1],
        bold: true,
        lineHeight: 1.05,
        margin: [0, level === 1 ? 0 : 8, 0, 5],
      };
    }
    return {
      stack: await flow(el, {
        alignment: align,
        specParagraph: true,
        specKeepLines:
          settings.keepParagraph ||
          /^(FR|NFR|REQ|BR)-\d+\b/i.test(el.textContent.trim()),
      }),
      margin: [0, 0, 0, gap],
    };
  }
  return flow(template.content);
}

function diagramSheet({
  width,
  height,
  desired,
  profile,
  separate,
  basePage,
  horizontal,
  vertical,
  extra,
  fitted,
}) {
  const fit = (page) =>
    Math.min(
      (page.width - horizontal) / width,
      (page.height - vertical - extra) / height,
      1,
    );
  if (profile === "a4") {
    return { scale: fitted, pageSize: separate ? basePage : null };
  }
  if (!separate && fitted + 0.01 >= desired)
    return { scale: fitted, pageSize: null };
  const wide = fit(landscape);
  if (fitted + 0.01 >= desired) return { scale: fitted, pageSize: basePage };
  if (wide + 0.01 >= desired)
    return { scale: Math.min(wide, desired), pageSize: landscape };
  const scale = Math.min(
    desired,
    (14400 - Math.max(horizontal, vertical + extra) - 2) /
      Math.max(width, height),
  );
  return {
    scale,
    pageSize: {
      width: Math.max(
        basePage.width,
        Math.ceil(width * scale + horizontal + 2),
      ),
      height: Math.max(360, Math.ceil(height * scale + vertical + extra + 2)),
    },
  };
}

function diagramBlock(raw, options) {
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
  const extra = 75 + Math.ceil((graph.title || "").length / 95) * 13;
  const fitted = Math.min(
    ((options.basePage.width - options.horizontal) * layout.width) /
      100 /
      width,
    (options.basePage.height - options.vertical - extra) / height,
    layout.height ? (layout.height * 0.75) / height : Infinity,
    1,
  );
  const { scale, pageSize } = diagramSheet({
    ...options,
    width,
    height,
    extra,
    fitted,
    desired: desiredScale,
  });
  const drawing = {
    svg: svg.outerHTML,
    width: width * scale,
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
  return { node, pageSize };
}

async function mermaidBlock(source, options) {
  try {
    const { url, width, height } = await mermaidGraphic(source);
    const extra = 75;
    const fitted = Math.min(
      0.75,
      (options.labelWidth || options.basePage.width - options.horizontal) /
        width,
      (options.basePage.height - options.vertical - extra) / height,
    );
    const { scale, pageSize } = diagramSheet({
      ...options,
      width,
      height,
      extra,
      fitted,
      desired: 0.64,
    });
    const pixels = Math.min(scale * 4, 4096 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * pixels));
    canvas.height = Math.max(1, Math.ceil(height * pixels));
    const image = new Image();
    image.src = url;
    await image.decode();
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const drawing = {
      image: canvas.toDataURL("image/png"),
      width: width * scale,
      height: height * scale,
      alignment: "center",
    };
    return {
      node: { stack: [drawing], unbreakable: true, margin: [0, 2, 0, 8] },
      pageSize,
    };
  } catch {
    options.note(
      "Диаграмма Mermaid не построилась. В PDF добавлен исходный код.",
    );
    return {
      node: {
        stack: [
          {
            text: "Ошибка Mermaid · не удалось построить изображение",
            color: "#8b2841",
          },
          {
            text: source.trimEnd(),
            font: "Mono",
            fontSize: 9,
            preserveLeadingSpaces: true,
          },
        ],
        margin: [0, 4, 0, 8],
      },
    };
  }
}

function contentsRows(meta, settings, pageNumbers) {
  const { size, accent, headingDestinations } = settings;
  return meta.entries.map((entry) => {
    const { marker, label, slug, depth } = entry;
    const linkToDestination = headingDestinations.get(slug);
    return {
      columns: [
        ...(marker
          ? [{ width: "auto", text: marker, linkToDestination, noWrap: true }]
          : []),
        {
          width: "*",
          text: [{ text: label, linkToDestination, specTocSlug: slug }],
        },
      ],
      columnGap: size * 0.3,
      color: accent,
      margin: [depth * size * 1.45, 0, pageNumbers ? size * 3 : 0, size * 0.16],
    };
  });
}

// Only the final layout knows where headings landed and where a wrapped title
// ends. Fill the reserved gutter on that last line without changing pagination.
function finishContentsPages(pages, headingPages) {
  for (const page of pages) {
    for (const { type, item: line } of page.items) {
      if (type !== "line" || !line.lastLineInParagraph) continue;
      const last = line.inlines.at(-1);
      const pageNumber =
        last?.specTocSlug && headingPages.get(last.specTocSlug);
      if (!pageNumber) continue;
      const text = String(pageNumber);
      const size = last.fontSize;
      const width = last.font.widthOfString(text, size, last.fontFeatures);
      const x = page.pageSize.width - page.pageMargins.right - width;
      const x1 = line.x + line.getWidth() + size * 0.5;
      const x2 = x - size * 0.5;
      if (x2 - x1 >= size * 0.4) {
        const y = line.y + line.getAscenderHeight() - size * 0.1;
        page.items.push({
          type: "vector",
          item: {
            type: "line",
            x1,
            x2,
            y1: y,
            y2: y,
            lineWidth: size * 0.09,
            lineColor: "#585363",
            lineCap: "round",
            dash: { length: 0.1, space: size * 0.42 },
          },
        });
      }
      line.inlines.push({
        ...last,
        x: x - line.x,
        text,
        width,
        color: "#262431",
      });
    }
  }
}

export async function exportPdf(parts, md, doc, profile = "screen") {
  await import("./vendor/pdf/pdfmake.min.js");
  const style = doc.style || {};
  const margins = pageMargins(style);
  const basePage = style.pdfOrientation === "landscape" ? landscape : a4;
  const pageLayout = {
    basePage,
    horizontal: margins[0] + margins[2],
    vertical: margins[1] + margins[3],
  };
  const font = families[style.font] || "Sans";
  const size = (Number(style.size) || 16) * 0.75;
  const leading = (Number(style.leading) || 1.65) * 0.74;
  const settings = {
    ...pageLayout,
    math: formulaSettings(style),
    headingAlign: ["center", "right"].includes(style.headingAlign)
      ? style.headingAlign
      : "left",
    headingColor: style.accentHeadings ? style.accent || "#6353bb" : "#262431",
    index: specIndex(parts),
    size,
    gap: (Number(style.gap) || 12) * 0.75,
    align: style.align === "justify" ? "justify" : "left",
    accent: style.accent || "#6353bb",
    tabSize: Number(style.tabSize) || 4,
    measureTable: tableMeasurer(fontFiles, font, size * 0.92, leading),
  };
  settings.headingDestinations = new Map(
    settings.index.headings.flatMap((heading) => {
      const slug = parts[heading.index].t.meta?.anchor;
      return slug ? [[slug, "spec-" + heading.key]] : [];
    }),
  );
  const targets = new Map();
  for (const target of settings.index.targets) {
    if (!targets.has(target.index)) targets.set(target.index, []);
    targets.get(target.index).push(target);
  }
  const sections = [];
  let normal = [];
  const warnings = [];
  const blocksOnPages = new Map();
  const locations = new Map();
  const automaticSheets = new Set();
  let pageSizes = [];
  const flush = () => {
    if (normal.length)
      sections.push({
        section: normal,
        pageSize: basePage,
        pageOrientation: basePage === landscape ? "landscape" : "portrait",
      });
    normal = [];
  };
  for (const [i, part] of parts.entries()) {
    const rules = part.pdfRules || [];
    const forceLandscape = rules.includes("landscape-sheet");
    const separate = forceLandscape || rules.includes("separate-sheet");
    const headingLevel =
      part.t.type === "heading_open" ? Number(part.t.tag.slice(1)) : 0;
    const manualBreak =
      rules.includes("break-before") ||
      (headingLevel > 0 && headingLevel <= (style.pdfSectionLevel || 0));
    const note = (message) => {
      if (
        !warnings.some(
          (warning) => warning.index === i && warning.message === message,
        )
      )
        warnings.push({ index: i, message });
    };
    const mermaid = isMermaid(part.t);
    const diagram =
      part.t.type === "fence" && part.t.info.trim() === "studio-diagram";
    const columns =
      part.t.type === "table_open"
        ? part.tokens.filter((token) => token.type === "th_open").length
        : 0;
    let pageSize = separate ? basePage : null;
    if (forceLandscape || (columns > 6 && profile === "screen"))
      pageSize = landscape;
    let blocks;
    if (diagram || mermaid) {
      const options = {
        ...pageLayout,
        basePage: forceLandscape ? landscape : basePage,
        profile: forceLandscape ? "a4" : profile,
        separate,
        note,
      };
      const rendered = mermaid
        ? await mermaidBlock(part.t.content, options)
        : diagramBlock(part.t.content, options);
      pageSize = rendered.pageSize || pageSize;
      blocks = [rendered.node];
    } else if (part.t.type === "spec_toc" && part.t.meta.entries.length) {
      blocks = contentsRows(part.t.meta, settings, style.pdfPageNumbers);
    } else {
      if (columns > 6 && profile === "a4")
        note("В таблице много столбцов для A4. Проверьте ширину и читаемость.");
      const selectedTargets = targets.get(i) || [];
      blocks = await markdownBlocks(
        md.renderer.render(part.tokens, md.options, {}),
        {
          ...settings,
          pageSize: pageSize || basePage,
          targets: selectedTargets,
          keepParagraph: (targets.get(i - 1) || []).some(
            (target) =>
              target.row < 0 && /^(FR|NFR|REQ|BR)-\d+$/i.test(target.id || ""),
          ),
          note,
        },
      );
      if (blocks[0]?.headlineLevel) {
        const target = selectedTargets.find((t) => t.row < 0);
        const first = blocks[0].stack.find((node) => node.text);
        if (target) {
          if (first) first.id = "spec-" + target.key;
          else
            blocks[0].stack.unshift({
              text: "\u200b",
              fontSize: 0.1,
              id: "spec-" + target.key,
            });
        }
      }
    }
    if (!blocks.length) continue;
    const heading = Boolean(blocks[0].headlineLevel);
    const unit = {
      id: "spec-pdf-block-" + i,
      stack: blocks,
      specKeep: heading || rules.includes("keep-next"),
      heading,
      manualBreak,
    };
    if (pageSize) {
      if (!separate) automaticSheets.add(i);
      const headings = [];
      if (!manualBreak && !forceLandscape) {
        while (normal.at(-1)?.heading) {
          const previous = normal.pop();
          headings.unshift(previous);
          if (previous.manualBreak) break;
        }
      }
      flush();
      sections.push({
        section: [...headings, unit],
        pageSize,
        pageOrientation:
          pageSize.width > pageSize.height ? "landscape" : "portrait",
      });
    } else {
      if (manualBreak) flush();
      normal.push(unit);
      if (rules.includes("break-after")) flush();
    }
  }
  flush();
  const nextBlock = new Map();
  for (const section of sections) {
    const units = section.section;
    units.forEach((unit, index) => {
      if (!unit.specKeep) return;
      let next = index + 1;
      if (unit.heading) {
        while (units[next]?.heading && units[next + 1]) next++;
      }
      if (units[next]) nextBlock.set(unit.id, units[next].id);
    });
  }
  const pageBreakBefore = (node, container) => {
    const next = nextBlock.get(node.id);
    if (!next) return false;
    const page = node.pageNumbers.at(-1);
    if (
      container
        .getFollowingNodesOnPage()
        .some((item) => item.id === next && item.pageNumbers[0] === page)
    )
      return false;
    return container
      .getPreviousNodesOnPage()
      .some((item) => item.id?.startsWith("spec-pdf-block-"));
  };
  pageBreakBefore.specLayout = (nodes, pages) => {
    pageSizes = pages.map(({ pageSize, pageMargins }) => ({
      ...pageSize,
      marginLeft: pageMargins.left,
    }));
    for (const node of nodes) {
      if (!node.id?.startsWith("spec-pdf-block-") || !node.positions.length)
        continue;
      const index = Number(node.id.slice("spec-pdf-block-".length));
      blocksOnPages.set(index, [
        ...new Set(node.positions.map((position) => position.pageNumber)),
      ]);
      const starts = new Map();
      for (const { pageNumber, top } of node.positions) {
        if (!Number.isFinite(top)) continue;
        starts.set(
          pageNumber,
          Math.min(top, starts.get(pageNumber) ?? Infinity),
        );
      }
      for (const [pageNumber, top] of starts) {
        if (!locations.has(pageNumber)) locations.set(pageNumber, []);
        locations.get(pageNumber).push({ index, top });
      }
    }
    if (style.pdfPageNumbers) {
      const headingPages = new Map(
        settings.index.headings.map(({ index }) => [
          parts[index].t.meta.anchor,
          blocksOnPages.get(index)?.[0],
        ]),
      );
      finishContentsPages(pages, headingPages);
    }
    for (const blocks of locations.values())
      blocks.sort((a, b) => a.top - b.top || a.index - b.index);
  };
  const fonts = Object.fromEntries(
    [...new Set(["Sans", "Mono", font])].map((name) => [name, fontFiles(name)]),
  );
  const pdf = window.pdfMake;
  pdf.setFonts(fonts);
  pdf.setUrlResourceCaching(true);
  const blob = await pdf
    .createPdf({
      info: { title: doc.name.replace(/\.md$/i, ""), creator: "SpecCraft" },
      pageSize: basePage,
      pageOrientation: basePage === landscape ? "landscape" : "portrait",
      pageMargins: margins,
      footer: style.pdfPageNumbers
        ? (page) => ({
            text: String(page),
            alignment: "center",
            margin: [0, Math.min(12, Math.max(0, margins[3] - 13)), 0, 0],
            fontSize: 9,
            color: "#585363",
          })
        : null,
      defaultStyle: {
        font,
        fontSize: size,
        color: "#262431",
        lineHeight: leading,
      },
      content: sections.length ? sections : [{ text: "" }],
      pageBreakBefore,
    })
    .getBlob();
  return {
    blob,
    warnings,
    blocksOnPages,
    pageSizes,
    locations,
    automaticSheets,
  };
}
