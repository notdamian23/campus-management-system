#include <Arduino.h>
#include <Wire.h>

#include <algorithm>
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
bool g_attendanceMode = false;
int g_menuIndex = 0;
std::vector<StudentInfo> g_cachedPendingStudents;
std::vector<StudentInfo> g_cachedPairedStudents;
std::vector<EnrollmentSessionInfo> g_cachedEnrollmentSessions;
std::vector<String> g_remoteRecordedStudentIds;
uint32_t g_lastAutoSyncAttemptAt = 0;

constexpr const char *kMenuItems[] = {
    "Pair Event",
    "Enroll Student",
    "Attendance Mode",
    "Sync Records",
    "Wi-Fi Setup",
};
constexpr size_t kMenuItemCount = sizeof(kMenuItems) / sizeof(kMenuItems[0]);

String trim16(const String &value) {
  String output = value;
  output.trim();
  if (output.length() > CampusConfig::kLcdColumns) {
    output = output.substring(0, CampusConfig::kLcdColumns);
  }
  return output;
}

void showMessage(const String &line1, const String &line2, uint32_t holdMs) {
  g_display.show(line1, line2);
  if (holdMs > 0) {
    delay(holdMs);
  }
}

bool connectForOnlineTask(const String &line1) {
  showMessage(line1, "Wi-Fi connect...", 0);
  g_feedback.wifiPulse();

  String error;
  if (!g_wifi.connect(error, CampusConfig::kWifiTimeoutMs)) {
    showMessage("Wi-Fi Failed", trim16(error), 1500);
    g_feedback.error();
    return false;
  }

  g_time.syncWithNetwork(error);
  return true;
}

void disconnectAfterOnlineTask() {
  g_backend.clearSession();
  g_wifi.disconnect();
}

void renderMenu() {
  g_display.showMenu("CAMPUS Menu", kMenuItems, g_menuIndex,
                     static_cast<int>(kMenuItemCount));
}

void cachePairedEventContext(const EventInfo &event,
                             const std::vector<StudentInfo> &students,
                             const std::vector<String> &recordedStudentIds) {
  g_pairedEvent = event;
  g_cachedPairedStudents = students;
  g_remoteRecordedStudentIds = recordedStudentIds;
  g_storage.savePairedEventContext(event, students, recordedStudentIds);
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
}

String eventSubtitle(const EventInfo &event) {
  String line2 = event.date;
  if (!event.scheduledTime.isEmpty()) {
    if (!line2.isEmpty()) {
      line2 += " ";
    }
    line2 += event.scheduledTime;
  }
  if (line2.isEmpty()) {
    line2 = event.location;
  }
  return line2;
}

bool chooseEventFromList(const std::vector<EventInfo> &events, int &selectedIndex) {
  while (true) {
    const EventInfo &event = events[selectedIndex];
    g_display.showLines("Select Event", trim16(event.title),
                        trim16(eventSubtitle(event)), "UP/DN SEL BK");

    const ButtonAction action = g_buttons.poll();
    if (action == ButtonAction::Up) {
      selectedIndex = (selectedIndex == 0)
                          ? static_cast<int>(events.size()) - 1
                          : selectedIndex - 1;
      delay(120);
      continue;
    }
    if (action == ButtonAction::Down) {
      selectedIndex = (selectedIndex + 1) % static_cast<int>(events.size());
      delay(120);
      continue;
    }
    if (action == ButtonAction::Select) {
      delay(120);
      return true;
    }
    if (action == ButtonAction::Back) {
      delay(120);
      return false;
    }
    delay(30);
  }
}

