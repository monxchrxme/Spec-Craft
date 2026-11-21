import { specIndex, canonical } from "./spec-index.js";
import { makePatch, fingerprint } from "./workflow-model.js";
import { fence } from "./documents.js";
import { normalize } from "./graph.js";

const clean = (s) => s.trim().replace(/\s+/g, " ");
const graphOf = (part) => {
  if (part?.t.type !== "fence" || part.t.info.trim() !== "studio-diagram")
    return null;
  try {
    return normalize(JSON.parse(part.t.content));
  } catch {
    return null;
  }
};
const graphKey = (graph) =>
  graph.id || "title:" + (graph.title || "Блок-схема");
const withinLimit = (value, limit = 240) =>
  value.length <= limit
    ? value
    : value.slice(0, limit - 15) + fingerprint(value);

export function workflowSections(parts, body) {
  const headings = specIndex(parts).headings;
  const hierarchy = [];
  const sections = headings.map((heading, i) => {
    while (hierarchy.length && hierarchy.at(-1).depth >= heading.depth)
      hierarchy.pop();
    hierarchy.push(heading);
    const next = headings[i + 1];
    const start = parts[heading.index].start,
      end = next ? parts[next.index].start : body.length;
    const key =
      heading.id ||
      JSON.stringify(hierarchy.map((item) => canonical(item.label)));
    return {
      key: withinLimit(key),
      label: heading.label,
      index: heading.index,
      start,
      end,
      signature: fingerprint(body.slice(start, end).trimEnd()),
      type: "section",
    };
  });
  return uniqueUnits(sections);
}

function uniqueUnits(items) {
  const counts = new Map();
  for (const item of items)
    counts.set(item.key, (counts.get(item.key) || 0) + 1);
  return items.filter((item) => counts.get(item.key) === 1);
}

export function historyUnits(parts, body) {
  return uniqueUnits([
    ...workflowSections(parts, body),
    ...parts.flatMap((part, index) => {
      const graph = graphOf(part);
      return graph
        ? [
            {
              type: "diagram",
              key: "diagram:" + graphKey(graph),
              label: graph.title || "Блок-схема",
              start: part.start,
              end: part.end,
              index,
            },
          ]
        : [];
    }),
  ]);
}

export function sectionAt(sections, index) {
  return sections.findLast((item) => item.index <= index)?.key || "";
}

function blockIndex(paper, element) {
  const block = element?.closest(".block");
  return block?.parentElement === paper
    ? Number(block.dataset.workIndex ?? block.dataset.idx)
    : -1;
}

