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
bool g_attendanceMode = false;
int g_menuIndex = 0;
std::vector<StudentInfo> g_cachedPendingStudents;

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
  g_wifi.disconnect();
}

void renderMenu() {
  g_display.showMenu("CAMPUS Menu", kMenuItems, g_menuIndex,
                     static_cast<int>(kMenuItemCount));
}

bool confirmLatestEvent(const EventInfo &event) {
  while (true) {
    const bool showPrompt = ((millis() / 1500UL) % 2UL) == 1UL;
    if (showPrompt) {
      g_display.show("Pair latest evt?", "SEL pair BACK");
    } else {
      String line2 = event.date;
      if (line2.isEmpty()) {
        line2 = event.scheduledTime;
      }
      if (line2.isEmpty()) {
        line2 = event.location;
      }
      g_display.show(event.title, line2);
    }

    const ButtonAction action = g_buttons.poll();
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

void runPairEvent() {
  if (!connectForOnlineTask("Pair Event")) {
    return;
  }

  EventInfo latestEvent;
  String error;
  if (!g_backend.fetchLatestEvent(latestEvent, error)) {
    showMessage("Pair Failed", trim16(error), 1800);
    g_feedback.error();
    disconnectAfterOnlineTask();
    return;
  }

  const bool confirmed = confirmLatestEvent(latestEvent);
  if (!confirmed) {
    showMessage("Pair Cancelled", "No changes made", 1200);
    disconnectAfterOnlineTask();
    return;
  }

  g_storage.savePairedEvent(latestEvent);
  g_pairedEvent = latestEvent;
  g_backend.confirmPairing(latestEvent, error);

  showMessage("Event Paired", trim16(latestEvent.title), 1500);
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

  if (!connectForOnlineTask("Enroll Student")) {
    return;
  }

  String error;
  std::vector<StudentInfo> students;
  if (!g_backend.fetchPendingEnrollments(students, error)) {
    showMessage("Fetch Failed", trim16(error), 1500);
    g_feedback.error();
    disconnectAfterOnlineTask();
    return;
  }

  g_storage.savePendingStudents(students);
  g_cachedPendingStudents = students;

  if (g_cachedPendingStudents.empty()) {
    showMessage("No Pending FP", "Website is clear", 1400);
    disconnectAfterOnlineTask();
    return;
  }

  int index = 0;
  while (true) {
    const bool showPrompt = ((millis() / 1700UL) % 2UL) == 1UL;
    if (showPrompt) {
      g_display.show("SEL enroll", "UP/DN BK exit");
    } else {
      g_display.showStudent(g_cachedPendingStudents[index], index,
                            static_cast<int>(g_cachedPendingStudents.size()));
    }

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

      student.templateId = templateId;
      student.enrollmentSynced = false;
      g_storage.upsertFingerprintMapping(student);

      if (g_backend.submitEnrollment(student, enrollError)) {
        g_storage.markEnrollmentSynced(student.studentUid);
        showMessage("Enroll Success", student.schoolId, 1500);
      } else {
        showMessage("Local Saved", "Sync later", 1500);
      }

      removePendingStudent(student.studentUid);
      g_feedback.success();

      if (g_cachedPendingStudents.empty()) {
        showMessage("Queue Empty", "All done", 1200);
        break;
      }

      index = 0;
    }

    delay(30);
  }

  disconnectAfterOnlineTask();
}

void enterAttendanceMode() {
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
  g_display.showAttendancePrompt(g_pairedEvent, g_storage.unsyncedAttendanceCount());
}

void handleAttendanceLoop() {
  const ButtonAction action = g_buttons.poll();
  if (action == ButtonAction::Back) {
    g_attendanceMode = false;
    renderMenu();
    delay(120);
    return;
  }

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

  AttendanceRecord record;
  String message;
  const AttendanceOutcome outcome = g_attendance.recordAttendance(
      g_pairedEvent, student, match.templateId, record, message);

  if (outcome == AttendanceOutcome::Recorded) {
    showMessage(student.studentName, "Attendance Saved", 1300);
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

  std::vector<StudentInfo> pendingEnrollments = g_storage.loadUnsyncedEnrollments();
  for (auto &student : pendingEnrollments) {
    String error;
    if (g_backend.submitEnrollment(student, error)) {
      g_storage.markEnrollmentSynced(student.studentUid);
      ++enrollmentUploads;
    }
    delay(80);
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

    g_display.showSyncProgress(attendanceUploads + 1,
                               attendanceUploads + batch.size());

    std::vector<SyncItemResult> results;
    String error;
    if (!g_backend.syncAttendance(batch, results, error)) {
      showMessage("Sync Partial", trim16(error), 1600);
      g_feedback.warning();
      break;
    }

    g_storage.applySyncResults(results);
    for (const auto &result : results) {
      if (result.status == "uploaded") {
        ++attendanceUploads;
      } else if (result.status == "duplicate") {
        ++duplicates;
      }
    }
    delay(120);
  }

  String line2 = "A:" + String(attendanceUploads) + " D:" + String(duplicates);
  if (enrollmentUploads > 0) {
    line2 = "E:" + String(enrollmentUploads) + " " + line2;
  }
  showMessage("Sync Complete", line2, 1800);
  g_feedback.success();
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

  g_pairedEvent = g_storage.loadPairedEvent();
  renderMenu();
}

void loop() {
  if (g_attendanceMode) {
    handleAttendanceLoop();
    delay(15);
    return;
  }

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
      g_pairedEvent = g_storage.loadPairedEvent();
      renderMenu();
    }
  }

  delay(20);
}
