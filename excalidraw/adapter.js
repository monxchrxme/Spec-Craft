import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, exportToSvg, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

window.EXCALIDRAW_ASSET_PATH = new URL("./", import.meta.url).href;

export function mountDrawing(element, scene, ready) {
  const root = createRoot(element);
  root.render(createElement(Excalidraw, {
    langCode: "ru-RU",
    initialData: { ...scene, scrollToContent: true },
    excalidrawAPI: (api) => ready({
      snapshot: () => serializeAsJSON(
        api.getSceneElements(), api.getAppState(), api.getFiles(), "local",
      ),
      frameTool: () => api.setActiveTool({ type: "frame" }),
    }),
  }));
}

export async function drawingImage(scene, crop) {
  const elements = scene.elements.filter((element) => element && !element.isDeleted);
  const exportingFrame = elements.find((element) =>
    element.id === crop && element.type === "frame") || null;
  const svg = await exportToSvg({
    elements,
    appState: { ...scene.appState, exportScale: 1, exportBackground: true, exportEmbedScene: false },
    files: scene.files,
    exportPadding: 12,
    exportingFrame,
  });
  const { width, height } = svg.viewBox.baseVal;
  if (!(width > 0 && height > 0)) throw Error("Пустой рисунок Excalidraw.");
  return {
    url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.outerHTML),
    width,
    height,
    background: scene.appState.viewBackgroundColor || "white",
  };
}
