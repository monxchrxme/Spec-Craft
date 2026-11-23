import { readFolders, folderStorageKey } from "./workspace-folders.js";

export const activeWorkspaceKey = "speccraft:private-workspace";
const sourceKey = (id) => "speccraft:private-source:" + id;
const sourcesInThisTab = new Set();

export function rememberWorkspaceSource(id) {
  sourcesInThisTab.add(id);
  try {
    localStorage.setItem(sourceKey(id), "true");
  } catch {
    // Keep showing the newly created key if browser storage is full.
  }
}

export function isWorkspaceSource(id) {
  if (sourcesInThisTab.has(id)) return true;
  try {
    return localStorage.getItem(sourceKey(id)) === "true";
  } catch {
    return false;
  }
}

export function workspaceKeys(id) {
  const prefix = id ? "speccraft:private:" + id + ":" : "buro:";
  return {
    docs: prefix + "doc:",
    folders: id ? prefix + "folders" : folderStorageKey,
    active: prefix + "active",
  };
}

export function activeWorkspace() {
  try {
    const id = localStorage.getItem(activeWorkspaceKey);
    return /^[a-f0-9]{64}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

function documentKeys(prefix) {
  return Object.keys(localStorage).filter((key) => key.startsWith(prefix));
}

export function readWorkspace(keys) {
  const documents = documentKeys(keys.docs).map((key) => JSON.parse(localStorage.getItem(key)));
  if (documents.some((doc) => !doc || typeof doc.id !== "string" ||
      typeof doc.name !== "string" || typeof doc.body !== "string"))
    throw Error("В браузере есть личный файл, который не удалось прочитать.");
  return { documents, folders: readFolders(JSON.parse(localStorage.getItem(keys.folders))) };
}

export function writeWorkspace(keys, snapshot) {
  const next = new Map(snapshot.documents.map((doc) => [keys.docs + doc.id, JSON.stringify(doc)]));
  next.set(keys.folders, JSON.stringify(snapshot.folders));
  const oldKeys = new Set([...documentKeys(keys.docs), keys.folders, ...next.keys()]);
  const previous = new Map([...oldKeys].map((key) => [key, localStorage.getItem(key)]));
  const changed = [...oldKeys].filter((key) => (next.get(key) ?? null) !== previous.get(key));
  try {
    for (const key of changed) if (!next.has(key)) localStorage.removeItem(key);
    for (const key of changed) if (next.has(key)) localStorage.setItem(key, next.get(key));
  } catch (error) {
    for (const key of changed) localStorage.removeItem(key);
    for (const key of changed) if (previous.get(key) !== null)
      localStorage.setItem(key, previous.get(key));
    throw error;
  }
}
