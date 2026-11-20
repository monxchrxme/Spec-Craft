const prefixes = /^(?:(?:│   |\|   |    ))*(?:├── |└── |\|-- |`-- |\+-- )/;
function readEntry(line, root = false) {
  const match = /^(.*?)(?:\s+#\s*(.*))?$/.exec(line.trim());
  const name = match[1].trim();
  if (!name) return null;
  const folder = root || name.endsWith("/");
  return {
    name: name.replace(/\/$/, "") || "/",
    note: match[2] || "",
    children: folder ? [] : null,
  };
}

export function readProjectTree(source) {
  const lines = source.trimEnd().split(/\r\n?|\n/);
  const root = readEntry(lines.shift() || "", true);
  const parents = [root];
  if (!root) return null;
  for (const line of lines) {
    const prefix = prefixes.exec(line);
    if (!prefix) return null;
    const depth = prefix[0].length / 4;
    const parent = parents[depth - 1];
    const entry = readEntry(line.slice(prefix[0].length));
    if (!parent || !entry) return null;
    parent.children ??= [];
    parent.children.push(entry);
    parents.length = depth;
    parents[depth] = entry;
  }
  return root;
}

export function isProjectTree(token) {
  if (token?.type !== "fence") return null;
  const language = token.info.trim().toLowerCase();
  if (!["", "text", "txt", "plaintext", "tree"].includes(language)) return null;
  if (
    !token.content.includes("\n") ||
    !token.content.trimEnd().includes("\n")
  ) {
    return language === "tree" || /^\S[^\n]*\/$/.test(token.content.trimEnd())
      ? readProjectTree(token.content)
      : null;
  }
  return readProjectTree(token.content);
}

export function projectTreeMarkdown(root) {
  const rows = [];
  function visit(entry, prefix, connector, root = false) {
    const suffix = entry.children && entry.name !== "/" ? "/" : "";
    rows.push({
      text: prefix + connector + entry.name + suffix,
      note: entry.note,
    });
    const children = entry.children || [];
    for (const [index, child] of children.entries()) {
      const next = root
        ? ""
        : prefix + (connector === "├── " ? "│   " : "    ");
      visit(child, next, index === children.length - 1 ? "└── " : "├── ");
    }
  }
  visit(root, "", "", true);
  const widest = Math.max(
    0,
    ...rows.filter((row) => row.note).map((row) => Array.from(row.text).length),
  );
  const content = rows
    .map(
      ({ text, note }) =>
        text +
        (note
          ? " ".repeat(widest - Array.from(text).length + 3) + "# " + note
          : ""),
    )
    .join("\n");
  return (
    String.fromCharCode(96).repeat(3) +
    "text\n" +
    content +
    "\n" +
    String.fromCharCode(96).repeat(3)
  );
}
