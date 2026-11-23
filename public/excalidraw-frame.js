const origin = location.origin;
const report = (type, data = {}) =>
  window.parent.postMessage({ type, ...data }, origin);
let sceneSnapshot;

window.addEventListener("message", async (event) => {
  if (event.source !== window.parent || event.origin !== origin) return;
  if (event.data?.type === "excalidraw-open") {
    try {
      const { mountDrawing } = await import("./excalidraw-assets/adapter.js");
      mountDrawing(document.querySelector("#drawing"), event.data.scene, (snapshot) => {
        sceneSnapshot = snapshot;
        report("excalidraw-loaded");
      });
    } catch {
      report("excalidraw-error", { message: "Не удалось загрузить Excalidraw." });
    }
  } else if (event.data?.type === "excalidraw-save" && sceneSnapshot) {
    try {
      report("excalidraw-result", { source: sceneSnapshot() });
    } catch {
      report("excalidraw-error", { message: "Не удалось сохранить рисунок." });
    }
  }
});
report("excalidraw-ready");
