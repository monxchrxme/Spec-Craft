import { mergeFolders as matchFolders, readFolders } from "./workspace-folders.js";

export const emptyWorkspace = () => ({ documents: [], folders: [] });
const encoder = new TextEncoder();
const json = (value) => JSON.stringify(value) ?? "";

export async function workspaceSummary(snapshot) {
  const documents = await Promise.all(snapshot.documents.map(async ({ updated, ...record }) => {
    const hash = await crypto.subtle.digest("SHA-256", encoder.encode(json(record)));
    return [record.id, Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")];
  }));
  return { documents: Object.fromEntries(documents), folders: snapshot.folders };
}

export function addLocalWorkspace(current, guest) {
  const knownDocuments = new Set(current.documents.map(({ id }) => id));
  const knownFolders = new Set(current.folders.map(({ id }) => id));
  const imported = [
    ...current.folders,
    ...guest.folders.filter(({ id }) => !knownFolders.has(id)),
  ];
  const { folders, ids } = matchFolders(current.folders, imported);
  const documents = guest.documents.filter(({ id }) => !knownDocuments.has(id))
    .map((doc) => ({
      ...doc,
      folderId: knownFolders.has(doc.folderId) ? doc.folderId : ids.get(doc.folderId),
    }));
  return {
    documentsAdded: documents.length,
    foldersAdded: folders.length - current.folders.length,
    workspace: { documents: [...current.documents, ...documents], folders },
  };
}

function mergeFolders(base, mine, theirs) {
  const originals = new Map(base.map((folder) => [folder.id, folder]));
  const local = new Map(mine.map((folder) => [folder.id, folder]));
  const remote = new Map(theirs.map((folder) => [folder.id, folder]));
  const merged = new Map();
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const before = originals.get(id), a = local.get(id), b = remote.get(id);
    const folder = json(a) === json(before) ? b :
      json(b) === json(before) ? a :
        a && b ? {
          id,
          name: a.name === before?.name ? b.name : a.name,
          parentId: a.parentId === before?.parentId ? b.parentId : a.parentId,
        } : a || b;
    if (folder) merged.set(id, folder);
  }
  const ordered = readFolders([...merged.values()]);
  const known = new Set(ordered.map(({ id }) => id));
  // Concurrent moves can create a cycle. Keep those folders in the root.
  return ordered.concat([...merged.values()].filter(({ id }) => !known.has(id))
    .map((folder) => ({ ...folder, parentId: "" })));
}

export function mergeWorkspace(base, mine, theirs, mySummary, theirSummary) {
  const folders = mergeFolders(base.folders, mine.folders, theirs.folders);
  const folderIds = new Set(folders.map(({ id }) => id));
  const local = new Map(mine.documents.map((doc) => [doc.id, doc]));
  const remote = new Map(theirs.documents.map((doc) => [doc.id, doc]));
  const documents = [];
  let conflicts = 0;
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const a = local.get(id), b = remote.get(id);
    const original = base.documents[id], mineAt = mySummary.documents[id], theirsAt = theirSummary.documents[id];
    if (mineAt === theirsAt || theirsAt === original) {
      if (a) documents.push(a);
    } else if (mineAt === original) {
      if (b) documents.push(b);
    } else if (a && b) {
      documents.push(b, {
        ...a,
        id: crypto.randomUUID(),
        name: a.name.replace(/\.md$/i, "") + " (конфликт синхронизации).md",
      });
      conflicts++;
    } else documents.push(a || b);
  }
  return {
    conflicts,
    workspace: {
      folders,
      documents: documents.map((doc) => doc.folderId && !folderIds.has(doc.folderId)
        ? { ...doc, folderId: undefined }
        : doc),
    },
  };
}

export function sameWorkspaceSummary(a, b) {
  const aIds = Object.keys(a.documents);
  if (aIds.length !== Object.keys(b.documents).length ||
      aIds.some((id) => a.documents[id] !== b.documents[id])) return false;
  const bFolders = new Map(b.folders.map((folder) => [folder.id, json(folder)]));
  return a.folders.length === b.folders.length &&
    a.folders.every((folder) => json(folder) === bFolders.get(folder.id));
}
