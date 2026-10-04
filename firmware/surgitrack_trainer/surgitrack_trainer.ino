// Surgical Tremor Trainer — Arduino Uno R4 WiFi
// Hardware: one BMI270 (back of hand, 0x68) + DRV2605L haptic driver (0x5A),
// both on the R4's header pins (3.3V, GND, SDA, SCL) — the Wire bus.
//
// Works on its own: measures hand tremor (4–12 Hz shaking), buzzes the wrist
// when it gets too high, and shows a live tremor bar on the LED matrix.
// Set FOR_PI to true when the computer is connected and running the website tracker / recorder.
//
// With FOR_PI = true it streams "millis,ax,ay,az,gx,gy,gz" at 200 Hz and accepts 'B' (buzz) and 'D' (double click):
//   python tracker/server.py --serial /dev/cu.usbmodemXXXX --device trainer        (website)
//   python tracker/collect.py --port /dev/cu.usbmodemXXXX --baud 115200 --time-unit ms --check   (training data)

#include <Wire.h>
#include "SparkFun_BMI270_Arduino_Library.h"
#include <Adafruit_DRV2605.h>
#include "Arduino_LED_Matrix.h"

// ---------------- Settings you can change ----------------
const bool  FOR_PI       = true;    // false = Arduino only, true = stream data to the computer
const float TREMOR_LIMIT = 0.010;   // tremor level (g) that triggers a buzz — tune this
const unsigned long BUZZ_COOLDOWN_MS = 800;  // shortest gap between buzzes
const unsigned long BUZZ_BLANK_MS    = 300;  // ignore readings right after a buzz
const unsigned long WARMUP_MS        = 2000; // no buzzing for the first 2 seconds
const float SAMPLE_HZ = 200.0;               // readings per second

// ---------------- Hardware ----------------
BMI270 imu;
Adafruit_DRV2605 drv;
ArduinoLEDMatrix matrix;
uint8_t frame[8][12];

// ---------------- Filter that keeps only 4–12 Hz ----------------
struct Biquad {
  float b0, b1, b2, a1, a2;
  float z1 = 0, z2 = 0;
  float process(float x) {
    float y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  }
};

Biquad makeFilter(bool highPass, float cutoffHz, float fs) {
  float w0 = 2 * PI * cutoffHz / fs;
  float c = cos(w0);
  float alpha = sin(w0) / (2 * 0.7071);
  float a0 = 1 + alpha;
  Biquad f;
  if (highPass) {
    f.b0 = (1 + c) / 2 / a0;
    f.b1 = -(1 + c) / a0;
    f.b2 = (1 + c) / 2 / a0;
  } else {
    f.b0 = (1 - c) / 2 / a0;
    f.b1 = (1 - c) / a0;
    f.b2 = (1 - c) / 2 / a0;
  }
  f.a1 = -2 * c / a0;
  f.a2 = (1 - alpha) / a0;
  return f;
}

Biquad highPass1, highPass2, lowPass1, lowPass2;
float meanSquare = 0;  // running average of the filtered signal, squared
float tremor = 0;      // tremor level in g (RMS of the 4–12 Hz shaking)

unsigned long nextSampleUs = 0;
unsigned long lastBuzzMs = 0;
unsigned long lastDisplayMs = 0;
unsigned long lastPlotMs = 0;

// ---------------- Helpers ----------------
void buzz(uint8_t effect) {
  drv.setWaveform(0, effect);
  drv.setWaveform(1, 0);
  drv.go();
  lastBuzzMs = millis();
}

void showTremorBar() {
  // Bar grows left to right. Reaching column 8 means you've hit the limit.
  int lit = constrain((int)(tremor / TREMOR_LIMIT * 8.0), 0, 12);
  for (int r = 0; r < 8; r++) {
    for (int c = 0; c < 12; c++) {
      frame[r][c] = (c < lit) ? 1 : 0;
    }
  }
  frame[0][7] = 1;  // small marks showing where the limit is
  frame[7][7] = 1;
  matrix.renderBitmap(frame, 8, 12);
}

void handleCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'B') buzz(47);  // single buzz
    if (c == 'D') buzz(10);  // double click
  }
}

// ---------------- Setup ----------------
void setup() {
  Serial.begin(115200);
  Wire.begin();
  matrix.begin();

  while (imu.beginI2C(BMI2_I2C_PRIM_ADDR, Wire) != BMI2_OK) {
    if (!FOR_PI && Serial) Serial.println("BMI270 not found - check wiring");
    delay(1000);
  }
  while (!drv.begin(&Wire)) {
    if (!FOR_PI && Serial) Serial.println("DRV2605L not found - check wiring");
    delay(1000);
  }
  drv.selectLibrary(1);
  drv.setMode(DRV2605_MODE_INTTRIG);

  highPass1 = makeFilter(true, 4.0, SAMPLE_HZ);
  highPass2 = makeFilter(true, 4.0, SAMPLE_HZ);
  lowPass1  = makeFilter(false, 12.0, SAMPLE_HZ);
  lowPass2  = makeFilter(false, 12.0, SAMPLE_HZ);

  buzz(10);  // double click = ready
  nextSampleUs = micros();
}

// ---------------- Main loop ----------------
void loop() {
  handleCommands();

  // Take a reading exactly SAMPLE_HZ times a second
  if ((long)(micros() - nextSampleUs) < 0) return;
  nextSampleUs += (unsigned long)(1000000.0 / SAMPLE_HZ);
  if (micros() - nextSampleUs > 100000) nextSampleUs = micros();  // resync if far behind

  imu.getSensorData();
  float ax = imu.data.accelX;
  float ay = imu.data.accelY;
  float az = imu.data.accelZ;
  float mag = sqrt(ax * ax + ay * ay + az * az);

  // Keep only the 4–12 Hz part (removes gravity and slow, intentional movement)
  float y = lowPass2.process(lowPass1.process(highPass2.process(highPass1.process(mag))));

  // Average over about one second, skipping the moments right after a buzz
  bool blanked = millis() - lastBuzzMs < BUZZ_BLANK_MS;
  if (!blanked) {
    meanSquare += (y * y - meanSquare) / SAMPLE_HZ;
    tremor = sqrt(meanSquare);
  }

  // Arduino-only mode: buzz the wrist when tremor is too high
  if (!FOR_PI && millis() > WARMUP_MS &&
      tremor > TREMOR_LIMIT && millis() - lastBuzzMs > BUZZ_COOLDOWN_MS) {
    buzz(47);
  }

  // Output
  if (Serial) {
    if (FOR_PI) {
      // time, accel X/Y/Z (g), gyro X/Y/Z (deg/s) — matches the Pi script
      Serial.print(millis()); Serial.print(',');
      Serial.print(ax, 4); Serial.print(',');
      Serial.print(ay, 4); Serial.print(',');
      Serial.print(az, 4); Serial.print(',');
      Serial.print(imu.data.gyroX, 2); Serial.print(',');
      Serial.print(imu.data.gyroY, 2); Serial.print(',');
      Serial.println(imu.data.gyroZ, 2);
    } else if (millis() - lastPlotMs >= 20) {
      lastPlotMs = millis();
      Serial.print("tremor:"); Serial.print(tremor, 4);
      Serial.print(" limit:"); Serial.println(TREMOR_LIMIT, 4);
    }
  }

  // Refresh the LED bar 20 times a second
  if (millis() - lastDisplayMs >= 50) {
    lastDisplayMs = millis();
    showTremorBar();
  }
}
