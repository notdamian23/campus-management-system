#include <Arduino.h>
#include <esp_heap_caps.h>
#include <time.h>
#include <Wire.h>

#include <vector>

#include <CampusEligibility.h>

#include "AttendanceManager.h"
#include "BackendClient.h"
#include "ButtonInput.h"
#include "Config.h"
#include "DisplayManager.h"
#include "FeedbackManager.h"
#include "FingerprintManager.h"
#include "Pins.h"
#include "StorageManager.h"
#include "TimeManager.h"
#include "WifiManager.h"

namespace {
ButtonInput g_buttons;
DisplayManager g_display;
FeedbackManager g_feedback;
FingerprintManager g_fingerprint;
StorageManager g_storage;
WifiManager g_wifi;
TimeManager g_time;
BackendClient g_backend;
AttendanceManager g_attendance(g_storage, g_time);

EventInfo g_pairedEvent;
EnrollmentSessionInfo g_currentEnrollmentSession;
int g_menuIndex = 0;
int g_pairEventIndex = 0;
int g_enrollmentSessionIndex = 0;
int g_pendingStudentIndex = 0;
int g_attendanceModeIndex = 0;
int g_syncRecordsMenuIndex = 0;
int g_timeOutConfirmIndex = 1;
int g_clearPairConfirmIndex = 1;
std::vector<EventInfo> g_cachedAvailableEvents;
std::vector<StudentInfo> g_cachedPendingStudents;
std::vector<StudentInfo> g_cachedPairedStudents;
std::vector<EnrollmentSessionInfo> g_cachedEnrollmentSessions;
std::vector<String> g_remoteRecordedStudentIds;
EnrollmentQueueStats g_enrollmentQueueStats;
size_t g_enrollmentQueuePageOffset = 0;
bool g_enrollmentQueuePagedFromSd = false;
bool g_pairedEventRecoveredFromAttendance = false;

constexpr const char *kMenuItems[] = {
    "Pair Event",
    "Enroll Student",
    "Attendance Mode",
    "Sync Records",
    "Export Backup",
    "Clear Paired Event",
    "Wi-Fi Setup",
};
constexpr size_t kMenuItemCount = sizeof(kMenuItems) / sizeof(kMenuItems[0]);
constexpr const char *kAttendanceModeItems[] = {
    "Time in",
    "Time out",
};
constexpr size_t kAttendanceModeItemCount =
    sizeof(kAttendanceModeItems) / sizeof(kAttendanceModeItems[0]);
constexpr const char *kSyncRecordsMenuItems[] = {
    "Attendance Only",
    "Enrollment Only",
    "Fingerprint Roster",
    "Paired Event Data",
    "Cleanup Queue",
    "Full Sync",
    "Back",
};
constexpr size_t kSyncRecordsMenuItemCount =
    sizeof(kSyncRecordsMenuItems) / sizeof(kSyncRecordsMenuItems[0]);
constexpr uint32_t kUiActionGapMs = 140;
constexpr uint32_t kShortMessageMs = 1200;
constexpr uint32_t kMediumMessageMs = 1500;
constexpr uint32_t kLongMessageMs = 1800;
constexpr uint32_t kDebugIntervalMs = 30000;
constexpr uint32_t kFingerRemovalTimeoutMs = 3000;
constexpr uint32_t kAutoSyncQuietPeriodMs = 5000;
constexpr uint32_t kMaxAutoSyncBackoffMs = 15UL * 60UL * 1000UL;
constexpr size_t kEnrollmentQueuePageSize = 6;

enum class AppScreen : uint8_t {
  Menu,
  PairEventSelection,
  EnrollmentSessionSelection,
  EnrollmentStudentSelection,
  AttendanceMenu,
  SyncRecordsMenu,
  TimeOutConfirmation,
  ClearPairConfirmation,
  AttendanceScan,
  SyncProgress,
};

enum class AttendanceCaptureMode : uint8_t {
  None,
  TimeIn,
  TimeOut,
};

enum class SyncMode : uint8_t {
  None,
  Auto,
  AttendanceOnly,
  EnrollmentOnly,
  FingerprintRoster,
  PairedEventData,
  CleanupQueue,
  Full,
};

enum class SyncPhase : uint8_t {
  Idle,
  WaitForWifi,
  WaitForTime,
  UploadEnrollment,
  UploadAttendance,
  CleanupMappings,
  RefreshContext,
  DownloadFingerprintRoster,
  Complete,
};

struct TimedMessage {
  bool active = false;
  uint32_t endsAt = 0;
  String line1;
  String line2;
  String line3;
  String line4;
};

struct SyncController {
  SyncMode mode = SyncMode::None;
  SyncPhase phase = SyncPhase::Idle;
  bool keepWifiConnected = false;
  bool timeSyncStarted = false;
  bool contextRefreshNeeded = false;
  size_t enrollmentAttempts = 0;
  size_t enrollmentUploads = 0;
  size_t attendanceAttempts = 0;
  size_t attendanceUploads = 0;
  size_t duplicates = 0;
  size_t rejections = 0;
  size_t cleanupProcessed = 0;
  size_t rosterRows = 0;
  bool rosterDownloaded = false;
  bool cleanupQueueLoaded = false;
  std::vector<CleanupQueueItem> cleanupQueue;
  String lastError;
  String lastFailureStage;
};

AppScreen g_screen = AppScreen::Menu;
TimedMessage g_message;
SyncController g_sync;
uint32_t g_lastUiActionAt = 0;
uint32_t g_lastAutoSyncAttemptAt = 0;
uint32_t g_autoSyncBackoffMs = CampusConfig::kAutoSyncIntervalMs;
uint32_t g_lastAttendancePollAt = 0;
uint32_t g_fingerRemovalDeadlineAt = 0;
uint32_t g_lastDebugLogAt = 0;
bool g_displayDirty = true;
bool g_waitingForFingerRemoval = false;
size_t g_lastAttendancePromptUnsyncedCount = static_cast<size_t>(-1);
String g_lastFingerprintState = "boot";
AttendanceCaptureMode g_attendanceCaptureMode = AttendanceCaptureMode::None;

void showTimedMessage(const String &line1, const String &line2, uint32_t holdMs,
                      const String &line3 = "", const String &line4 = "");
void loadStoredPairedEventContext();
bool loadEnrollmentQueuePage(size_t offset);
bool hasOfflineEnrollmentQueue();
bool recoverPairedEventFromAttendance(EventInfo &event);
void addBackupEventCandidate(const AttendanceRecord &record,
                             std::vector<EventInfo> &events);
bool upsertCachedPairedStudent(const StudentInfo &student);
void startFingerRemovalWait();
bool hasPendingSyncWork();

String trim16(const String &value) {
  String output = value;
  output.trim();
  if (output.length() > CampusConfig::kLcdColumns) {
    output = output.substring(0, CampusConfig::kLcdColumns);
  }
  return output;
}

void wrapMessage(const String &message, String (&lines)[4]) {
  for (auto &line : lines) {
    line = "";
  }

  String remaining = message;
  remaining.trim();
  for (size_t lineIndex = 0; lineIndex < 4 && !remaining.isEmpty(); ++lineIndex) {
    if (remaining.length() <= CampusConfig::kLcdColumns) {
      lines[lineIndex] = remaining;
      break;
    }

    int splitAt = CampusConfig::kLcdColumns;
    while (splitAt > 0 && remaining[splitAt] != ' ') {
      --splitAt;
    }
    if (splitAt <= 0) {
      splitAt = CampusConfig::kLcdColumns;
    }

    lines[lineIndex] = remaining.substring(0, splitAt);
    lines[lineIndex].trim();
    remaining = remaining.substring(splitAt);
    remaining.trim();
  }
}

void showWrappedMessage(const String &message, uint32_t holdMs) {
  String lines[4];
  wrapMessage(message, lines);
  showTimedMessage(lines[0], lines[1], holdMs, lines[2], lines[3]);
}

String eligibilityTargetModeLabel(const EventInfo &event) {
  EventInfo normalized = event;
  CampusEligibility::normalizeEvent(normalized);
  return normalized.targetMode.isEmpty() ? "unknown" : normalized.targetMode;
}

bool pairedEventNeedsStudentContext(const EventInfo &event) {
  return CampusEligibility::requiresPairedStudentContext(event);
}

void logEligibilityDecision(
    int templateId, const StudentInfo &student, const EventInfo &event,
    const CampusEligibility::EventEligibilityDecision &decision) {
  Serial.printf(
      "[ATTEND][ELIG] templateId=%d eventId=%s title=%s uid=%s schoolId=%s "
      "name=%s course=%s year=%s section=%s normCourse=%s normYear=%s "
      "normSection=%s targetMode=%s targetStudent=%s "
      "selectedStudentCount=%u selectedSchoolCount=%u rosterRequired=%s "
      "rosterRequiredHint=%s audienceRestricted=%s rosterAvailable=%s "
      "matchedPairedRoster=%s eventCourse=%s eventYear=%s eventSection=%s "
      "preregRequired=%s paymentRequired=%s activeOnly=%s schema=%u "
      "inactiveBlocked=%s preregBlocked=%s paymentBlocked=%s bodBlocked=%s "
      "allowed=%s stalePairing=%s finalReason=%s\n",
      templateId, event.eventId.c_str(), event.title.c_str(),
      student.studentUid.c_str(), student.schoolId.c_str(),
      student.studentName.c_str(), student.course.c_str(),
      student.yearLevel.c_str(), student.section.c_str(),
      decision.normalizedStudentCourse.c_str(),
      decision.normalizedStudentYearLevel.c_str(),
      decision.normalizedStudentSection.c_str(),
      eligibilityTargetModeLabel(event).c_str(), event.targetStudent.c_str(),
      static_cast<unsigned>(event.targetedStudentIds.size()),
      static_cast<unsigned>(event.targetedSchoolIds.size()),
      decision.rosterRequired ? "yes" : "no",
      event.rosterRequired ? "yes" : "no",
      event.audienceRestricted ? "yes" : "no",
      decision.rosterAvailable ? "yes" : "no",
      decision.matchedPairedRoster ? "yes" : "no",
      decision.eventCourseFilter.c_str(), decision.eventYearLevelFilter.c_str(),
      decision.eventSectionFilter.c_str(),
      event.preregistrationRequired || event.requiresRegistration ? "yes" : "no",
      event.paymentRequired ? "yes" : "no", event.activeOnly ? "yes" : "no",
      static_cast<unsigned>(event.contextSchemaVersion),
      decision.blockedByInactive ? "yes" : "no",
      decision.blockedByPrereg ? "yes" : "no",
      decision.blockedByPayment ? "yes" : "no",
      decision.blockedByBodScope ? "yes" : "no",
      decision.allowed ? "yes" : "no",
      decision.stalePairedEventData ? "yes" : "no",
      decision.finalReason.c_str());
}

void logQuickMemory(const char *label) {
  const uint32_t freeHeap = ESP.getFreeHeap();
  const uint32_t largestBlock =
      heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  Serial.printf("[MEM] %s free=%u largest=%u\n", label,
                static_cast<unsigned>(freeHeap),
                static_cast<unsigned>(largestBlock));
}

void logDetailedMemory(const char *label) {
  const uint32_t freeHeap = ESP.getFreeHeap();
  const uint32_t largestBlock =
      heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  const uint32_t minHeap = ESP.getMinFreeHeap();
  Serial.printf("[MEM] %s free=%u largest=%u min=%u\n", label,
                static_cast<unsigned>(freeHeap),
                static_cast<unsigned>(largestBlock),
                static_cast<unsigned>(minHeap));
}

String backendEligibilityTitle(const String &reason) {
  if (reason == "payment_required") {
    return "PAYMENT REQUIRED";
  }
  if (reason == "registration_required") {
    return "PREREG REQUIRED";
  }
  if (reason == "inactive_student") {
    return "INACTIVE";
  }
  if (reason == "bod_scope_mismatch") {
    return "BOD RESTRICTED";
  }
  return "NOT ELIGIBLE";
}

String backendEligibilityDetail(const String &reason) {
  if (reason == "not_selected_student") {
    return "Not selected";
  }
  if (reason == "not_target_student") {
    return "Not targeted";
  }
  if (reason == "not_target_course") {
    return "Course mismatch";
  }
  if (reason == "not_target_year") {
    return "Year mismatch";
  }
  if (reason == "not_target_section") {
    return "Section mismatch";
  }
  if (reason == "registration_required") {
    return "Pre-reg required";
  }
  if (reason == "payment_required") {
    return "Payment required";
  }
  if (reason == "inactive_student") {
    return "Account inactive";
  }
  if (reason == "bod_scope_mismatch") {
    return "Scope mismatch";
  }
  return "See operator";
}

bool applyPairedEventStudentContext(StudentInfo &student) {
  if (!g_pairedEvent.isValid()) {
    return false;
  }

  StudentInfo pairedStudent;
  if (!g_storage.findPairedEventStudent(g_pairedEvent.eventId, student.studentUid,
                                        student.schoolId, pairedStudent)) {
    return false;
  }

  if (!pairedStudent.studentUid.isEmpty()) {
    student.studentUid = pairedStudent.studentUid;
  }
  if (!pairedStudent.schoolId.isEmpty()) {
    student.schoolId = pairedStudent.schoolId;
  }
  if (!pairedStudent.studentName.isEmpty()) {
    student.studentName = pairedStudent.studentName;
  }
  if (!pairedStudent.course.isEmpty()) {
    student.course = pairedStudent.course;
  }
  if (!pairedStudent.yearLevel.isEmpty()) {
    student.yearLevel = pairedStudent.yearLevel;
  }
  if (!pairedStudent.section.isEmpty()) {
    student.section = pairedStudent.section;
  }
  if (!pairedStudent.bodScope.isEmpty()) {
    student.bodScope = pairedStudent.bodScope;
  }
  if (!pairedStudent.queueId.isEmpty()) {
    student.queueId = pairedStudent.queueId;
  }

  CampusEligibility::normalizeStudent(student);
  return true;
}

bool handleOwnershipLookupFailure(int templateId, const String &line1,
                                  const String &line2,
                                  const String &line3 = "",
                                  const String &line4 = "") {
  Serial.printf("[ATTEND] owner sync required template=%d\n", templateId);
  showTimedMessage(line1, line2, kMediumMessageMs, line3, line4);
  g_feedback.error();
  startFingerRemovalWait();
  return false;
}

bool resolveAttendanceOwnerForMatch(const FingerprintMatch &match,
                                    StudentInfo &student,
                                    bool &backendEligibilityKnown,
                                    bool &backendEventAllowed,
                                    String &backendReason) {
  backendEligibilityKnown = false;
  backendEventAllowed = false;
  backendReason = "";

  const FingerprintTemplateOwnership localOwnership =
      g_storage.resolveTemplateOwnership(match.templateId);
  if (localOwnership.state == FingerprintOwnershipState::Duplicate) {
    Serial.printf("[ATTEND] template=%d ownership=duplicate active=%u total=%u\n",
                  match.templateId,
                  static_cast<unsigned>(localOwnership.activeOwners),
                  static_cast<unsigned>(localOwnership.totalMatches));
    showTimedMessage("Duplicate FP", "Fix Required", kMediumMessageMs);
    g_feedback.error();
    startFingerRemovalWait();
    return false;
  }
  if (localOwnership.state == FingerprintOwnershipState::Unique) {
    student = localOwnership.student;
    return true;
  }

  Serial.printf("[ATTEND] local ownership lookup failed template=%d totalMatches=%u\n",
                match.templateId,
                static_cast<unsigned>(localOwnership.totalMatches));

  Serial.printf("[ATTEND] SD ownership lookup started template=%d\n",
                match.templateId);
  logQuickMemory("before SD ownership lookup");
  const FingerprintTemplateOwnership sdOwnership =
      g_storage.resolveTemplateOwnershipFromSd(match.templateId);
  logQuickMemory("after SD ownership lookup");
  if (sdOwnership.state == FingerprintOwnershipState::Duplicate) {
    Serial.printf(
        "[ATTEND] template=%d ownership=duplicate active=%u total=%u source=sd\n",
        match.templateId, static_cast<unsigned>(sdOwnership.activeOwners),
        static_cast<unsigned>(sdOwnership.totalMatches));
    showTimedMessage("Duplicate FP", "Fix Required", kMediumMessageMs);
    g_feedback.error();
    startFingerRemovalWait();
    return false;
  }
  if (sdOwnership.state == FingerprintOwnershipState::Unique) {
    student = sdOwnership.student;
    Serial.printf("[ATTEND] SD owner found template=%d name=%s\n",
                  match.templateId, student.studentName.c_str());
    if (g_storage.upsertFingerprintMappingCacheOnly(student)) {
      Serial.printf(
          "[ATTEND] local fingerprint map updated template=%d student=%s source=sd\n",
          match.templateId, student.studentUid.c_str());
    }
    return true;
  }

  Serial.printf("[ATTEND] SD owner not found template=%d\n", match.templateId);
  if (!g_wifi.isConnected()) {
    return handleOwnershipLookupFailure(match.templateId, "Owner sync", "required",
                                        "Connect Wi-Fi", "");
  }

  Serial.printf("[ATTEND] backend ownership fallback started template=%d\n",
                match.templateId);
  AttendanceOwnerResolution resolution;
  String error;
  if (!g_backend.resolveAttendanceOwner(match.templateId, g_pairedEvent.eventId,
                                        resolution, error)) {
    Serial.printf("[ATTEND] backend owner lookup failed template=%d error=%s\n",
                  match.templateId, error.c_str());
    return handleOwnershipLookupFailure(match.templateId, "Owner sync", "required",
                                        trim16(error), "");
  }

  if (!resolution.ownerFound) {
    if (resolution.reason == "duplicate_owner_conflict") {
      Serial.printf(
          "[ATTEND] backend owner not found template=%d reason=%s\n",
          match.templateId, resolution.reason.c_str());
      showTimedMessage("Duplicate FP", "Fix Required", kMediumMessageMs,
                       "Backend conflict", "");
      g_feedback.error();
      startFingerRemovalWait();
      return false;
    }

    Serial.printf("[ATTEND] backend owner not found template=%d reason=%s\n",
                  match.templateId, resolution.reason.c_str());
    return handleOwnershipLookupFailure(match.templateId, "Owner Not Found",
                                        "Sync roster",
                                        trim16(resolution.reason), "");
  }

  student = resolution.student;
  backendEligibilityKnown = true;
  backendEventAllowed = resolution.eventAllowed;
  backendReason = resolution.reason;
  Serial.printf("[ATTEND] backend owner found template=%d name=%s\n",
                match.templateId, student.studentName.c_str());
  if (g_storage.upsertFingerprintMappingCacheOnly(student)) {
    Serial.printf(
        "[ATTEND] local fingerprint map updated template=%d student=%s source=backend\n",
        match.templateId, student.studentUid.c_str());
  }
  if (backendEventAllowed) {
    upsertCachedPairedStudent(student);
  }
  return true;
}

bool upsertCachedPairedStudent(const StudentInfo &student) {
  bool updated = false;
  for (auto &pairedStudent : g_cachedPairedStudents) {
    if (pairedStudent.studentUid == student.studentUid) {
      pairedStudent = student;
      updated = true;
      break;
    }
  }

  if (!updated) {
    g_cachedPairedStudents.push_back(student);
  }

  if (!g_pairedEvent.isValid()) {
    return updated;
  }

  g_storage.savePairedEventContext(g_pairedEvent, g_cachedPairedStudents,
                                   g_remoteRecordedStudentIds);
  return true;
}

String attendanceModeLabel(AttendanceCaptureMode mode) {
  switch (mode) {
    case AttendanceCaptureMode::TimeOut:
      return "Time Out";
    case AttendanceCaptureMode::TimeIn:
      return "Time In";
    case AttendanceCaptureMode::None:
    default:
      return "Idle";
  }
}

bool isTimeOutMode() {
  return g_attendanceCaptureMode == AttendanceCaptureMode::TimeOut;
}

bool isTimeOutFinalizedForCurrentEvent() {
  return g_pairedEvent.isValid() && g_pairedEvent.timeOutFinalized;
}

void persistPairedEventState() {
  if (!g_pairedEvent.isValid()) {
    return;
  }
  g_storage.savePairedEventContext(g_pairedEvent, g_cachedPairedStudents,
                                   g_remoteRecordedStudentIds);
}

bool parseTimeText(const String &value, int &hour, int &minute) {
  String text = value;
  text.trim();
  if (text.isEmpty()) {
    return false;
  }

  String upper = text;
  upper.toUpperCase();
  bool isPm = upper.endsWith("PM");
  bool isAm = upper.endsWith("AM");
  if (isPm || isAm) {
    upper = upper.substring(0, upper.length() - 2);
    upper.trim();
  }

  const int colonIndex = upper.indexOf(':');
  if (colonIndex < 0) {
    return false;
  }

  hour = upper.substring(0, colonIndex).toInt();
  minute = upper.substring(colonIndex + 1).toInt();
  if (minute < 0 || minute > 59) {
    return false;
  }

  if (isAm || isPm) {
    if (hour < 1 || hour > 12) {
      return false;
    }
    if (isPm && hour < 12) {
      hour += 12;
    }
    if (isAm && hour == 12) {
      hour = 0;
    }
  } else if (hour < 0 || hour > 23) {
    return false;
  }

  return true;
}

bool parseEventDateTime(const String &date, const String &timeText, uint64_t &epoch) {
  int year = 0;
  int month = 0;
  int day = 0;
  if (sscanf(date.c_str(), "%d-%d-%d", &year, &month, &day) != 3) {
    return false;
  }

  int hour = 0;
  int minute = 0;
  if (!parseTimeText(timeText, hour, minute)) {
    return false;
  }

  struct tm tmValue = {};
  tmValue.tm_year = year - 1900;
  tmValue.tm_mon = month - 1;
  tmValue.tm_mday = day;
  tmValue.tm_hour = hour;
  tmValue.tm_min = minute;
  tmValue.tm_sec = 0;

  const time_t localEpoch = mktime(&tmValue);
  if (localEpoch < 0) {
    return false;
  }

  epoch = static_cast<uint64_t>(localEpoch) - CampusConfig::kUtcOffsetSeconds;
  return true;
}

bool isPastEventEndTime(const EventInfo &event) {
  if (!event.isValid() || event.scheduledTimeEnd.isEmpty()) {
    return false;
  }

  const TimeSnapshot now = g_time.now();
  if (!now.valid) {
    return false;
  }

  uint64_t eventEndEpoch = 0;
  if (!parseEventDateTime(event.date, event.scheduledTimeEnd, eventEndEpoch)) {
    return false;
  }

  return now.epoch >= eventEndEpoch;
}

void showTimeInBlockedMessage(const EventInfo &event) {
  const String startsAt =
      trim16(event.scheduledTime.isEmpty() ? "Unknown" : event.scheduledTime);
  showTimedMessage("TIME IN not", "allowed yet", kLongMessageMs, "Starts at:",
                   startsAt);
}

void resetPairedEventState() {
  g_pairedEvent = EventInfo{};
  g_cachedPairedStudents.clear();
  g_remoteRecordedStudentIds.clear();
  g_pairedEventRecoveredFromAttendance = false;
  g_attendanceCaptureMode = AttendanceCaptureMode::None;
}

bool clearPairedEventIfSafe(String &message) {
  if (!g_pairedEvent.isValid()) {
    return true;
  }

  if (g_pairedEvent.scheduledTimeEnd.isEmpty()) {
    message = "Paired event data invalid.";
    return false;
  }

  const TimeSnapshot now = g_time.now();
  if (!now.valid) {
    message = "Paired event data invalid.";
    return false;
  }

  if (!isPastEventEndTime(g_pairedEvent)) {
    message = "Module already paired to an active event.";
    return false;
  }

  // Attendance records keep their own event metadata, so finished events can be
  // replaced without losing pending offline sync data.
  if (!g_storage.clearPairedEvent()) {
    message = "Unable to clear paired event.";
    return false;
  }

  resetPairedEventState();
  return true;
}

bool canPairNewEvent(String &message) {
  loadStoredPairedEventContext();
  if (!g_pairedEvent.isValid()) {
    if (g_storage.unsyncedAttendanceCount() > 0) {
      message = "Unsynced attendance exists but paired event data is incomplete";
      return false;
    }
    return true;
  }

  return clearPairedEventIfSafe(message);
}

bool canAdminClearPairedEvent(String &message) {
  loadStoredPairedEventContext();
  if (g_storage.unsyncedAttendanceCount() > 0) {
    message = "Cannot clear while unsynced attendance exists.";
    return false;
  }

  message = "";
  return true;
}

bool isSyncActive() {
  return g_sync.mode != SyncMode::None;
}

bool isAttendanceScreen() {
  return g_screen == AppScreen::AttendanceMenu ||
         g_screen == AppScreen::TimeOutConfirmation ||
         g_screen == AppScreen::AttendanceScan;
}

void markDisplayDirty() {
  g_displayDirty = true;
}

void setScreen(AppScreen screen) {
  if (g_screen != screen) {
    g_screen = screen;
    markDisplayDirty();
  }
}

void setFingerprintState(const char *state) {
  if (g_lastFingerprintState == state) {
    return;
  }

  g_lastFingerprintState = state;
  Serial.printf("[FP] state=%s\n", state);
}

FingerprintMatch waitForFingerprintLookup(uint32_t timeoutMs) {
  const uint32_t startedAt = millis();
  while ((millis() - startedAt) < timeoutMs) {
    const FingerprintMatch match = g_fingerprint.scanOnce();
    if (match.status == FingerprintScanStatus::NoFinger) {
      delay(90);
      continue;
    }
    return match;
  }

  FingerprintMatch timeout;
  timeout.status = FingerprintScanStatus::Error;
  timeout.message = "Finger check timeout";
  return timeout;
}

const char *screenName(AppScreen screen) {
  switch (screen) {
    case AppScreen::Menu:
      return "menu";
    case AppScreen::PairEventSelection:
      return "pair";
    case AppScreen::EnrollmentSessionSelection:
      return "enroll-session";
    case AppScreen::EnrollmentStudentSelection:
      return "enroll-student";
    case AppScreen::AttendanceMenu:
      return "attendance-menu";
    case AppScreen::SyncRecordsMenu:
      return "sync-menu";
    case AppScreen::TimeOutConfirmation:
      return "timeout-confirm";
    case AppScreen::ClearPairConfirmation:
      return "clear-pair-confirm";
    case AppScreen::AttendanceScan:
      return "attendance-scan";
    case AppScreen::SyncProgress:
      return "sync";
    default:
      return "unknown";
  }
}

const char *syncModeName(SyncMode mode) {
  switch (mode) {
    case SyncMode::Auto:
      return "auto";
    case SyncMode::AttendanceOnly:
      return "attendance-only";
    case SyncMode::EnrollmentOnly:
      return "enrollment-only";
    case SyncMode::FingerprintRoster:
      return "fingerprint-roster";
    case SyncMode::PairedEventData:
      return "paired-event-data";
    case SyncMode::CleanupQueue:
      return "cleanup-queue";
    case SyncMode::Full:
      return "full";
    case SyncMode::None:
    default:
      return "none";
  }
}

const char *syncModeMenuLabel(SyncMode mode) {
  switch (mode) {
    case SyncMode::Auto:
      return "Auto Sync";
    case SyncMode::AttendanceOnly:
      return "Attendance Only";
    case SyncMode::EnrollmentOnly:
      return "Enrollment Only";
    case SyncMode::FingerprintRoster:
      return "Fingerprint Roster";
    case SyncMode::PairedEventData:
      return "Paired Event Data";
    case SyncMode::CleanupQueue:
      return "Cleanup Queue";
    case SyncMode::Full:
      return "Full Sync";
    case SyncMode::None:
    default:
      return "Sync Records";
  }
}

const char *syncModeStatusLabel(SyncMode mode) {
  switch (mode) {
    case SyncMode::Auto:
      return "Auto Sync...";
    case SyncMode::AttendanceOnly:
      return "Sync Attendance...";
    case SyncMode::EnrollmentOnly:
      return "Sync Enrollment...";
    case SyncMode::FingerprintRoster:
      return "Sync Roster...";
    case SyncMode::PairedEventData:
      return "Sync Event Data...";
    case SyncMode::CleanupQueue:
      return "Sync Cleanup...";
    case SyncMode::Full:
      return "Full Sync...";
    case SyncMode::None:
    default:
      return "Sync Idle";
  }
}

bool isInteractiveSyncMode(SyncMode mode) {
  return mode != SyncMode::None && mode != SyncMode::Auto;
}

bool syncModeIncludesEnrollment(SyncMode mode) {
  return mode == SyncMode::Auto || mode == SyncMode::EnrollmentOnly ||
         mode == SyncMode::Full;
}

bool syncModeIncludesAttendance(SyncMode mode) {
  return mode == SyncMode::Auto || mode == SyncMode::AttendanceOnly ||
         mode == SyncMode::Full;
}

bool syncModeIncludesCleanupQueue(SyncMode mode) {
  return mode == SyncMode::Auto || mode == SyncMode::CleanupQueue ||
         mode == SyncMode::Full;
}

bool syncModeIncludesContextRefresh(SyncMode mode) {
  return mode == SyncMode::Auto || mode == SyncMode::EnrollmentOnly ||
         mode == SyncMode::PairedEventData || mode == SyncMode::CleanupQueue ||
         mode == SyncMode::Full;
}

bool syncModeIncludesFingerprintRoster(SyncMode mode) {
  return mode == SyncMode::Auto || mode == SyncMode::FingerprintRoster ||
         mode == SyncMode::Full;
}

bool syncModeStartsWithContextRefresh(SyncMode mode) {
  return mode == SyncMode::Full;
}

bool syncModeShouldFailOnRefreshError(SyncMode mode) {
  return mode == SyncMode::EnrollmentOnly ||
         mode == SyncMode::PairedEventData ||
         mode == SyncMode::CleanupQueue;
}

bool syncModeShouldFailOnRosterError(SyncMode mode) {
  return mode == SyncMode::FingerprintRoster;
}

SyncPhase nextSyncPhaseAfterTime(SyncMode mode) {
  switch (mode) {
    case SyncMode::Auto:
    case SyncMode::EnrollmentOnly:
    case SyncMode::Full:
      return SyncPhase::UploadEnrollment;
    case SyncMode::AttendanceOnly:
      return SyncPhase::UploadAttendance;
    case SyncMode::CleanupQueue:
      return SyncPhase::CleanupMappings;
    case SyncMode::PairedEventData:
      return SyncPhase::RefreshContext;
    case SyncMode::FingerprintRoster:
      return SyncPhase::DownloadFingerprintRoster;
    case SyncMode::None:
    default:
      return SyncPhase::Complete;
  }
}

SyncPhase nextSyncPhaseAfterEnrollment(SyncMode mode,
                                       bool contextRefreshNeeded,
                                       bool pairedEventValid) {
  if (mode == SyncMode::Auto || mode == SyncMode::Full) {
    return SyncPhase::UploadAttendance;
  }
  if (contextRefreshNeeded && pairedEventValid &&
      syncModeIncludesContextRefresh(mode)) {
    return SyncPhase::RefreshContext;
  }
  return SyncPhase::Complete;
}

SyncPhase nextSyncPhaseAfterAttendance(SyncMode mode) {
  return syncModeIncludesCleanupQueue(mode) ? SyncPhase::CleanupMappings
                                            : SyncPhase::Complete;
}

SyncPhase nextSyncPhaseAfterCleanup(SyncMode mode, bool contextRefreshNeeded,
                                    bool pairedEventValid) {
  if (contextRefreshNeeded && pairedEventValid &&
      syncModeIncludesContextRefresh(mode)) {
    return SyncPhase::RefreshContext;
  }
  return syncModeIncludesFingerprintRoster(mode)
             ? SyncPhase::DownloadFingerprintRoster
             : SyncPhase::Complete;
}

SyncPhase nextSyncPhaseAfterRefresh(SyncMode mode) {
  return syncModeIncludesFingerprintRoster(mode)
             ? SyncPhase::DownloadFingerprintRoster
             : SyncPhase::Complete;
}

bool canStartSyncMode(SyncMode mode, String &title, String &detail) {
  title = "Sync Records";
  detail = "";

  switch (mode) {
    case SyncMode::None:
      detail = "Select a sync mode";
      return false;
    case SyncMode::Auto:
      detail = "Nothing pending";
      return hasPendingSyncWork();
    case SyncMode::AttendanceOnly:
      if (g_storage.unsyncedAttendanceCount() == 0) {
        detail = "No attendance queue";
        return false;
      }
      return true;
    case SyncMode::EnrollmentOnly:
      if (g_storage.unsyncedEnrollmentCount() == 0) {
        detail = "No enrollment queue";
        return false;
      }
      return true;
    case SyncMode::PairedEventData:
      if (!g_pairedEvent.isValid()) {
        title = "No Paired Event";
        detail = "Pair Event first";
        return false;
      }
      return true;
    case SyncMode::FingerprintRoster:
    case SyncMode::CleanupQueue:
    case SyncMode::Full:
      return true;
    default:
      detail = "Select a sync mode";
      return false;
  }
}

const char *syncPhaseName(SyncPhase phase) {
  switch (phase) {
    case SyncPhase::WaitForWifi:
      return "Wi-Fi";
    case SyncPhase::WaitForTime:
      return "Time sync";
    case SyncPhase::UploadEnrollment:
      return "Enrollments";
    case SyncPhase::UploadAttendance:
      return "Attendance";
    case SyncPhase::CleanupMappings:
      return "Cleanup";
    case SyncPhase::RefreshContext:
      return "Refresh evt";
    case SyncPhase::DownloadFingerprintRoster:
      return "FP roster";
    case SyncPhase::Complete:
      return "Complete";
    case SyncPhase::Idle:
    default:
      return "Idle";
  }
}

template <typename T>
int clampIndex(int index, const std::vector<T> &items) {
  if (items.empty()) {
    return 0;
  }
  if (index < 0) {
    return 0;
  }
  const int maxIndex = static_cast<int>(items.size()) - 1;
  return index > maxIndex ? maxIndex : index;
}

bool deadlineReached(uint32_t deadline) {
  return static_cast<int32_t>(millis() - deadline) >= 0;
}

void showTimedMessage(const String &line1, const String &line2, uint32_t holdMs,
                      const String &line3, const String &line4) {
  g_message.active = true;
  g_message.endsAt = millis() + holdMs;
  g_message.line1 = line1;
  g_message.line2 = line2;
  g_message.line3 = line3;
  g_message.line4 = line4;
  markDisplayDirty();
}

void clearTimedMessage() {
  if (!g_message.active) {
    return;
  }

  g_message.active = false;
  markDisplayDirty();
}

void updateTimedMessage() {
  if (!g_message.active) {
    return;
  }

  if (!deadlineReached(g_message.endsAt)) {
    return;
  }

  g_message.active = false;
  if (isAttendanceScreen()) {
    g_lastAttendancePromptUnsyncedCount = static_cast<size_t>(-1);
  }
  markDisplayDirty();
}

ButtonAction pollUiAction() {
  const ButtonAction action = g_buttons.poll();
  if (action == ButtonAction::None) {
    return action;
  }

  const uint32_t now = millis();
  if ((now - g_lastUiActionAt) < kUiActionGapMs) {
    return ButtonAction::None;
  }

  g_lastUiActionAt = now;
  return action;
}

void cachePairedEventContext(const EventInfo &event,
                             const std::vector<StudentInfo> &students,
                             const std::vector<String> &recordedStudentIds) {
  EventInfo eventToCache = event;
  CampusEligibility::normalizeEvent(eventToCache);
  const bool needsStudentContext = pairedEventNeedsStudentContext(eventToCache);
  std::vector<StudentInfo> studentsToCache = students;
  if (!needsStudentContext) {
    studentsToCache.clear();
  }
  for (auto &student : studentsToCache) {
    CampusEligibility::normalizeStudent(student);
  }
  if (g_pairedEvent.isValid() && g_pairedEvent.eventId == event.eventId &&
      g_pairedEvent.timeOutFinalized) {
    eventToCache.timeOutFinalized = true;
  }

  g_pairedEvent = eventToCache;
  g_cachedPairedStudents = studentsToCache;
  g_remoteRecordedStudentIds.clear();
  g_pairedEventRecoveredFromAttendance = false;
  g_storage.savePairedEventContext(eventToCache, studentsToCache,
                                   recordedStudentIds);
}

bool recoverPairedEventFromAttendance(EventInfo &event) {
  const std::vector<AttendanceRecord> records = g_storage.loadAttendanceRecords();
  std::vector<EventInfo> candidates;
  candidates.reserve(records.size());

  String latestEventId;
  uint64_t latestEpoch = 0;
  for (const auto &record : records) {
    if (record.synced || record.syncRejected || record.eventId.isEmpty()) {
      continue;
    }

    addBackupEventCandidate(record, candidates);
    if (latestEventId.isEmpty() || record.capturedAtEpoch >= latestEpoch) {
      latestEventId = record.eventId;
      latestEpoch = record.capturedAtEpoch;
    }
  }

  if (candidates.empty()) {
    return false;
  }

  if (!latestEventId.isEmpty()) {
    for (const auto &candidate : candidates) {
      if (candidate.eventId == latestEventId) {
        event = candidate;
        return true;
      }
    }
  }

  event = candidates.front();
  return true;
}

void loadStoredPairedEventContext() {
  g_pairedEventRecoveredFromAttendance = false;
  Serial.println("[PAIR] loading cached paired event context");
  EventInfo event;
  std::vector<StudentInfo> students;
  std::vector<String> recordedStudentIds;
  if (g_storage.loadPairedEventContext(event, students, recordedStudentIds)) {
    g_pairedEvent = event;
    g_cachedPairedStudents = students;
    g_remoteRecordedStudentIds = recordedStudentIds;
    Serial.printf("[PAIR] loaded cached paired event context eventId=%s\n",
                  g_pairedEvent.eventId.c_str());
    Serial.printf("[PAIR] cached event title=%s\n", g_pairedEvent.title.c_str());
    Serial.printf("[PAIR] cached targetMode=%s\n",
                  eligibilityTargetModeLabel(g_pairedEvent).c_str());
    Serial.printf("[PAIR] cached course=%s year=%s section=%s\n",
                  CampusEligibility::joinCanonicalList(g_pairedEvent.courseFilters)
                      .c_str(),
                  CampusEligibility::joinCanonicalList(g_pairedEvent.yearLevelFilters)
                      .c_str(),
                  CampusEligibility::joinCanonicalList(g_pairedEvent.sectionFilters)
                      .c_str());
    Serial.printf("[PAIR] cached targeted count=%u\n",
                  static_cast<unsigned>(
                      CampusEligibility::targetedStudentCount(g_pairedEvent)));
    Serial.printf("[PAIR] cached audienceRestricted=%s rosterRequired=%s schema=%u\n",
                  g_pairedEvent.audienceRestricted ? "yes" : "no",
                  g_pairedEvent.rosterRequired ? "yes" : "no",
                  static_cast<unsigned>(g_pairedEvent.contextSchemaVersion));
    Serial.printf("[PAIR] cached student context on SD=%s\n",
                  g_storage.hasPairedEventStudentContext(g_pairedEvent.eventId) ?
                      "yes" :
                      "no");
    return;
  }

  g_pairedEvent = g_storage.loadPairedEvent();
  g_cachedPairedStudents.clear();
  g_remoteRecordedStudentIds.clear();
  const String pairedContextStatus = g_storage.pairedEventContextStatus();
  Serial.printf("[PAIR] cached paired event context unavailable reason=%s\n",
                pairedContextStatus.c_str());
  if (g_pairedEvent.isValid()) {
    Serial.printf("[PAIR] cached paired event metadata eventId=%s title=%s\n",
                  g_pairedEvent.eventId.c_str(), g_pairedEvent.title.c_str());
    return;
  }

  EventInfo recoveredEvent;
  if (recoverPairedEventFromAttendance(recoveredEvent)) {
    g_pairedEvent = recoveredEvent;
    g_pairedEventRecoveredFromAttendance = true;
    Serial.printf(
        "[PAIR] recovered event from pending attendance eventId=%s title=%s "
        "pendingA=%u\n",
        g_pairedEvent.eventId.c_str(), g_pairedEvent.title.c_str(),
        static_cast<unsigned>(g_storage.unsyncedAttendanceCount()));
  }
}

bool loadEnrollmentQueuePage(size_t offset) {
  g_enrollmentQueueStats = g_storage.getEnrollmentQueueStatsFromSd();
  g_enrollmentQueuePagedFromSd =
      g_enrollmentQueueStats.sdReady && g_enrollmentQueueStats.queueExists;
  g_cachedPendingStudents.clear();
  g_enrollmentQueuePageOffset = 0;

  if (!g_enrollmentQueuePagedFromSd) {
    return false;
  }

  if (g_enrollmentQueueStats.pendingRows == 0) {
    Serial.printf("[ENROLL][QUEUE] loading page offset=%u limit=%u\n",
                  static_cast<unsigned>(offset),
                  static_cast<unsigned>(kEnrollmentQueuePageSize));
    Serial.println("[ENROLL][QUEUE] page loaded count=0");
    return true;
  }

  size_t safeOffset = offset;
  if (safeOffset >= g_enrollmentQueueStats.pendingRows) {
    safeOffset =
        ((g_enrollmentQueueStats.pendingRows - 1U) / kEnrollmentQueuePageSize) *
        kEnrollmentQueuePageSize;
  }

  Serial.printf("[ENROLL][QUEUE] loading page offset=%u limit=%u\n",
                static_cast<unsigned>(safeOffset),
                static_cast<unsigned>(kEnrollmentQueuePageSize));
  logDetailedMemory("before enrollment queue page load");
  if (!g_storage.loadEnrollmentQueuePageFromSd(
          safeOffset, kEnrollmentQueuePageSize, g_cachedPendingStudents, true)) {
    g_enrollmentQueuePagedFromSd = false;
    g_enrollmentQueueStats = EnrollmentQueueStats{};
    return false;
  }
  logDetailedMemory("after enrollment queue page load");

  g_enrollmentQueuePageOffset = safeOffset;
  Serial.printf("[ENROLL][QUEUE] page loaded count=%u\n",
                static_cast<unsigned>(g_cachedPendingStudents.size()));
  return true;
}

bool hasOfflineEnrollmentQueue() {
  if (!g_currentEnrollmentSession.isValid()) {
    return false;
  }

  if (g_enrollmentQueuePagedFromSd) {
    return g_enrollmentQueueStats.pendingRows > 0;
  }

  return !g_cachedPendingStudents.empty();
}

void loadStoredEnrollmentSession() {
  g_currentEnrollmentSession = g_storage.loadCurrentEnrollmentSession();
  g_cachedPendingStudents.clear();
  g_enrollmentQueueStats = EnrollmentQueueStats{};
  g_enrollmentQueuePageOffset = 0;
  g_enrollmentQueuePagedFromSd = false;

  if (g_currentEnrollmentSession.isValid()) {
    if (!loadEnrollmentQueuePage(0)) {
      g_cachedPendingStudents = g_storage.loadPendingStudents();
    } else {
      Serial.printf(
          "[ENROLL][QUEUE] loaded SD queue pending=%u enrolledPendingSync=%u "
          "synced=%u\n",
          static_cast<unsigned>(g_enrollmentQueueStats.pendingRows),
          static_cast<unsigned>(g_enrollmentQueueStats.enrolledPendingSyncRows),
          static_cast<unsigned>(g_enrollmentQueueStats.syncedRows));
    }
  }

  if (g_currentEnrollmentSession.isValid() && !hasOfflineEnrollmentQueue() &&
      g_storage.unsyncedEnrollmentCount() == 0) {
    g_storage.clearCurrentEnrollmentSession();
    g_currentEnrollmentSession = EnrollmentSessionInfo{};
    g_cachedPendingStudents.clear();
    g_enrollmentQueueStats = EnrollmentQueueStats{};
    g_enrollmentQueuePageOffset = 0;
    g_enrollmentQueuePagedFromSd = false;
  }
}

String eventSubtitle(const EventInfo &event) {
  String line2 = event.date;
  if (!event.scheduledTime.isEmpty()) {
    if (!line2.isEmpty()) {
      line2 += " ";
    }
    line2 += event.scheduledTime;
    if (!event.scheduledTimeEnd.isEmpty()) {
      line2 += "-";
      line2 += event.scheduledTimeEnd;
    }
  }
  if (line2.isEmpty()) {
    line2 = event.location;
  }
  return line2;
}

void disconnectAfterOnlineTask() {
  g_backend.clearSession();
  g_wifi.disconnect();
}

bool allowInteractiveOnlineTask() {
  if (!isSyncActive()) {
    return true;
  }

  if (g_sync.mode == SyncMode::Auto &&
      (g_sync.phase == SyncPhase::WaitForWifi ||
       g_sync.phase == SyncPhase::WaitForTime)) {
    Serial.println("[SYNC] cancelling auto sync for foreground action");
    g_wifi.cancelConnect();
    disconnectAfterOnlineTask();
    g_sync = SyncController{};
    markDisplayDirty();
    return true;
  }

  showTimedMessage("Sync Busy", "Please wait...", kShortMessageMs);
  g_feedback.warning();
  return false;
}

bool connectForOnlineTask(const String &line1) {
  clearTimedMessage();
  g_display.show(line1, "Wi-Fi connect...");

  String error;
  if (!g_wifi.connect(error, CampusConfig::kWifiTimeoutMs)) {
    Serial.printf("[WIFI] connect failed: %s\n", error.c_str());
    showTimedMessage("Wi-Fi Failed", trim16(error), kMediumMessageMs);
    g_feedback.error();
    return false;
  }

  Serial.printf("[WIFI] connected status=%s\n", g_wifi.statusText().c_str());

  String timeError;
  if (!g_time.syncWithNetwork(timeError)) {
    Serial.printf("[TIME] sync skipped: %s\n", timeError.c_str());
  }

  return true;
}

bool refreshPairedEventContext(String &error) {
  if (!g_pairedEvent.isValid()) {
    error = "No paired event";
    return false;
  }

  EventInfo event;
  std::vector<StudentInfo> students;
  std::vector<String> recordedStudentIds;
  if (!g_backend.pairEvent(g_pairedEvent.eventId, event, students,
                           recordedStudentIds, error)) {
    return false;
  }

  if (pairedEventNeedsStudentContext(event)) {
    Serial.printf("[PAIR] refresh eventId=%s requiresContext=yes\n",
                  event.eventId.c_str());
    if (!g_backend.downloadPairedEventContextToStorage(event, g_storage, error)) {
      return false;
    }
    cachePairedEventContext(event, {}, {});
  } else {
    Serial.printf("[PAIR] refresh eventId=%s requiresContext=no reason=unrestricted-audience\n",
                  event.eventId.c_str());
    cachePairedEventContext(event, {}, recordedStudentIds);
  }
  return true;
}

void renderMenu() {
  g_display.showMenu("CAMPUS Menu", kMenuItems, g_menuIndex,
                     static_cast<int>(kMenuItemCount));
}

void renderPairEventSelection() {
  if (g_cachedAvailableEvents.empty()) {
    renderMenu();
    return;
  }

  g_pairEventIndex = clampIndex(g_pairEventIndex, g_cachedAvailableEvents);
  const EventInfo &event = g_cachedAvailableEvents[g_pairEventIndex];
  g_display.showLines("Select Event", trim16(event.title),
                      trim16(eventSubtitle(event)), "UP/DN SEL BK");
}

void renderEnrollmentSessionSelection() {
  if (g_cachedEnrollmentSessions.empty()) {
    renderMenu();
    return;
  }

  g_enrollmentSessionIndex =
      clampIndex(g_enrollmentSessionIndex, g_cachedEnrollmentSessions);
  g_display.showEnrollmentSession(
      g_cachedEnrollmentSessions[g_enrollmentSessionIndex], g_enrollmentSessionIndex,
      static_cast<int>(g_cachedEnrollmentSessions.size()));
}

void renderEnrollmentStudentSelection() {
  if (g_cachedPendingStudents.empty()) {
    g_display.show("Queue Empty", "Nothing to enroll");
    return;
  }

  g_pendingStudentIndex = clampIndex(g_pendingStudentIndex, g_cachedPendingStudents);
  const int displayIndex =
      g_enrollmentQueuePagedFromSd
          ? static_cast<int>(g_enrollmentQueuePageOffset +
                             static_cast<size_t>(g_pendingStudentIndex))
          : g_pendingStudentIndex;
  const int displayTotal =
      g_enrollmentQueuePagedFromSd
          ? static_cast<int>(g_enrollmentQueueStats.pendingRows)
          : static_cast<int>(g_cachedPendingStudents.size());
  g_display.showStudent(g_cachedPendingStudents[g_pendingStudentIndex],
                        displayIndex, displayTotal);
}

void renderAttendanceMenu() {
  g_display.showMenu("Attendance Mode", kAttendanceModeItems, g_attendanceModeIndex,
                     static_cast<int>(kAttendanceModeItemCount));
}

void renderSyncRecordsMenu() {
  if (g_syncRecordsMenuIndex < 0 ||
      g_syncRecordsMenuIndex >= static_cast<int>(kSyncRecordsMenuItemCount)) {
    g_syncRecordsMenuIndex = 0;
  }

  g_display.showMenu("Sync Records", kSyncRecordsMenuItems, g_syncRecordsMenuIndex,
                     static_cast<int>(kSyncRecordsMenuItemCount));
}

void renderTimeOutConfirmation() {
  const String line4 =
      g_timeOutConfirmIndex == 0 ? ">Yes            No" : " Yes           >No";
  g_display.showLines("WARNING: TIME OUT", "You cannot return", "to TIME IN",
                      line4);
}

void renderClearPairConfirmation() {
  const String title =
      g_pairedEvent.isValid() ? trim16(g_pairedEvent.title) : "Stale pairing data";
  const String line4 = g_clearPairConfirmIndex == 0 ? ">Yes            No"
                                                    : " Yes           >No";
  g_display.showLines("Clear Paired Event", title, "Keeps attendance", line4);
}

void renderAttendancePrompt() {
  const size_t unsyncedCount = g_storage.unsyncedAttendanceCount();
  g_lastAttendancePromptUnsyncedCount = unsyncedCount;
  String footer = "Scan for " + attendanceModeLabel(g_attendanceCaptureMode);
  if (unsyncedCount > 0) {
    footer = "Unsynced:" + String(unsyncedCount);
  }
  String line2 = attendanceModeLabel(g_attendanceCaptureMode);
  if (!g_pairedEvent.date.isEmpty()) {
    line2 += " " + g_pairedEvent.date;
  }
  String line3 = g_pairedEvent.scheduledTime;
  if (!g_pairedEvent.scheduledTimeEnd.isEmpty()) {
    if (!line3.isEmpty()) {
      line3 += "-";
    }
    line3 += g_pairedEvent.scheduledTimeEnd;
  }
  if (line3.isEmpty()) {
    line3 = g_pairedEvent.location;
  }
  g_display.showLines(g_pairedEvent.title, line2, line3, footer);
}

void renderSyncProgress() {
  String line3 = syncPhaseName(g_sync.phase);
  String line4 = "E:" + String(g_sync.enrollmentUploads) + " A:" +
                 String(g_sync.attendanceUploads);
  if (g_sync.cleanupProcessed > 0) {
    line4 += " C:";
    line4 += String(g_sync.cleanupProcessed);
  }
  if (g_sync.rosterDownloaded) {
    line4 = "Roster rows:" + String(g_sync.rosterRows);
  } else if (g_sync.rejections > 0) {
    line4 += " R:";
    line4 += String(g_sync.rejections);
  } else if (g_sync.duplicates > 0) {
    line4 += " D:";
    line4 += String(g_sync.duplicates);
  }
  g_display.showLines("Sync Records", syncModeStatusLabel(g_sync.mode), line3,
                      line4);
}

void renderCurrentScreen() {
  if (!g_displayDirty) {
    return;
  }

  g_displayDirty = false;
  if (g_message.active) {
    g_display.showLines(g_message.line1, g_message.line2, g_message.line3,
                        g_message.line4);
    return;
  }

  switch (g_screen) {
    case AppScreen::Menu:
      renderMenu();
      break;
    case AppScreen::PairEventSelection:
      renderPairEventSelection();
      break;
    case AppScreen::EnrollmentSessionSelection:
      renderEnrollmentSessionSelection();
      break;
    case AppScreen::EnrollmentStudentSelection:
      renderEnrollmentStudentSelection();
      break;
    case AppScreen::AttendanceMenu:
      renderAttendanceMenu();
      break;
    case AppScreen::SyncRecordsMenu:
      renderSyncRecordsMenu();
      break;
    case AppScreen::TimeOutConfirmation:
      renderTimeOutConfirmation();
      break;
    case AppScreen::ClearPairConfirmation:
      renderClearPairConfirmation();
      break;
    case AppScreen::AttendanceScan:
      renderAttendancePrompt();
      break;
    case AppScreen::SyncProgress:
      renderSyncProgress();
      break;
  }
}

void startFingerRemovalWait() {
  g_waitingForFingerRemoval = true;
  g_fingerRemovalDeadlineAt = millis() + kFingerRemovalTimeoutMs;
  setFingerprintState("wait-release");
}

void updateFingerRemovalWait() {
  if (!g_waitingForFingerRemoval) {
    return;
  }

  if (!g_fingerprint.isFingerPresent() ||
      deadlineReached(g_fingerRemovalDeadlineAt)) {
    g_waitingForFingerRemoval = false;
    setFingerprintState("ready");
    g_lastAttendancePromptUnsyncedCount = static_cast<size_t>(-1);
    markDisplayDirty();
  }
}

bool hasPendingSyncWork() {
  return g_storage.unsyncedAttendanceCount() > 0 ||
         g_storage.unsyncedEnrollmentCount() > 0;
}

String syncFailureStageLabel() {
  if (!g_backend.lastFailureStage().isEmpty() &&
      g_backend.lastFailureStage() != "none" &&
      g_backend.lastFailureStage() != "init") {
    return g_backend.lastFailureStage();
  }

  switch (g_sync.phase) {
    case SyncPhase::WaitForWifi:
      return "wifi";
    case SyncPhase::WaitForTime:
      return "time";
    case SyncPhase::UploadEnrollment:
      return "enrollment";
    case SyncPhase::UploadAttendance:
      return "attendance";
    case SyncPhase::CleanupMappings:
      return "cleanup";
    case SyncPhase::RefreshContext:
      return "refresh_context";
    case SyncPhase::DownloadFingerprintRoster:
      return "fingerprint_roster";
    case SyncPhase::Complete:
    case SyncPhase::Idle:
    default:
      return "sync";
  }
}

String syncSummaryLine() {
  switch (g_sync.mode) {
    case SyncMode::EnrollmentOnly:
      return "Uploaded E:" + String(g_sync.enrollmentUploads);
    case SyncMode::FingerprintRoster:
      return g_sync.rosterDownloaded
                 ? "Rows:" + String(g_sync.rosterRows)
                 : String("Roster refresh done");
    case SyncMode::PairedEventData:
      return "Event context updated";
    case SyncMode::CleanupQueue:
      return "Cleanup applied:" + String(g_sync.cleanupProcessed);
    case SyncMode::AttendanceOnly:
    case SyncMode::Auto:
    case SyncMode::Full: {
      String line = "A:" + String(g_sync.attendanceUploads) + " D:" +
                    String(g_sync.duplicates);
      if (g_sync.enrollmentUploads > 0) {
        line = "E:" + String(g_sync.enrollmentUploads) + " " + line;
      }
      if (g_sync.rejections > 0) {
        line += " R:";
        line += String(g_sync.rejections);
      }
      return line;
    }
    case SyncMode::None:
    default:
      return "No sync active";
  }
}

String syncFailureTitle(const String &error) {
  if (!g_wifi.isConnected() || error == "Wi-Fi not connected") {
    return "NO WIFI";
  }

  if (g_backend.lastFailureStage() == "response_too_large") {
    return "RESPONSE TOO BIG";
  }
  const int httpCode = g_backend.lastHttpStatusCode();
  if (httpCode == -1) {
    return "HTTPS CONNECT FAIL";
  }
  if (httpCode == 401 || httpCode == 403) {
    return "AUTH ERROR";
  }
  if (httpCode >= 500 && httpCode <= 599) {
    return "SERVER ERROR";
  }
  return "SYNC FAILED";
}

String syncFailureDetail(const String &error) {
  if (!g_wifi.isConnected() || error == "Wi-Fi not connected") {
    return "Check Wi-Fi setup";
  }

  if (g_backend.lastFailureStage() == "response_too_large") {
    return "Trim backend body";
  }
  const int httpCode = g_backend.lastHttpStatusCode();
  if (httpCode == -1) {
    const String detail = g_backend.lastHttpErrorString();
    if (g_backend.lastTlsMemoryPressure()) {
      return "TLS heap pressure";
    }
    return trim16(detail.isEmpty() ? error : detail);
  }
  if (httpCode == 401 || httpCode == 403) {
    return "Check device auth";
  }
  if (httpCode >= 500 && httpCode <= 599) {
    return "Retry later";
  }
  return trim16(error);
}

void finishSyncSuccess() {
  const size_t retainedAttendance = g_storage.unsyncedAttendanceCount();
  const size_t retainedEnrollments = g_storage.unsyncedEnrollmentCount();
  Serial.printf("[SYNC] completed mode=%s E=%u A=%u D=%u R=%u\n",
                syncModeName(g_sync.mode),
                static_cast<unsigned>(g_sync.enrollmentUploads),
                static_cast<unsigned>(g_sync.attendanceUploads),
                static_cast<unsigned>(g_sync.duplicates),
                static_cast<unsigned>(g_sync.rejections));
  Serial.printf(
      "[SYNC][SUMMARY] mode=%s attemptedE=%u sentE=%u attemptedA=%u sentA=%u "
      "duplicates=%u rejected=%u retainedE=%u retainedA=%u failureStage=none\n",
      syncModeName(g_sync.mode),
      static_cast<unsigned>(g_sync.enrollmentAttempts),
      static_cast<unsigned>(g_sync.enrollmentUploads),
      static_cast<unsigned>(g_sync.attendanceAttempts),
      static_cast<unsigned>(g_sync.attendanceUploads),
      static_cast<unsigned>(g_sync.duplicates),
      static_cast<unsigned>(g_sync.rejections),
      static_cast<unsigned>(retainedEnrollments),
      static_cast<unsigned>(retainedAttendance));

  if (!g_sync.keepWifiConnected) {
    disconnectAfterOnlineTask();
  }

  if (g_sync.mode == SyncMode::Auto) {
    g_autoSyncBackoffMs = CampusConfig::kAutoSyncIntervalMs;
  } else {
    setScreen(AppScreen::SyncRecordsMenu);
    showTimedMessage("SYNC OK", syncModeMenuLabel(g_sync.mode), kLongMessageMs,
                     syncSummaryLine());
    g_feedback.success();
  }

  if (g_pairedEventRecoveredFromAttendance &&
      syncModeIncludesAttendance(g_sync.mode) &&
      g_storage.unsyncedAttendanceCount() == 0) {
    Serial.println("[PAIR] cleared recovered event after sync completion");
    resetPairedEventState();
  }

  g_sync = SyncController{};
  markDisplayDirty();
}

void failSync(const String &error) {
  const String message = error.isEmpty() ? String("Sync failed") : error;
  g_sync.lastError = message;
  g_sync.lastFailureStage = syncFailureStageLabel();
  const size_t retainedAttendance = g_storage.unsyncedAttendanceCount();
  const size_t retainedEnrollments = g_storage.unsyncedEnrollmentCount();
  Serial.printf("[SYNC] failed mode=%s error=%s\n", syncModeName(g_sync.mode),
                message.c_str());
  Serial.printf(
      "[SYNC][SUMMARY] mode=%s attemptedE=%u sentE=%u attemptedA=%u sentA=%u "
      "duplicates=%u rejected=%u retainedE=%u retainedA=%u failureStage=%s "
      "tlsMemoryPressure=%s responseBytes=%u\n",
      syncModeName(g_sync.mode),
      static_cast<unsigned>(g_sync.enrollmentAttempts),
      static_cast<unsigned>(g_sync.enrollmentUploads),
      static_cast<unsigned>(g_sync.attendanceAttempts),
      static_cast<unsigned>(g_sync.attendanceUploads),
      static_cast<unsigned>(g_sync.duplicates),
      static_cast<unsigned>(g_sync.rejections),
      static_cast<unsigned>(retainedEnrollments),
      static_cast<unsigned>(retainedAttendance),
      g_sync.lastFailureStage.c_str(),
      g_backend.lastTlsMemoryPressure() ? "yes" : "no",
      static_cast<unsigned>(g_backend.lastResponsePayloadSize()));

  if (!g_sync.keepWifiConnected) {
    disconnectAfterOnlineTask();
  }

  if (g_sync.mode == SyncMode::Auto) {
    const uint32_t nextBackoff = g_autoSyncBackoffMs * 2UL;
    g_autoSyncBackoffMs =
        nextBackoff > kMaxAutoSyncBackoffMs ? kMaxAutoSyncBackoffMs : nextBackoff;
  } else {
    setScreen(AppScreen::SyncRecordsMenu);
    showTimedMessage(syncFailureTitle(message), syncModeMenuLabel(g_sync.mode),
                     kLongMessageMs, syncFailureDetail(message),
                     trim16(message));
    g_feedback.warning();
  }

  g_sync = SyncController{};
  markDisplayDirty();
}

void startSync(SyncMode mode, bool keepWifiConnected) {
  if (isSyncActive()) {
    return;
  }

  String validationTitle;
  String validationDetail;
  if (!canStartSyncMode(mode, validationTitle, validationDetail)) {
    if (isInteractiveSyncMode(mode)) {
      showTimedMessage(validationTitle, validationDetail, kShortMessageMs);
      g_feedback.warning();
    }
    return;
  }

  if (!g_wifi.hasCredentials()) {
    if (isInteractiveSyncMode(mode)) {
      showTimedMessage("Wi-Fi not set", "Use Wi-Fi Setup", kMediumMessageMs);
      g_feedback.warning();
    }
    return;
  }

  g_sync = SyncController{};
  g_sync.mode = mode;
  g_sync.phase = SyncPhase::WaitForWifi;
  g_sync.keepWifiConnected = keepWifiConnected;
  g_sync.contextRefreshNeeded =
      syncModeStartsWithContextRefresh(mode) && g_pairedEvent.isValid();
  g_lastAutoSyncAttemptAt = millis();

  if (isInteractiveSyncMode(mode)) {
    setScreen(AppScreen::SyncProgress);
  }

  Serial.printf("[SYNC] start mode=%s pendingA=%u pendingE=%u batchA=%u\n",
                syncModeName(mode),
                static_cast<unsigned>(g_storage.unsyncedAttendanceCount()),
                static_cast<unsigned>(g_storage.unsyncedEnrollmentCount()),
                static_cast<unsigned>(CampusConfig::kAttendanceSyncBatchSize));

  String error;
  if (!g_wifi.beginConnect(error, CampusConfig::kWifiTimeoutMs)) {
    failSync(error);
    return;
  }

  markDisplayDirty();
}

void tickSync() {
  if (!isSyncActive()) {
    return;
  }

  switch (g_sync.phase) {
    case SyncPhase::WaitForWifi: {
      String error;
      const WifiConnectResult result = g_wifi.pollConnect(error);
      if (result == WifiConnectResult::Failed) {
        failSync(error);
        return;
      }
      if (result != WifiConnectResult::Connected) {
        return;
      }

      g_sync.phase = SyncPhase::WaitForTime;
      g_time.beginNetworkSync(CampusConfig::kNtpSyncTimeoutMs);
      g_sync.timeSyncStarted = true;
      markDisplayDirty();
      return;
    }

    case SyncPhase::WaitForTime: {
      String error;
      const TimeSyncResult result = g_time.pollNetworkSync(error);
      if (result == TimeSyncResult::InProgress ||
          result == TimeSyncResult::Idle) {
        return;
      }
      if (result == TimeSyncResult::Failed) {
        Serial.printf("[TIME] sync failed during %s sync: %s\n",
                      syncModeName(g_sync.mode), error.c_str());
      }
      g_sync.phase = nextSyncPhaseAfterTime(g_sync.mode);
      markDisplayDirty();
      return;
    }

    case SyncPhase::UploadEnrollment: {
      if (!syncModeIncludesEnrollment(g_sync.mode)) {
        g_sync.phase = nextSyncPhaseAfterEnrollment(
            g_sync.mode, g_sync.contextRefreshNeeded, g_pairedEvent.isValid());
        markDisplayDirty();
        return;
      }

      Serial.printf("[ENROLL][SYNC] loading result batch limit=%u\n", 1U);
      logDetailedMemory("before enrollment sync upload");
      const std::vector<StudentInfo> pendingEnrollments =
          g_storage.loadUnsyncedEnrollments();
      if (pendingEnrollments.empty()) {
        g_sync.phase = nextSyncPhaseAfterEnrollment(
            g_sync.mode, g_sync.contextRefreshNeeded, g_pairedEvent.isValid());
        markDisplayDirty();
        return;
      }

      String error;
      const StudentInfo &student = pendingEnrollments.front();
      ++g_sync.enrollmentAttempts;
      if (!g_backend.submitEnrollment(student, error)) {
        failSync(error);
        return;
      }

      g_storage.markEnrollmentResultSyncedOnSd(student.sessionId,
                                               student.studentUid);
      g_storage.markEnrollmentSynced(student.studentUid);
      ++g_sync.enrollmentUploads;
      g_sync.contextRefreshNeeded = g_pairedEvent.isValid();
      logDetailedMemory("after enrollment sync upload");
      Serial.printf("[ENROLL][SYNC] uploaded student=%s\n",
                    student.studentUid.c_str());
      markDisplayDirty();
      return;
    }

    case SyncPhase::UploadAttendance: {
      if (!syncModeIncludesAttendance(g_sync.mode)) {
        g_sync.phase = nextSyncPhaseAfterAttendance(g_sync.mode);
        markDisplayDirty();
        return;
      }

      const std::vector<AttendanceRecord> batch =
          g_storage.loadUnsyncedAttendanceBatch(
              CampusConfig::kAttendanceSyncBatchSize);
      if (batch.empty()) {
        g_sync.phase = nextSyncPhaseAfterAttendance(g_sync.mode);
        markDisplayDirty();
        return;
      }

      g_sync.attendanceAttempts += batch.size();
      std::vector<SyncItemResult> results;
      String error;
      if (!g_backend.syncAttendance(batch, results, error)) {
        if (!results.empty()) {
          g_storage.applySyncResults(results);
        }
        failSync(error);
        return;
      }

      g_storage.applySyncResults(results);
      bool batchHasFailure = false;
      String batchError;
      for (const auto &result : results) {
        Serial.printf("[SYNC][ATTEND] result record=%s status=%s message=%s\n",
                      result.recordId.c_str(), result.status.c_str(),
                      result.message.c_str());
        if (result.status == "uploaded") {
          ++g_sync.attendanceUploads;
          g_sync.contextRefreshNeeded = true;
        } else if (result.status == "duplicate") {
          ++g_sync.duplicates;
          g_sync.contextRefreshNeeded = true;
        } else if (result.status == "rejected") {
          ++g_sync.rejections;
        } else if (!batchHasFailure) {
          batchHasFailure = true;
          batchError = result.message;
        }
      }

      if (batchHasFailure) {
        failSync(batchError);
        return;
      }

      g_lastAttendancePromptUnsyncedCount = static_cast<size_t>(-1);
      markDisplayDirty();
      return;
    }

    case SyncPhase::CleanupMappings: {
      if (!syncModeIncludesCleanupQueue(g_sync.mode)) {
        g_sync.phase = nextSyncPhaseAfterCleanup(
            g_sync.mode, g_sync.contextRefreshNeeded, g_pairedEvent.isValid());
        markDisplayDirty();
        return;
      }

      if (!g_sync.cleanupQueueLoaded) {
        String error;
        if (!g_backend.fetchCleanupQueue(g_sync.cleanupQueue, error)) {
          failSync(error);
          return;
        }
        g_sync.cleanupQueueLoaded = true;
      }

      if (g_sync.cleanupQueue.empty()) {
        g_sync.phase = nextSyncPhaseAfterCleanup(
            g_sync.mode, g_sync.contextRefreshNeeded, g_pairedEvent.isValid());
        markDisplayDirty();
        return;
      }

      const CleanupQueueItem item = g_sync.cleanupQueue.front();
      g_sync.cleanupQueue.erase(g_sync.cleanupQueue.begin());

      String cleanupError;
      if (!g_storage.applyCleanupQueueItem(item, cleanupError)) {
        failSync(cleanupError);
        return;
      }

      if (item.type == "deleteTemplateIfUnused") {
        String deleteError;
        if (!g_fingerprint.deleteTemplate(item.templateId, deleteError)) {
          failSync(deleteError);
          return;
        }
      }

      CleanupQueueResult result;
      result.cleanupId = item.cleanupId;
      result.processed = true;
      result.message = "Applied on device";
      std::vector<CleanupQueueResult> ackResults = {result};
      String ackError;
      if (!g_backend.acknowledgeCleanupQueue(ackResults, ackError)) {
        failSync(ackError);
        return;
      }

      loadStoredPairedEventContext();
      loadStoredEnrollmentSession();
      g_sync.contextRefreshNeeded = true;
      ++g_sync.cleanupProcessed;
      Serial.printf("[SYNC][CLEANUP] cleanupId=%s type=%s template=%d schoolId=%s\n",
                    item.cleanupId.c_str(), item.type.c_str(), item.templateId,
                    item.schoolId.c_str());
      markDisplayDirty();
      return;
    }

    case SyncPhase::RefreshContext: {
      String error;
      if (!refreshPairedEventContext(error)) {
        Serial.printf("[SYNC] paired event refresh failed: %s\n", error.c_str());
        if (syncModeShouldFailOnRefreshError(g_sync.mode)) {
          failSync(error);
          return;
        }
      }
      g_sync.phase = nextSyncPhaseAfterRefresh(g_sync.mode);
      markDisplayDirty();
      return;
    }

    case SyncPhase::DownloadFingerprintRoster: {
      const FingerprintRosterStats previousStats =
          g_storage.getFingerprintRosterStats();
      FingerprintRosterStats stats;
      String error;
      if (!g_backend.downloadFingerprintRoster(g_storage, stats, error)) {
        Serial.printf(
            "[ROSTER] download failed reason=%s keepExisting=%s count=%u size=%u\n",
            error.c_str(), previousStats.rosterExists ? "yes" : "no",
            static_cast<unsigned>(previousStats.totalRows),
            static_cast<unsigned>(previousStats.fileSize));
        if (syncModeShouldFailOnRosterError(g_sync.mode)) {
          failSync(error);
          return;
        }
      } else {
        g_sync.rosterDownloaded = true;
        g_sync.rosterRows = stats.totalRows;
      }
      g_sync.phase = SyncPhase::Complete;
      markDisplayDirty();
      return;
    }

    case SyncPhase::Complete:
      finishSyncSuccess();
      return;

    case SyncPhase::Idle:
    default:
      return;
  }
}

void maybeStartAutoSync() {
  if (isSyncActive() || g_message.active || isAttendanceScreen() ||
      g_screen != AppScreen::Menu) {
    return;
  }

  if ((millis() - g_lastUiActionAt) < kAutoSyncQuietPeriodMs) {
    return;
  }

  if (!hasPendingSyncWork() || !g_wifi.hasCredentials()) {
    return;
  }

  if ((millis() - g_lastAutoSyncAttemptAt) < g_autoSyncBackoffMs) {
    return;
  }

  startSync(SyncMode::Auto, false);
}

void enterSyncRecordsMenu() {
  if (!allowInteractiveOnlineTask()) {
    return;
  }

  if (g_syncRecordsMenuIndex < 0 ||
      g_syncRecordsMenuIndex >= static_cast<int>(kSyncRecordsMenuItemCount)) {
    g_syncRecordsMenuIndex = 0;
  }
  setScreen(AppScreen::SyncRecordsMenu);
}

void runSync(SyncMode mode) {
  if (!allowInteractiveOnlineTask()) {
    return;
  }

  startSync(mode, false);
}

void beginPairEventFlow() {
  String pairMessage;
  if (!canPairNewEvent(pairMessage)) {
    Serial.printf("[PAIR] blocked: %s\n", pairMessage.c_str());
    showWrappedMessage(pairMessage, kLongMessageMs);
    g_feedback.warning();
    return;
  }

  if (!allowInteractiveOnlineTask()) {
    return;
  }

  if (!connectForOnlineTask("Pair Event")) {
    return;
  }

  std::vector<EventInfo> events;
  String error;
  const bool fetched = g_backend.fetchAvailableEvents(events, error);
  disconnectAfterOnlineTask();

  if (!fetched) {
    showTimedMessage("Pair Failed", trim16(error), kLongMessageMs);
    g_feedback.error();
    return;
  }

  if (events.empty()) {
    showTimedMessage("No Events", "Create online evt", kMediumMessageMs);
    return;
  }

  g_cachedAvailableEvents = events;
  g_pairEventIndex = 0;
  setScreen(AppScreen::PairEventSelection);
}

void confirmSelectedPairEvent() {
  if (g_cachedAvailableEvents.empty()) {
    setScreen(AppScreen::Menu);
    return;
  }

  if (g_pairedEvent.isValid()) {
    const EventInfo &selectedEvent =
        g_cachedAvailableEvents[clampIndex(g_pairEventIndex, g_cachedAvailableEvents)];
    if (selectedEvent.eventId == g_pairedEvent.eventId) {
      Serial.println("[PAIR] duplicate pairing attempt to same event");
      showTimedMessage("Event already", "paired here", kShortMessageMs);
      g_feedback.warning();
      return;
    }
  }

  if (!allowInteractiveOnlineTask()) {
    return;
  }

  if (!connectForOnlineTask("Pair Event")) {
    return;
  }

  EventInfo pairedEvent;
  std::vector<StudentInfo> students;
  std::vector<String> recordedStudentIds;
  String error;
  const EventInfo &selectedEvent =
      g_cachedAvailableEvents[clampIndex(g_pairEventIndex, g_cachedAvailableEvents)];
  bool paired = g_backend.pairEvent(selectedEvent.eventId, pairedEvent, students,
                                    recordedStudentIds, error);
  if (paired) {
    const bool requiresContext = pairedEventNeedsStudentContext(pairedEvent);
    Serial.printf("[PAIR] eventId=%s targetMode=%s requiresContext=%s\n",
                  pairedEvent.eventId.c_str(),
                  eligibilityTargetModeLabel(pairedEvent).c_str(),
                  requiresContext ? "yes" : "no");
    Serial.printf(
        "[PAIR] audienceRestricted=%s rosterRequired=%s yearLevels=%s courses=%s "
        "targetStudent=%s selectedStudentCount=%u selectedSchoolCount=%u\n",
        pairedEvent.audienceRestricted ? "yes" : "no",
        pairedEvent.rosterRequired ? "yes" : "no",
        CampusEligibility::joinCanonicalList(pairedEvent.yearLevelFilters).c_str(),
        CampusEligibility::joinCanonicalList(pairedEvent.courseFilters).c_str(),
        pairedEvent.targetStudent.c_str(),
        static_cast<unsigned>(pairedEvent.targetedStudentIds.size()),
        static_cast<unsigned>(pairedEvent.targetedSchoolIds.size()));
    if (requiresContext) {
      if (!g_backend.downloadPairedEventContextToStorage(pairedEvent, g_storage,
                                                         error)) {
        Serial.printf("[PAIR] context download failed after pair event=%s error=%s\n",
                      selectedEvent.eventId.c_str(), error.c_str());
        paired = false;
      } else {
        cachePairedEventContext(pairedEvent, {}, {});
      }
    } else {
      Serial.printf("[PAIR] skip paired context download eventId=%s reason=unrestricted-audience\n",
                    pairedEvent.eventId.c_str());
      cachePairedEventContext(pairedEvent, {}, recordedStudentIds);
    }
  }
  disconnectAfterOnlineTask();

  if (!paired) {
    showTimedMessage("Pair Failed", trim16(error), kLongMessageMs);
    g_feedback.error();
    return;
  }

  setScreen(AppScreen::Menu);
  showTimedMessage("Event Paired", trim16(pairedEvent.title), kMediumMessageMs);
  g_feedback.success();
}

void beginEnrollmentFlow() {
  if (!g_fingerprint.isReady()) {
    showTimedMessage("Enroll Blocked", "Scanner offline", kMediumMessageMs);
    g_feedback.error();
    return;
  }

  if (!allowInteractiveOnlineTask()) {
    return;
  }

  loadStoredEnrollmentSession();
  const bool hasOfflineSession = hasOfflineEnrollmentQueue();

  if (g_wifi.hasCredentials() && connectForOnlineTask("Enroll Student")) {
    String error;
    const bool fetched =
        g_backend.fetchEnrollmentSessions(g_cachedEnrollmentSessions, error);
    disconnectAfterOnlineTask();

    if (!fetched) {
      if (!hasOfflineSession) {
        showTimedMessage("Fetch Failed", trim16(error), kMediumMessageMs);
        g_feedback.error();
        return;
      }
    } else if (!g_cachedEnrollmentSessions.empty()) {
      g_enrollmentSessionIndex = 0;
      setScreen(AppScreen::EnrollmentSessionSelection);
      return;
    }
  } else if (!hasOfflineSession) {
    return;
  }

  if (!g_currentEnrollmentSession.isValid()) {
    showTimedMessage("No Session", "Create online sess", kMediumMessageMs);
    return;
  }

  if (!hasOfflineEnrollmentQueue()) {
    showTimedMessage("Queue Empty", "Nothing to enroll", kMediumMessageMs);
    return;
  }

  g_pendingStudentIndex = 0;
  setScreen(AppScreen::EnrollmentStudentSelection);
}

void confirmSelectedEnrollmentSession() {
  if (g_cachedEnrollmentSessions.empty()) {
    setScreen(AppScreen::Menu);
    return;
  }

  if (!allowInteractiveOnlineTask()) {
    return;
  }

  if (!connectForOnlineTask("Enroll Student")) {
    return;
  }

  String error;
  EnrollmentSessionInfo session;
  std::vector<StudentInfo> downloadedStudents;
  const EnrollmentSessionInfo &selectedSession =
      g_cachedEnrollmentSessions[clampIndex(g_enrollmentSessionIndex,
                                            g_cachedEnrollmentSessions)];

  const bool paired = g_backend.pairEnrollmentSession(selectedSession.sessionId, session,
                                                      error);
  if (!paired) {
    disconnectAfterOnlineTask();
    showTimedMessage("Pair Failed", trim16(error), kMediumMessageMs);
    g_feedback.error();
    return;
  }

  Serial.printf("[ENROLL][QUEUE] download started session=%s\n",
                session.sessionId.c_str());
  logDetailedMemory("before enrollment session download");
  const bool downloaded = g_backend.downloadEnrollmentSession(
      session.sessionId, session, downloadedStudents, error);
  disconnectAfterOnlineTask();
  logDetailedMemory("after enrollment session download");

  if (!downloaded) {
    showTimedMessage("Queue Failed", trim16(error), kMediumMessageMs);
    g_feedback.error();
    return;
  }

  g_currentEnrollmentSession = session;
  if (!g_storage.saveCurrentEnrollmentSession(session)) {
    Serial.println("[ENROLL][QUEUE] failed to save current session metadata");
  }
  logDetailedMemory("before enrollment queue save");
  const bool queueSavedToSd =
      g_storage.saveEnrollmentQueueToSd(session, downloadedStudents);
  logDetailedMemory("after enrollment queue save");

  bool usingSdQueue = false;
  if (queueSavedToSd) {
    g_storage.savePendingStudents({});
    std::vector<StudentInfo>().swap(g_cachedPendingStudents);
    usingSdQueue = loadEnrollmentQueuePage(0);
  }

  if (!usingSdQueue) {
    if (!queueSavedToSd) {
      Serial.println("[ENROLL][QUEUE] SD unavailable, falling back to LittleFS");
    }
    g_enrollmentQueuePagedFromSd = false;
    g_enrollmentQueueStats = EnrollmentQueueStats{};
    g_enrollmentQueuePageOffset = 0;
    g_cachedPendingStudents = downloadedStudents;
    g_storage.savePendingStudents(downloadedStudents);
  } else {
    std::vector<StudentInfo>().swap(downloadedStudents);
  }

  if (g_cachedPendingStudents.empty()) {
    showTimedMessage("Queue Empty", "Nothing to enroll", kMediumMessageMs);
    g_feedback.warning();
    return;
  }

  g_pendingStudentIndex = 0;
  setScreen(AppScreen::EnrollmentStudentSelection);
  if (usingSdQueue) {
    showTimedMessage("Session Ready", trim16(session.sessionId), kShortMessageMs,
                     "SD queue ready", "");
  } else {
    showTimedMessage("SD unavailable", "Limited queue", kMediumMessageMs,
                     trim16(session.sessionId), "");
  }
}

void enrollSelectedStudent() {
  if (g_cachedPendingStudents.empty()) {
    showTimedMessage("Queue Empty", "Nothing to enroll", kMediumMessageMs);
    setScreen(AppScreen::Menu);
    return;
  }

  g_pendingStudentIndex = clampIndex(g_pendingStudentIndex, g_cachedPendingStudents);
  StudentInfo student = g_cachedPendingStudents[g_pendingStudentIndex];
  if (student.templateId > 0 || student.enrollmentStatus == "enrolled" ||
      student.syncStatus == "synced") {
    showTimedMessage("Already Enrolled", student.schoolId, kShortMessageMs);
    return;
  }

  clearTimedMessage();
  g_display.show("Check Finger", "Place finger...");
  const FingerprintMatch existingMatch =
      waitForFingerprintLookup(8000);
  if (existingMatch.status == FingerprintScanStatus::Error) {
    showTimedMessage("Check Failed", trim16(existingMatch.message),
                     kLongMessageMs);
    g_feedback.error();
    return;
  }
  if (existingMatch.status == FingerprintScanStatus::Matched) {
    FingerprintTemplateOwnership ownership =
        g_storage.resolveTemplateOwnership(existingMatch.templateId);
    if (ownership.state == FingerprintOwnershipState::None) {
      ownership =
          g_storage.resolveTemplateOwnershipFromSd(existingMatch.templateId);
    }
    if (ownership.state == FingerprintOwnershipState::None &&
        g_wifi.hasCredentials() && connectForOnlineTask("Check Finger")) {
      AttendanceOwnerResolution resolution;
      String ownerError;
      const String eventId =
          g_pairedEvent.isValid() ? g_pairedEvent.eventId : String("");
      if (g_backend.resolveAttendanceOwner(existingMatch.templateId, eventId,
                                          resolution, ownerError) &&
          resolution.ownerFound) {
        ownership.state = FingerprintOwnershipState::Unique;
        ownership.student = resolution.student;
        ownership.activeOwners = 1;
        ownership.totalMatches = 1;
        g_storage.upsertFingerprintMappingCacheOnly(resolution.student);
      }
      disconnectAfterOnlineTask();
    }
    if (ownership.state == FingerprintOwnershipState::Unique) {
      if (ownership.student.studentUid == student.studentUid) {
        showTimedMessage("Already Enrolled", student.schoolId, kLongMessageMs,
                         "Use cleanup", "before replace");
      } else {
        showTimedMessage("Finger In Use",
                         trim16(ownership.student.schoolId.isEmpty()
                                    ? ownership.student.studentUid
                                    : ownership.student.schoolId),
                         kLongMessageMs, "Cleanup first", "");
      }
    } else {
      showTimedMessage("Cleanup Needed", "Admin review", kLongMessageMs,
                       "Duplicate or", "stale template");
    }
    g_feedback.warning();
    return;
  }

  const int templateId = g_storage.nextFreeTemplateId(
      CampusConfig::kFingerprintFirstTemplateId,
      CampusConfig::kFingerprintLastTemplateId);
  if (templateId < 0) {
    showTimedMessage("Sensor Full", "Delete old slots", kLongMessageMs);
    g_feedback.error();
    return;
  }

  clearTimedMessage();
  g_display.show("Enroll Finger", "Place finger...");

  String enrollError;
  logDetailedMemory("before enroll operation");
  if (!g_fingerprint.enrollTemplate(templateId, enrollError)) {
    showTimedMessage("Enroll Failed", trim16(enrollError), kLongMessageMs);
    g_feedback.error();
    return;
  }

  const TimeSnapshot snapshot = g_time.now();
  student.sessionId = g_currentEnrollmentSession.sessionId;
  student.templateId = templateId;
  student.enrollmentSynced = false;
  student.fingerprintStatus = "enrolled";
  student.fingerprintDeviceId = g_storage.deviceId();
  student.enrollmentStatus = "enrolled";
  student.syncStatus = "pending";
  student.remarks = "";
  student.enrolledAtIso = snapshot.iso8601;
  CampusEligibility::normalizeStudent(student);
  g_cachedPendingStudents[g_pendingStudentIndex] = student;
  if (!g_enrollmentQueuePagedFromSd) {
    g_storage.savePendingStudents(g_cachedPendingStudents);
  }
  if (!g_storage.upsertFingerprintMapping(student)) {
    showTimedMessage("Save Failed", "Check storage", kLongMessageMs,
                     student.schoolId, "");
    g_feedback.error();
    return;
  }
  if (g_enrollmentQueuePagedFromSd) {
    const int currentIndex = g_pendingStudentIndex;
    loadEnrollmentQueuePage(g_enrollmentQueuePageOffset);
    if (!g_cachedPendingStudents.empty()) {
      g_pendingStudentIndex =
          currentIndex >= static_cast<int>(g_cachedPendingStudents.size())
              ? static_cast<int>(g_cachedPendingStudents.size()) - 1
              : currentIndex;
    } else {
      g_pendingStudentIndex = 0;
    }
  }
  logDetailedMemory("after enroll operation");

  if (g_pairedEvent.isValid()) {
    const CampusEligibility::EventEligibilityDecision decision =
        g_storage.evaluateStudentEligibilityForEvent(g_pairedEvent, student);
    logEligibilityDecision(templateId, student, g_pairedEvent, decision);
    if (decision.allowed || decision.matchedPairedRoster ||
        decision.matchedTargetedStudent || decision.matchedTargetedSchoolId) {
      upsertCachedPairedStudent(student);
      Serial.printf("[ENROLL] paired context updated student=%s reason=%s\n",
                    student.studentUid.c_str(), decision.finalReason.c_str());
    }
  }

  Serial.printf("[ENROLL] student=%s template=%d pendingSync=%u\n",
                student.studentUid.c_str(), templateId,
                static_cast<unsigned>(g_storage.unsyncedEnrollmentCount()));
  showTimedMessage("Saved Offline", student.schoolId, kShortMessageMs);
  g_feedback.success();
}

void enterAttendanceScanMode(AttendanceCaptureMode mode) {
  g_attendanceCaptureMode = mode;
  g_waitingForFingerRemoval = false;
  g_lastAttendancePollAt = 0;
  g_lastAttendancePromptUnsyncedCount = static_cast<size_t>(-1);
  setFingerprintState("ready");
  setScreen(AppScreen::AttendanceScan);
}

void enterTimeOutModeWithConfirmation() {
  if (isTimeOutFinalizedForCurrentEvent()) {
    enterAttendanceScanMode(AttendanceCaptureMode::TimeOut);
    return;
  }

  Serial.println(
      "[ATTEND] WARNING: TIME OUT is final. You cannot return to TIME IN. "
      "Proceed?");
  g_timeOutConfirmIndex = 1;
  setScreen(AppScreen::TimeOutConfirmation);
}

void enterAttendanceMode() {
  loadStoredPairedEventContext();
  if (!g_pairedEvent.isValid()) {
    showTimedMessage("No Event", "Pair event first", kMediumMessageMs);
    g_feedback.error();
    return;
  }

  if (g_pairedEventRecoveredFromAttendance) {
    showTimedMessage("Recovered Event", "Sync records first", kLongMessageMs,
                     trim16(g_pairedEvent.title), trim16(g_pairedEvent.date));
    g_feedback.warning();
    return;
  }

  if (!g_fingerprint.isReady()) {
    showTimedMessage("Scanner Offline", "Check AS608", kMediumMessageMs);
    g_feedback.error();
    return;
  }

  g_attendanceModeIndex = 0;
  g_attendanceCaptureMode = AttendanceCaptureMode::None;
  setScreen(AppScreen::AttendanceMenu);
}

void leaveAttendanceMode() {
  g_waitingForFingerRemoval = false;
  g_attendanceCaptureMode = AttendanceCaptureMode::None;
  setFingerprintState("idle");
  disconnectAfterOnlineTask();
  setScreen(AppScreen::Menu);
}

void handleAttendanceLoop() {
  if (g_message.active || g_waitingForFingerRemoval ||
      g_attendanceCaptureMode == AttendanceCaptureMode::None) {
    return;
  }

  const uint32_t now = millis();
  if ((now - g_lastAttendancePollAt) < CampusConfig::kAttendancePollMs) {
    return;
  }
  g_lastAttendancePollAt = now;

  const FingerprintMatch match = g_fingerprint.scanOnce();
  if (match.status == FingerprintScanStatus::NoFinger) {
    setFingerprintState("idle");
    return;
  }

  if (match.status == FingerprintScanStatus::NotFound) {
    setFingerprintState("not-found");
    showTimedMessage("Not Registered", "See operator", kShortMessageMs);
    g_feedback.error();
    startFingerRemovalWait();
    return;
  }

  if (match.status == FingerprintScanStatus::Error) {
    setFingerprintState("error");
    showTimedMessage("Scan Error", trim16(match.message), kShortMessageMs);
    g_feedback.error();
    startFingerRemovalWait();
    return;
  }

  setFingerprintState("matched");
  StudentInfo student;
  bool backendEligibilityKnown = false;
  bool backendEventAllowed = false;
  String backendReason;
  if (!resolveAttendanceOwnerForMatch(match, student, backendEligibilityKnown,
                                      backendEventAllowed, backendReason)) {
    return;
  }

  Serial.printf(
      "[ATTEND] templateId=%d matched uid=%s schoolId=%s name=%s course=%s "
      "year=%s section=%s\n",
      match.templateId, student.studentUid.c_str(), student.schoolId.c_str(),
      student.studentName.c_str(), student.course.c_str(),
      student.yearLevel.c_str(), student.section.c_str());
  if (applyPairedEventStudentContext(student)) {
    Serial.printf(
        "[ATTEND] paired context applied uid=%s schoolId=%s course=%s year=%s\n",
        student.studentUid.c_str(), student.schoolId.c_str(),
        student.course.c_str(), student.yearLevel.c_str());
  }
  if (backendEligibilityKnown) {
    Serial.printf(
        "[ATTEND] eligibility allowed=%s reason=%s ownerFound=yes source=backend\n",
        backendEventAllowed ? "yes" : "no", backendReason.c_str());
    if (!backendEventAllowed) {
      Serial.printf("[ATTEND] rejected reason=%s ownerFound=yes\n",
                    backendReason.c_str());
      showTimedMessage(
          backendEligibilityTitle(backendReason),
          trim16(student.studentName.isEmpty() ? student.schoolId
                                               : student.studentName),
          kMediumMessageMs, trim16(backendEligibilityDetail(backendReason)),
          trim16(backendReason));
      g_feedback.error();
      startFingerRemovalWait();
      return;
    }
  } else {
    Serial.printf("[ATTEND][ELIG] using cached paired event context=%s\n",
                  g_storage.hasPairedEventContextCache() ? "yes" : "no");
    const CampusEligibility::EventEligibilityDecision decision =
        g_storage.evaluateStudentEligibilityForEvent(g_pairedEvent, student);
    Serial.printf("[ATTEND][ELIG] targetMode=%s\n",
                  eligibilityTargetModeLabel(g_pairedEvent).c_str());
    Serial.printf("[ATTEND][ELIG] student normCourse=%s normYear=%s normSection=%s\n",
                  decision.normalizedStudentCourse.c_str(),
                  decision.normalizedStudentYearLevel.c_str(),
                  decision.normalizedStudentSection.c_str());
    Serial.printf("[ATTEND][ELIG] event normCourse=%s normYear=%s normSection=%s\n",
                  decision.eventCourseFilter.c_str(),
                  decision.eventYearLevelFilter.c_str(),
                  decision.eventSectionFilter.c_str());
    if (decision.targetModeSpecific) {
      Serial.println("[ATTEND][ELIG] targeted list check started");
    }
    Serial.printf("[ATTEND] eligibility allowed=%s reason=%s\n",
                  decision.allowed ? "yes" : "no", decision.finalReason.c_str());
    if (decision.allowed) {
      if (decision.targetModeSpecific) {
        Serial.println("[ATTEND][ELIG] targeted list accepted");
      } else if (decision.usedBroadAudienceFilters) {
        Serial.println("[ATTEND][ELIG] broad scope accepted");
      }
    } else if (decision.targetModeSpecific) {
      Serial.printf("[ATTEND][ELIG] targeted list rejected reason=%s\n",
                    decision.finalReason.c_str());
    } else if (decision.finalReason == "student_not_in_target_scope") {
      Serial.printf("[ATTEND][ELIG] broad scope rejected reason=%s\n",
                    decision.finalReason.c_str());
    }
    logEligibilityDecision(match.templateId, student, g_pairedEvent, decision);
    if (!decision.allowed) {
      Serial.printf("[ATTEND] rejected reason=%s ownerFound=yes\n",
                    decision.finalReason.c_str());
      if (decision.stalePairedEventData) {
        showTimedMessage("Event audience", "data incomplete", kMediumMessageMs,
                         "Re-pair event", "context");
      } else {
        showTimedMessage(CampusEligibility::rejectionTitle(decision),
                         trim16(student.studentName.isEmpty() ? student.schoolId
                                                              : student.studentName),
                         kMediumMessageMs,
                         trim16(CampusEligibility::rejectionDetail(decision)),
                         trim16(decision.finalReason));
      }
      g_feedback.error();
      startFingerRemovalWait();
      return;
    }

    if (!decision.matchedPairedRoster &&
        (decision.usedBroadAudienceFilters || decision.matchedTargetedStudent ||
         decision.matchedTargetedSchoolId)) {
      upsertCachedPairedStudent(student);
      Serial.printf("[ATTEND] paired roster refreshed student=%s source=%s\n",
                    student.studentUid.c_str(), decision.finalReason.c_str());
    }
  }

  AttendanceRecord record;
  String message;
  const AttendanceOutcome outcome =
      isTimeOutMode()
          ? g_attendance.recordTimeOut(g_pairedEvent, student, match.templateId, record,
                                       message)
          : g_attendance.recordTimeIn(g_pairedEvent, student, match.templateId, record,
                                      message);

  if (outcome == AttendanceOutcome::TimeInRecorded) {
    Serial.printf(
        "[ATTEND] time-in saved student=%s status=%s unsynced=%u sdWrite=%s\n",
        student.studentUid.c_str(), record.attendanceStatus.c_str(),
        static_cast<unsigned>(g_storage.unsyncedAttendanceCount()),
        g_storage.lastSdWriteSucceeded() ? "ok" : "fail");
    showTimedMessage(student.studentName, "Time In saved", kShortMessageMs, "",
                     record.attendanceStatus);
    g_feedback.success();
  } else if (outcome == AttendanceOutcome::TimeOutRecorded) {
    Serial.printf(
        "[ATTEND] time-out saved student=%s status=%s unsynced=%u sdWrite=%s\n",
        student.studentUid.c_str(), record.attendanceStatus.c_str(),
        static_cast<unsigned>(g_storage.unsyncedAttendanceCount()),
        g_storage.lastSdWriteSucceeded() ? "ok" : "fail");
    if (record.attendanceStatus == "Present") {
      Serial.println("[ATTEND] status updated to Present");
      showTimedMessage(student.studentName, "Time Out saved", kShortMessageMs,
                       "Status updated", "to Present");
    } else {
      showTimedMessage(student.studentName, "Time Out saved", kShortMessageMs);
    }
    g_feedback.success();
  } else if (outcome == AttendanceOutcome::TimeInTooEarly) {
    Serial.printf(
        "[ATTEND] TIME IN blocked before start student=%s date=%s start=%s\n",
        student.studentUid.c_str(), g_pairedEvent.date.c_str(),
        g_pairedEvent.scheduledTime.c_str());
    showTimeInBlockedMessage(g_pairedEvent);
    g_feedback.warning();
  } else if (outcome == AttendanceOutcome::DuplicateTimeIn) {
    Serial.println("[ATTEND] TIME IN already recorded");
    showTimedMessage("TIME IN", "already recorded", kShortMessageMs);
    g_feedback.warning();
  } else if (outcome == AttendanceOutcome::TimeOutAlreadyDone) {
    Serial.println("[ATTEND] TIME OUT already done. Cannot return to TIME IN");
    showTimedMessage("TIME OUT", "already done", kLongMessageMs,
                     "Cannot return", "to TIME IN");
    g_feedback.warning();
  } else if (outcome == AttendanceOutcome::DuplicateTimeOut) {
    Serial.println("[ATTEND] TIME OUT already recorded");
    showTimedMessage("TIME OUT", "already recorded", kShortMessageMs);
    g_feedback.warning();
  } else if (outcome == AttendanceOutcome::MissingTimeIn) {
    Serial.println("[ATTEND] No TIME IN record found. Cannot TIME OUT");
    showTimedMessage("No TIME IN", "record found", kMediumMessageMs,
                     "Cannot TIME OUT");
    g_feedback.warning();
  } else {
    showTimedMessage("Save Failed", trim16(message), kShortMessageMs);
    g_feedback.error();
  }

  startFingerRemovalWait();
}

void mergeBackupEventMetadata(const AttendanceRecord &record, EventInfo &event) {
  if (event.eventId.isEmpty()) {
    event.eventId = record.eventId;
  }
  if (event.title.isEmpty()) {
    event.title = record.eventTitle;
  }
  if (event.date.isEmpty()) {
    event.date = record.eventDate;
  }
  if (event.scheduledTime.isEmpty()) {
    event.scheduledTime = record.scheduledTimeStart;
  }
  if (event.scheduledTimeEnd.isEmpty()) {
    event.scheduledTimeEnd = record.scheduledTimeEnd;
  }
  if (event.location.isEmpty()) {
    event.location = record.eventLocation;
  }

  if (event.title.isEmpty()) {
    event.title = record.eventId;
  }
}

void addBackupEventCandidate(const AttendanceRecord &record,
                             std::vector<EventInfo> &events) {
  if (record.eventId.isEmpty()) {
    return;
  }

  for (auto &event : events) {
    if (event.eventId == record.eventId) {
      mergeBackupEventMetadata(record, event);
      return;
    }
  }

  EventInfo event;
  if (g_pairedEvent.isValid() && g_pairedEvent.eventId == record.eventId) {
    event = g_pairedEvent;
  }
  mergeBackupEventMetadata(record, event);
  events.push_back(event);
}

void runExportBackup() {
  if (!g_storage.ensureSdReady()) {
    Serial.println("[BACKUP] blocked: SD card mount failed");
    showTimedMessage("Backup Failed", "Insert/check SD", kLongMessageMs,
                     "Card not mounted", "Retry export");
    g_feedback.error();
    return;
  }

  const std::vector<AttendanceRecord> records = g_storage.loadAttendanceRecords();
  if (records.empty()) {
    Serial.println("[BACKUP] no attendance records to export");
    showTimedMessage("No Records", "Nothing to export", kMediumMessageMs);
    g_feedback.warning();
    return;
  }

  std::vector<EventInfo> backupEvents;
  backupEvents.reserve(records.size());
  for (const auto &record : records) {
    addBackupEventCandidate(record, backupEvents);
  }

  if (backupEvents.empty()) {
    Serial.println("[BACKUP] failed: no event metadata available");
    showTimedMessage("Backup Failed", "Event data missing", kMediumMessageMs);
    g_feedback.error();
    return;
  }

  TimeSnapshot generatedAt = g_time.now();
  if (!generatedAt.valid) {
    generatedAt.iso8601 = "unknown";
    generatedAt.source = "unknown";
  }

  size_t exportedCount = 0;
  size_t failedCount = 0;
  for (const auto &event : backupEvents) {
    String path;
    if (g_storage.exportAttendanceCsv(event, generatedAt, path)) {
      ++exportedCount;
      Serial.printf("[BACKUP] exported event=%s path=%s\n", event.eventId.c_str(),
                    path.c_str());
    } else {
      ++failedCount;
      Serial.printf("[BACKUP] export failed event=%s\n", event.eventId.c_str());
    }
  }

  if (exportedCount == 0) {
    showTimedMessage("Backup Failed", "Export error", kMediumMessageMs);
    g_feedback.error();
    return;
  }

  if (failedCount > 0) {
    showTimedMessage("Backup Partial", "Files: " + String(exportedCount),
                     kLongMessageMs, "Failed: " + String(failedCount),
                     "See Serial");
    g_feedback.warning();
    return;
  }

  showTimedMessage("Backup Exported", "Files: " + String(exportedCount),
                   kLongMessageMs, "Saved to SD", "/exports");
  g_feedback.success();
}

void enterClearPairedEventConfirmation() {
  String message;
  if (!canAdminClearPairedEvent(message)) {
    Serial.printf("[PAIR] clear blocked: %s\n", message.c_str());
    showTimedMessage("Clear Blocked", "Unsynced records", kLongMessageMs,
                     "Run Sync Records", "or Export Backup");
    g_feedback.warning();
    return;
  }

  g_clearPairConfirmIndex = 1;
  setScreen(AppScreen::ClearPairConfirmation);
}

void runWifiSetup() {
  if (!allowInteractiveOnlineTask()) {
    return;
  }

  String message;
  const WifiSetupResult result =
      g_wifi.runSetupPortal(g_display, g_buttons, message,
                            CampusConfig::kSetupPortalTimeoutMs);

  switch (result) {
    case WifiSetupResult::Configured:
      showTimedMessage("Wi-Fi Ready", trim16(message), kMediumMessageMs);
      g_feedback.success();
      break;
    case WifiSetupResult::Cancelled:
      showTimedMessage("Wi-Fi Setup", "Cancelled", kShortMessageMs);
      break;
    case WifiSetupResult::TimedOut:
      showTimedMessage("Wi-Fi Setup", "Timed out", kShortMessageMs);
      g_feedback.warning();
      break;
    case WifiSetupResult::Failed:
    default:
      showTimedMessage("Wi-Fi Setup", trim16(message), kMediumMessageMs);
      g_feedback.error();
      break;
  }

  setScreen(AppScreen::Menu);
}

void handleMenuAction(ButtonAction action) {
  if (action == ButtonAction::Up) {
    g_menuIndex =
        (g_menuIndex == 0) ? static_cast<int>(kMenuItemCount) - 1 : g_menuIndex - 1;
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Down) {
    g_menuIndex = (g_menuIndex + 1) % static_cast<int>(kMenuItemCount);
    markDisplayDirty();
    return;
  }

  if (action != ButtonAction::Select) {
    return;
  }

  switch (g_menuIndex) {
    case 0:
      beginPairEventFlow();
      break;
    case 1:
      beginEnrollmentFlow();
      break;
    case 2:
      enterAttendanceMode();
      break;
    case 3:
      enterSyncRecordsMenu();
      break;
    case 4:
      runExportBackup();
      break;
    case 5:
      enterClearPairedEventConfirmation();
      break;
    case 6:
      runWifiSetup();
      break;
    default:
      break;
  }
}

void handleSyncRecordsMenuAction(ButtonAction action) {
  if (action == ButtonAction::Up) {
    g_syncRecordsMenuIndex =
        (g_syncRecordsMenuIndex == 0)
            ? static_cast<int>(kSyncRecordsMenuItemCount) - 1
            : g_syncRecordsMenuIndex - 1;
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Down) {
    g_syncRecordsMenuIndex =
        (g_syncRecordsMenuIndex + 1) %
        static_cast<int>(kSyncRecordsMenuItemCount);
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Back) {
    setScreen(AppScreen::Menu);
    return;
  }

  if (action != ButtonAction::Select) {
    return;
  }

  SyncMode selectedMode = SyncMode::None;
  switch (g_syncRecordsMenuIndex) {
    case 0:
      selectedMode = SyncMode::AttendanceOnly;
      break;
    case 1:
      selectedMode = SyncMode::EnrollmentOnly;
      break;
    case 2:
      selectedMode = SyncMode::FingerprintRoster;
      break;
    case 3:
      selectedMode = SyncMode::PairedEventData;
      break;
    case 4:
      selectedMode = SyncMode::CleanupQueue;
      break;
    case 5:
      selectedMode = SyncMode::Full;
      break;
    case 6:
    default:
      setScreen(AppScreen::Menu);
      return;
  }

  Serial.printf("[SYNC][MENU] selected=%s\n", syncModeName(selectedMode));
  runSync(selectedMode);
}

void handlePairEventAction(ButtonAction action) {
  if (g_cachedAvailableEvents.empty()) {
    setScreen(AppScreen::Menu);
    return;
  }

  if (action == ButtonAction::Up) {
    g_pairEventIndex = (g_pairEventIndex == 0)
                           ? static_cast<int>(g_cachedAvailableEvents.size()) - 1
                           : g_pairEventIndex - 1;
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Down) {
    g_pairEventIndex =
        (g_pairEventIndex + 1) % static_cast<int>(g_cachedAvailableEvents.size());
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Back) {
    setScreen(AppScreen::Menu);
    return;
  }

  if (action == ButtonAction::Select) {
    confirmSelectedPairEvent();
  }
}

void handleEnrollmentSessionAction(ButtonAction action) {
  if (g_cachedEnrollmentSessions.empty()) {
    setScreen(AppScreen::Menu);
    return;
  }

  if (action == ButtonAction::Up) {
    g_enrollmentSessionIndex =
        (g_enrollmentSessionIndex == 0)
            ? static_cast<int>(g_cachedEnrollmentSessions.size()) - 1
            : g_enrollmentSessionIndex - 1;
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Down) {
    g_enrollmentSessionIndex =
        (g_enrollmentSessionIndex + 1) %
        static_cast<int>(g_cachedEnrollmentSessions.size());
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Back) {
    setScreen(AppScreen::Menu);
    return;
  }

  if (action == ButtonAction::Select) {
    confirmSelectedEnrollmentSession();
  }
}

void handleEnrollmentStudentAction(ButtonAction action) {
  if (g_cachedPendingStudents.empty()) {
    showTimedMessage("Queue Empty", "Nothing to enroll", kMediumMessageMs);
    setScreen(AppScreen::Menu);
    return;
  }

  if (action == ButtonAction::Up) {
    if (g_enrollmentQueuePagedFromSd && !g_cachedPendingStudents.empty()) {
      if (g_pendingStudentIndex > 0) {
        --g_pendingStudentIndex;
      } else if (g_enrollmentQueueStats.pendingRows > 0) {
        if (g_enrollmentQueuePageOffset == 0) {
          const size_t lastOffset =
              ((g_enrollmentQueueStats.pendingRows - 1U) / kEnrollmentQueuePageSize) *
              kEnrollmentQueuePageSize;
          loadEnrollmentQueuePage(lastOffset);
        } else {
          const size_t previousOffset =
              g_enrollmentQueuePageOffset >= kEnrollmentQueuePageSize
                  ? g_enrollmentQueuePageOffset - kEnrollmentQueuePageSize
                  : 0;
          loadEnrollmentQueuePage(previousOffset);
        }
        if (!g_cachedPendingStudents.empty()) {
          g_pendingStudentIndex =
              static_cast<int>(g_cachedPendingStudents.size()) - 1;
        }
      }
      markDisplayDirty();
      return;
    }

    g_pendingStudentIndex = (g_pendingStudentIndex == 0)
                                ? static_cast<int>(g_cachedPendingStudents.size()) - 1
                                : g_pendingStudentIndex - 1;
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Down) {
    if (g_enrollmentQueuePagedFromSd && !g_cachedPendingStudents.empty()) {
      if ((g_pendingStudentIndex + 1) <
          static_cast<int>(g_cachedPendingStudents.size())) {
        ++g_pendingStudentIndex;
      } else if (g_enrollmentQueueStats.pendingRows > 0) {
        const size_t nextOffset = g_enrollmentQueuePageOffset +
                                  g_cachedPendingStudents.size();
        if (nextOffset >= g_enrollmentQueueStats.pendingRows) {
          loadEnrollmentQueuePage(0);
        } else {
          loadEnrollmentQueuePage(nextOffset);
        }
        g_pendingStudentIndex = 0;
      }
      markDisplayDirty();
      return;
    }

    g_pendingStudentIndex =
        (g_pendingStudentIndex + 1) % static_cast<int>(g_cachedPendingStudents.size());
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Back) {
    setScreen(AppScreen::Menu);
    return;
  }

  if (action == ButtonAction::Select) {
    enrollSelectedStudent();
  }
}

void handleAttendanceMenuAction(ButtonAction action) {
  if (action == ButtonAction::Up || action == ButtonAction::Down) {
    g_attendanceModeIndex =
        g_attendanceModeIndex == 0 ? 1 : 0;
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Back) {
    leaveAttendanceMode();
    return;
  }

  if (action != ButtonAction::Select) {
    return;
  }

  if (g_attendanceModeIndex == 0) {
    if (isTimeOutFinalizedForCurrentEvent()) {
      const String exact =
          "Time out already done. Cannot proceed to Time in";
      Serial.printf("[ATTEND] %s\n", exact.c_str());
      showWrappedMessage(exact, kLongMessageMs);
      g_feedback.warning();
      return;
    }

    if (!g_attendance.canStartTimeIn(g_pairedEvent)) {
      Serial.printf("[ATTEND] TIME IN blocked before start date=%s start=%s\n",
                    g_pairedEvent.date.c_str(),
                    g_pairedEvent.scheduledTime.c_str());
      showTimeInBlockedMessage(g_pairedEvent);
      g_feedback.warning();
      return;
    }

    enterAttendanceScanMode(AttendanceCaptureMode::TimeIn);
    return;
  }

  enterTimeOutModeWithConfirmation();
}

void handleTimeOutConfirmationAction(ButtonAction action) {
  if (action == ButtonAction::Up || action == ButtonAction::Down) {
    g_timeOutConfirmIndex = g_timeOutConfirmIndex == 0 ? 1 : 0;
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Back) {
    setScreen(AppScreen::AttendanceMenu);
    return;
  }

  if (action != ButtonAction::Select) {
    return;
  }

  if (g_timeOutConfirmIndex == 1) {
    Serial.println("[ATTEND] TIME OUT confirmation cancelled");
    setScreen(AppScreen::AttendanceMenu);
    return;
  }

  g_pairedEvent.timeOutFinalized = true;
  persistPairedEventState();
  Serial.println("[ATTEND] TIME OUT finalized for current event");
  enterAttendanceScanMode(AttendanceCaptureMode::TimeOut);
}

void handleClearPairConfirmationAction(ButtonAction action) {
  if (action == ButtonAction::Up || action == ButtonAction::Down) {
    g_clearPairConfirmIndex = g_clearPairConfirmIndex == 0 ? 1 : 0;
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Back) {
    setScreen(AppScreen::Menu);
    return;
  }

  if (action != ButtonAction::Select) {
    return;
  }

  if (g_clearPairConfirmIndex == 1) {
    Serial.println("[PAIR] clear pairing cancelled");
    setScreen(AppScreen::Menu);
    return;
  }

  String message;
  if (!canAdminClearPairedEvent(message)) {
    Serial.printf("[PAIR] clear blocked after confirmation: %s\n", message.c_str());
    showTimedMessage("Clear Blocked", "Unsynced records", kLongMessageMs,
                     "Run Sync Records", "or Export Backup");
    g_feedback.warning();
    setScreen(AppScreen::Menu);
    return;
  }

  if (!g_storage.clearPairedEvent()) {
    Serial.println("[PAIR] clear failed: storage error");
    showTimedMessage("Clear Failed", "Storage error", kMediumMessageMs);
    g_feedback.error();
    setScreen(AppScreen::Menu);
    return;
  }

  resetPairedEventState();
  Serial.println("[PAIR] paired event cleared by admin");
  showTimedMessage("Pairing Cleared", "Attendance kept", kLongMessageMs,
                   "Local logs intact", "");
  g_feedback.success();
  setScreen(AppScreen::Menu);
}

void handleAttendanceScanAction(ButtonAction action) {
  if (action == ButtonAction::Back) {
    setScreen(AppScreen::AttendanceMenu);
    g_attendanceCaptureMode = AttendanceCaptureMode::None;
    return;
  }

  handleAttendanceLoop();
}

void handleSyncScreenAction(ButtonAction action) {
  if (action == ButtonAction::Back && !isSyncActive()) {
    setScreen(AppScreen::SyncRecordsMenu);
  }
}

void logHeartbeat() {
  if ((millis() - g_lastDebugLogAt) < kDebugIntervalMs) {
    return;
  }

  g_lastDebugLogAt = millis();
  Serial.printf(
      "[DBG] heap=%u minHeap=%u wifi=%s screen=%s fp=%s attMode=%s timeoutFinal=%s "
      "pendingA=%u pendingE=%u sdReady=%s sdWrite=%s syncMode=%s syncPhase=%s\n",
      static_cast<unsigned>(ESP.getFreeHeap()),
      static_cast<unsigned>(ESP.getMinFreeHeap()), g_wifi.statusText().c_str(),
      screenName(g_screen), g_lastFingerprintState.c_str(),
      attendanceModeLabel(g_attendanceCaptureMode).c_str(),
      isTimeOutFinalizedForCurrentEvent() ? "yes" : "no",
      static_cast<unsigned>(g_storage.unsyncedAttendanceCount()),
      static_cast<unsigned>(g_storage.unsyncedEnrollmentCount()),
      g_storage.isSdReady() ? "yes" : "no",
      g_storage.lastSdWriteSucceeded() ? "ok" : "fail",
      syncModeName(g_sync.mode), syncPhaseName(g_sync.phase));
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);

