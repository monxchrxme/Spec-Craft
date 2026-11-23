import { mountDrawing } from "./excalidraw-assets/adapter.js";

window.openSpecCraftDrawing = (scene, ready) =>
  mountDrawing(document.querySelector("#drawing"), scene, ready);
