#pragma once

#include <Arduino.h>

#include "AppTypes.h"

class StorageManager;

class TimeManager {
 public:
  bool begin(StorageManager &storage);
  bool syncWithNetwork(String &error);
  TimeSnapshot now();
  bool hasRtc() const;

 private:
  uint64_t estimatedEpoch() const;
  String iso8601(uint64_t epoch) const;

  StorageManager *storage_ = nullptr;
  bool rtcAvailable_ = false;
  bool networkSynced_ = false;
  uint64_t lastEpoch_ = 0;
  uint32_t epochCapturedAtMs_ = 0;
};
