const markers = {
  toc: ["<!-- spec-toc -->", "<!-- /spec-toc -->"],
  bibliography: ["<!-- spec-bibliography -->", "<!-- /spec-bibliography -->"],
};

const numberedToc = "<!-- spec-toc numbered -->";

export function portableBlock(kind, content, numbered = false) {
  const open = kind === "toc" && numbered ? numberedToc : markers[kind][0];
  return [open, "", content, "", markers[kind][1]].join("\n");
}

function plainHeading(inline) {
  return (inline?.children || [])
    .map((child) =>
      ["softbreak", "hardbreak"].includes(child.type)
        ? " "
        : child.content || "",
    )
    .join("")
    .trim();
}

export function headingSlug(title, used) {
  const base =
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_ -]/gu, "")
      .replace(/ /g, "-") || "раздел";
  let candidate = base;
  for (let index = 1; used.has(candidate); index++)
    candidate = base + "-" + index;
  used.add(candidate);
  return candidate;
}

function linkLabel(title) {
  return (
    title
      .replace(/[\\[\]`*_~<>!&]/g, "\\$&")
      .replace(/\s+/g, " ")
      .trim() || "Раздел"
  );
}

function tocHierarchy(headings) {
  const ancestors = [];
  const counters = [];
  return headings.map((heading) => {
    while (ancestors.length && ancestors.at(-1) >= heading.level)
      ancestors.pop();
    const depth = ancestors.length;
    counters.length = depth + 1;
    counters[depth] = (counters[depth] || 0) + 1;
    ancestors.push(heading.level);
    return { ...heading, depth, number: counters.join(".") + "." };
  });
}

export function tocEntries(headings, numbered) {
  const widths = [];
  return headings
    .map(({ label, slug, depth, number }) => {
      const marker = numbered ? number : ["•", "◦", "▪"][depth % 3];
      widths[depth] = Math.max(widths[depth] || 0, marker.length);
      // Authors sometimes include the same section number in the heading itself.
      const prefix =
        numbered && label.startsWith(number + " ") ? number.length + 1 : 0;
      return { label: label.slice(prefix) || "Раздел", slug, depth, marker };
    })
    .map((entry) => ({ ...entry, markerChars: widths[entry.depth] }));
}

export function tocMarkdown(headings, numbered = false) {
  if (!headings.length) return "Заголовки появятся здесь автоматически.";
  return tocEntries(headings, numbered)
    .map(({ depth, marker, label, slug }) => {
      const indent = numbered
        ? "\u00a0\u00a0".repeat(depth)
        : "  ".repeat(depth) + "- ";
      const number = numbered ? marker + " " : "";
      return (
        indent +
        "[" +
        number +
        linkLabel(label) +
        "](#" +
        encodeURIComponent(slug) +
        ")"
      );
    })
    .join(numbered ? "\n\n" : "\n");
}

export function portableBlocks(md) {
  md.block.ruler.before(
    "html_block",
    "spec_portable_block",
    (state, start, end, silent) => {
      if (
        state.env.portableFragment ||
        state.blkIndent ||
        state.sCount[start] >= 4
      )
        return false;
      const from = state.bMarks[start];
      if (from && state.src[from - 1] !== "\n") return false;
      const line = (index) =>
        state.src.slice(state.bMarks[index], state.eMarks[index]).trim();
      const numbered = line(start) === numberedToc;
      const matched = Object.entries(markers).find(
        ([kind, pair]) =>
          pair[0] === line(start) || (kind === "toc" && numbered),
      );
      if (!matched) return false;
      const [kind, [, close]] = matched;
      let last = start + 1;
      while (last < end && line(last) !== close) {
        if (
          line(last) === matched[1][0] ||
          (kind === "toc" && line(last) === numberedToc)
        )
          return false;
        last++;
      }
      if (last === end) return false;
      if (silent) return true;
      const block = state.push("spec_" + kind, "", 0);
      if (kind === "toc") block.meta = { numbered };
      block.map = [start, last + 1];
      block.content = state.src
        .slice(state.bMarks[start + 1], state.bMarks[last])
        .trim();
      state.line = last + 1;
      return true;
    },
    { alt: ["paragraph"] },
  );

  md.core.ruler.after("inline", "spec_heading_anchors", ({ tokens, env }) => {
    if (env.portableFragment) return;
    const headings = [],
      used = new Set();
    const titleIndexes = new Map();
    for (const [index, token] of tokens.entries()) {
      if (token.type !== "heading_open") continue;
      const label = plainHeading(tokens[index + 1]);
      const slug = headingSlug(label, used);
      token.attrSet("id", "doc-heading-" + slug);
      token.meta = { ...token.meta, anchor: slug };
      const next = tokens[index + 3];
      if (next?.type === "spec_toc" && label === "Оглавление")
        titleIndexes.set(next, index);
      if (token.level === 0)
        headings.push({
          index,
          level: Number(token.tag[1]),
          slug,
          label,
        });
    }
    const titleTokens = new Set(titleIndexes.values());
    const sections = tocHierarchy(
      headings.filter((heading) => !titleTokens.has(heading.index)),
    );
    for (const token of tokens) {
      if (token.type === "spec_toc")
        token.meta = {
          ...token.meta,
          headings: sections,
          markdown: tocMarkdown(sections, token.meta.numbered),
        };
    }
  });

  md.renderer.rules.spec_toc = (tokens, index) => {
    const { headings, numbered, markdown } = tokens[index].meta;
    const escape = md.utils.escapeHtml;
    const rows = tocEntries(headings, numbered).map(
      ({ slug, label, depth, marker, markerChars }) =>
        '<li style="--toc-depth:' +
        depth +
        ";--toc-marker:" +
        markerChars +
        'ch"><a href="#' +
        escape(encodeURIComponent(slug)) +
        '"><span class="toc-marker">' +
        marker +
        "</span> <span>" +
        escape(label) +
        "</span></a></li>",
    );
    return (
      '<nav class="document-toc" aria-label="Оглавление">' +
      (rows.length
        ? '<ol role="list">' + rows.join("") + "</ol>"
        : "<p>" + escape(markdown) + "</p>") +
      "</nav>"
    );
  };
  md.renderer.rules.spec_bibliography = (tokens, index) =>
    '<div class="document-bibliography" data-style="' +
    (bibliographyEntries(tokens[index].content)?.style || "numbered") +
    '">' +
    md.render(tokens[index].content, { portableFragment: true }) +
    "</div>";
}

export function materializeToc(body, md) {
  if (!body.includes("<!-- spec-toc")) return body;
  const tokens = md
    .parse(body, {})
    .filter((token) => token.type === "spec_toc");
  const starts = [0];
  for (const match of body.matchAll(/\r\n|\r|\n/g))
    starts.push(match.index + match[0].length);
  const newline = body.match(/\r\n|\r|\n/)?.[0] || "\n";
  for (const token of tokens.reverse()) {
    const start = starts[token.map[0]],
      end = starts[token.map[1]] ?? body.length;
    const suffix = /[\r\n]$/.test(body.slice(start, end)) ? newline : "";
    const replacement = portableBlock(
      "toc",
      token.meta.markdown,
      token.meta.numbered,
    ).replaceAll("\n", newline);
    body = body.slice(0, start) + replacement + suffix + body.slice(end);
  }
  return body;
}

export const bibliographyStyles = {
  numbered: "Нумерованный · 1.",
  bullets: "Маркированный · •",
  references: "Номера в скобках · [1]",
};

const bibliographyMarkers = {
  numbered: /^\d{1,9}[.)][ \t]+(.+)$/,
  bullets: /^[-+*][ \t]+(.+)$/,
  references: /^\\?\[\d{1,9}\\?\][ \t]+(.+)$/,
};

export function bibliographyEntries(source) {
  const entries = [];
  const first = source.split("\n").find((line) => line.trim());
  const style = first
    ? Object.keys(bibliographyMarkers).find((key) =>
        bibliographyMarkers[key].test(first),
      )
    : "numbered";
  if (!style) return null;
  for (const line of source.split("\n")) {
    const item = bibliographyMarkers[style].exec(line);
    if (item) entries.push(item[1].trimEnd());
    else if (/^\s+$/.test(line) || !line) continue;
    else if (entries.length && /^ {2,}\S/.test(line))
      entries[entries.length - 1] += "\n" + line.trim();
    else return null;
  }
  return { style, entries };
}

export function bibliographyMarkdown(entries, style = "numbered") {
  const references = style === "references";
  const list = entries
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const marker = references
        ? `\\[${index + 1}] `
        : style === "bullets"
          ? "- "
          : `${index + 1}. `;
      const indent = references ? "  " : " ".repeat(marker.length);
      return marker + entry.replace(/\s*\n+\s*/g, "\n" + indent);
    })
    .join(references ? "\n\n" : "\n");
  return portableBlock("bibliography", list);
}
