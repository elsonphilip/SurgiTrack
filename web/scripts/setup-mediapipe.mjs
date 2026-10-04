// Puts the in-browser hand tracker's files where the site can serve them (idempotent, safe to run any time):
//   web/public/mediapipe/wasm/*              ← from node_modules/@mediapipe/tasks-vision (no CDN needed)
//   web/public/models/hand_landmarker.task   ← from ../models/ if present, else downloaded once from Google (~8 MB)
import { cpSync, copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = path.join(web, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDst = path.join(web, "public", "mediapipe", "wasm");
const modelDst = path.join(web, "public", "models", "hand_landmarker.task");
const modelLocal = path.join(web, "..", "models", "hand_landmarker.task");
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDst, { recursive: true });
  cpSync(wasmSrc, wasmDst, { recursive: true });
} else {
  console.warn("⚠ @mediapipe/tasks-vision is not installed yet (run npm install in web/); webcam tracking will be unavailable.");
}

if (!existsSync(modelDst)) {
  mkdirSync(path.dirname(modelDst), { recursive: true });
  if (existsSync(modelLocal)) {
    copyFileSync(modelLocal, modelDst);
  } else {
    try {
      console.log("▶ Downloading the hand tracking model (~8 MB, once)…");
      const res = await fetch(MODEL_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tmp = modelDst + ".part";
      writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
      renameSync(tmp, modelDst);
    } catch (e) {
      console.warn(`⚠ Could not download the hand tracking model (${e.message}). Webcam tracking needs it: download\n  ${MODEL_URL}\n  and save it as web/public/models/hand_landmarker.task`);
    }
  }
}
