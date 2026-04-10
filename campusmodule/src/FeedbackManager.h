#pragma once

#include <Arduino.h>

class FeedbackManager {
 public:
  struct Step {
    bool green = false;
    bool red = false;
    uint16_t frequency = 0;
    uint16_t durationMs = 0;
  };

  void begin();
  void update();
  void success();
  void error();
  void warning();
  void wifiPulse();
  void quiet();

 private:
  void startPattern(const Step *steps, size_t stepCount);
  void applyStep(const Step &step);
  void setLed(bool green, bool red);
  void toneFor(uint16_t frequency, uint16_t durationMs);

  const Step *activePattern_ = nullptr;
  size_t activeStepCount_ = 0;
  size_t activeStepIndex_ = 0;
  uint32_t stepStartedAt_ = 0;
  bool patternActive_ = false;
};
