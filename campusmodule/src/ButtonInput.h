#pragma once

#include <Arduino.h>

enum class ButtonAction : uint8_t {
  None,
  Up,
  Down,
  Select,
  Back,
};

class ButtonInput {
 public:
  void begin();
  ButtonAction poll();
};
