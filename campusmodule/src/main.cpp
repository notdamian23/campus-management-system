#include <Arduino.h>
#include <time.h>
#include <Wire.h>

#include <vector>

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
int g_timeOutConfirmIndex = 1;
int g_clearPairConfirmIndex = 1;
std::vector<EventInfo> g_cachedAvailableEvents;
std::vector<StudentInfo> g_cachedPendingStudents;
std::vector<StudentInfo> g_cachedPairedStudents;
std::vector<EnrollmentSessionInfo> g_cachedEnrollmentSessions;
std::vector<String> g_remoteRecordedStudentIds;

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
constexpr uint32_t kUiActionGapMs = 140;
constexpr uint32_t kShortMessageMs = 1200;
constexpr uint32_t kMediumMessageMs = 1500;
constexpr uint32_t kLongMessageMs = 1800;
constexpr uint32_t kDebugIntervalMs = 30000;
constexpr uint32_t kFingerRemovalTimeoutMs = 3000;
constexpr uint32_t kAutoSyncQuietPeriodMs = 5000;
constexpr uint32_t kMaxAutoSyncBackoffMs = 15UL * 60UL * 1000UL;

enum class AppScreen : uint8_t {
  Menu,
  PairEventSelection,
  EnrollmentSessionSelection,
  EnrollmentStudentSelection,
  AttendanceMenu,
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
  Manual,
};

enum class SyncPhase : uint8_t {
  Idle,
  WaitForWifi,
  WaitForTime,
  UploadEnrollment,
  UploadAttendance,
  RefreshContext,
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
  size_t enrollmentUploads = 0;
  size_t attendanceUploads = 0;
  size_t duplicates = 0;
  String lastError;
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

  if (g_storage.hasUnsyncedAttendanceForEvent(g_pairedEvent.eventId)) {
    message = "Previous event attendance not yet synced.";
    return false;
  }

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
    case SyncMode::Manual:
      return "manual";
    case SyncMode::None:
    default:
      return "none";
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
    case SyncPhase::RefreshContext:
      return "Refresh evt";
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
  if (g_pairedEvent.isValid() && g_pairedEvent.eventId == event.eventId &&
      g_pairedEvent.timeOutFinalized) {
    eventToCache.timeOutFinalized = true;
  }

  g_pairedEvent = eventToCache;
  g_cachedPairedStudents = students;
  g_remoteRecordedStudentIds = recordedStudentIds;
  g_storage.savePairedEventContext(eventToCache, students, recordedStudentIds);
}

void loadStoredPairedEventContext() {
  EventInfo event;
  std::vector<StudentInfo> students;
  std::vector<String> recordedStudentIds;
  if (g_storage.loadPairedEventContext(event, students, recordedStudentIds)) {
    g_pairedEvent = event;
    g_cachedPairedStudents = students;
    g_remoteRecordedStudentIds = recordedStudentIds;
    return;
  }

  g_pairedEvent = g_storage.loadPairedEvent();
  g_cachedPairedStudents.clear();
  g_remoteRecordedStudentIds.clear();
}

