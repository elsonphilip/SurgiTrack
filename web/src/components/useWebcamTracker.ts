"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadHandLandmarker, type Connection } from "@/lib/handtrack";
import type { Lm } from "@/lib/cam-session";

export type CamStatus = "off" | "loading" | "asking" | "ready" | "denied" | "nodevice" | "error";
export interface CamFrame { t: number; lm: Lm[] | null; w: number; h: number }

/**
 * Asks the browser for the webcam (the permission prompt appears when start() is called, so call it from a click),
 * runs MediaPipe hand tracking on every new video frame and reports the landmarks. Video never leaves the computer.
 */
export function useWebcamTracker(onFrame: (f: CamFrame) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<CamStatus>("off");
  const [message, setMessage] = useState("");
  const [handVisible, setHandVisible] = useState(false);
  const [fps, setFps] = useState(0); // how many camera frames a second are being tracked
  const cb = useRef(onFrame);
  useEffect(() => { cb.current = onFrame; }, [onFrame]);
  const live = useRef({ stream: null as MediaStream | null, raf: 0, run: 0, last: -1, vis: false, conns: [] as Connection[], n: 0, t0: 0 });

  const stop = useCallback(() => {
    const L = live.current;
    L.run++; // invalidates any loop or start() still in flight
    cancelAnimationFrame(L.raf);
    L.stream?.getTracks().forEach((t) => t.stop());
    L.stream = null;
    const v = videoRef.current;
    if (v) { v.pause(); v.srcObject = null; }
    L.vis = false; setHandVisible(false); setFps(0); L.n = 0;
    setStatus("off"); setMessage("");
  }, []);

  const start = useCallback(async () => {
    const L = live.current;
    if (L.stream) return;
    const run = ++L.run;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error"); setMessage("This browser can't use the camera here. Open the site at http://localhost:3000 in Chrome, Edge, Safari or Firefox.");
      return;
    }
    try {
      setStatus("asking"); setMessage("Your browser is asking to use the camera. Click Allow.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false });
      if (run !== L.run) { stream.getTracks().forEach((t) => t.stop()); return; }
      L.stream = stream;
      setStatus("loading"); setMessage("Camera on. Loading hand tracking…");
      const v = videoRef.current;
      if (!v) throw new Error("no video element");
      v.srcObject = stream;
      await v.play();
      const { landmarker, connections } = await loadHandLandmarker();
      if (run !== L.run) return;
      L.conns = connections;
      setStatus("ready"); setMessage("");
      const tick = () => {
        if (run !== L.run) return;
        L.raf = requestAnimationFrame(tick);
        if (v.readyState < 2 || v.currentTime === L.last) return;
        L.last = v.currentTime;
        let lm: Lm[] | null = null;
        try { lm = landmarker.detectForVideo(v, performance.now()).landmarks[0] ?? null; } catch { lm = null; }
        const vis = lm !== null;
        if (vis !== L.vis) { L.vis = vis; setHandVisible(vis); }
        draw(overlayRef.current, lm, L.conns);
        L.n++;
        const nowMs = performance.now();
        if (nowMs - L.t0 >= 1000) { setFps(Math.round((L.n * 1000) / (nowMs - L.t0))); L.n = 0; L.t0 = nowMs; }
        cb.current({ t: performance.now() / 1000, lm, w: v.videoWidth, h: v.videoHeight });
      };
      L.raf = requestAnimationFrame(tick);
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      L.stream?.getTracks().forEach((t) => t.stop()); L.stream = null;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied");
        setMessage("Camera access was blocked. Click the camera icon in the address bar (or the site settings), choose Allow, then try again.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus("nodevice"); setMessage("No camera was found. Plug one in, or check that no other app is using it.");
      } else if (name === "NotReadableError") {
        setStatus("error"); setMessage("The camera is busy. Close other apps or tabs using it (Zoom, Teams, FaceTime) and try again.");
      } else {
        setStatus("error"); setMessage(`Couldn't start hand tracking: ${(e as Error).message || name || "unknown error"}. If this says the model could not load, run: node web/scripts/setup-mediapipe.mjs`);
      }
    }
  }, []);

  useEffect(() => () => stop(), [stop]);
  return { videoRef, overlayRef, status, message, handVisible, fps, start, stop };
}

function draw(c: HTMLCanvasElement | null, lm: Lm[] | null, conns: Connection[]) {
  const g = c?.getContext("2d");
  if (!c || !g) return;
  if (c.width !== 320) { c.width = 320; c.height = 240; }
  g.clearRect(0, 0, c.width, c.height);
  if (!lm) return;
  g.lineWidth = 2; g.strokeStyle = "rgba(166,202,200,.85)";
  for (const { start, end } of conns) { g.beginPath(); g.moveTo(lm[start].x * c.width, lm[start].y * c.height); g.lineTo(lm[end].x * c.width, lm[end].y * c.height); g.stroke(); }
  g.fillStyle = "rgba(166,202,200,.9)";
  for (const p of lm) { g.beginPath(); g.arc(p.x * c.width, p.y * c.height, 2.2, 0, 7); g.fill(); }
  g.strokeStyle = "#E3A857"; g.lineWidth = 3; g.fillStyle = "#E3A857"; // the index fingertip is what flies the ship
  g.beginPath(); g.arc(lm[8].x * c.width, lm[8].y * c.height, 8, 0, 7); g.stroke();
  g.beginPath(); g.arc(lm[8].x * c.width, lm[8].y * c.height, 3, 0, 7); g.fill();
}