  Wire.begin(Pins::kI2cSda, Pins::kI2cScl);

  g_buttons.begin();
  g_feedback.begin();
  g_storage.begin();
  g_wifi.begin();
  g_time.begin(g_storage);

  g_display.begin();
  g_display.show("CAMPUS Module", "Booting...");

  if (!g_wifi.hasCredentials()) {
    showTimedMessage("Wi-Fi not set", "Use Wi-Fi Setup", kShortMessageMs);
  }

  String fingerprintError;
  if (!g_fingerprint.begin(fingerprintError)) {
    showTimedMessage("Scanner Error", trim16(fingerprintError), kMediumMessageMs);
    setFingerprintState("offline");
  } else {
    setFingerprintState("ready");
  }

  loadStoredPairedEventContext();
  markDisplayDirty();
  Serial.printf("[BOOT] device=%s wifi=%s freeHeap=%u\n",
                g_storage.deviceId().c_str(), g_wifi.statusText().c_str(),
                static_cast<unsigned>(ESP.getFreeHeap()));
}

void loop() {
  g_feedback.update();
  updateTimedMessage();
  updateFingerRemovalWait();

  if (!g_message.active && g_screen == AppScreen::AttendanceScan) {
    const size_t unsyncedCount = g_storage.unsyncedAttendanceCount();
    if (unsyncedCount != g_lastAttendancePromptUnsyncedCount &&
        !g_waitingForFingerRemoval) {
      markDisplayDirty();
    }
  }

  tickSync();
  maybeStartAutoSync();

  renderCurrentScreen();

  if (!g_message.active) {
    const ButtonAction action = pollUiAction();
    switch (g_screen) {
      case AppScreen::Menu:
        handleMenuAction(action);
        break;
      case AppScreen::PairEventSelection:
        handlePairEventAction(action);
        break;
      case AppScreen::EnrollmentSessionSelection:
        handleEnrollmentSessionAction(action);
        break;
      case AppScreen::EnrollmentStudentSelection:
        handleEnrollmentStudentAction(action);
        break;
      case AppScreen::AttendanceMenu:
        handleAttendanceMenuAction(action);
        break;
      case AppScreen::SyncRecordsMenu:
        handleSyncRecordsMenuAction(action);
        break;
      case AppScreen::TimeOutConfirmation:
        handleTimeOutConfirmationAction(action);
        break;
      case AppScreen::ClearPairConfirmation:
        handleClearPairConfirmationAction(action);
        break;
      case AppScreen::AttendanceScan:
        handleAttendanceScanAction(action);
        break;
      case AppScreen::SyncProgress:
        handleSyncScreenAction(action);
        break;
    }
  }

  logHeartbeat();
  delay(5);
}