void loadStoredEnrollmentSession() {
  g_currentEnrollmentSession = g_storage.loadCurrentEnrollmentSession();
  g_cachedPendingStudents = g_storage.loadPendingStudents();
  if (g_currentEnrollmentSession.isValid() && g_cachedPendingStudents.empty() &&
      g_storage.unsyncedEnrollmentCount() == 0) {
    g_storage.clearCurrentEnrollmentSession();
    g_currentEnrollmentSession = EnrollmentSessionInfo{};
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
  if (!g_backend.fetchPairedEventContext(event, students, recordedStudentIds,
                                         error)) {
    return false;
  }

  cachePairedEventContext(event, students, recordedStudentIds);
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
  g_display.showStudent(g_cachedPendingStudents[g_pendingStudentIndex],
                        g_pendingStudentIndex,
                        static_cast<int>(g_cachedPendingStudents.size()));
}

void renderAttendanceMenu() {
  g_display.showMenu("Attendance Mode", kAttendanceModeItems, g_attendanceModeIndex,
                     static_cast<int>(kAttendanceModeItemCount));
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
  String line2 = String(syncModeName(g_sync.mode)) + " " + syncPhaseName(g_sync.phase);
  String line3 = "E:" + String(g_sync.enrollmentUploads) + " A:" +
                 String(g_sync.attendanceUploads);
  String line4 = "Dup:" + String(g_sync.duplicates) + " Q:" +
                 String(g_storage.unsyncedAttendanceCount());
  g_display.showLines("Sync Records", line2, line3, line4);
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

String syncSummaryLine() {
  String line = "A:" + String(g_sync.attendanceUploads) + " D:" +
                String(g_sync.duplicates);
  if (g_sync.enrollmentUploads > 0) {
    line = "E:" + String(g_sync.enrollmentUploads) + " " + line;
  }
  return line;
}

void finishSyncSuccess() {
  Serial.printf("[SYNC] completed mode=%s E=%u A=%u D=%u\n",
                syncModeName(g_sync.mode),
                static_cast<unsigned>(g_sync.enrollmentUploads),
                static_cast<unsigned>(g_sync.attendanceUploads),
                static_cast<unsigned>(g_sync.duplicates));

  if (!g_sync.keepWifiConnected) {
    disconnectAfterOnlineTask();
  }

  if (g_sync.mode == SyncMode::Auto) {
    g_autoSyncBackoffMs = CampusConfig::kAutoSyncIntervalMs;
  } else {
    setScreen(AppScreen::Menu);
    showTimedMessage("Sync Complete", syncSummaryLine(), kLongMessageMs);
    g_feedback.success();
  }

  g_sync = SyncController{};
  markDisplayDirty();
}

void failSync(const String &error) {
  const String message = error.isEmpty() ? String("Sync failed") : error;
  Serial.printf("[SYNC] failed mode=%s error=%s\n", syncModeName(g_sync.mode),
                message.c_str());

  if (!g_sync.keepWifiConnected) {
    disconnectAfterOnlineTask();
  }

  if (g_sync.mode == SyncMode::Auto) {
    const uint32_t nextBackoff = g_autoSyncBackoffMs * 2UL;
    g_autoSyncBackoffMs =
        nextBackoff > kMaxAutoSyncBackoffMs ? kMaxAutoSyncBackoffMs : nextBackoff;
  } else {
    setScreen(AppScreen::Menu);
    showTimedMessage("Sync Partial", trim16(message), kLongMessageMs);
    g_feedback.warning();
  }

  g_sync = SyncController{};
  markDisplayDirty();
}

void startSync(SyncMode mode, bool keepWifiConnected) {
  if (isSyncActive()) {
    return;
  }

  if (!hasPendingSyncWork()) {
    if (mode == SyncMode::Manual) {
      showTimedMessage("Sync Records", "Nothing pending", kShortMessageMs);
    }
    return;
  }

  if (!g_wifi.hasCredentials()) {
    if (mode == SyncMode::Manual) {
      showTimedMessage("Wi-Fi not set", "Use Wi-Fi Setup", kMediumMessageMs);
      g_feedback.warning();
    }
    return;
  }

  g_sync = SyncController{};
  g_sync.mode = mode;
  g_sync.phase = SyncPhase::WaitForWifi;
  g_sync.keepWifiConnected = keepWifiConnected;
  g_lastAutoSyncAttemptAt = millis();

  if (mode == SyncMode::Manual) {
    setScreen(AppScreen::SyncProgress);
  }

  Serial.printf("[SYNC] start mode=%s pendingA=%u pendingE=%u\n",
                syncModeName(mode),
                static_cast<unsigned>(g_storage.unsyncedAttendanceCount()),
                static_cast<unsigned>(g_storage.unsyncedEnrollmentCount()));

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
      g_sync.phase = SyncPhase::UploadEnrollment;
      markDisplayDirty();
      return;
    }

    case SyncPhase::UploadEnrollment: {
      const std::vector<StudentInfo> pendingEnrollments =
          g_storage.loadUnsyncedEnrollments();
      if (pendingEnrollments.empty()) {
        g_sync.phase = SyncPhase::UploadAttendance;
        markDisplayDirty();
        return;
      }

      String error;
      const StudentInfo &student = pendingEnrollments.front();
      if (!g_backend.submitEnrollment(student, error)) {
        failSync(error);
        return;
      }

      g_storage.markEnrollmentSynced(student.studentUid);
      ++g_sync.enrollmentUploads;
      Serial.printf("[SYNC] enrollment uploaded student=%s\n",
                    student.studentUid.c_str());
      markDisplayDirty();
      return;
    }

    case SyncPhase::UploadAttendance: {
      const std::vector<AttendanceRecord> batch =
          g_storage.loadUnsyncedAttendanceBatch(CampusConfig::kSyncBatchSize);
      if (batch.empty()) {
        g_sync.phase = g_sync.contextRefreshNeeded && g_pairedEvent.isValid()
                           ? SyncPhase::RefreshContext
                           : SyncPhase::Complete;
        markDisplayDirty();
        return;
      }

      std::vector<SyncItemResult> results;
      String error;
      if (!g_backend.syncAttendance(batch, results, error)) {
        failSync(error);
        return;
      }

      g_storage.applySyncResults(results);
      for (const auto &result : results) {
        if (result.status == "uploaded") {
          ++g_sync.attendanceUploads;
          g_sync.contextRefreshNeeded = true;
        } else if (result.status == "duplicate") {
          ++g_sync.duplicates;
          g_sync.contextRefreshNeeded = true;
        }
      }

      g_lastAttendancePromptUnsyncedCount = static_cast<size_t>(-1);
      markDisplayDirty();
      return;
    }

    case SyncPhase::RefreshContext: {
      String error;
      if (!refreshPairedEventContext(error)) {
        Serial.printf("[SYNC] paired event refresh failed: %s\n", error.c_str());
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

void startManualSync() {
  if (!allowInteractiveOnlineTask()) {
    return;
  }
  startSync(SyncMode::Manual, false);
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
  const bool paired = g_backend.pairEvent(selectedEvent.eventId, pairedEvent, students,
                                          recordedStudentIds, error);
  disconnectAfterOnlineTask();

  if (!paired) {
    showTimedMessage("Pair Failed", trim16(error), kLongMessageMs);
    g_feedback.error();
    return;
  }

  cachePairedEventContext(pairedEvent, students, recordedStudentIds);
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
  const bool hasOfflineSession =
      g_currentEnrollmentSession.isValid() && !g_cachedPendingStudents.empty();

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

  if (g_cachedPendingStudents.empty()) {
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

  const bool downloaded = g_backend.downloadEnrollmentSession(
      session.sessionId, session, downloadedStudents, error);
  disconnectAfterOnlineTask();

  if (!downloaded) {
    showTimedMessage("Queue Failed", trim16(error), kMediumMessageMs);
    g_feedback.error();
    return;
  }

  g_currentEnrollmentSession = session;
  g_cachedPendingStudents = downloadedStudents;
  g_storage.saveCurrentEnrollmentSession(session);
  g_storage.savePendingStudents(downloadedStudents);
  g_pendingStudentIndex = 0;
  setScreen(AppScreen::EnrollmentStudentSelection);
  showTimedMessage("Session Ready", trim16(session.sessionId), kShortMessageMs);
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
  g_cachedPendingStudents[g_pendingStudentIndex] = student;
  g_storage.savePendingStudents(g_cachedPendingStudents);
  g_storage.upsertFingerprintMapping(student);

  for (auto &pairedStudent : g_cachedPairedStudents) {
    if (pairedStudent.studentUid == student.studentUid) {
      pairedStudent.templateId = templateId;
      pairedStudent.fingerprintStatus = "enrolled";
      pairedStudent.fingerprintDeviceId = g_storage.deviceId();
      pairedStudent.queueId = student.queueId;
      break;
    }
  }

  if (g_pairedEvent.isValid()) {
    g_storage.savePairedEventContext(g_pairedEvent, g_cachedPairedStudents,
                                     g_remoteRecordedStudentIds);
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
  if (!g_storage.findStudentByTemplate(match.templateId, student)) {
    showTimedMessage("No Mapping", "Enroll student", kMediumMessageMs);
    g_feedback.error();
    startFingerRemovalWait();
    return;
  }

  if (!g_storage.isStudentAuthorizedForEvent(g_pairedEvent.eventId,
                                             student.studentUid)) {
    showTimedMessage("Not In Roster", "See operator", kMediumMessageMs);
    g_feedback.warning();
    startFingerRemovalWait();
    return;
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
      startManualSync();
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
    g_pendingStudentIndex = (g_pendingStudentIndex == 0)
                                ? static_cast<int>(g_cachedPendingStudents.size()) - 1
                                : g_pendingStudentIndex - 1;
    markDisplayDirty();
    return;
  }

  if (action == ButtonAction::Down) {
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
    setScreen(AppScreen::Menu);
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
