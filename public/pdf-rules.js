const directive =
  /^<!--[ \t]*spec-pdf:[ \t]*((?:break-before|break-after|keep-next|separate-sheet|landscape-sheet)(?:[ \t]+(?:break-before|break-after|keep-next|separate-sheet|landscape-sheet))*)[ \t]*-->$/;
const spacer = /^<!--[ \t]*spec-pdf-spacer(?:[ \t]*:[ \t]*(\d{1,3}))?[ \t]*-->$/;
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
      const height = space?.[1] === undefined ? null : Number(space[1]);
      if (!match && (!space || (height !== null && !isPdfSpacerHeight(height)))) return false;
      if (silent) return true;
      const token = state.push(match ? "spec_pdf" : "spec_pdf_spacer", "", 0);
      token.map = [start, start + 1];
      token.meta = match ? match[1].split(/[ \t]+/) : height;
      state.line = start + 1;
      return true;
    },
    { alt: ["paragraph"] },
  );
  md.renderer.rules.spec_pdf = md.renderer.rules.spec_pdf_spacer = () => "";
}

export function formatPdfRules(rules, newline) {
  return rules.length
    ? "<!-- spec-pdf: " + rules.join(" ") + " -->" + newline + newline
    : "";
}
