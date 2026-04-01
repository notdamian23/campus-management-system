#include "FeedbackManager.h"

#include "Pins.h"

void FeedbackManager::begin() {
  pinMode(Pins::kGreenLed, OUTPUT);
  pinMode(Pins::kRedLed, OUTPUT);
  digitalWrite(Pins::kGreenLed, LOW);
  digitalWrite(Pins::kRedLed, LOW);

  ledcSetup(Pins::kBuzzerChannel, 2000, 8);
  ledcAttachPin(Pins::kBuzzer, Pins::kBuzzerChannel);
  quiet();
}

void FeedbackManager::success() {
  setLed(true, false);
  toneFor(2200, 90);
  delay(60);
  toneFor(2800, 90);
  setLed(false, false);
}

void FeedbackManager::error() {
  setLed(false, true);
  toneFor(600, 180);
  delay(70);
  toneFor(450, 220);
  setLed(false, false);
}

void FeedbackManager::warning() {
  setLed(false, true);
  toneFor(1200, 90);
  delay(50);
  toneFor(1200, 90);
  setLed(false, false);
}

void FeedbackManager::wifiPulse() {
  setLed(true, false);
  toneFor(1500, 40);
  setLed(false, false);
}

void FeedbackManager::quiet() {
  ledcWrite(Pins::kBuzzerChannel, 0);
  ledcWriteTone(Pins::kBuzzerChannel, 0);
}

void FeedbackManager::setLed(bool green, bool red) {
  digitalWrite(Pins::kGreenLed, green ? HIGH : LOW);
  digitalWrite(Pins::kRedLed, red ? HIGH : LOW);
}

void FeedbackManager::toneFor(uint16_t frequency, uint16_t durationMs) {
  ledcWriteTone(Pins::kBuzzerChannel, frequency);
  ledcWrite(Pins::kBuzzerChannel, 128);
  delay(durationMs);
  quiet();
}
