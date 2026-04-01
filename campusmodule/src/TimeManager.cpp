#include "TimeManager.h"

#include <time.h>

#include "Config.h"
#include "StorageManager.h"

#if CAMPUS_USE_RTC
#include <RTClib.h>
namespace {
RTC_DS3231 g_rtc;
}
#endif

bool TimeManager::begin(StorageManager &storage) {
  storage_ = &storage;
  lastEpoch_ = storage_->getLastKnownEpoch();
  epochCapturedAtMs_ = millis();

#if CAMPUS_USE_RTC
  if (CampusConfig::kUseRtc && g_rtc.begin()) {
    rtcAvailable_ = true;
    const DateTime rtcNow = g_rtc.now();
    if (rtcNow.year() >= 2024) {
      lastEpoch_ = rtcNow.unixtime();
      epochCapturedAtMs_ = millis();
      storage_->setLastKnownEpoch(lastEpoch_);
    } else if (lastEpoch_ > 0) {
      g_rtc.adjust(DateTime(static_cast<uint32_t>(lastEpoch_)));
    }
  }
#endif

  return true;
}

bool TimeManager::syncWithNetwork(String &error) {
  configTime(0, 0, CampusConfig::kNtpServerPrimary,
             CampusConfig::kNtpServerSecondary);

  const uint32_t startedAt = millis();
  while ((millis() - startedAt) < 10000) {
    time_t nowValue = time(nullptr);
    if (nowValue > 1704067200) {
      lastEpoch_ = static_cast<uint64_t>(nowValue);
      epochCapturedAtMs_ = millis();
      networkSynced_ = true;
      if (storage_ != nullptr) {
        storage_->setLastKnownEpoch(lastEpoch_);
      }
#if CAMPUS_USE_RTC
      if (rtcAvailable_) {
        g_rtc.adjust(DateTime(static_cast<uint32_t>(lastEpoch_)));
      }
#endif
      return true;
    }
    delay(250);
  }

  error = "Time sync failed";
  return false;
}

TimeSnapshot TimeManager::now() {
  TimeSnapshot snapshot;
  uint64_t epoch = 0;
  String source = "unknown";

#if CAMPUS_USE_RTC
  if (rtcAvailable_) {
    const DateTime rtcNow = g_rtc.now();
    if (rtcNow.year() >= 2024) {
      epoch = rtcNow.unixtime();
      source = "rtc";
    }
  }
#endif

  if (epoch == 0 && lastEpoch_ > 0) {
    epoch = estimatedEpoch();
    source = networkSynced_ ? "ntp" : "estimated";
  }

  snapshot.epoch = epoch;
  snapshot.valid = epoch > 0;
  snapshot.source = source;
  snapshot.iso8601 = snapshot.valid ? iso8601(epoch) : "";
  return snapshot;
}

bool TimeManager::hasRtc() const {
  return rtcAvailable_;
}

uint64_t TimeManager::estimatedEpoch() const {
  if (lastEpoch_ == 0) {
    return 0;
  }
  return lastEpoch_ + ((millis() - epochCapturedAtMs_) / 1000ULL);
}

String TimeManager::iso8601(uint64_t epoch) const {
  time_t raw = static_cast<time_t>(epoch);
  struct tm tmValue;
  gmtime_r(&raw, &tmValue);

  char buffer[25];
  snprintf(buffer, sizeof(buffer), "%04d-%02d-%02dT%02d:%02d:%02dZ",
           tmValue.tm_year + 1900, tmValue.tm_mon + 1, tmValue.tm_mday,
           tmValue.tm_hour, tmValue.tm_min, tmValue.tm_sec);
  return String(buffer);
}
