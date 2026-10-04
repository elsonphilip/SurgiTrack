"""End-to-end: simulated rig → engine → WebSocket → (fake) website, all in-process and sped up."""
from __future__ import annotations
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


def test_trainer_sketch_protocol():
    """The standalone sketch: millis() timestamps, 7 fields, B / D buzz commands."""
    import time
    from rig import HardwareRig, parse_line

    assert parse_line("1000,0.01,0.02,1.0,1,2,3", "ms")[0] == 1_000_000
    assert parse_line("1000,0.01,0.02,1.0,1,2,3")[0] == 1000
    assert parse_line("tremor:0.0100 limit:0.0100", "ms") is None  # the sketch's plotter mode is ignored
    rig = HardwareRig("loop://", baud=115200, time_unit="ms", protocol="trainer")
    sent = []
    rig.ser.write = sent.append
    rig.buzz(); rig.play("tick"); rig.play("burst"); rig.play("success")
    assert sent == [b"B\n", b"B\n", b"B\n", b"D\n"]
    rig.ser.write = lambda b: None
    rig.close()


def test_no_data_message_explains_what_to_check():
    import pytest
    from rig import HardwareRig

    rig = HardwareRig("loop://", baud=115200, time_unit="ms", protocol="trainer")
    rig.ser.write = lambda b: None
    rig.n_lines = rig.n_bad = 0
    assert "FOR_PI" in rig.no_data_message()
    rig.n_lines, rig.n_bad, rig.last_bad = 5, 5, "tremor:0.0100 limit:0.0100"
    msg = rig.no_data_message()
    assert "tremor:0.0100" in msg and "baud" in msg
    rig.close()


def test_standalone_sketch_output_is_read_and_buzz_is_not_doubled():
    """A board running the standalone (FOR_PI = false) sketch prints 'tremor:<g> limit:<g>' lines."""
    import time
    from rig import HardwareRig, parse_plotter_line

    assert parse_plotter_line("tremor:0.0005 limit:0.0100") == (0.0005, 0.01)
    assert parse_plotter_line("tremor:1.2e-3 limit:0.0100\r") == (0.0012, 0.01)
    assert parse_plotter_line("12345,0.01,-0.02,0.99,1,2,3") is None
    rig = HardwareRig("loop://", baud=115200, time_unit="ms", protocol="trainer")
    rig.ser.write(b"tremor:0.0150 limit:0.0100\n")  # loops straight back into the reader
    s = rig.read((0, 0), False)
    assert s.tremor_g == 0.015 and s.imu[2] == 1.0
    sent = []
    rig.ser.write = sent.append
    rig.buzz(); rig.play("burst")           # the band is over its own limit, so it is buzzing by itself: send nothing
    rig.play("success")                     # a success pulse is always ours to send
    assert sent == [b"D\n"]
    rig.band_g = 0.004                      # under the band's own limit but possibly over a stricter level limit
    rig.buzz()
    assert sent == [b"D\n", b"B\n"]
    rig.ser.write = lambda b: None
    rig.close()
