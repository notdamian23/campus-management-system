#pragma once

#include <Adafruit_Fingerprint.h>
#include <Arduino.h>

#include "AppTypes.h"

class FingerprintManager {
 public:
  FingerprintManager();

  bool begin(String &error);
  bool isReady() const;

  FingerprintMatch scanOnce();
  bool enrollTemplate(uint16_t templateId, String &error);
  bool deleteTemplate(uint16_t templateId, String &error);
  void waitForFingerRemoval(uint32_t timeoutMs = 3000);

 private:
  bool captureToSlot(uint8_t slot, uint32_t timeoutMs, String &error);
  String decodeError(uint8_t code) const;

  HardwareSerial serial_;
  Adafruit_Fingerprint finger_;
  bool ready_ = false;
};
