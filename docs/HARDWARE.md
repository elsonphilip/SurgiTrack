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

## 5. Run everything (all local)
```
npm run dev                                   # website  → http://localhost:3000
python3 pi/server.py --serial /dev/ttyACM0 --camera 0 --site http://localhost:3000    # on the Pi / this machine
```
Website → Live Session → Settings → Data source = **Raspberry Pi** (address `ws://<pi-address>:8765`).
No hardware yet? `python3 pi/server.py --simulate` runs the whole pipeline with a simulated person (sessions stored as DEMO data).
