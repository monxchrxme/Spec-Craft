const directive =
  /^<!--[ \t]*spec-pdf:[ \t]*((?:break-before|break-after|keep-next|separate-sheet|landscape-sheet)(?:[ \t]+(?:break-before|break-after|keep-next|separate-sheet|landscape-sheet))*)[ \t]*-->$/;
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
      );
      const match = directive.exec(line.trimEnd());
      if (!match) return false;
      if (silent) return true;
      const token = state.push("spec_pdf", "", 0);
      token.map = [start, start + 1];
      token.meta = match[1].split(/[ \t]+/);
      state.line = start + 1;
      return true;
    },
    { alt: ["paragraph"] },
  );
  md.renderer.rules.spec_pdf = () => "";
}

export function formatPdfRules(rules, newline) {
  return rules.length
    ? "<!-- spec-pdf: " + rules.join(" ") + " -->" + newline + newline
    : "";
}
