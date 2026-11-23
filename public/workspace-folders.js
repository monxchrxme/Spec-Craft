export const folderStorageKey = "buro:folders";

export function readFolders(records) {
  if (!Array.isArray(records)) return [];
  const pending = new Map();
  for (const record of records) {
    if (typeof record?.id !== "string" || !record.id ||
        typeof record.name !== "string" || !record.name.trim()) continue;
    pending.set(record.id, {
      id: record.id,
      name: record.name.trim(),
      parentId: typeof record.parentId === "string" ? record.parentId : "",
    });
  }
  const folders = new Map();
  while (pending.size) {
    const size = pending.size;
    for (const [id, folder] of pending) {
      if (pending.has(folder.parentId)) continue;
      if (!folders.has(folder.parentId)) folder.parentId = "";
      folders.set(id, folder);
      pending.delete(id);
    }
    if (size === pending.size) break;
  }
  return [...folders.values()];
}

export function mergeFolders(current, imported, newId = () => crypto.randomUUID()) {
  const folders = [...current];
  const ids = new Map();
  for (const record of readFolders(imported)) {
    const parentId = ids.get(record.parentId) || "";
    const same = folders.find((folder) =>
      folder.parentId === parentId && folder.name === record.name);
    if (same) {
      ids.set(record.id, same.id);
      continue;
    }
    const id = folders.some((folder) => folder.id === record.id) ? newId() : record.id;
    folders.push({ ...record, id, parentId });
    ids.set(record.id, id);
  }
  return { folders, ids };
}
