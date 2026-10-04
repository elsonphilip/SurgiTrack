"""Guided data collection for model training — one participant at a time.

  python3 collect.py --list-ports                                   # find the Arduino's port
  python3 collect.py --port /dev/cu.usbmodem1101 --check            # 3-second hardware check
  python3 collect.py --port /dev/cu.usbmodem1101 --user p01         # full protocol for participant p01
  python3 collect.py --simulate --out /tmp/try --user p01 --seconds 3 --repeats 1   # dry run, fake data, never saved to data/raw

Each recording is quality-checked (sample rate, dropouts, gravity, stuck axes) and re-recorded on request.
Use anonymous IDs (p01, p02, …), never names, and get each participant's consent first.
"""
from __future__ import annotations
import argparse
import sys
import time
from pathlib import Path

from quality import check_recording
from recorder import RAW_DIR, record, record_session
from sources import serial_source, simulated_source

# (label, task, what to tell the participant, repeats)
PROTOCOL = [
    ("steady", "steady_hold",
     "Sit with your forearm resting on the table, wrist band on, hand held out as if holding a scalpel.\n"
     "Keep it as STILL as you can. Breathe normally."),
    ("simulated_tremor", "shake_hold",
     "Same pose, but deliberately make your hand SHAKE lightly and steadily — about 5 small shakes per second —\n"
     "like a mild tremor. Keep it going for the whole recording."),
]


def drain(source, seconds=0.5):
    """Throw away the first moments (stale serial buffer, hand still moving into position)."""
    start = None
    for row in source:
        start = row[0] if start is None else start
        if row[0] - start >= seconds:
            return


def run_protocol(source, src_kind, out_dir, user, seconds, repeats, input_fn=input, say=print):
    saved = []
    for label, task, instructions in [(a, b, c) for a, b, c in PROTOCOL]:
        for rep in range(1, repeats + 1):
            while True:
                say(f"\n=== {user} · {label} · recording {rep}/{repeats} ({seconds:.0f} s) ===\n{instructions}")
                input_fn("Press Enter when ready… ")
                for n in (3, 2, 1):
                    say(f"  {n}…")
                    time.sleep(0 if src_kind == "synthetic" else 1)
                drain(source)
                say("  RECORDING — go!")
                path, meta = record_session(source, src_kind, out_dir, user, task, label, seconds)
                q = check_recording(path)
                say(f"  done: {q['n']} samples, {q['rate_hz']} Hz, max gap {q['max_gap_s'] * 1000:.0f} ms, gravity {q['gravity_g']} g")
                if q["ok"]:
                    saved.append(path)
                    break
                for pr in q["problems"]:
                    say(f"  ✗ {pr}")
                path.unlink(missing_ok=True)
                path.with_suffix(".json").unlink(missing_ok=True)
                if input_fn("  Problem with that recording (deleted). Try again? [Y/n] ").strip().lower() == "n":
                    break
    return saved


def hardware_check(source, seconds=3.0, out_dir="/tmp"):
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        path, _ = record_session(source, "synthetic", d, "check", "check", "check", seconds)
        return check_recording(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port")
    ap.add_argument("--list-ports", action="store_true")
    ap.add_argument("--raw", action="store_true", help="print the first few raw lines from the port, to see what the board sends")
    ap.add_argument("--baud", type=int, default=460800, help="serial speed; must match Serial.begin() in the sketch")
    ap.add_argument("--time-unit", choices=["us", "ms"], default="us", help="unit of the first column: micros() = us, millis() = ms")
    ap.add_argument("--check", action="store_true", help="record 3 s and report whether the stream looks healthy")
    ap.add_argument("--simulate", action="store_true")
    ap.add_argument("--out", help="output dir (required with --simulate)")
    ap.add_argument("--user", help="anonymous participant id, e.g. p01")
    ap.add_argument("--seconds", type=float, default=30)
    ap.add_argument("--repeats", type=int, default=3, help="recordings per label")
    a = ap.parse_args()

    if a.raw:
        if not a.port:
            ap.error("--raw needs --port")
        import serial

        with serial.Serial(a.port, a.baud, timeout=1) as ser:
            print(f"Reading {a.port} at {a.baud} baud for 4 s ...")
            lines = [ser.readline() for _ in range(4)] + [ser.readline() for _ in range(8)]
        got = [l.decode("ascii", errors="replace").rstrip() for l in lines if l]
        if not got:
            print("NOTHING received. The board is silent: sketch not uploaded / FOR_PI is false / stuck waiting for the IMU / wrong port.")
        for g in got[:10]:
            print("  ", repr(g))
        if got:
            print("Expected lines like  123456,0.01,-0.02,0.99,1.2,-0.3,0.5  (time,ax,ay,az,gx,gy,gz). "
                  "Garbled characters = wrong --baud. Lines starting 'tremor:' = FOR_PI is false.")
        return
    if a.list_ports:
        from serial.tools import list_ports

        ports = list(list_ports.comports())
        print("\n".join(f"{p.device}  {p.description}" for p in ports) or "no serial ports found")
        return
    if a.simulate:
        if not a.out or Path(a.out).resolve() == RAW_DIR:
            ap.error("--simulate needs --out somewhere other than data/raw")
        # steady and shaky fakes alternate so a dry run exercises both labels
        source, kind, out_dir = simulated_source(realtime=False), "synthetic", Path(a.out)
    elif a.port:
        source, kind, out_dir = serial_source(a.port, a.baud, a.time_unit), "device", RAW_DIR
    else:
        ap.error("pass --port (or --simulate / --list-ports)")

    if a.check:
        q = hardware_check(source)
        print(f"{q['n']} samples · {q['rate_hz']} Hz · max gap {q['max_gap_s'] * 1000:.0f} ms · gravity {q['gravity_g']} g")
        print("✓ stream looks healthy" if q["ok"] else "\n".join("✗ " + p for p in q["problems"]))
        sys.exit(0 if q["ok"] else 1)
    if not a.user:
        ap.error("--user is required (anonymous id like p01)")
    saved = run_protocol(source, kind, out_dir, a.user, a.seconds, a.repeats)
    print(f"\nSaved {len(saved)} recordings for {a.user} to {out_dir}. Next participant, or: python3 inventory.py")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):  # Windows consoles may not be UTF-8; never crash on ✓ / ✗ / …
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
