const taskPrefix = /^\[([ xX])\](?:[ \t]+|$)/;

export function taskLists(md) {
  md.core.ruler.after("inline", "task_lists", (state) => {
    const { tokens } = state;
    for (let i = 1; i < tokens.length; i++) {
      const inline = tokens[i];
      const paragraph = tokens[i - 1];
      if (inline.type !== "inline" || paragraph.type !== "paragraph_open") continue;
      const item = tokens[i - 2];
      const listTask = item?.type === "list_item_open";
      if (!listTask && paragraph.level !== 0) continue;
      const marker = taskPrefix.exec(inline.content);
      if (!marker) continue;
      if (listTask) item.attrJoin("class", "task-list-item");
      const children = [];
      md.inline.parse(inline.content.slice(marker[0].length), md, state.env, children);
      const input = new state.Token("task_input", "input", 0);
      input.meta = { line: inline.map[0], checked: marker[1] !== " " };
      inline.children = [input, ...children];
    }
  });
  md.renderer.rules.task_input = (tokens, index) => {
    const { line, checked } = tokens[index].meta;
    return `<input type="checkbox" class="task-checkbox" data-task-line="${line}" aria-label="Отметка задачи" disabled${checked ? " checked" : ""}>`;
  };
}

export function setTaskChecked(source, line, checked) {
  const segments = source.split(/(\r\n|\r|\n)/);
  const index = line * 2;
  if (!Number.isInteger(line) || line < 0 || index >= segments.length) return source;
  segments[index] = segments[index].replace(
    /^([ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?)\[[ xX]\](?=[ \t]|$)/,
    (_, prefix) => prefix + (checked ? "[x]" : "[ ]"),
  );
  return segments.join("");
}
