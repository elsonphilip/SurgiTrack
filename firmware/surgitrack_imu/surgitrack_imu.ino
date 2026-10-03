// SurgiTrack wristband firmware — Arduino UNO R4 WiFi + BMI270 (IMU) + DRV2605L (haptics) + HC-SR04 (height)
//
// Libraries (Library Manager): "SparkFun BMI270 Arduino Library", "Adafruit DRV2605 Library"
// Wiring: see docs/HARDWARE.md.   Protocol: see docs/PROTOCOL.md.
//
// OUT (USB serial, 460800 baud, one line per sample at 200 Hz):
//     t_us,ax,ay,az,gx,gy,gz,dist_cm        accel in g, gyro in deg/s, dist_cm empty until the first echo
// IN  (one command per line):
//     H<n>   play DRV2605L effect n (1–123; 47 = strong buzz)         X   stop the motor
//
// NOT yet compiled or tested on hardware — check the IMU address, pins and effect numbers on first bring-up.

#include <Wire.h>
#include "SparkFun_BMI270_Arduino_Library.h"
#include <Adafruit_DRV2605.h>

const uint32_t BAUD = 460800;
const uint32_t SAMPLE_PERIOD_US = 5000;  // 200 Hz
const uint8_t IMU_ADDR = 0x68;           // 0x69 if the breakout's SDO pin is pulled high
const uint8_t TRIG_PIN = 4;
const uint8_t ECHO_PIN = 2;              // D2 supports external interrupts
const uint32_t PING_PERIOD_MS = 60;      // HC-SR04 needs ≥ 60 ms between pings
const uint8_t DEFAULT_EFFECT = 47;

BMI270 imu;
Adafruit_DRV2605 drv;
bool hapticOk = false;

// HC-SR04 is measured with an interrupt so it never blocks the 200 Hz IMU loop.
volatile uint32_t echoStartUs = 0, echoWidthUs = 0;
volatile bool echoReady = false;
float distCm = NAN;
uint32_t lastPingMs = 0;
uint32_t nextSampleUs = 0;
char cmd[16];
uint8_t cmdLen = 0;

void onEcho() {
  if (digitalRead(ECHO_PIN)) {
    echoStartUs = micros();
  } else {
    echoWidthUs = micros() - echoStartUs;
    echoReady = true;
  }
}

void playEffect(uint8_t effect) {
  if (!hapticOk || effect < 1 || effect > 123) return;
  drv.setWaveform(0, effect);
  drv.setWaveform(1, 0);  // end of sequence
  drv.go();
}

void handleCommand(const char* c) {
  if (c[0] == 'H') {
    int n = atoi(c + 1);
    playEffect(n > 0 ? n : DEFAULT_EFFECT);
  } else if (c[0] == 'X' && hapticOk) {
    drv.stop();
  }
}

void setup() {
  Serial.begin(BAUD);
  while (!Serial && millis() < 3000) {}
  Wire.begin();
  Wire.setClock(400000);

  while (imu.beginI2C(IMU_ADDR) != BMI2_OK) {
    Serial.println("# BMI270 not found, retrying");
    delay(500);
  }
  imu.setAccelODR(BMI2_ACC_ODR_200HZ);
  imu.setGyroODR(BMI2_GYR_ODR_200HZ);

  hapticOk = drv.begin();
  if (hapticOk) {
    drv.selectLibrary(1);  // ERM library
    drv.setMode(DRV2605_MODE_INTTRIG);
  } else {
    Serial.println("# DRV2605L not found — haptics disabled");
  }

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(ECHO_PIN), onEcho, CHANGE);

  Serial.println("# surgitrack v2 fields=t_us,ax,ay,az,gx,gy,gz,dist_cm");
  nextSampleUs = micros();
}

void loop() {
  // 1) commands from the Pi (non-blocking, newline-terminated)
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (cmdLen) { cmd[cmdLen] = 0; handleCommand(cmd); cmdLen = 0; }
    } else if (cmdLen < sizeof(cmd) - 1) {
      cmd[cmdLen++] = ch;
    }
  }

  // 2) HC-SR04: fire a ping every PING_PERIOD_MS, read back the interrupt result
  uint32_t nowMs = millis();
  if (nowMs - lastPingMs >= PING_PERIOD_MS) {
    lastPingMs = nowMs;
    digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
  }
  if (echoReady) {
    noInterrupts(); uint32_t w = echoWidthUs; echoReady = false; interrupts();
    if (w > 0 && w < 30000) distCm = w / 58.0f;  // µs → cm (valid ≈ 2–400 cm)
  }

  // 3) IMU sample at 200 Hz
  uint32_t now = micros();
  if ((int32_t)(now - nextSampleUs) < 0) return;
  nextSampleUs += SAMPLE_PERIOD_US;

  imu.getSensorData();
  Serial.print(now);                    Serial.print(',');
  Serial.print(imu.data.accelX, 4);     Serial.print(',');
  Serial.print(imu.data.accelY, 4);     Serial.print(',');
  Serial.print(imu.data.accelZ, 4);     Serial.print(',');
  Serial.print(imu.data.gyroX, 3);      Serial.print(',');
  Serial.print(imu.data.gyroY, 3);      Serial.print(',');
  Serial.print(imu.data.gyroZ, 3);      Serial.print(',');
  if (!isnan(distCm)) Serial.print(distCm, 1);
  Serial.println();
}
