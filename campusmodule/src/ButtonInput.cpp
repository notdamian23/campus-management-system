#include "ButtonInput.h"

#include "Pins.h"

namespace {
struct DebouncedButton {
  uint8_t pin;
  ButtonAction action;
  bool stableState = HIGH;
  bool lastReading = HIGH;
  uint32_t lastChangeAt = 0;
  uint32_t lowSinceAt = 0;
  uint32_t lastStuckWarnAt = 0;
};

constexpr uint32_t kDebounceMs = 35;
constexpr uint32_t kStuckWarnMs = 2000;

DebouncedButton g_buttons[] = {
    {Pins::kButtonUp, ButtonAction::Up},
    {Pins::kButtonDown, ButtonAction::Down},
    {Pins::kButtonSelect, ButtonAction::Select},
    {Pins::kButtonBack, ButtonAction::Back},
};

const char *actionName(ButtonAction action) {
  switch (action) {
    case ButtonAction::Up:
      return "UP";
    case ButtonAction::Down:
      return "DOWN";
    case ButtonAction::Select:
      return "SELECT";
    case ButtonAction::Back:
      return "BACK";
    case ButtonAction::None:
    default:
      return "NONE";
  }
}
}  // namespace

void ButtonInput::begin() {
  Serial.println("[BUTTON] mode=INPUT_PULLUP active=LOW wiring=GPIO->button->GND");
  for (auto &button : g_buttons) {
    pinMode(button.pin, INPUT_PULLUP);
    const bool reading = digitalRead(button.pin);
    button.stableState = reading;
    button.lastReading = reading;
    button.lastChangeAt = millis();
    button.lowSinceAt = reading == LOW ? millis() : 0;
    button.lastStuckWarnAt = 0;
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
        button.lowSinceAt = now;
        button.lastStuckWarnAt = 0;
        Serial.printf("[BUTTON] action=%s pin=%u ms=%lu\n",
                      actionName(button.action), button.pin,
                      static_cast<unsigned long>(now));
        return button.action;
      }
      button.lowSinceAt = 0;
      button.lastStuckWarnAt = 0;
    }

    if (button.stableState == LOW) {
      if (button.lowSinceAt == 0) {
        button.lowSinceAt = now;
      }
      if ((now - button.lowSinceAt) >= kStuckWarnMs &&
          (button.lastStuckWarnAt == 0 ||
           (now - button.lastStuckWarnAt) >= kStuckWarnMs)) {
        Serial.printf("[BUTTON][WARN] stuck pin=%u\n", button.pin);
        button.lastStuckWarnAt = now;
      }
    } else {
      button.lowSinceAt = 0;
      button.lastStuckWarnAt = 0;
    }
  }

  return ButtonAction::None;
}
