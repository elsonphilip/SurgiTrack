// SurgiTrack IMU streamer — Arduino UNO R4 WiFi + BMI270 (I2C / Qwiic)
// Library: "SparkFun BMI270 Arduino Library" (Library Manager)
// Output: one CSV line per sample over USB serial:  t_us,ax,ay,az,gx,gy,gz
//   accel in g, gyro in deg/s, t_us = micros() on the Arduino.
// NOT yet tested on hardware — verify wiring/address (0x68 default, 0x69 if SDO high).

#include <Wire.h>
#include "SparkFun_BMI270_Arduino_Library.h"

const uint32_t BAUD = 460800;
const uint32_t SAMPLE_PERIOD_US = 5000;  // 200 Hz
const uint8_t IMU_ADDR = 0x68;

BMI270 imu;
uint32_t nextSample = 0;

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

  Serial.println("# surgitrack_imu v1 fields=t_us,ax,ay,az,gx,gy,gz");
  nextSample = micros();
}

void loop() {
  uint32_t now = micros();
  if ((int32_t)(now - nextSample) < 0) return;
  nextSample += SAMPLE_PERIOD_US;

  imu.getSensorData();
  Serial.print(now);            Serial.print(',');
  Serial.print(imu.data.accelX, 4); Serial.print(',');
  Serial.print(imu.data.accelY, 4); Serial.print(',');
  Serial.print(imu.data.accelZ, 4); Serial.print(',');
  Serial.print(imu.data.gyroX, 3);  Serial.print(',');
  Serial.print(imu.data.gyroY, 3);  Serial.print(',');
  Serial.println(imu.data.gyroZ, 3);

  // TODO: haptic trigger — read a one-byte command from the Pi and drive the DRV2605L.
}