function readText(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest("button,svg,[aria-hidden=true]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const runs = [];
  let value = "";
  for (let node; (node = walker.nextNode()); ) {
    runs.push({ node, start: value.length });
    value += node.data;
  }
  return { value, runs };
}

function selectionOffset(root, range, text) {
  const run = text.runs.find((item) => item.node === range.startContainer);
  if (run) return run.start + range.startOffset;
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString().length;
}

function tableDetails(cell) {
  const table = cell.closest("table");
  const row = cell.parentElement;
  const labels = [...table.rows[0].cells].map((item) =>
    clean(readText(item).value),
  );
  const rowKey = clean(readText(row.cells[0]).value);
  return {
    row: row.rowIndex,
    column: cell.cellIndex,
    rowKey: rowKey.slice(0, 140),
    header: (labels[cell.cellIndex] || "").slice(0, 140),
    tableKey: labels.join("|").slice(0, 220),
  };
}

export function anchorFrom(paper, parts, sections, element) {
  const index = blockIndex(paper, element);
  if (index < 0) return null;
  const edge = element.closest("[data-edge]");
  if (edge) {
    const graph = graphOf(parts[index]);
    const connection = graph?.edges.find(
      (item) => item.id === edge.dataset.edge,
    );
    if (!connection || !connection.id) return null;
    return {
      anchor: { kind: "edge", diagram: graphKey(graph), edge: connection.id },
      label:
        "Стрелка · " +
        (connection.label || connection.from + " → " + connection.to),
      index,
    };
  }
  const cell = element.closest("td,th");
  if (!cell) return null;
  const details = tableDetails(cell);
  const quote = clean(readText(cell).value).slice(0, 700);
  return {
    anchor: {
      kind: "cell",
      block: index,
      section: sectionAt(sections, index),
      quote,
      ...details,
    },
    label:
      "Ячейка · " +
      [details.header, quote || "пустая"].filter(Boolean).join(" · "),
    index,
  };
}

export function selectedTextAnchor(paper, sections) {
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const asElement = (node) =>
    node instanceof Element ? node : node.parentElement;
  const first = asElement(range.startContainer),
    last = asElement(range.endContainer);
  const index = blockIndex(paper, first);
  const quote = range.toString();
  if (
    index < 0 ||
    index !== blockIndex(paper, last) ||
    !quote.trim() ||
    quote.length > 700
  )
    return null;
  if (first.closest("table") || last.closest("table")) return null;
  const text = readText(paper.children[index]);
  const offset = selectionOffset(paper.children[index], range, text);
  if (text.value.slice(offset, offset + quote.length) !== quote) return null;
  return {
    anchor: {
      kind: "text",
      quote,
      offset,
      block: index,
      section: sectionAt(sections, index),
      prefix: text.value.slice(Math.max(0, offset - 60), offset),
      suffix: text.value.slice(
        offset + quote.length,
        offset + quote.length + 60,
      ),
    },
    label: "Текст · «" + clean(quote).slice(0, 145) + "»",
    index,
  };
}

function quoteMatches(value, anchor) {
  const entries = [];
  for (
    let i = value.indexOf(anchor.quote);
    i >= 0;
    i = value.indexOf(anchor.quote, i + 1)
  ) {
    const before = value.slice(0, i),
      after = value.slice(i + anchor.quote.length);
    let lead = 0,
      tail = 0;
    while (
      lead < anchor.prefix.length &&
      before.at(-1 - lead) === anchor.prefix.at(-1 - lead)
    )
      lead++;
    while (tail < anchor.suffix.length && after[tail] === anchor.suffix[tail])
      tail++;
    entries.push({ offset: i, score: lead + tail });
  }
  return entries;
}

export function resolveAnchor(paper, parts, sections, anchor) {
  const blocks = [...paper.children];
  if (anchor.kind === "edge") {
    const indices = parts.flatMap((part, i) => {
      const graph = graphOf(part);
      return graph && graphKey(graph) === anchor.diagram ? [i] : [];
    });
    if (indices.length !== 1) return null;
    const index = indices[0];
    const element = blocks[index]?.querySelector(
      '[data-edge="' + CSS.escape(anchor.edge) + '"]',
    );
    return element ? { element, index } : null;
  }
  const candidates = blocks.map((block, index) => ({ block, index }));
  const scope = candidates.filter(
    ({ index }) => sectionAt(sections, index) === anchor.section,
  );
  if (anchor.kind === "cell") {
    function cells(list, exactTable = true) {
      return list.flatMap(({ block, index }) =>
        [...(block.querySelector("table")?.rows || [])].flatMap((row) =>
          [...row.cells].flatMap((cell) => {
            const info = tableDetails(cell);
            const sameRow =
              anchor.row === 0
                ? info.row === 0
                : !!anchor.rowKey &&
                  info.row > 0 &&
                  info.rowKey === anchor.rowKey;
            const sameColumn = anchor.header
              ? info.header === anchor.header
              : info.column === anchor.column;
            const sameTable = exactTable
              ? info.tableKey === anchor.tableKey
              : !!anchor.header &&
                info.tableKey.split("|")[0] === anchor.tableKey.split("|")[0];
            return sameRow && sameColumn && sameTable
              ? [{ element: cell, index }]
              : [];
          }),
        ),
      );
    }
    const scoped = cells(scope);
    const matches = scoped.length ? scoped : cells(candidates);
    if (matches.length === 1) return matches[0];
    if (!matches.length) {
      const updated = cells(scope, false);
      if (updated.length === 1) return updated[0];
    }
    const element =
      blocks[anchor.block]?.querySelector("table")?.rows[anchor.row]?.cells[
        anchor.column
      ];
    if (!matches.length && element) {
      const info = tableDetails(element);
      if (
        info.tableKey === anchor.tableKey &&
        clean(readText(element).value) === anchor.quote &&
        info.rowKey === anchor.rowKey
      )
        return { element, index: anchor.block };
    }
    return null;
  }
  function quotations(list) {
    return list.flatMap(({ block, index }) => {
      if (!block || block.querySelector("table,.diagram-card")) return [];
      const text = readText(block);
      return quoteMatches(text.value, anchor).map((match) => ({
        ...match,
        text,
        element: block,
        index,
      }));
    });
  }
  const nearby = quotations(scope);
  const entries = (nearby.length ? nearby : quotations(candidates)).sort(
    (a, b) => b.score - a.score,
  );
  const match = entries[0];
  if (!match || match.score === entries[1]?.score) return null;
  const start = match.text.runs.findLast((run) => run.start <= match.offset);
  const endOffset = match.offset + anchor.quote.length;
  const end = match.text.runs.find(
    (run) => run.start + run.node.data.length >= endOffset,
  );
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, match.offset - start.start);
  range.setEnd(end.node, endOffset - end.start);
  return { element: match.element, range, index: match.index };
}

