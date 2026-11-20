export function makePatch(body, start, end, replacement, narrow = true) {
  let before = body.slice(start, end),
    after = replacement;
  if (narrow) {
    let left = 0,
      right = 0;
    const limit = Math.min(before.length, after.length);
    while (left < limit && before[left] === after[left]) left++;
    while (
      right < limit - left &&
      before.at(-right - 1) === after.at(-right - 1)
    )
      right++;
    start += left;
    end -= right;
    before = before.slice(left, before.length - right);
    after = after.slice(left, after.length - right);
  }
  return {
    before,
    after,
    offset: start,
    prefix: body.slice(Math.max(0, start - 72), start),
    suffix: body.slice(end, end + 72),
  };
}

export function validPatch(patch, limit = 56_000) {
  return (
    patch &&
    Number.isSafeInteger(patch.offset) &&
    patch.offset >= 0 &&
    ["before", "after", "prefix", "suffix"].every(
      (key) => typeof patch[key] === "string",
    ) &&
    patch.before !== patch.after &&
    patch.before.length <= limit &&
    patch.after.length <= limit &&
    patch.prefix.length <= 72 &&
    patch.suffix.length <= 72
  );
}

export function patchOffset(body, patch, exactRevision = false) {
  const { before, offset, prefix, suffix } = patch;
  const matchesAt = (index) =>
    index <= body.length && body.startsWith(before, index);
  if (exactRevision && matchesAt(offset)) return offset;
  if (!before && !prefix && !suffix) return body ? null : 0;
  const needle = before || prefix || suffix;
  const matches = [];
  for (let cursor = 0; ; ) {
    const found = body.indexOf(needle, cursor);
    if (found < 0) break;
    cursor = found + 1;
    const start = found + (!before && prefix ? prefix.length : 0);
    const lead =
      body.slice(Math.max(0, start - prefix.length), start) === prefix &&
      !!prefix;
    const tail = body.startsWith(suffix, start + before.length) && !!suffix;
    const score = Number(lead) + Number(tail);
    if (
      before
        ? score || (!prefix && !suffix)
        : score === Number(!!prefix) + Number(!!suffix)
    )
      matches.push({ start, score });
  }
  matches.sort((a, b) => b.score - a.score);
  if (!matches.length || matches[0].score === matches[1]?.score) return null;
  return matches[0].start;
}

export function patchedBody(body, patch, exactRevision) {
  const start = patchOffset(body, patch, exactRevision);
  return start === null
    ? null
    : body.slice(0, start) +
        patch.after +
        body.slice(start + patch.before.length);
}

export const approvalStates = {
  draft: "Черновик",
  review: "На согласовании",
  approved: "Согласован",
  rework: "Требует доработки",
};

// Section revisions are local comparisons. Access is enforced by the collaboration API.
export function fingerprint(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0") + "." + value.length;
}
