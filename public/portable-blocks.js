const markers = {
  toc: ["<!-- spec-toc -->", "<!-- /spec-toc -->"],
  bibliography: ["<!-- spec-bibliography -->", "<!-- /spec-bibliography -->"],
};

export function portableBlock(kind, content) {
  return [markers[kind][0], "", content, "", markers[kind][1]].join("\n");
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

function tocMarkdown(headings) {
  if (!headings.length) return "Заголовки появятся здесь автоматически.";
  const ancestors = [];
  return headings
    .map(({ level, label, slug }) => {
      while (ancestors.length && ancestors.at(-1) >= level) ancestors.pop();
      const line =
        "  ".repeat(ancestors.length) +
        "- [" +
        linkLabel(label) +
        "](#" +
        encodeURIComponent(slug) +
        ")";
      ancestors.push(level);
      return line;
    })
    .join("\n");
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
      const matched = Object.entries(markers).find(
        ([, pair]) => pair[0] === line(start),
      );
      if (!matched) return false;
      const [kind, [, close]] = matched;
      let last = start + 1;
      while (last < end && line(last) !== close) {
        if (line(last) === matched[1][0]) return false;
        last++;
      }
      if (last === end) return false;
      if (silent) return true;
      const block = state.push("spec_" + kind, "", 0);
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
    for (const token of tokens) {
      if (token.type === "spec_toc")
        token.meta = {
          markdown: tocMarkdown(
            headings.filter((heading) => !titleTokens.has(heading.index)),
          ),
        };
    }
  });

  md.renderer.rules.spec_toc = (tokens, index) =>
    '<nav class="document-toc" aria-label="Оглавление">' +
    md.render(tokens[index].meta.markdown, { portableFragment: true }) +
    "</nav>";
  md.renderer.rules.spec_bibliography = (tokens, index) =>
    '<div class="document-bibliography">' +
    md.render(tokens[index].content, { portableFragment: true }) +
    "</div>";
}

export function materializeToc(body, md) {
  if (!body.includes(markers.toc[0])) return body;
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
    const replacement = portableBlock("toc", token.meta.markdown).replaceAll(
      "\n",
      newline,
    );
    body = body.slice(0, start) + replacement + suffix + body.slice(end);
  }
  return body;
}

export function bibliographyEntries(source) {
  const entries = [];
  for (const line of source.split("\n")) {
    const item = /^\d{1,9}[.)][ \t]+(.+)$/.exec(line);
    if (item) entries.push(item[1].trimEnd());
    else if (/^\s+$/.test(line) || !line) continue;
    else if (entries.length && /^ {2,}\S/.test(line))
      entries[entries.length - 1] += "\n" + line.trim();
    else return null;
  }
  return entries;
}

export function bibliographyMarkdown(entries) {
  const list = entries
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const marker = index + 1 + ". ";
      return marker + entry.replaceAll("\n", "\n" + " ".repeat(marker.length));
    })
    .join("\n");
  return portableBlock("bibliography", list);
}
