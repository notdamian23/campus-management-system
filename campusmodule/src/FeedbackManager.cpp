#include "FeedbackManager.h"

#include "Pins.h"

namespace {
constexpr FeedbackManager::Step kSuccessPattern[] = {
    {true, false, 2200, 90},
    {true, false, 0, 60},
    {true, false, 2800, 90},
};

constexpr FeedbackManager::Step kErrorPattern[] = {
    {false, true, 600, 180},
    {false, true, 0, 70},
    {false, true, 450, 220},
};

constexpr FeedbackManager::Step kWarningPattern[] = {
    {false, true, 1200, 90},
    {false, true, 0, 50},
    {false, true, 1200, 90},
};

constexpr FeedbackManager::Step kWifiPulsePattern[] = {
    {true, false, 1500, 40},
};
}  // namespace

void FeedbackManager::begin() {
  pinMode(Pins::kGreenLed, OUTPUT);
  pinMode(Pins::kRedLed, OUTPUT);
  digitalWrite(Pins::kGreenLed, LOW);
  digitalWrite(Pins::kRedLed, LOW);

  ledcSetup(Pins::kBuzzerChannel, 2000, 8);
  ledcAttachPin(Pins::kBuzzer, Pins::kBuzzerChannel);
  quiet();
}

void FeedbackManager::update() {
  if (!patternActive_ || activePattern_ == nullptr || activeStepIndex_ >= activeStepCount_) {
    return;
  }

  if ((millis() - stepStartedAt_) < activePattern_[activeStepIndex_].durationMs) {
    return;
  }

  ++activeStepIndex_;
  if (activeStepIndex_ >= activeStepCount_) {
    quiet();
    setLed(false, false);
    patternActive_ = false;
    activePattern_ = nullptr;
    activeStepCount_ = 0;
    return;
  }

  applyStep(activePattern_[activeStepIndex_]);
}

void FeedbackManager::success() {
  startPattern(kSuccessPattern,
               sizeof(kSuccessPattern) / sizeof(kSuccessPattern[0]));
}

void FeedbackManager::error() {
  startPattern(kErrorPattern, sizeof(kErrorPattern) / sizeof(kErrorPattern[0]));
}

void FeedbackManager::warning() {
  startPattern(kWarningPattern,
               sizeof(kWarningPattern) / sizeof(kWarningPattern[0]));
}

void FeedbackManager::wifiPulse() {
  startPattern(kWifiPulsePattern,
               sizeof(kWifiPulsePattern) / sizeof(kWifiPulsePattern[0]));
}

void FeedbackManager::quiet() {
  ledcWrite(Pins::kBuzzerChannel, 0);
  ledcWriteTone(Pins::kBuzzerChannel, 0);
}

void FeedbackManager::startPattern(const Step *steps, size_t stepCount) {
  activePattern_ = steps;
  activeStepCount_ = stepCount;
  activeStepIndex_ = 0;
  patternActive_ = stepCount > 0;
  if (!patternActive_) {
    quiet();
    setLed(false, false);
    return;
  }

  applyStep(activePattern_[0]);
}

void FeedbackManager::applyStep(const Step &step) {
  setLed(step.green, step.red);
  toneFor(step.frequency, step.durationMs);
  stepStartedAt_ = millis();
}

void FeedbackManager::setLed(bool green, bool red) {
  digitalWrite(Pins::kGreenLed, green ? HIGH : LOW);
  digitalWrite(Pins::kRedLed, red ? HIGH : LOW);
}

void FeedbackManager::toneFor(uint16_t frequency, uint16_t durationMs) {
  if (frequency == 0 || durationMs == 0) {
    quiet();
    return;
  }

  ledcWriteTone(Pins::kBuzzerChannel, frequency);
  ledcWrite(Pins::kBuzzerChannel, 128);
}
