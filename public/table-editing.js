import { diffChars } from "./vendor/jsdiff/diff/character.js";

export function cellLineBreaks(md) {
  md.inline.ruler.before("html_inline", "cell_line_break", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 60) return false;
    const match = /^<br\s*\/?>/i.exec(state.src.slice(state.pos, state.posMax));
    if (!match) return false;
    if (!silent) {
      const token = state.push("hardbreak", "br", 0);
      token.meta = { from: state.pos, to: state.pos + match[0].length };
    }
    state.pos += match[0].length;
    return true;
  });
}

export function editableCellText(markdown, md) {
  if (!/<br/i.test(markdown)) return markdown;
  const breaks = md
    .parseInline(markdown, {})[0]
    .children.filter((token) => token.type === "hardbreak" && token.meta);
  for (const {
    meta: { from, to },
  } of breaks.reverse())
    markdown = markdown.slice(0, from) + "\n" + markdown.slice(to);
  return markdown;
}

export function tableCellPoint(cell, x, y) {
  const position = document.caretPositionFromPoint?.(x, y);
  const hit = !position && document.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? hit?.startContainer;
  if (!node || !cell.contains(node)) return null;
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.setEnd(node, position?.offset ?? hit.startOffset);
  return range.toString().length;
}

export function cellSourceOffset(visible, source, offset) {
  if (visible === source) return offset;
  if (offset >= visible.length) return source.length;
  const changes = diffChars(visible, source, { maxEditLength: 256 });
  if (!changes) return Math.min(offset, source.length);
  let index = 0;
  for (const change of changes) {
    const length = change.value.length;
    if (!change.added) {
      if (offset < length) return index + (change.removed ? 0 : offset);
      offset -= length;
    }
    if (!change.removed) index += length;
  }
  return source.length;
}

export function placeCellCaret(cell, offset) {
  const node = cell.firstChild ?? cell;
  document
    .getSelection()
    ?.collapse(node, Math.min(offset, cell.textContent.length));
}
