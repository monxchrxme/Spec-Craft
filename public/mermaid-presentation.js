import { diagramHeight } from "./diagram-height.js";

export const mermaidLayouts = {
  source: "Как в коде",
  compact: "Компактно · Dagre",
  elk: "По порядку из кода · ELK",
};
export const mermaidDirections = {
  source: "Как в коде",
  horizontal: "Слева направо",
  vertical: "Сверху вниз",
};
export const mermaidThemes = {
  source: "Как в коде",
  blue: "Синяя",
  midnight: "Тёмно-синяя",
  neutral: "Монохромная",
};
const marker =
  /^%%[ \t]+speccraft-render:[ \t]+(source|compact|elk|free)[ \t]+(source|horizontal|vertical)(?:[ \t]+(source|blue|midnight|neutral)[ \t]+(\d{1,4}))?[ \t]*(?:\r?\n|$)/m;
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
    layout: config?.[1] === "free" ? "elk" : config?.[1] || "source",
    direction: config?.[2] || "source",
    theme: config?.[3] || "source",
    height: diagramHeight(Number(config?.[4])),
  };
}

export function setMermaidPresentation(
  source,
  layout,
  direction,
  appearance = {},
) {
  const current = mermaidPresentation(source);
  const { clean, bodyStart } = current;
  const { theme = current.theme, height = current.height } = appearance;
  if (
    !Object.hasOwn(mermaidLayouts, layout) ||
    !Object.hasOwn(mermaidDirections, direction) ||
    !Object.hasOwn(mermaidThemes, theme)
  )
    return source;
  const extra = theme !== "source" || height ? ` ${theme} ${height}` : "";
  if (layout === "source" && direction === "source" && !extra) return clean;
  return (
    clean.slice(0, bodyStart) +
    "%% speccraft-render: " +
    layout +
    " " +
    direction +
    extra +
    "\n" +
    clean.slice(bodyStart)
  );
}

export function configureMermaid(source) {
  const { clean, layout, direction, type, bodyStart, theme } =
    mermaidPresentation(source);
  const result = { layout: type ? layout : "source", theme };
  if (!type || direction === "source") return { ...result, source: clean };
  const rank = direction === "horizontal" ? "LR" : "TB";
  const body = clean.slice(bodyStart);
  if (type === "flowchart" || type === "graph") {
    return {
      ...result,
      source:
        clean.slice(0, bodyStart) +
        body.replace(
          /^(\s*(?:flowchart|graph))\b(?:[ \t]+(?:TD|TB|BT|RL|LR)\b)?/m,
          "$1 " + rank,
        ),
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
  return {
    ...result,
    source: clean.slice(0, bodyStart) + statements.join("\n"),
  };
}
