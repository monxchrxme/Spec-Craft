export const mermaidLayouts = {
  source: "Как в коде",
  compact: "Компактно · Dagre",
  elk: "Ортогонально · ELK",
};
export const mermaidDirections = {
  source: "Как в коде",
  horizontal: "Слева направо",
  vertical: "Сверху вниз",
};
const marker =
  /^%%[ \t]+speccraft-render:[ \t]+(source|compact|elk)[ \t]+(source|horizontal|vertical)[ \t]*(?:\r?\n|$)/m;
const frontmatter = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function mermaidPresentation(source) {
  const config = marker.exec(source);
  const clean = source.replace(marker, "");
  const bodyStart = frontmatter.exec(clean)?.[0].length || 0;
  const header =
    /^[ \t]*(?:%%[^\n]*\n[ \t]*|\r?\n)*((?:flowchart|graph|stateDiagram-v2|stateDiagram)\b)/.exec(
      clean.slice(bodyStart),
    );
  return {
    clean,
    bodyStart,
    type: header?.[1] || "",
    layout: config?.[1] || "source",
    direction: config?.[2] || "source",
  };
}

export function setMermaidPresentation(source, layout, direction) {
  const { clean, bodyStart } = mermaidPresentation(source);
  if (
    !Object.hasOwn(mermaidLayouts, layout) ||
    !Object.hasOwn(mermaidDirections, direction)
  )
    return source;
  if (layout === "source" && direction === "source") return clean;
  return (
    clean.slice(0, bodyStart) +
    "%% speccraft-render: " +
    layout +
    " " +
    direction +
    "\n" +
    clean.slice(bodyStart)
  );
}

export function configureMermaid(source) {
  const { clean, layout, direction, type, bodyStart } =
    mermaidPresentation(source);
  if (!type) return { source: clean, layout: "source" };
  if (direction === "source") return { source: clean, layout };
  const rank = direction === "horizontal" ? "LR" : "TB";
  const body = clean.slice(bodyStart);
  if (type === "flowchart" || type === "graph") {
    return {
      source:
        clean.slice(0, bodyStart) +
        body.replace(
          /^(\s*(?:flowchart|graph))\b(?:[ \t]+(?:TD|TB|BT|RL|LR)\b)?/m,
          "$1 " + rank,
        ),
      layout,
    };
  }
  const lines = body.split("\n");
  const header = lines.findIndex((line) =>
    /^\s*stateDiagram(?:-v2)?\b/.test(line),
  );
  let depth = 0;
  const statements = lines.filter((line, index) => {
    if (index <= header || /^\s*%%/.test(line)) return true;
    if (!depth && /^\s*direction\s+(?:TD|TB|BT|RL|LR)\s*;?\s*$/.test(line))
      return false;
    const transitions = line.replace(/"(?:[^"\\]|\\.)*"/g, "");
    if (/^\s*state\b.*\{\s*$/.test(transitions)) depth++;
    if (/^\s*\}\s*$/.test(transitions)) depth = Math.max(0, depth - 1);
    return true;
  });
  statements.splice(header + 1, 0, "    direction " + rank);
  return { source: clean.slice(0, bodyStart) + statements.join("\n"), layout };
}
