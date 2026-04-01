#pragma once

#include <Arduino.h>

struct EventInfo {
  String eventId;
  String title;
  String date;
  String scheduledTime;
  String location;
  String status;

  bool isValid() const {
    return !eventId.isEmpty();
  }
};

struct StudentInfo {
  String studentUid;
  String schoolId;
  String studentName;
  String course;
  String year;
  int templateId = -1;
  bool enrollmentSynced = false;

  bool isValid() const {
    return !studentUid.isEmpty();
  }
};

struct TimeSnapshot {
  uint64_t epoch = 0;
  String iso8601;
  String source = "unknown";
  bool valid = false;
};

struct AttendanceRecord {
  String recordId;
  String eventId;
  String eventTitle;
  String studentUid;
  String schoolId;
  String studentName;
  String course;
  String year;
  int templateId = -1;
  String deviceId;
  uint64_t capturedAtEpoch = 0;
  String capturedAtIso;
  String timeSource = "unknown";
  bool synced = false;
  bool remoteDuplicate = false;
  String syncError;
  uint32_t retryCount = 0;
};

struct SyncItemResult {
  String recordId;
  String status;
  String message;
};

enum class FingerprintScanStatus : uint8_t {
  NoFinger,
  Matched,
  NotFound,
  Error,
};

struct FingerprintMatch {
  FingerprintScanStatus status = FingerprintScanStatus::NoFinger;
  int templateId = -1;
  int confidence = 0;
  String message;
};
