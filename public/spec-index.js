// The Markdown remains the source of truth. Locations refer to parsed blocks,
// including individual rows of imported requirement tables.
export function wikiLinks(md) {
  md.inline.ruler.before("link", "wiki_link", (state, silent) => {
    const start = state.pos;
    if (state.linkLevel || !state.src.startsWith("[[", start)) return false;
    const match = /^\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+))?\]\]/.exec(
      state.src.slice(start, state.posMax),
    );
    if (!match || !match[1].trim()) return false;
    if (!silent) {
      const token = state.push("wiki_link", "a", 0);
      token.meta = { target: match[1].trim().replace(/^#/, "") };
      token.content = (match[2] || token.meta.target).trim();
    }
    state.pos = start + match[0].length;
    return true;
  });
  md.renderer.rules.wiki_link = (tokens, i) => {
    const t = tokens[i],
      esc = md.utils.escapeHtml;
    return (
      '<a href="#spec-link" class="wiki-link" data-wiki="' +
      esc(t.meta.target) +
      '">' +
      esc(t.content) +
      "</a>"
    );
  };
}
export const canonical = (s) =>
  s.trim().normalize("NFC").toLocaleLowerCase("ru");
const idPattern = /^((?:FR|NFR|REQ|BR|TC)-\d+)\b/i;
export function specIndex(parts) {
  const targets = [],
    refs = [],
    components = [],
    headings = [],
    checks = [],
    requirements = [],
    bindings = [];
  let hierarchy = [];
  function addTarget(index, row, label, id, criterion = "") {
    const item = {
      index,
      row,
      label,
      id,
      criterion,
      key: index + ":" + row,
      section: hierarchy.at(-1)?.label || "Начало документа",
    };
    targets.push(item);
    if (id) (id.startsWith("TC-") ? checks : requirements).push(item);
    return item;
  }
  for (const [i, p] of parts.entries()) {
    const inline = p.tokens.filter((t) => t.type === "inline");
    const plain = (t) =>
      (t?.children || [])
        .map((c) => c.content || "")
        .join("")
        .trim();
    if (p.t.type === "heading_open") {
      const label = plain(inline[0]),
        id = label.match(idPattern)?.[1].toUpperCase();
      const depth = Number(p.t.tag[1]);
      hierarchy = hierarchy.filter((h) => h.depth < depth);
      const h = addTarget(i, -1, label, id);
      h.labelSource = inline[0]?.content;
      h.depth = depth;
      hierarchy.push(h);
      headings.push(h);
    }
    if (p.t.type === "table_open") {
      let cells = [],
        sources = [],
        header = [],
        row = -1;
      for (const t of p.tokens) {
        if (t.type === "tr_open") {
          row++;
          cells = [];
          sources = [];
        }
        if (t.type === "inline") {
          cells.push(plain(t));
          sources.push(t.content);
        }
        if (t.type !== "tr_close") continue;
        if (row === 0) {
          header = cells;
          continue;
        }
        const idColumn = header.findIndex((s) =>
          /^id$|^идентификатор$/i.test(s),
        );
        const c = Math.max(0, idColumn),
          id = cells[c]?.match(idPattern)?.[1].toUpperCase();
        if (id) {
          const criterion = header.findIndex((s) =>
            /критер|при[её]мк/i.test(s),
          );
          const name = header.findIndex((s) =>
            /требован|формулировк|названи|проверк/i.test(s),
          );
          const titleColumn = name >= 0 && name !== c ? name : c === 0 ? 1 : 0;
          const target = addTarget(
            i,
            row,
            id + " · " + (cells[titleColumn] || ""),
            id,
            cells[criterion] || "",
          );
          target.labelSource = id + " · " + (sources[titleColumn] || "");
        }
      }
    }
    let row = -1;
    for (const token of p.tokens) {
      if (token.type === "tr_open") row++;
      for (const child of token.children || [])
        if (child.type === "wiki_link")
          refs.push({
            index: i,
            row,
            target: child.meta.target,
            source: hierarchy.at(-1)?.label || "Начало документа",
          });
    }
    const check = hierarchy.findLast((h) => h.id?.startsWith("TC-"));
    const binding =
      p.t.type === "paragraph_open" &&
      p.text.trim().match(/^Проверяет:\s*\[\[((?:FR|NFR|REQ|BR)-\d+)\]\]$/i);
    if (check && binding)
      bindings.push({ check, req: binding[1].toUpperCase(), index: i });
    if (p.t.type === "fence" && p.t.info.trim() === "studio-diagram") {
      try {
        const g = JSON.parse(p.t.content);
        for (const n of g.nodes || [])
          if (typeof n.id === "string")
            components.push({
              index: i,
              node: n.id,
              label: n.label,
              diagram: g.title || "Блок-схема",
              diagramId: typeof g.id === "string" ? g.id : undefined,
              reqs: Array.isArray(n.requirements)
                ? n.requirements
                    .filter((s) => typeof s === "string")
                    .map((s) => s.toUpperCase())
                : [],
            });
      } catch {
        /* The diagram block displays its own parse error. */
      }
    }
  }
  const aliases = new Map();
  for (const item of targets)
    for (const alias of new Set([
      canonical(item.label),
      ...(item.id ? [canonical(item.id)] : []),
    ])) {
      if (!aliases.has(alias)) aliases.set(alias, []);
      aliases.get(alias).push(item);
    }
  return {
    targets,
    requirements,
    checks,
    refs,
    components,
    bindings,
    headings,
    resolve: (s) => aliases.get(canonical(s)) || [],
  };
}

