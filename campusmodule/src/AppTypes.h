#pragma once

#include <Arduino.h>

struct EventInfo {
  String eventId;
  String title;
  String date;
  String scheduledTime;
  String location;
  String status;
  bool requiresRegistration = false;

  bool isValid() const {
    return !eventId.isEmpty();
  }
};

struct EnrollmentSessionInfo {
  String sessionId;
  String createdBy;
  String createdByName;
  String createdBySchoolId;
  String status;
  String pairedDeviceId;
  int totalStudents = 0;
  int pendingCount = 0;
  int downloadedCount = 0;
  int enrolledCount = 0;
  int syncedCount = 0;
  int failedCount = 0;

  bool isValid() const {
    return !sessionId.isEmpty();
  }
};

struct StudentInfo {
  String studentUid;
  String schoolId;
  String studentName;
  String course;
  String yearLevel;
  String sessionId;
  String queueId;
  String fingerprintStatus;
  String fingerprintDeviceId;
  String enrollmentStatus;
  String syncStatus;
  String remarks;
  String enrolledAtIso;
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
  String yearLevel;
  int templateId = -1;
  String deviceId;
  uint64_t capturedAtEpoch = 0;
  String capturedAtIso;
  String timeSource = "unknown";
  String source = "portable-device";
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