bool chooseEnrollmentSessionFromList(
    const std::vector<EnrollmentSessionInfo> &sessions, int &selectedIndex) {
  while (true) {
    g_display.showEnrollmentSession(sessions[selectedIndex], selectedIndex,
                                    static_cast<int>(sessions.size()));

    const ButtonAction action = g_buttons.poll();
    if (action == ButtonAction::Up) {
      selectedIndex = (selectedIndex == 0)
                          ? static_cast<int>(sessions.size()) - 1
                          : selectedIndex - 1;
      delay(120);
      continue;
    }
    if (action == ButtonAction::Down) {
      selectedIndex = (selectedIndex + 1) % static_cast<int>(sessions.size());
      delay(120);
      continue;
    }
    if (action == ButtonAction::Select) {
      delay(120);
      return true;
    }
    if (action == ButtonAction::Back) {
      delay(120);
      return false;
    }
    delay(30);
  }
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

bool syncPendingWork(bool silent, size_t &enrollmentUploads,
                     size_t &attendanceUploads, size_t &duplicates,
                     String &error) {
  enrollmentUploads = 0;
  attendanceUploads = 0;
  duplicates = 0;

  std::vector<StudentInfo> pendingEnrollments = g_storage.loadUnsyncedEnrollments();
  for (auto &student : pendingEnrollments) {
    String itemError;
    if (g_backend.submitEnrollment(student, itemError)) {
      g_storage.markEnrollmentSynced(student.studentUid);
      ++enrollmentUploads;
    } else if (error.isEmpty()) {
      error = itemError;
    }
    delay(60);
  }

  while (true) {
    std::vector<AttendanceRecord> batch;
    for (const auto &record : g_storage.loadAttendanceRecords()) {
      if (!record.synced) {
        batch.push_back(record);
      }
      if (batch.size() >= CampusConfig::kSyncBatchSize) {
        break;
      }
    }

    if (batch.empty()) {
      break;
    }

    if (!silent) {
      g_display.showSyncProgress(attendanceUploads + 1,
                                 attendanceUploads + batch.size());
    }

    std::vector<SyncItemResult> results;
    String batchError;
    if (!g_backend.syncAttendance(batch, results, batchError)) {
      error = batchError;
      return false;
    }

    g_storage.applySyncResults(results);
    for (const auto &result : results) {
      if (result.status == "uploaded") {
        ++attendanceUploads;
      } else if (result.status == "duplicate") {
        ++duplicates;
      }
    }
    delay(90);
  }

  if (g_pairedEvent.isValid()) {
    String contextError;
    refreshPairedEventContext(contextError);
  }

  return true;
}

bool syncSingleRecordIfConnected(const AttendanceRecord &record, String &statusLabel) {
  if (!g_wifi.isConnected()) {
    return false;
  }

  std::vector<AttendanceRecord> batch = {record};
  std::vector<SyncItemResult> results;
  String error;
  if (!g_backend.syncAttendance(batch, results, error)) {
    return false;
  }

  g_storage.applySyncResults(results);
  for (const auto &result : results) {
    if (result.recordId != record.recordId) {
      continue;
    }
    if (result.status == "uploaded") {
      String contextError;
      refreshPairedEventContext(contextError);
      statusLabel = "Attendance Synced";
      return true;
    }
    if (result.status == "duplicate") {
      String contextError;
      refreshPairedEventContext(contextError);
      statusLabel = "Already Synced";
      return true;
    }
  }
  return false;
}

void runPairEvent() {
  if (!connectForOnlineTask("Pair Event")) {
    return;
  }

  std::vector<EventInfo> events;
  String error;
  if (!g_backend.fetchAvailableEvents(events, error)) {
    showMessage("Pair Failed", trim16(error), 1800);
    g_feedback.error();
    disconnectAfterOnlineTask();
    return;
  }

  if (events.empty()) {
    showMessage("No Events", "Create online evt", 1400);
    disconnectAfterOnlineTask();
    return;
  }

  int selectedIndex = 0;
  const bool confirmed = chooseEventFromList(events, selectedIndex);
  if (!confirmed) {
    showMessage("Pair Cancelled", "No changes made", 1200);
    disconnectAfterOnlineTask();
    return;
  }

  EventInfo pairedEvent;
  std::vector<StudentInfo> students;
  std::vector<String> recordedStudentIds;
  if (!g_backend.pairEvent(events[selectedIndex].eventId, pairedEvent, students,
                           recordedStudentIds, error)) {
    showMessage("Pair Failed", trim16(error), 1800);
    g_feedback.error();
    disconnectAfterOnlineTask();
    return;
  }

  cachePairedEventContext(pairedEvent, students, recordedStudentIds);
  showMessage("Event Paired", trim16(pairedEvent.title), 1500);
  g_feedback.success();
  disconnectAfterOnlineTask();
}

void removePendingStudent(const String &studentUid) {
  auto students = g_storage.loadPendingStudents();
  students.erase(
      std::remove_if(students.begin(), students.end(),
                     [&](const StudentInfo &student) {
                       return student.studentUid == studentUid;
                     }),
      students.end());
  g_storage.savePendingStudents(students);
  g_cachedPendingStudents = students;
}

void runEnrollStudent() {
  if (!g_fingerprint.isReady()) {
    showMessage("Enroll Blocked", "Scanner offline", 1500);
    g_feedback.error();
    return;
  }

  loadStoredEnrollmentSession();

  bool downloadedFreshSession = false;
  if (connectForOnlineTask("Enroll Student")) {
    String error;
    if (!g_backend.fetchEnrollmentSessions(g_cachedEnrollmentSessions, error)) {
      if (!g_currentEnrollmentSession.isValid() || g_cachedPendingStudents.empty()) {
        showMessage("Fetch Failed", trim16(error), 1500);
        g_feedback.error();
        disconnectAfterOnlineTask();
        return;
      }
    } else if (!g_cachedEnrollmentSessions.empty()) {
      int selectedIndex = 0;
      const bool confirmed =
          chooseEnrollmentSessionFromList(g_cachedEnrollmentSessions, selectedIndex);
      if (!confirmed) {
        showMessage("Enroll Cancel", "No session picked", 1200);
        disconnectAfterOnlineTask();
        return;
      }

      EnrollmentSessionInfo session;
      if (!g_backend.pairEnrollmentSession(
              g_cachedEnrollmentSessions[selectedIndex].sessionId, session,
              error)) {
        showMessage("Pair Failed", trim16(error), 1500);
        g_feedback.error();
        disconnectAfterOnlineTask();
        return;
      }

      std::vector<StudentInfo> downloadedStudents;
      if (!g_backend.downloadEnrollmentSession(session.sessionId, session,
                                               downloadedStudents, error)) {
        showMessage("Queue Failed", trim16(error), 1500);
        g_feedback.error();
        disconnectAfterOnlineTask();
        return;
      }

      g_currentEnrollmentSession = session;
      g_cachedPendingStudents = downloadedStudents;
      g_storage.saveCurrentEnrollmentSession(session);
      g_storage.savePendingStudents(downloadedStudents);
      downloadedFreshSession = true;
    }
    disconnectAfterOnlineTask();
  } else if (!g_currentEnrollmentSession.isValid() || g_cachedPendingStudents.empty()) {
    return;
  }

  if (!g_currentEnrollmentSession.isValid()) {
    showMessage("No Session", "Create online sess", 1400);
    return;
  }

  if (g_cachedPendingStudents.empty()) {
    showMessage("Queue Empty", "Nothing to enroll", 1400);
    return;
  }

  if (downloadedFreshSession) {
    showMessage("Session Ready", trim16(g_currentEnrollmentSession.sessionId), 1200);
  }

  int index = 0;
  while (true) {
    g_display.showStudent(g_cachedPendingStudents[index], index,
                          static_cast<int>(g_cachedPendingStudents.size()));

    const ButtonAction action = g_buttons.poll();
    if (action == ButtonAction::Up) {
      index = (index == 0) ? static_cast<int>(g_cachedPendingStudents.size()) - 1
                           : index - 1;
      delay(120);
    } else if (action == ButtonAction::Down) {
      index = (index + 1) % static_cast<int>(g_cachedPendingStudents.size());
      delay(120);
    } else if (action == ButtonAction::Back) {
      delay(120);
      break;
    } else if (action == ButtonAction::Select) {
      delay(120);

      StudentInfo student = g_cachedPendingStudents[index];
      if (student.templateId > 0 || student.enrollmentStatus == "enrolled" ||
          student.syncStatus == "synced") {
        showMessage("Already Enrolled", student.schoolId, 1200);
        continue;
      }

      const int templateId = g_storage.nextFreeTemplateId(
          CampusConfig::kFingerprintFirstTemplateId,
          CampusConfig::kFingerprintLastTemplateId);

      if (templateId < 0) {
        showMessage("Sensor Full", "Delete old slots", 1800);
        g_feedback.error();
        break;
      }

      showMessage("Enroll Finger", "Place finger...", 0);
      String enrollError;
      if (!g_fingerprint.enrollTemplate(templateId, enrollError)) {
        showMessage("Enroll Failed", trim16(enrollError), 1800);
        g_feedback.error();
        continue;
      }

      TimeSnapshot snapshot = g_time.now();
      student.sessionId = g_currentEnrollmentSession.sessionId;
      student.templateId = templateId;
      student.enrollmentSynced = false;
      student.fingerprintStatus = "enrolled";
      student.fingerprintDeviceId = g_storage.deviceId();
      student.enrollmentStatus = "enrolled";
      student.syncStatus = "pending";
      student.remarks = "";
      student.enrolledAtIso = snapshot.iso8601;
      g_cachedPendingStudents[index] = student;
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

      showMessage("Saved Offline", student.schoolId, 1200);
      g_feedback.success();
    }

    delay(30);
  }
}

void maybeAutoSync(bool keepWifiConnected) {
  if (!g_wifi.hasCredentials()) {
    return;
  }

  if ((millis() - g_lastAutoSyncAttemptAt) < CampusConfig::kAutoSyncIntervalMs) {
    return;
  }

  const bool hasPendingAttendance = g_storage.unsyncedAttendanceCount() > 0;
  const bool hasPendingEnrollments =
      !g_storage.loadUnsyncedEnrollments().empty();
  if (!hasPendingAttendance && !hasPendingEnrollments) {
    return;
  }

  g_lastAutoSyncAttemptAt = millis();

  String error;
  if (!g_wifi.isConnected() &&
      !g_wifi.connect(error, CampusConfig::kWifiTimeoutMs)) {
    return;
  }

  g_time.syncWithNetwork(error);

  size_t enrollmentUploads = 0;
  size_t attendanceUploads = 0;
  size_t duplicates = 0;
  String syncError;
  syncPendingWork(true, enrollmentUploads, attendanceUploads, duplicates,
                  syncError);

  if (!keepWifiConnected) {
    disconnectAfterOnlineTask();
  }
}

void enterAttendanceMode() {
  loadStoredPairedEventContext();
  if (!g_pairedEvent.isValid()) {
    showMessage("No Event", "Pair event first", 1500);
    g_feedback.error();
    return;
  }

  if (!g_fingerprint.isReady()) {
    showMessage("Scanner Offline", "Check AS608", 1500);
    g_feedback.error();
    return;
  }

  g_attendanceMode = true;
  if (g_wifi.hasCredentials()) {
    String error;
    if (g_wifi.connect(error, CampusConfig::kWifiTimeoutMs)) {
      g_time.syncWithNetwork(error);
      refreshPairedEventContext(error);
    }
  }
  g_display.showAttendancePrompt(g_pairedEvent, g_storage.unsyncedAttendanceCount());
}

void handleAttendanceLoop() {
  const ButtonAction action = g_buttons.poll();
  if (action == ButtonAction::Back) {
    g_attendanceMode = false;
    disconnectAfterOnlineTask();
    renderMenu();
    delay(120);
    return;
  }

  maybeAutoSync(true);

  static uint32_t lastPollAt = 0;
  if ((millis() - lastPollAt) < CampusConfig::kAttendancePollMs) {
    return;
  }
  lastPollAt = millis();

  const FingerprintMatch match = g_fingerprint.scanOnce();
  if (match.status == FingerprintScanStatus::NoFinger) {
    return;
  }

  if (match.status == FingerprintScanStatus::NotFound) {
    showMessage("Not Registered", "See operator", 1200);
    g_feedback.error();
    g_fingerprint.waitForFingerRemoval();
    g_display.showAttendancePrompt(g_pairedEvent, g_storage.unsyncedAttendanceCount());
    return;
  }

  if (match.status == FingerprintScanStatus::Error) {
    showMessage("Scan Error", trim16(match.message), 1200);
    g_feedback.error();
    g_fingerprint.waitForFingerRemoval();
    g_display.showAttendancePrompt(g_pairedEvent, g_storage.unsyncedAttendanceCount());
    return;
  }

  StudentInfo student;
  if (!g_storage.findStudentByTemplate(match.templateId, student)) {
    showMessage("No Mapping", "Enroll student", 1400);
    g_feedback.error();
    g_fingerprint.waitForFingerRemoval();
    g_display.showAttendancePrompt(g_pairedEvent, g_storage.unsyncedAttendanceCount());
    return;
  }

  if (!g_storage.isStudentAuthorizedForEvent(g_pairedEvent.eventId,
                                             student.studentUid)) {
    showMessage("Not In Roster", "See operator", 1400);
    g_feedback.warning();
    g_fingerprint.waitForFingerRemoval();
    g_display.showAttendancePrompt(g_pairedEvent, g_storage.unsyncedAttendanceCount());
    return;
  }

  AttendanceRecord record;
  String message;
  const AttendanceOutcome outcome = g_attendance.recordAttendance(
      g_pairedEvent, student, match.templateId, record, message);

  if (outcome == AttendanceOutcome::Recorded) {
    String statusLine = "Saved Offline";
    syncSingleRecordIfConnected(record, statusLine);
    showMessage(student.studentName, statusLine, 1300);
    g_feedback.success();
  } else if (outcome == AttendanceOutcome::Duplicate) {
    showMessage(student.studentName, "Already Recorded", 1300);
    g_feedback.warning();
  } else {
    showMessage("Save Failed", trim16(message), 1300);
    g_feedback.error();
  }

  g_fingerprint.waitForFingerRemoval();
  g_display.showAttendancePrompt(g_pairedEvent, g_storage.unsyncedAttendanceCount());
}

void runSyncRecords() {
  if (!connectForOnlineTask("Sync Records")) {
    return;
  }

  size_t enrollmentUploads = 0;
  size_t attendanceUploads = 0;
  size_t duplicates = 0;
  String error;
  if (!syncPendingWork(false, enrollmentUploads, attendanceUploads, duplicates,
                       error)) {
    showMessage("Sync Partial", trim16(error), 1600);
    g_feedback.warning();
    disconnectAfterOnlineTask();
    return;
  }

  String line2 = "A:" + String(attendanceUploads) + " D:" + String(duplicates);
  if (enrollmentUploads > 0) {
    line2 = "E:" + String(enrollmentUploads) + " " + line2;
  }
  if (!error.isEmpty()) {
    showMessage("Sync Partial", trim16(error), 1800);
    g_feedback.warning();
  } else {
    showMessage("Sync Complete", line2, 1800);
    g_feedback.success();
  }
  disconnectAfterOnlineTask();
}

void runWifiSetup() {
  String message;
  const WifiSetupResult result =
      g_wifi.runSetupPortal(g_display, g_buttons, message,
                            CampusConfig::kSetupPortalTimeoutMs);

  switch (result) {
    case WifiSetupResult::Configured:
      showMessage("Wi-Fi Ready", trim16(message), 1500);
      g_feedback.success();
      break;
    case WifiSetupResult::Cancelled:
      showMessage("Wi-Fi Setup", "Cancelled", 1200);
      break;
    case WifiSetupResult::TimedOut:
      showMessage("Wi-Fi Setup", "Timed out", 1200);
      g_feedback.warning();
      break;
    case WifiSetupResult::Failed:
    default:
      showMessage("Wi-Fi Setup", trim16(message), 1500);
      g_feedback.error();
      break;
  }
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
  showMessage("CAMPUS Module", "Booting...", 500);

  if (!g_wifi.hasCredentials()) {
    showMessage("Wi-Fi not set", "Use Wi-Fi Setup", 1200);
  }

  String fingerprintError;
  if (!g_fingerprint.begin(fingerprintError)) {
    showMessage("Scanner Error", trim16(fingerprintError), 1500);
  }

  loadStoredPairedEventContext();
  renderMenu();
}

void loop() {
  if (g_attendanceMode) {
    handleAttendanceLoop();
    delay(15);
    return;
  }

  maybeAutoSync(false);

  const ButtonAction action = g_buttons.poll();
  if (action == ButtonAction::Up) {
    g_menuIndex =
        (g_menuIndex == 0) ? static_cast<int>(kMenuItemCount) - 1 : g_menuIndex - 1;
    renderMenu();
    delay(120);
  } else if (action == ButtonAction::Down) {
    g_menuIndex = (g_menuIndex + 1) % static_cast<int>(kMenuItemCount);
    renderMenu();
    delay(120);
  } else if (action == ButtonAction::Select) {
    delay(120);
    switch (g_menuIndex) {
      case 0:
        runPairEvent();
        break;
      case 1:
        runEnrollStudent();
        break;
      case 2:
        enterAttendanceMode();
        break;
      case 3:
        runSyncRecords();
        break;
      case 4:
        runWifiSetup();
        break;
      default:
        break;
    }
    if (!g_attendanceMode) {
      loadStoredPairedEventContext();
      renderMenu();
    }
  }

  delay(20);
}
