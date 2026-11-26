const directive =
  /^<!--[ \t]*spec-pdf:[ \t]*((?:break-before|break-after|keep-next|separate-sheet|landscape-sheet)(?:[ \t]+(?:break-before|break-after|keep-next|separate-sheet|landscape-sheet))*)[ \t]*-->$/;
const spacer = /^<!--[ \t]*spec-pdf-spacer(?:[ \t]*:[ \t]*(\d{1,3}))?[ \t]*-->$/;
const blockDirective = /^<!--[ \t]*spec-pdf-block:[ \t]*([^<>]+?)[ \t]*-->$/;
export const pdfBlockFields = [
  ["scale", "Масштаб, %", 50, 150],
  ["before", "Отступ до, мм", 0, 40],
  ["after", "Отступ после, мм", 0, 40],
];
export const pdfBlockAlignments = {
  left: "По левому краю", center: "По центру", right: "По правому краю",
};

export function pdfBlockFormat(input = {}) {
  const result = {};
  if (/^[a-f0-9]{32}$/.test(input.group)) result.group = input.group;
  if (Object.hasOwn(pdfBlockAlignments, input.align)) result.align = input.align;
  for (const [key, , min, max] of pdfBlockFields) {
    const value = input[key];
    if (Number.isInteger(value) && value >= min && value <= max)
      result[key] = value;
  }
  return result;
}

function readBlockDirective(line) {
  const match = blockDirective.exec(line);
  if (!match) return null;
  const fields = {};
  for (const entry of match[1].split(/[ \t]+/)) {
    const pair = /^(group|align|scale|before|after)=([a-z0-9]+)$/.exec(entry);
    if (!pair) return null;
    const [, key, value] = pair;
    fields[key] = key === "group" || key === "align" ? value : Number(value);
  }
  const format = pdfBlockFormat(fields);
  return Object.keys(fields).length === Object.keys(format).length ? format : null;
}
export const maxPdfSpacerHeight = 100;
export const defaultPdfSpacerHeight = 10;
export const isPdfSpacerHeight = (value) =>
  Number.isInteger(value) && value >= 0 && value <= maxPdfSpacerHeight;
export const isPdfSpacer = (token) => token?.type === "spec_pdf_spacer";

export function pdfSpacerDefault(style) {
  return isPdfSpacerHeight(style?.pdfSpacerHeight) ? style.pdfSpacerHeight : defaultPdfSpacerHeight;
}

export function formatPdfSpacer(height = null) {
  return height === null ? "<!-- spec-pdf-spacer -->" : "<!-- spec-pdf-spacer: " + height + " -->";
}

export function pdfRules(md) {
  md.block.ruler.before(
    "html_block",
    "spec_pdf",
    (state, start, end, silent) => {
      const startOfLine = state.bMarks[start];
      if (
        state.blkIndent ||
        (startOfLine > 0 && state.src[startOfLine - 1] !== "\n") ||
        state.sCount[start] >= 4
      )
        return false;
      const line = state.src.slice(
        state.bMarks[start] + state.tShift[start],
        state.eMarks[start],
      ).trimEnd();
      const match = directive.exec(line);
      const space = match ? null : spacer.exec(line);
      const format = match || space ? null : readBlockDirective(line);
      const height = space?.[1] === undefined ? null : Number(space[1]);
      if (!match && !format && (!space || (height !== null && !isPdfSpacerHeight(height))))
        return false;
      if (silent) return true;
      const type = match ? "spec_pdf" : format ? "spec_pdf_block" : "spec_pdf_spacer";
      const token = state.push(type, "", 0);
      token.map = [start, start + 1];
      token.meta = match ? match[1].split(/[ \t]+/) : format ?? height;
      state.line = start + 1;
      return true;
    },
    { alt: ["paragraph"] },
  );
  for (const type of ["spec_pdf", "spec_pdf_spacer", "spec_pdf_block"])
    md.renderer.rules[type] = () => "";
}

export function formatPdfRules(rules, newline) {
  return rules.length
    ? "<!-- spec-pdf: " + rules.join(" ") + " -->" + newline + newline
    : "";
}

export function updatePdfMetadata(body, updates, kind) {
  const newline = body.match(/\r\n|\r|\n/)?.[0] || "\n";
  const edits = [];
  for (const [part, value] of updates) {
    const fields = kind === "rules" ? value
      : Object.entries(pdfBlockFormat(value)).map(([key, field]) => key + "=" + field);
    const name = kind === "rules" ? "spec-pdf" : "spec-pdf-block";
    const marker = fields.length ? "<!-- " + name + ": " + fields.join(" ") + " -->" + newline : "";
    const ranges = part.pdfMetadata[kind];
    if (!ranges.length && marker) edits.push([part.fullStart, part.fullStart, marker]);
    for (const [i, [start, end]] of ranges.entries())
      edits.push([start, end, i === 0 ? marker : ""]);
  }
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0]))
    body = body.slice(0, start) + text + body.slice(end);
  return body;
}
