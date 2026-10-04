"""SurgiTrack runner: drives a sensor rig + session engine and streams it to the browser over a WebSocket.

  python server.py --simulate                      # no hardware: a simulated person (sessions are flagged DEMO)
  python server.py --simulate --camera 0 --camera-mode webcam   # fake wristband, REAL hand via the laptop webcam (DEMO)
  python server.py --serial /dev/cu.usbmodem1101 --camera 0 --camera-mode webcam   # real wristband + laptop webcam
  python server.py --serial /dev/ttyACM0 --camera 0   # Pi: wristband + overhead Pi camera (hardware: not yet tested)

Browser (Live Session → Settings → Data source = Raspberry Pi) connects to ws://<this machine>:8765.
Finished sessions are POSTed to the website (--site, default http://localhost:3000). Message formats: docs/PROTOCOL.md.
"""
from __future__ import annotations
import argparse
import asyncio
import base64
import json
import threading
import time

from engine import HOLD_LENGTH_S, EngineError, SessionEngine
from paths import load_paths
from screen import load_screener
from uploader import UploadError, post_session

FRAME_HZ = 30.0


class Runner:
    def __init__(self, rig, simulated, site, api_key=None, fs=100.0, screener=None, task="path"):
        self.rig, self.simulated, self.site, self.api_key = rig, simulated, site, api_key
        self.engine = SessionEngine(fs=fs, haptic=rig.buzz, screener=screener, haptic_fx=rig.play)
        self.engine.task = task
        if task == "hold":
            self.engine.length_s = HOLD_LENGTH_S
        self.clients, self.user_id, self.loop = set(), None, None
        self._stop = threading.Event()
        self._seen_version = -1

    # ----- thread → websocket bridge -----
    def _emit(self, msg):
        if self.loop and self.clients:
            asyncio.run_coroutine_threadsafe(self._send_all(json.dumps(msg)), self.loop)

    async def _send_all(self, text):
        for ws in list(self.clients):
            try:
                await ws.send(text)
            except Exception:
                self.clients.discard(ws)

    # ----- engine loop (own thread) -----
    def engine_loop(self):
        e, last_frame, last_video, sent_video = self.engine, -1e9, -1e9, None
        told_standalone = False  # wall-clock times of the last frame / preview sent
        while not self._stop.is_set():
            try:
                target, running = e.target_mm(), e.phase == "run"
                s = self.rig.read(target, running)
            except Exception as ex:  # serial timeout etc.
                self._emit({"type": "error", "message": f"sensor read failed: {ex}"})
                time.sleep(0.5)
                continue
            if s.tremor_g is not None and not told_standalone:
                told_standalone = True
                print("Band is in standalone mode (it reports 'tremor:' / 'limit:' lines). Sessions work, but no raw movement is recorded, "
                      "so they can't be used to train the model. For training data, upload the sketch with FOR_PI = true.")
            events = e.feed(s)
            if e.version != self._seen_version:
                self._seen_version = e.version
                self._emit({"type": "state", **e.state()})
            now = time.perf_counter()  # throttle by wall time so a fast simulation can't flood the socket
            if now - last_frame >= 1.0 / FRAME_HZ:
                last_frame = now
                self._emit({"type": "frame", **e.live(s)})
            if now - last_video >= 0.12 and self.clients:  # camera preview (only rigs with a camera return one)
                last_video = now
                jpeg = self.rig.latest_jpeg()
                if jpeg is not None and jpeg is not sent_video:
                    sent_video = jpeg
                    self._emit({"type": "video", "jpeg": base64.b64encode(jpeg).decode()})
            for kind, payload in events:
                if kind == "error":
                    self._emit({"type": "error", "message": payload})
                elif kind == "done":
                    threading.Thread(target=self._finish, args=(payload,), daemon=True).start()

    def _finish(self, result):
        m = result["metrics"]
        body = {"userId": self.user_id, "level": result["level"], "pathId": result["pathId"], "task": result.get("task", "path"), "metrics": m,
                "baseline": result["baseline"], "raw": result["raw"], "simulated": self.simulated}
        if "screening" in result:
            body["screening"] = result["screening"]
        out = {"type": "result", "metrics": m, "samples": len(result["raw"]), "screening": result.get("screening"), "simulated": self.simulated}
        if not self.user_id:
            out.update(uploaded=False, error="No profile selected — open Live Session from a profile.")
        else:
            try:
                resp = post_session(self.site, body, self.api_key)
                out.update(uploaded=True, session=resp["session"], promoted=resp.get("promoted", False),
                           counted=resp.get("counted", False), isBest=resp.get("isBest", False), prevBest=resp.get("prevBest", 0))
            except UploadError as ex:
                out.update(uploaded=False, error=str(ex))
        self._emit(out)

    # ----- websocket side -----
    async def handler(self, ws):
        self.clients.add(ws)
        await ws.send(json.dumps({"type": "hello", "version": 1, "simulated": self.simulated, "camera": bool(getattr(self.rig, "has_camera", False)), "task": self.engine.task, "paths": sorted(load_paths())}))
        await ws.send(json.dumps({"type": "state", **self.engine.state()}))
        try:
            async for raw in ws:
                try:
                    self._command(json.loads(raw))
                except (EngineError, ValueError, KeyError, TypeError) as ex:
                    await ws.send(json.dumps({"type": "error", "message": str(ex)}))
        finally:
            self.clients.discard(ws)

    def _command(self, m):
        e, cmd = self.engine, m.get("cmd")
        if cmd == "set":
            if m.get("userId"):
                self.user_id = str(m["userId"])
            e.configure(level=m.get("level"), path_id=m.get("pathId"), length_s=m.get("sessionLength"), tiered=m.get("game"))
        elif cmd == "calibrate":
            e.begin_calibration()
        elif cmd == "calib_next":
            e.calib_next()
        elif cmd == "start":
            e.start_run()
        elif cmd == "stop":
            e.stop()
        elif cmd == "ping":
            self._emit({"type": "pong"})
        else:
            raise ValueError(f"unknown command {cmd!r}")

    async def serve(self, host, port):
        from websockets.asyncio.server import serve

        self.loop = asyncio.get_running_loop()
        threading.Thread(target=self.engine_loop, daemon=True).start()
        async with serve(self.handler, host, port):
            print(f"SurgiTrack runner listening on ws://{host}:{port}  ({'SIMULATED rig' if self.simulated else 'hardware rig'})  → site {self.site}")
            await asyncio.get_running_loop().create_future()

    def stop(self):
        self._stop.set()
        close = getattr(self.rig, "close", None)
        if close:
            close()  # release the camera / serial port


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--simulate", action="store_true", help="use a simulated person instead of hardware")
    ap.add_argument("--skill", type=float, default=0.6, help="simulated steadiness 0 (shaky) – 1 (steady)")
    ap.add_argument("--speed", type=float, default=1.0, help="simulation speed multiplier")
    ap.add_argument("--serial", help="Arduino serial port, e.g. /dev/ttyACM0")
    ap.add_argument("--device", choices=["repo", "trainer"], default="repo",
                    help="repo = firmware/surgitrack_imu (460800 baud, micros, H<n> haptics); trainer = firmware/surgitrack_trainer (115200 baud, millis, B/D haptics)")
    ap.add_argument("--baud", type=int, default=None, help="serial speed (default depends on --device)")
    ap.add_argument("--time-unit", choices=["us", "ms"], default=None, help="unit of the first serial column (default depends on --device)")
    ap.add_argument("--task", choices=["auto", "path", "hold"], default="auto",
                    help="path = trace a path (needs a camera), hold = hold steady (IMU only). auto = hold for a wristband with no camera")
    ap.add_argument("--camera", default=None, help="camera for MediaPipe fingertip tracking: 0 = laptop webcam, or a video file")
    ap.add_argument("--camera-mode", choices=["overhead", "webcam"], default="overhead",
                    help="overhead = Pi camera looking down (height from the distance sensor); webcam = laptop camera facing you (hand-size ruler)")
    ap.add_argument("--no-mirror", action="store_true", help="webcam mode: don't flip left/right")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--site", default="http://localhost:3000")
    ap.add_argument("--api-key", default=None)
    a = ap.parse_args()

    tracker, mapper = None, None
    if a.camera is not None:
        from camera import FingertipTracker
        from scale import HandRulerMapper, OverheadMapper

        src = int(a.camera) if str(a.camera).isdigit() else a.camera
        tracker = FingertipTracker(src)
        w, h = int(tracker.cap.get(3) or 640), int(tracker.cap.get(4) or 480)
        mapper = HandRulerMapper(w, h, mirror_x=not a.no_mirror) if a.camera_mode == "webcam" else OverheadMapper()
        tracker.mirror_preview = a.camera_mode == "webcam" and not a.no_mirror
        print(f"Camera {a.camera}: {w}×{h}, {a.camera_mode} mode")

    if a.simulate:
        from rig import SimulatedRig

        # --simulate fakes the wristband (IMU); with --camera your real hand is tracked. Either way sessions are flagged DEMO.
        rig, simulated = SimulatedRig(skill=a.skill, speed=a.speed, tracker=tracker, mapper=mapper), True
    elif a.serial:
        from rig import HardwareRig

        trainer = a.device == "trainer"
        rig, simulated = HardwareRig(a.serial, tracker, mapper, baud=a.baud or (115200 if trainer else 460800),
                                     time_unit=a.time_unit or ("ms" if trainer else "us"), protocol=a.device), False
    else:
        ap.error("choose --simulate or --serial PORT")
    screener = load_screener()
    print("Tremor model:", "loaded (screening on)" if screener else "none yet (train.py) — screening off")
    task = a.task if a.task != "auto" else ("hold" if (not simulated and tracker is None) else "path")
    print("Task:", "steady hold (IMU only, tremor + haptics)" if task == "hold" else "trace a path (camera)")
    runner = Runner(rig, simulated, a.site, a.api_key, screener=screener, task=task)
    try:
        asyncio.run(runner.serve(a.host, a.port))
    except KeyboardInterrupt:
        runner.stop()


if __name__ == "__main__":
    main()
