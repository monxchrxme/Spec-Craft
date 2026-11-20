const markers = {
  toc: ["<!-- spec-toc -->", "<!-- /spec-toc -->"],
  bibliography: ["<!-- spec-bibliography -->", "<!-- /spec-bibliography -->"],
};

const headingIdentity =
  /^<!-- spec-heading-id: ([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}) -->$/;
export const isHeadingIdentity = (line) => headingIdentity.test(line.trim());
export function formatHeadingIdentity(ref, newline) {
  return ref
    ? "<!-- spec-heading-id: " + ref.slice(3) + " -->" + newline + newline
    : "";
}

export const tocLevels = [1, 2, 3, 4, 5, 6];
const tocOpening =
  /^<!-- spec-toc(?: (numbered|auto))?(?: levels=(none|[1-6](?:,[1-6])*))?(?: unnumbered=([^\s<>]+))? -->$/;

function readTocOptions(match) {
  let unnumbered;
  try {
    unnumbered = match[3] ? match[3].split(",").map(decodeURIComponent) : [];
  } catch {
    return null;
  }
  return {
    numbered: Boolean(match[1]),
    automatic: match[1] === "auto",
    levels: match[2]
      ? tocLevels.filter((level) => match[2].includes(level))
      : tocLevels,
    unnumbered,
  };
}

export function portableBlock(kind, content, options = {}) {
  let open = markers[kind][0];
  if (kind === "toc") {
    const {
      numbered = options === true,
      levels = tocLevels,
      unnumbered = [],
    } = options;
    const fields = ["spec-toc"];
    if (numbered) fields.push(options.automatic ? "auto" : "numbered");
    if (levels.length !== tocLevels.length)
      fields.push("levels=" + (levels.join(",") || "none"));
    if (unnumbered.length)
      fields.push(
        "unnumbered=" +
          unnumbered
            .map((slug) => encodeURIComponent(slug).replaceAll("-", "%2D"))
            .join(","),
      );
    open = "<!-- " + fields.join(" ") + " -->";
  }
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

export function tocEntries(
  headings,
  { numbered, automatic, levels, unnumbered },
) {
  const exceptions = new Set(unnumbered);
  const ancestors = [];
  const root = { prefix: "", count: 0 };
  const entries = [];
  for (const { level, label, slug, id } of headings) {
    if (!levels.includes(level)) continue;
    while (ancestors.length && ancestors.at(-1).level >= level) ancestors.pop();
    const depth = ancestors.length;
    const siblings = ancestors.at(-1)?.children ?? root;
    const authored = label.match(
      /^(\d+(?:\.\d+)*[.)]|\d+(?:\.\d+)+)\s+(?=\S)/u,
    );
    const title = authored ? label.slice(authored[0].length) : label;
    let children = siblings;
    let marker = "";
    if (!exceptions.has(id) && !exceptions.has(slug)) {
      siblings.count++;
      let number = siblings.prefix + siblings.count + ".";
      if (numbered && !automatic && authored) {
        const digits = authored[1].replace(/[.)]$/, "");
        number = digits + ".";
        const split = digits.lastIndexOf(".") + 1;
        siblings.prefix = digits.slice(0, split);
        siblings.count = Number(digits.slice(split));
      }
      marker = numbered ? number : ["•", "◦", "▪"][depth % 3];
      children = { prefix: number, count: 0 };
    }
    ancestors.push({ level, children });
    entries.push({ label: title || "Раздел", slug, depth, marker });
  }
  return entries;
}

