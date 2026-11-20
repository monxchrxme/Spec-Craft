import { highlightColors } from "./formatting.js";
import { formulaSvg } from "./math.js";
import { isMermaid, mermaidGraphic } from "./mermaid.js";
import { specIndex } from "./spec-index.js";
import { draw, normalize, frameLayout } from "./graph.js";
import { tableMeasurer } from "./pdf-table-flow.js";

const a4 = { width: 595.28, height: 841.89 };
const landscape = { width: a4.height, height: a4.width };
const margin = 38;
const contentWidth = a4.width - margin * 2;
const contentHeight = a4.height - margin * 2;
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

async function pdfFormula(element, size, widthLimit, heightLimit, note) {
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
      const contentBox = svg.getBBox();
      svg.remove();
      svg.removeAttribute("style");
      svg.setAttribute("viewBox", [0, 0, box.width, box.height].join(" "));
      const scale = Math.min(0.75, heightLimit / box.height);
      if (scale < 0.72 || contentBox.width > widthLimit / 0.75 + 1)
        note("Нумерованная формула уменьшена. Проверьте её читаемость.");
      svg.setAttribute("width", box.width * scale);
      svg.setAttribute("height", box.height * scale);
      return {
        svg: svg.outerHTML,
        width: box.width * scale,
        height: box.height * scale,
        font: "Sans",
        alignment: "center",
        margin: [0, 2, 0, 5],
      };
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
    note("В формуле есть ошибка LaTeX.");
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
  const { size, accent, gap, align, tabSize, note, pageSize } = settings;
  const pageWidth = pageSize.width - margin * 2;
  const pageHeight = pageSize.height - margin * 2;

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
          size,
          widthLimit,
          heightLimit,
          note,
        );
        if (node.classList.contains("math-display")) {
          flush();
          stack.push(formula);
        } else runs.push({ ...style, ...formula });
      } else if (node.hasAttribute?.("data-mermaid")) {
        flush();
        const drawing = await mermaidBlock(
          node.querySelector("code").textContent,
          { profile: "a4", labelWidth: widthLimit, note },
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
        stack: el.textContent
          .replace(/\n$/, "")
          .replaceAll("\t", " ".repeat(tabSize))
          .split("\n")
          .map((text) => ({
            text: text || "\u00a0",
            specParagraph: true,
            specKeepLines: true,
          })),
        font: "Mono",
        fontSize: size * 0.9,
        preserveLeadingSpaces: true,
        margin: [8, 4, 4, gap],
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
  extra,
  fitted,
}) {
  const fit = (page) =>
    Math.min(
      (page.width - 2 * margin) / width,
      (page.height - 2 * margin - extra) / height,
      1,
    );
  if (profile === "a4") {
    return { scale: fitted, pageSize: separate ? a4 : null };
  }
  if (!separate && fitted + 0.01 >= desired)
    return { scale: fitted, pageSize: null };
  const wide = fit(landscape);
  if (fitted + 0.01 >= desired) return { scale: fitted, pageSize: a4 };
  if (wide + 0.01 >= desired)
    return { scale: Math.min(wide, desired), pageSize: landscape };
  const scale = Math.min(
    desired,
    (14400 - 2 * margin - extra - 2) / Math.max(width, height),
  );
  return {
    scale,
    pageSize: {
      width: Math.max(a4.width, Math.ceil(width * scale + 2 * margin + 2)),
      height: Math.max(360, Math.ceil(height * scale + 2 * margin + extra + 2)),
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
    (contentWidth * layout.width) / 100 / width,
    (contentHeight - extra) / height,
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
      (options.labelWidth || contentWidth) / width,
      (contentHeight - extra) / height,
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

export async function exportPdf(parts, md, doc, profile = "screen") {
  await import("./vendor/pdf/pdfmake.min.js");
  const style = doc.style || {};
  const font = families[style.font] || "Sans";
  const size = (Number(style.size) || 16) * 0.75;
  const leading = (Number(style.leading) || 1.65) * 0.74;
  const settings = {
    index: specIndex(parts),
    size,
    gap: (Number(style.gap) || 12) * 0.75,
    align: style.align === "justify" ? "justify" : "left",
    accent: style.accent || "#6353bb",
    tabSize: Number(style.tabSize) || 4,
    measureTable: tableMeasurer(fontFiles, font, size * 0.92, leading),
  };
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
        pageSize: a4,
        pageOrientation: "portrait",
      });
    normal = [];
  };
  for (const [i, part] of parts.entries()) {
    const rules = part.pdfRules || [];
    const separate = rules.includes("separate-sheet");
    const manualBreak = rules.includes("break-before");
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
    let pageSize =
      separate || (columns > 6 && profile === "screen")
        ? columns > 6 && profile === "screen"
          ? landscape
          : a4
        : null;
    let blocks;
    if (diagram || mermaid) {
      const options = { profile, separate, note };
      const rendered = mermaid
        ? await mermaidBlock(part.t.content, options)
        : diagramBlock(part.t.content, options);
      pageSize = rendered.pageSize || pageSize;
      blocks = [rendered.node];
    } else {
      if (columns > 6 && profile === "a4")
        note("В таблице много столбцов для A4. Проверьте ширину и читаемость.");
      const selectedTargets = targets.get(i) || [];
      blocks = await markdownBlocks(
        md.renderer.render(part.tokens, md.options, {}),
        {
          ...settings,
          pageSize: pageSize || a4,
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
        if (first && target) first.id = "spec-" + target.key;
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
      if (!manualBreak) {
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
      pageSize: "A4",
      pageOrientation: "portrait",
      pageMargins: margin,
      footer: style.pdfPageNumbers
        ? (page) => ({
            text: String(page),
            alignment: "center",
            margin: [0, 12, 0, 0],
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
