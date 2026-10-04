"""What data do we have, and is it enough to train?   python3 inventory.py"""
from __future__ import annotations
import json
import sys
from collections import defaultdict
from pathlib import Path

from dataset import NEGATIVE, POSITIVE, RAW_DIR
from train import MIN_PARTICIPANTS

WINDOW_S, STEP_S = 2.0, 1.0


def windows(seconds):
    return max(0, int((seconds - WINDOW_S) / STEP_S) + 1)


def inventory(raw_dir=RAW_DIR):
    """{participant: {label: [recordings, windows]}} for real device recordings with a trainable label."""
    inv, skipped = defaultdict(lambda: defaultdict(lambda: [0, 0])), {"synthetic": 0, "other_label": 0}
    for m in sorted(Path(raw_dir).glob("*.json")):
        meta = json.loads(m.read_text())
        if meta.get("source") != "device":
            skipped["synthetic"] += 1
            continue
        if meta.get("label") not in POSITIVE | NEGATIVE:
            skipped["other_label"] += 1
            continue
        cell = inv[meta["user"]][meta["label"]]
        cell[0] += 1
        cell[1] += windows(meta.get("seconds", 0))
    return inv, skipped


def readiness(inv):
    """List of things still missing; empty = ready to run train.py."""
    todo = []
    both = [u for u, labs in inv.items() if (set(labs) & NEGATIVE) and (set(labs) & POSITIVE)]
    if len(inv) < MIN_PARTICIPANTS:
        todo.append(f"need {MIN_PARTICIPANTS - len(inv)} more participant(s) (have {len(inv)}, minimum {MIN_PARTICIPANTS})")
    if not any(set(l) & NEGATIVE for l in inv.values()):
        todo.append("no 'steady' recordings yet")
    if not any(set(l) & POSITIVE for l in inv.values()):
        todo.append("no tremor recordings yet (simulated_tremor / clinical_tremor)")
    short = [u for u in inv if u not in both]
    if inv and short:
        todo.append("these participants are missing a class (record both steady and tremor): " + ", ".join(sorted(short)))
    return todo


def main():
    inv, skipped = inventory()
    if not inv:
        print(f"No usable real recordings in {RAW_DIR}. Start with: python3 collect.py --port <PORT> --user p01")
        sys.exit(1)
    labels = sorted({l for labs in inv.values() for l in labs})
    print(f"{'participant':<14}" + "".join(f"{l:>26}" for l in labels))
    for u in sorted(inv):
        print(f"{u:<14}" + "".join(f"{'%d rec / %d win' % tuple(inv[u][l]) if l in inv[u] else '—':>26}" for l in labels))
    tot = {l: sum(inv[u][l][1] for u in inv if l in inv[u]) for l in labels}
    print(f"{'TOTAL windows':<14}" + "".join(f"{tot[l]:>26}" for l in labels))
    if any(skipped.values()):
        print(f"(skipped: {skipped['synthetic']} synthetic, {skipped['other_label']} with other labels)")
    todo = readiness(inv)
    print("\n" + ("✓ Ready: run  python3 train.py" if not todo else "Not ready yet:\n" + "\n".join("  • " + t for t in todo)))
    sys.exit(0 if not todo else 1)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):  # Windows consoles may not be UTF-8; never crash on ✓ / ✗ / …
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
