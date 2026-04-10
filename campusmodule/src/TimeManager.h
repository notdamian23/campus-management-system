#pragma once

#include <Arduino.h>

#include "AppTypes.h"

class StorageManager;

enum class TimeSyncResult : uint8_t {
  Idle,
  InProgress,
  Synced,
  Failed,
};

class TimeManager {
 public:
  bool begin(StorageManager &storage);
  void beginNetworkSync(uint32_t timeoutMs);
  TimeSyncResult pollNetworkSync(String &error);
  bool syncWithNetwork(String &error);
  TimeSnapshot now();
  bool hasRtc() const;
  bool isNetworkSynced() const;

 private:
  uint64_t estimatedEpoch() const;
  String iso8601(uint64_t epoch) const;

  StorageManager *storage_ = nullptr;
  bool rtcAvailable_ = false;
  bool networkSynced_ = false;
  bool networkSyncPending_ = false;
  uint64_t lastEpoch_ = 0;
  uint32_t epochCapturedAtMs_ = 0;
  uint32_t networkSyncStartedAtMs_ = 0;
  uint32_t networkSyncTimeoutMs_ = 0;
};
