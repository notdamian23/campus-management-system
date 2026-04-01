#pragma once

#include <Arduino.h>

namespace Pins {
inline constexpr uint8_t kFingerprintTx = 17;
inline constexpr uint8_t kFingerprintRx = 16;

inline constexpr uint8_t kButtonUp = 32;
inline constexpr uint8_t kButtonDown = 33;
inline constexpr uint8_t kButtonSelect = 25;
inline constexpr uint8_t kButtonBack = 26;

inline constexpr uint8_t kGreenLed = 27;
inline constexpr uint8_t kRedLed = 14;
inline constexpr uint8_t kBuzzer = 13;
inline constexpr uint8_t kBuzzerChannel = 0;

inline constexpr uint8_t kI2cSda = 21;
inline constexpr uint8_t kI2cScl = 22;

inline constexpr uint8_t kSdCs = 5;
inline constexpr uint8_t kSdSck = 18;
inline constexpr uint8_t kSdMiso = 19;
inline constexpr uint8_t kSdMosi = 23;
}  // namespace Pins