export function tocMarkdown(entries, numbered) {
  if (!entries.length) return "Нет заголовков выбранных уровней.";
  const list = !numbered && entries.every((entry) => entry.marker);
  return entries
    .map(({ depth, marker, label, slug }) => {
      const indent = (list ? "  " : "\u00a0\u00a0").repeat(depth);
      const prefix = list ? "- " : "";
      const symbol = list || !marker ? "" : marker + " ";
      return (
        indent +
        prefix +
        "[" +
        symbol +
        linkLabel(label) +
        "](#" +
        encodeURIComponent(slug) +
        ")"
      );
    })
    .join(list ? "\n" : "\n\n");
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
      const identity = headingIdentity.exec(line(start));
      if (identity) {
        if (!silent) {
          const token = state.push("spec_heading_id", "", 0);
          token.map = [start, start + 1];
          token.meta = identity[1];
          state.line = start + 1;
        }
        return true;
      }
      const toc = tocOpening.exec(line(start));
      const options = toc && readTocOptions(toc);
      const matched = Object.entries(markers).find(
        ([kind, pair]) =>
          pair[0] === line(start) || (kind === "toc" && options),
      );
      if (!matched) return false;
      const [kind, [, close]] = matched;
      let last = start + 1;
      while (last < end && line(last) !== close) {
        if (
          line(last) === matched[1][0] ||
          (kind === "toc" && tocOpening.test(line(last)))
        )
          return false;
        last++;
      }
      if (last === end) return false;
      if (silent) return true;
      const block = state.push("spec_" + kind, "", 0);
      if (kind === "toc") block.meta = options;
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
    const identities = new Set();
    for (const [index, token] of tokens.entries()) {
      if (token.type !== "heading_open") continue;
      const label = plainHeading(tokens[index + 1]);
      const slug = headingSlug(label, used);
      token.attrSet("id", "doc-heading-" + slug);
      token.meta = { ...token.meta, anchor: slug };
      const identity = tokens[index - 1];
      if (
        token.level === 0 &&
        identity?.type === "spec_heading_id" &&
        token.map[0] <= identity.map[1] + 1 &&
        !identities.has(identity.meta)
      ) {
        identities.add(identity.meta);
        token.meta.tocId = "id:" + identity.meta;
        identity.attached = true;
      }
      const next = tokens[index + 3];
      if (next?.type === "spec_toc" && label === "Оглавление")
        titleIndexes.set(next, index);
      if (token.level === 0)
        headings.push({
          index,
          level: Number(token.tag[1]),
          slug,
          label,
          id: token.meta.tocId,
        });
    }
    const titleTokens = new Set(titleIndexes.values());
    const headingsForToc = headings.filter(
      (heading) => !titleTokens.has(heading.index),
    );
    for (const token of tokens) {
      if (token.type !== "spec_toc") continue;
      const entries = tocEntries(headingsForToc, token.meta);
      Object.assign(token.meta, {
        headings: headingsForToc,
        entries,
        markdown: tocMarkdown(entries, token.meta.numbered),
      });
    }
  });

  md.renderer.rules.spec_heading_id = () => "";
  md.renderer.rules.spec_toc = (tokens, index) => {
    const { entries, markdown } = tokens[index].meta;
    const escape = md.utils.escapeHtml;
    const rows = entries.map(
      ({ slug, label, depth, marker }) =>
        '<li style="--toc-depth:' +
        depth +
        '"><a href="#' +
        escape(encodeURIComponent(slug)) +
        '">' +
        (marker ? '<span class="toc-marker">' + marker + "</span> " : "") +
        "<span>" +
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

// Upgrade old slug-based exceptions and attach IDs to newly marked headings.
export function bindTocExceptions(body, parts, selection) {
  const tocs = parts.filter(
    ({ t, start }) =>
      t.type === "spec_toc" &&
      (start === selection?.start ||
        t.meta.unnumbered.some((ref) => !ref.startsWith("id:"))),
  );
  if (!tocs.length) return body;

  const headings = new Map(
    parts
      .filter(({ t }) => t.type === "heading_open")
      .map((part) => [part.t.meta.anchor, part]),
  );
  const ids = new Map();
  const changes = [];
  const newline = body.match(/\r\n|\r|\n/)?.[0] || "\n";
  for (const part of tocs) {
    const selected = part.start === selection?.start;
    const options = selected ? selection.options : part.t.meta;
    const unnumbered = options.unnumbered.map((ref) => {
      const heading = headings.get(ref);
      if (!heading) return ref;
      if (heading.t.meta.tocId) return heading.t.meta.tocId;
      if (!ids.has(ref)) {
        const id = "id:" + crypto.randomUUID();
        ids.set(ref, id);
        changes.push({
          start: heading.start,
          end: heading.start,
          text: formatHeadingIdentity(id, newline),
        });
      }
      return ids.get(ref);
    });
    if (
      !selected &&
      unnumbered.every((ref, index) => ref === options.unnumbered[index])
    )
      continue;
    const entries = tocEntries(part.t.meta.headings, options);
    const replacement = portableBlock(
      "toc",
      tocMarkdown(entries, options.numbered),
      {
        ...options,
        unnumbered,
      },
    );
    changes.push({
      start: part.start,
      end: part.end,
      text: replacement.replaceAll("\n", newline),
    });
  }
  for (const { start, end, text } of changes.sort((a, b) => b.start - a.start))
    body = body.slice(0, start) + text + body.slice(end);
  return body;
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
      token.meta,
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