// Compare document entities within their section so a changed position, table
// cell or requirement can be inspected without comparing an entire JSON fence.
export function reviewItems(parts) {
  const entries = new Map(),
    counts = new Map();
  let section = "Начало документа";
  function add(key, label, value) {
    const n = counts.get(key) || 0;
    counts.set(key, n + 1);
    entries.set(JSON.stringify([key, n]), { label, value });
  }
  for (const p of parts) {
    if (p.t.type === "heading_open") {
      section = p.tokens.find((t) => t.type === "inline")?.content || section;
      const id = section.match(idPattern)?.[1]?.toUpperCase();
      add(["heading", id || section].join("/"), section, p.text);
      continue;
    }
    if (p.t.type === "fence" && p.t.info.trim() === "studio-diagram") {
      try {
        const { nodes, edges, modules = [], ...meta } = JSON.parse(p.t.content);
        const graphKey = [section, meta.id || meta.title].join("/");
        add(
          graphKey + "/meta",
          "Схема · " + (meta.title || section),
          JSON.stringify(meta, null, 2),
        );
        for (const [kind, items] of [
          ["Фигура", nodes],
          ["Связь", edges],
          ["Модуль", modules],
        ])
          for (const o of items)
            add(
              graphKey + "/" + kind + "/" + o.id,
              kind +
                " · " +
                (o.label || o.title || (o.from ? o.from + " → " + o.to : o.id)),
              JSON.stringify(o, null, 2),
            );
        continue;
      } catch {
        /* Invalid diagrams can still be reviewed as source. */
      }
    }
    if (p.t.type === "table_open") {
      let cells = [];
      for (const t of p.tokens) {
        if (t.type === "tr_open") cells = [];
        if (t.type === "inline") cells.push(t.content);
        if (t.type === "tr_close")
          add(
            section + "/row/" + (cells[0] || ""),
            "Строка · " + (cells[0] || section),
            cells.join(" | "),
          );
      }
      add(
        section + "/table",
        "Таблица · " + section,
        p.tokens
          .filter((t) => t.type === "th_open")
          .map((t) => t.attrGet("style") || "—")
          .join(" | "),
      );
    } else add(section + "/" + p.t.type, section, p.text);
  }
  return entries;
}
