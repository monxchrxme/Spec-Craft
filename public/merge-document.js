import { diffLines } from "./vendor/jsdiff/diff/line.js";
import { diffChars } from "./vendor/jsdiff/diff/character.js";

function edits(base, version, diff) {
  const parts = diff(base, version, { timeout: 90, maxEditLength: 8000 });
  if (!parts) return null;
  let offset = 0,
    change;
  const result = [];
  for (const part of parts) {
    if (!part.added && !part.removed) {
      offset += part.value.length;
      change = null;
      continue;
    }
    if (!change) {
      change = { start: offset, end: offset, text: "" };
      result.push(change);
    }
    if (part.removed) change.end = offset += part.value.length;
    else change.text += part.value;
  }
  return result;
}

function mergeText(base, mine, theirs, diff = diffLines) {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  const left = edits(base, mine, diff),
    right = edits(base, theirs, diff);
  if (!left || !right) return null;
  let i = 0,
    j = 0,
    offset = 0,
    result = "";
  const append = ({ start, end, text }) => {
    result += base.slice(offset, start) + text;
    offset = end;
  };
  while (i < left.length || j < right.length) {
    const a = left[i],
      b = right[j];
    if (!b || (a && a.start < b.start && a.end <= b.start)) append(left[i++]);
    else if (!a || (b.start < a.start && b.end <= a.start)) append(right[j++]);
    else if (a.start === b.start && a.end === b.end) {
      const text =
        a.text === b.text
          ? a.text
          : diff === diffLines && a.start !== a.end
            ? mergeText(base.slice(a.start, a.end), a.text, b.text, diffChars)
            : null;
      if (text === null) return null;
      append({ ...a, text });
      i++;
      j++;
    } else return null;
  }
  return result + base.slice(offset);
}

export function snapshotOf(doc) {
  const style = Object.fromEntries(
    Object.entries(doc.style || {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  return { name: doc.name, body: doc.body, kind: doc.kind ?? "", style };
}

export const sameSnapshot = (a, b) =>
  JSON.stringify(snapshotOf(a)) === JSON.stringify(snapshotOf(b));

export function mergeDocument(base, mine, theirs) {
  const body = mergeText(base.body, mine.body, theirs.body);
  if (body === null) return null;
  const next = { body, style: {} };
  for (const field of ["name", "kind"]) {
    const a = mine[field],
      b = theirs[field],
      c = base[field];
    if (a !== b && a !== c && b !== c) return null;
    next[field] = a === c ? b : a;
  }
  for (const field of new Set([
    ...Object.keys(base.style),
    ...Object.keys(mine.style),
    ...Object.keys(theirs.style),
  ])) {
    const a = mine.style[field],
      b = theirs.style[field],
      c = base.style[field];
    if (a !== b && a !== c && b !== c) return null;
    const value = a === c ? b : a;
    if (value !== undefined) next.style[field] = value;
  }
  return snapshotOf(next);
}
