"""End-to-end: simulated rig → engine → WebSocket → (fake) website, all in-process and sped up."""
import asyncio
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from rig import SimulatedRig  # noqa: E402
from server import Runner  # noqa: E402

received = []


class FakeSite(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        received.append((self.path, body, self.headers.get("authorization")))
        out = json.dumps({"session": {"id": "abc", "score": 77, "userId": body["userId"]}, "promoted": False,
                          "counted": False, "isBest": False, "prevBest": 0}).encode()
        self.send_response(201); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(out)

    def log_message(self, *a):
        pass


async def drive(port):
    from websockets.asyncio.client import connect

    msgs, state = [], {}
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        async def send(**m):
            await ws.send(json.dumps(m))

        async def until(pred, timeout=20):
            end = asyncio.get_event_loop().time() + timeout
            while True:
                m = json.loads(await asyncio.wait_for(ws.recv(), max(0.1, end - asyncio.get_event_loop().time())))
                msgs.append(m)
                if m["type"] == "state":
                    state.update(m)
                if pred(m):
                    return m

        hello = await until(lambda m: m["type"] == "hello")
        assert hello["simulated"] is True and "l3-zigzag" in hello["paths"]
        await send(cmd="set", userId="ST-1234", level=3, pathId="l3-zigzag", sessionLength=5)
        await send(cmd="calibrate")
        await until(lambda m: m["type"] == "state" and m["phase"] == "calib" and m["calStep"] == 0)
        await send(cmd="calib_next"); await send(cmd="calib_next")
        await until(lambda m: m["type"] == "state" and m["calStep"] == 3)
        assert state["baseline"]["noiseSigma"] > 0
        await send(cmd="calib_next")
        await until(lambda m: m["type"] == "state" and m["phase"] == "run")
        result = await until(lambda m: m["type"] == "result", timeout=30)
        await send(cmd="set", level=99)  # invalid → error message, connection survives
        err = await until(lambda m: m["type"] == "error")
        return msgs, result, err


def test_full_session_over_websocket(tmp_path):
    srv = HTTPServer(("127.0.0.1", 0), FakeSite)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    rig = SimulatedRig(realtime=True, speed=8.0, skill=0.7, seed=5)
    runner = Runner(rig, simulated=True, site=f"http://127.0.0.1:{srv.server_port}", api_key="k")

    async def main():
        from websockets.asyncio.server import serve

        runner.loop = asyncio.get_running_loop()
        threading.Thread(target=runner.engine_loop, daemon=True).start()
        async with serve(runner.handler, "127.0.0.1", 0) as s:
            port = s.sockets[0].getsockname()[1]
            return await drive(port)

    try:
        msgs, result, err = asyncio.run(main())
    finally:
        runner.stop(); srv.shutdown()

    frames = [m for m in msgs if m["type"] == "frame"]
    assert len(frames) > 10 and {"imu", "spec", "pct", "acc", "trem", "haptic"} <= set(frames[-1])
    assert any(f["phase"] == "run" and f["finger"] for f in frames)
    # the session reached the (fake) website flagged simulated, with raw data and the right profile
    path, body, auth = received[-1]
    assert path == "/api/sessions" and auth == "Bearer k"
    assert body["simulated"] is True and body["userId"] == "ST-1234" and body["pathId"] == "l3-zigzag" and body["level"] == 3
    assert body["metrics"]["completionTimeS"] == 5.0 and len(body["raw"]) > 300 and "baseline" in body
    assert result["uploaded"] is True and result["session"]["score"] == 77 and result["simulated"] is True
    assert "level" in err["message"]
