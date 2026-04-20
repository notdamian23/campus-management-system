#pragma once

#include <Arduino.h>
#include <vector>

struct EventInfo {
  String eventId;
  String title;
  String date;
  String scheduledTime;
  String scheduledTimeEnd;
  String location;
  String status;
  String targetMode;
  String courseFilterLabel;
  String yearLevelFilterLabel;
  String sectionFilterLabel;
  std::vector<String> courseFilters;
  std::vector<String> yearLevelFilters;
  std::vector<String> sectionFilters;
  std::vector<String> targetedStudentIds;
  String bodScope;
  String bodScopeCanonical;
  bool requiresRegistration = false;
  bool preregistrationRequired = false;
  bool paymentRequired = false;
  bool activeOnly = false;
  bool timeOutFinalized = false;

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
  String section;
  String courseCanonical;
  String yearLevelCanonical;
  String sectionCanonical;
  String bodScope;
  String bodScopeCanonical;
  String sessionId;
  String queueId;
  String fingerprintStatus;
  String fingerprintDeviceId;
  String enrollmentStatus;
  String syncStatus;
  String remarks;
  String enrolledAtIso;
  int templateId = -1;
  bool isActive = true;
  bool activeKnown = false;
  bool preregistered = false;
  bool preregisteredKnown = false;
  bool paymentSatisfied = false;
  bool paymentKnown = false;
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
  String eventDate;
  String scheduledTimeStart;
  String scheduledTimeEnd;
  String eventLocation;
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
  uint64_t timeInEpoch = 0;
  String timeInIso;
  String timeInSource = "unknown";
  uint64_t timeOutEpoch = 0;
  String timeOutIso;
  String timeOutSource = "unknown";
  String attendanceStatus;
  String source = "portable-device";
  bool synced = false;
  bool syncRejected = false;
  bool remoteDuplicate = false;
  String syncError;
  uint32_t retryCount = 0;

  bool hasTimeIn() const {
    return timeInEpoch > 0 || !timeInIso.isEmpty();
  }

  bool hasTimeOut() const {
    return timeOutEpoch > 0 || !timeOutIso.isEmpty();
  }
};

struct SyncItemResult {
  String recordId;
  String status;
  String message;
};

enum class FingerprintOwnershipState : uint8_t {
  None,
  Unique,
  Duplicate,
};

struct FingerprintTemplateOwnership {
  FingerprintOwnershipState state = FingerprintOwnershipState::None;
  StudentInfo student;
  size_t activeOwners = 0;
  size_t totalMatches = 0;
};

struct CleanupQueueItem {
  String cleanupId;
  String type;
  int templateId = -1;
  String studentUid;
  String schoolId;
  String reason;
};

struct CleanupQueueResult {
  String cleanupId;
  bool processed = false;
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
