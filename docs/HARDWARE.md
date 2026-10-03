# Hardware bring-up checklist

Software for all of this is written; **none of it has run on real hardware yet.** Work down the list in order.

## Wiring (Arduino UNO R4 WiFi)
| Part | Pin | Notes |
|---|---|---|
| BMI270 (SDA/SCL) | A4 / A5 (Qwiic) | I²C address 0x68 (0x69 if SDO high) — change `IMU_ADDR` in the sketch |
| DRV2605L (SDA/SCL) | A4 / A5 | shares the I²C bus, address 0x5A; vibration motor on its OUT± |
| HC-SR04 TRIG | D4 | |
| HC-SR04 ECHO | D2 | interrupt-capable pin; UNO R4 I/O is 5 V so no divider needed |
| HC-SR04 VCC/GND | 5 V / GND | |
| USB | → Raspberry Pi | serial stream + haptic commands |

## 1. Flash the Arduino
Arduino IDE → install **SparkFun BMI270 Arduino Library** and **Adafruit DRV2605 Library** → open
`firmware/surgitrack_imu/surgitrack_imu.ino` → select *Arduino UNO R4 WiFi* → upload.
Fix anything that doesn't compile (this sketch has never been compiled).

## 2. Check the stream on the Pi
```
pip install -r pi/requirements.txt
python3 -c "from pi.sources import serial_source as s; import itertools; [print(x) for x in itertools.islice(s('/dev/ttyACM0'), 5)]"
```
Expect ~200 lines/s: `t,ax,ay,az,gx,gy,gz`; az ≈ 1.0 g when the wristband lies flat. If `BMI270 not found` appears, check wiring/address.
Hand-test the haptic: `echo "H47" > /dev/ttyACM0` (or the serial monitor) should buzz.

## 3. Record real data (needs ≥ 5 people)
```
python3 pi/recorder.py --port /dev/ttyACM0 --user u01 --task steady_hold --label steady --seconds 30
python3 pi/recorder.py --port /dev/ttyACM0 --user u01 --task steady_hold --label simulated_tremor --seconds 30
```
Then `python3 pi/train.py` → comparison table + `models/lgbm.txt`. Fit the tremor constant with `tremor.suggest_k`.

## 4. Camera + MediaPipe
```
sudo apt install libegl1 libgles2                 # system libraries MediaPipe needs (Raspberry Pi OS / Ubuntu)
pip install -r pi/requirements-camera.txt         # opencv-python + mediapipe
python3 pi/camera_check.py --image some_hand_photo.jpg --save out.jpg    # works headless
python3 pi/camera_check.py --camera 0 --height-cm 14                     # live preview window, press q to quit
```
`pi/camera.py` uses MediaPipe's **HandLandmarker (Tasks API)** and tracks **landmark 8 = index fingertip**. The ~8 MB model
`hand_landmarker.task` downloads automatically to `models/` the first time (or save it there yourself from
https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task).
Older MediaPipe releases (legacy `mp.solutions.hands`) are also supported if `pip install mediapipe` only gives you an old build on the Pi.
Verified on still photos (finds the hand, landmark 8 lands on the index fingertip, blank image → no hand);
**not yet verified with a live Pi camera** — check the frame rate in `camera_check.py` (aim for ≥ 15 fps).

Mount the Pi camera pointing straight down at the paper, HC-SR04 next to it pointing down (it reports the height).
`pi/scale.py` converts pixels → mm assuming the image centre is the middle of the 120 × 60 mm trace area and the Pi Camera v2
field of view (62.2°). Check with a ruler: move a fingertip 50 mm and compare the printed mm; adjust `CameraGeometry`
(`hfov_deg`, `center_px`, `mirror_x`). Good lighting and a plain background make the fingertip far steadier.

## 4b. Laptop webcam instead of the Pi camera
A laptop camera faces *you*, not the paper, and there is no height sensor, so the setup differs:
```
python3 pi/camera_check.py --camera 0 --mode webcam                    # live preview; press q to quit
python3 pi/server.py --serial /dev/cu.usbmodem1101 --camera 0 --camera-mode webcam
```
* **You trace by watching the screen.** The Live Session canvas shows a live fingertip cursor (a blue ring) — line it up with the
  start dot, then trace. The paper trace area is the middle of the camera image.
* **The hand is the ruler.** Without a height sensor, scale comes from your hand: the wrist → middle-knuckle distance of an average
  adult hand (≈ 95 mm) in pixels (`HandRulerMapper` in `pi/scale.py`). Left/right is mirrored so moving right moves the cursor right
  (`--no-mirror` to turn that off).
* **Tips:** good front light, plain background, palm toward the camera, hand roughly 30–50 cm away so it fills about a third of the
  frame. Keep the hand square to the camera (tilting shrinks the ruler and distorts mm).
* **Accuracy limits (be honest about these):** MediaPipe's fingertip wobbles ~1–2 px and a non-average hand shifts the scale, so
  expect a few mm of measurement noise — fine for Levels 1–2, rough for the ±1–1.5 mm levels. Tremor is still measured by the
  wristband IMU, which is far more precise than the camera.
* **macOS:** the first run asks for Camera permission for your terminal app (System Settings → Privacy & Security → Camera).
* **No Arduino yet? Test just the camera:** `python3 pi/server.py --simulate --camera 0 --camera-mode webcam` — the wristband
  (IMU) is faked, but your REAL hand is tracked. Sessions from this mode are flagged DEMO and never count toward real progress.
* **No camera handy?** `--camera some_video.mp4` replays a video file (paced, looping) — useful for demos.
* The Live Session camera card shows the preview with hand landmarks drawn on it.

### Is my camera working? (3 checks)
1. `python3 pi/camera_check.py --camera 0 --mode webcam` → a window opens with your picture; hold your hand up and a **green ring
   should sit on your index fingertip**, with `x,y px` and `mm` printed. No window / "could not open camera" = permission or wrong
   index (try `--camera 1`). No ring = poor light or hand too small/far.
2. Run the runner (`--simulate --camera 0 --camera-mode webcam`, or with `--serial`), open the website, **Detailed** view →
   Live Session → Settings → **Data source = Raspberry Pi** (address `ws://localhost:8765`). The chip should say **PI · SIMULATED**
   (or **PI · LIVE** with a real wristband) and the **Pi camera card shows your live video with the hand skeleton**.
3. The blue ring on the canvas follows your fingertip. If it says "Can't see your hand", the camera has lost you.

Note: the **browser never opens the camera** — the Python runner does, and the page only shows its preview. So the camera card
stays a striped placeholder until the runner is running and the Data source is set to Raspberry Pi (Detailed view only).

## 5. Run everything (all local)
```
npm run dev                                   # website  → http://localhost:3000
python3 pi/server.py --serial /dev/ttyACM0 --camera 0 --site http://localhost:3000    # on the Pi / this machine
```
Website → Live Session → Settings → Data source = **Raspberry Pi** (address `ws://<pi-address>:8765`).
No hardware yet? `python3 pi/server.py --simulate` runs the whole pipeline with a simulated person (sessions stored as DEMO data).