export function showAnchor(paper, match, scroll = true) {
  paper
    .querySelector(".workflow-anchored")
    ?.classList.remove("workflow-anchored");
  globalThis.CSS?.highlights?.delete("speccraft-thread");
  if (!match) return false;
  if (match.range && typeof Highlight !== "undefined" && CSS.highlights) {
    CSS.highlights.set("speccraft-thread", new Highlight(match.range));
  } else match.element.classList.add("workflow-anchored");
  if (scroll)
    match.element.scrollIntoView({ block: "center", inline: "center" });
  return true;
}

function cellRanges(line) {
  const bars = [];
  let escaped = false;
  for (let pos = 0; pos < line.length; pos++) {
    const char = line[pos];
    if (char === "|" && !escaped) bars.push(pos);
    escaped = char === "\\" && !escaped;
  }
  const start =
    bars.length && !line.slice(0, bars[0]).trim() ? bars.shift() : -1;
  const end =
    bars.length && !line.slice(bars.at(-1) + 1).trim()
      ? bars.pop()
      : line.length;
  const boundaries = [start, ...bars, end];
  return boundaries.slice(0, -1).map((start, i) => {
    const from = start + 1,
      to = boundaries[i + 1];
    const raw = line.slice(from, to);
    return [
      from + (raw.match(/^\s*/)?.[0].length || 0),
      Math.max(
        from + (raw.match(/^\s*/)?.[0].length || 0),
        to - (raw.match(/\s*$/)?.[0].length || 0),
      ),
    ];
  });
}

export function proposalSource(body, parts, target, addRow = false) {
  const part = parts[target.index];
  if (!part) return null;
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const source = (start, end, initial, change, type = "Markdown") => ({
    start,
    end,
    initial,
    type,
    patch: (value) => makePatch(body, start, end, change(value)),
  });
  const anchor = target.anchor;
  if (anchor?.kind === "edge") {
    const graph = graphOf(part);
    const connection = graph?.edges.find((item) => item.id === anchor.edge);
    if (!connection) return null;
    const version = source(
      part.start,
      part.end,
      JSON.stringify(connection, null, 2),
      (value) => {
        const next = JSON.parse(value);
        if (next?.id !== connection.id) throw Error("Сохраните ID связи.");
        const edges = graph.edges.map((item) =>
          item.id === connection.id ? next : item,
        );
        return fence(normalize({ ...graph, edges })).replace(/\n/g, newline);
      },
      "JSON стрелки",
    );
    return { ...version, connection, nodes: graph.nodes };
  }
  if (addRow || anchor?.kind === "cell") {
    const lines = part.text.split(/\r\n|\n/);
    const row = anchor?.row || 0;
    const at = addRow ? Math.max(1, row + 1) : row ? row + 1 : 0;
    const lineStart =
      part.start +
      lines
        .slice(0, at)
        .reduce((n, line) => n + line.length + newline.length, 0);
    const line = lines[at] || "";
    if (addRow) {
      const rowSize = cellRanges(lines[0]).length;
      const end = lineStart + line.length;
      return source(
        end,
        end,
        "| " + Array.from({ length: rowSize }, () => " ").join(" | ") + " |",
        (value) => {
          const trimmed = value.trim();
          if (
            !trimmed ||
            /\r|\n/.test(trimmed) ||
            cellRanges(trimmed).length !== rowSize
          )
            throw Error("Укажите одну строку с тем же количеством столбцов.");
          return newline + trimmed;
        },
        "Новая строка таблицы",
      );
    }
    const range = cellRanges(line)[anchor.column];
    if (!range) return null;
    const [from, to] = range;
    return source(
      lineStart + from,
      lineStart + to,
      line.slice(from, to),
      (value) =>
        value
          .replace(/\r?\n/g, " ")
          .replace(/(\\*)\|/g, (match, slash) =>
            slash.length % 2 ? match : slash + "\\|",
          ),
      "Ячейка таблицы",
    );
  }
  if (anchor?.kind === "text") {
    const at = part.text.indexOf(anchor.quote);
    if (at >= 0 && part.text.indexOf(anchor.quote, at + 1) < 0)
      return source(
        part.start + at,
        part.start + at + anchor.quote.length,
        anchor.quote,
        (value) => value,
      );
  }
  return source(part.start, part.end, part.text, (value) =>
    value.replace(/\r?\n/g, newline),
  );
}
