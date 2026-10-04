# SurgiTrack interfaces

```
 wristband (Arduino) ──USB serial──▶  tracker (tracker/server.py)  ──WebSocket──▶  browser (Live Session)
        ▲                                   │  ▲                                      │
        └────── haptic commands ────────────┘  └── camera (MediaPipe)                 │
                                            └────── HTTP POST /api/sessions ──▶  website (web/) ◀──────┘
```
Everything runs locally: the website on `http://localhost:3000`, the runner on `ws://localhost:8765` (or another machine on your network).

## 1. Arduino ⇄ tracker (USB serial, 460800 baud, `\n` terminated)
**Arduino → tracker**, 200 Hz: `t_us,ax,ay,az,gx,gy,gz,dist_cm`
accel in g, gyro in deg/s, `t_us` = Arduino `micros()`, `dist_cm` = HC-SR04 height (empty until the first echo).
Lines starting with `#` are comments (boot messages). Older firmware sent 7 fields (no distance) — still accepted.

**tracker → Arduino:** `H<n>` play DRV2605L effect *n* (47 = strong buzz), `X` stop.

## 2. tracker ⇄ browser (WebSocket, JSON text frames)
Run `python tracker/server.py --simulate` (no hardware) or `python tracker/server.py --serial /dev/ttyACM0 --camera 0`.
In the website: Live Session → Settings → **Data source = Tracker (Python)**, address `ws://localhost:8765`.

**Browser → runner**
| message | effect |
|---|---|
| `{"cmd":"set","userId":"ST-0417","level":3,"pathId":"l3-zigzag","sessionLength":12}` | choose profile/level/path/duration (any field optional; not allowed mid-run) |
| `{"cmd":"calibrate"}` | begin calibration (step 0) |
| `{"cmd":"calib_next"}` | advance: 0→1 (wristband on), 1→2 (neutral pose; auto-records 5 s still), 3→run (begin training) |
| `{"cmd":"start"}` / `{"cmd":"stop"}` | start a run directly (after calibration) / cancel to idle |

**Runner → browser**
| `type` | contents |
|---|---|
| `hello` | `{version, simulated, paths:[ids]}` on connect |
| `state` | `{phase: idle\|calib\|run\|done, calStep 0-3, calCount, level, pathId, sessionLength, tolerance, noise, baseline}` on every change |
| `frame` (30 Hz) | `{t, phase, imu[6], finger:[x_mm,y_mm]\|null, dist, dev, out, acc, trem, smooth, pct, time, pulses, haptic, spec[14]}` |
| `result` | `{metrics, samples, uploaded, session?, promoted?, counted?, isBest?, prevBest?, screening?, simulated, error?}` after the session is posted to the site |
| `error` | `{message}` (bad command, no hand tracked, sensor failure) |

Coordinates are millimetres on the 120 × 60 mm trace area, origin top-left, +y down (same frame as `data/paths.json`).

## 3. Runner → website (HTTP)
`POST /api/sessions` (JSON):
```json
{ "userId": "ST-0417", "level": 3, "pathId": "l3-zigzag",
  "metrics": { "accuracy": 94.3, "avgDeviationMm": 0.84, "tremor": 7.3, "smoothness": 71, "completionTimeS": 12, "hapticPulses": 1 },
  "baseline": { "pitch": 0.5, "roll": -1.2, "noiseSigma": 0.0031 },
  "screening": { "tremorProbability": 0.12, "windows": 11 },
  "simulated": false,
  "raw": [ { "t": 0.01, "ax": 0, "ay": 0, "az": 1, "gx": 0, "gy": 0, "gz": 0, "camX": 14.9, "camY": 30.0, "distCm": 14.2 } ] }
```
`simulated: true` stores the session as DEMO data (it never counts toward a real profile's best score / level / leaderboard).
Set `SURGITRACK_API_KEY` on the website and `--api-key` on the runner to require a bearer token.
Response: `{ session, promoted, counted, isBest, prevBest }`. The site computes the overall score.

## Metric definitions (`tracker/engine.py`, `tracker/tremor.py`)
* **accuracy** = % of camera samples within the level's tolerance of the path · **avgDeviationMm** = mean distance to the path
* **tremor (0–10)** = `10·clip(RMS₄₋₁₂Hz(accel) / (K·σ_base), 0, 1)`; σ_base = same band RMS measured in the 5 s still calibration
* **smoothness (0–100)** = `100 − α·max(0, ln(DJ) − ln_ref)` from the fingertip speed profile (DJ = dimensionless jerk)
* `K`, `α`, `ln_ref` are **placeholders** — fit them on real recordings (`tremor.suggest_k`).
