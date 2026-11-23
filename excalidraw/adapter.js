import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, exportToCanvas, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

window.EXCALIDRAW_ASSET_PATH = new URL("./", import.meta.url).href;

export function mountDrawing(element, scene, ready) {
  const root = createRoot(element);
  root.render(createElement(Excalidraw, {
    langCode: "ru-RU",
    initialData: { ...scene, scrollToContent: true },
    excalidrawAPI: (api) => {
      ready(() => serializeAsJSON(
        api.getSceneElements(), api.getAppState(), api.getFiles(), "local",
      ));
    },
  }));
}

export async function drawingImage(scene) {
  const canvas = await exportToCanvas({
    elements: scene.elements.filter((element) => !element.isDeleted),
    appState: { ...scene.appState, exportBackground: true },
    files: scene.files,
    maxWidthOrHeight: 2200,
    exportPadding: 12,
  });
  return {
    url: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}
