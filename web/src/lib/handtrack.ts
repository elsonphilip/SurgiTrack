/** Loads MediaPipe's HandLandmarker in the browser. Files are served locally (see web/scripts/setup-mediapipe.mjs), no CDN. */
import type { HandLandmarker } from "@mediapipe/tasks-vision";

export interface Connection { start: number; end: number }
let cached: Promise<{ landmarker: HandLandmarker; connections: Connection[] }> | null = null;

export function loadHandLandmarker() {
  cached ??= (async () => {
    const { FilesetResolver, HandLandmarker: HL } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const make = (delegate: "GPU" | "CPU") =>
      HL.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    let landmarker: HandLandmarker;
    try { landmarker = await make("GPU"); } catch { landmarker = await make("CPU"); }
    return { landmarker, connections: HL.HAND_CONNECTIONS as Connection[] };
  })().catch((e) => { cached = null; throw e; });
  return cached;
}
