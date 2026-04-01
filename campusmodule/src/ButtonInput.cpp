#include "ButtonInput.h"

#include "Pins.h"

namespace {
struct DebouncedButton {
  uint8_t pin;
  ButtonAction action;
  bool stableState = HIGH;
  bool lastReading = HIGH;
  uint32_t lastChangeAt = 0;
};

constexpr uint32_t kDebounceMs = 35;

DebouncedButton g_buttons[] = {
    {Pins::kButtonUp, ButtonAction::Up},
    {Pins::kButtonDown, ButtonAction::Down},
    {Pins::kButtonSelect, ButtonAction::Select},
    {Pins::kButtonBack, ButtonAction::Back},
};
}  // namespace

void ButtonInput::begin() {
  for (auto &button : g_buttons) {
    pinMode(button.pin, INPUT_PULLUP);
    const bool reading = digitalRead(button.pin);
    button.stableState = reading;
    button.lastReading = reading;
    button.lastChangeAt = millis();
  }
}

ButtonAction ButtonInput::poll() {
  const uint32_t now = millis();

  for (auto &button : g_buttons) {
    const bool reading = digitalRead(button.pin);
    if (reading != button.lastReading) {
      button.lastReading = reading;
      button.lastChangeAt = now;
    }

    if ((now - button.lastChangeAt) >= kDebounceMs &&
        button.stableState != button.lastReading) {
      button.stableState = button.lastReading;
      if (button.stableState == LOW) {
        return button.action;
      }
    }
  }

  return ButtonAction::None;
}
