#pragma once

#include <Arduino.h>

class FeedbackManager {
 public:
  void begin();
  void success();
  void error();
  void warning();
  void wifiPulse();
  void quiet();

 private:
  void setLed(bool green, bool red);
  void toneFor(uint16_t frequency, uint16_t durationMs);
};
