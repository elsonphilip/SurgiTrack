# SurgiTrack

Wrist-worn hand-stability trainer for med students / novice surgeons. A BMI270 IMU (via Arduino R4 WiFi)
streams motion to a Raspberry Pi, which scores tremor, smoothness and path deviation and drives haptic
feedback (DRV2605L). A Pi camera + MediaPipe Hands tracks path; the IMU is the primary tremor source
(a 30 fps camera can't resolve 4–12 Hz tremor reliably).

## Status
- [x] Arduino IMU streamer (untested on hardware)
- [x] Recorder, calibration, tremor features (+ tests)
- [x] Web app (`web/`): profiles, sessions, leaderboard, 5 progress charts, session API
- [ ] Collect real data → train classifier (split by user)
- [ ] MediaPipe path tracking, haptics, Pi → site uploader

## Quick start
```
cd pi && pip install -r requirements.txt && pytest
python recorder.py --port /dev/ttyACM0 --user u01 --task steady_hold --label steady --seconds 30
```
Not a medical device; any Parkinson's indication is a screening signal, not a diagnosis.

## Website (`web/`)
Next.js + Recharts, JSON-file storage in `web/data/` (gitignored).
```
cd web && npm install && npm run dev
npm run seed:demo    # optional demo profiles/sessions, flagged synthetic + shown with a DEMO badge
npm run seed:clear   # remove all synthetic data; real data is untouched
```
The Pi posts finished sessions to `POST /api/sessions`
(`{userId, level, metrics:{accuracy,avgDeviationMm,tremor,smoothness,completionTimeS}, raw?}`);
set `SURGITRACK_API_KEY` to require `Authorization: Bearer <key>`.
Posted sessions are stored as `source: "device"`; the overall score is computed server-side in `web/src/lib/scoring.ts`.

**Definitions (placeholders to retune with real data):** accuracy = % of path samples within the level's tolerance
(8/6/4/3/2 mm for levels 1–5); overall = 40% accuracy + 25% steadiness (100 − tremor) + 25% smoothness + 10% time;
score ≥ 80 on your current level unlocks the next.
