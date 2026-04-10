#include "StorageManager.h"

#include <algorithm>

#include <ArduinoJson.h>
#include <FS.h>
#include <LittleFS.h>
#include <SD.h>
#include <SPI.h>

#include "Config.h"
#include "Pins.h"

namespace {
constexpr char kDeviceConfigPath[] = "/config/device.json";
constexpr char kEnrollmentSessionPath[] = "/sessions/current_enrollment_session.json";
constexpr char kPendingStudentsPath[] = "/students/enrollment_queue.json";
constexpr char kFingerprintMapPath[] = "/fingerprint_map.json";
constexpr char kAttendancePath[] = "/attendance_records.json";
constexpr char kEnrollmentLogsPath[] = "/logs/enrollment_logs.json";
constexpr char kEnrollmentSyncQueuePath[] = "/logs/sync_queue.json";
constexpr char kPairedEventContextPath[] = "/paired_event_context.json";
constexpr char kTempPath[] = "/campus_tmp.json";
constexpr char kSdAuditPath[] = "/attendance_audit.csv";
constexpr char kSdExportDir[] = "/exports";

constexpr size_t kPendingDocSize = 16384;
constexpr size_t kFingerprintDocSize = 16384;
constexpr size_t kAttendanceDocSize = 65536;
constexpr size_t kPairedEventContextDocSize = 65536;
constexpr size_t kEnrollmentSessionDocSize = 4096;

const char *sdCardTypeName(uint8_t cardType) {
  switch (cardType) {
    case CARD_MMC:
      return "MMC";
    case CARD_SD:
      return "SDSC";
    case CARD_SDHC:
      return "SDHC";
    case CARD_NONE:
    default:
      return "none";
  }
}

void studentToJson(JsonObject object, const StudentInfo &student) {
  object["studentUid"] = student.studentUid;
  object["schoolId"] = student.schoolId;
  object["studentName"] = student.studentName;
  object["course"] = student.course;
  object["yearLevel"] = student.yearLevel;
  object["sessionId"] = student.sessionId;
  object["queueId"] = student.queueId;
  object["fingerprintStatus"] = student.fingerprintStatus;
  object["fingerprintDeviceId"] = student.fingerprintDeviceId;
  object["enrollmentStatus"] = student.enrollmentStatus;
  object["syncStatus"] = student.syncStatus;
  object["remarks"] = student.remarks;
  object["enrolledAtIso"] = student.enrolledAtIso;
  object["templateId"] = student.templateId;
  object["enrollmentSynced"] = student.enrollmentSynced;
}

StudentInfo studentFromJson(JsonObjectConst object) {
  StudentInfo student;
  student.studentUid = String(object["studentUid"] | "");
  student.schoolId = String(object["schoolId"] | "");
  student.studentName = String(object["studentName"] | "");
  student.course = String(object["course"] | "");
  student.yearLevel = String(object["yearLevel"] | object["year"] | "");
  student.sessionId = String(object["sessionId"] | "");
  student.queueId = String(object["queueId"] | "");
  student.fingerprintStatus = String(object["fingerprintStatus"] | "");
  student.fingerprintDeviceId = String(object["fingerprintDeviceId"] | "");
  student.enrollmentStatus = String(object["enrollmentStatus"] | "");
  student.syncStatus = String(object["syncStatus"] | "");
  student.remarks = String(object["remarks"] | "");
  student.enrolledAtIso = String(object["enrolledAtIso"] | "");
  student.templateId = object["templateId"] | -1;
  student.enrollmentSynced = object["enrollmentSynced"] | false;
  return student;
}

void enrollmentSessionToJson(JsonObject object,
                             const EnrollmentSessionInfo &session) {
  object["sessionId"] = session.sessionId;
  object["createdBy"] = session.createdBy;
  object["createdByName"] = session.createdByName;
  object["createdBySchoolId"] = session.createdBySchoolId;
  object["status"] = session.status;
  object["pairedDeviceId"] = session.pairedDeviceId;
  object["totalStudents"] = session.totalStudents;
  object["pendingCount"] = session.pendingCount;
  object["downloadedCount"] = session.downloadedCount;
  object["enrolledCount"] = session.enrolledCount;
  object["syncedCount"] = session.syncedCount;
  object["failedCount"] = session.failedCount;
}

EnrollmentSessionInfo enrollmentSessionFromJson(JsonObjectConst object) {
  EnrollmentSessionInfo session;
  session.sessionId = String(object["sessionId"] | "");
  session.createdBy = String(object["createdBy"] | "");
  session.createdByName = String(object["createdByName"] | "");
  session.createdBySchoolId = String(object["createdBySchoolId"] | "");
  session.status = String(object["status"] | "");
  session.pairedDeviceId = String(object["pairedDeviceId"] | "");
  session.totalStudents = object["totalStudents"] | 0;
  session.pendingCount = object["pendingCount"] | 0;
  session.downloadedCount = object["downloadedCount"] | 0;
  session.enrolledCount = object["enrolledCount"] | 0;
  session.syncedCount = object["syncedCount"] | 0;
  session.failedCount = object["failedCount"] | 0;
  return session;
}

void attendanceToJson(JsonObject object, const AttendanceRecord &record) {
  object["recordId"] = record.recordId;
  object["eventId"] = record.eventId;
  object["eventTitle"] = record.eventTitle;
  object["eventDate"] = record.eventDate;
  object["scheduledTimeStart"] = record.scheduledTimeStart;
  object["scheduledTimeEnd"] = record.scheduledTimeEnd;
  object["eventLocation"] = record.eventLocation;
  object["studentUid"] = record.studentUid;
  object["schoolId"] = record.schoolId;
  object["studentName"] = record.studentName;
  object["course"] = record.course;
  object["yearLevel"] = record.yearLevel;
  object["templateId"] = record.templateId;
  object["deviceId"] = record.deviceId;
  object["capturedAtEpoch"] = record.capturedAtEpoch;
  object["capturedAtIso"] = record.capturedAtIso;
  object["timeSource"] = record.timeSource;
  object["timeInEpoch"] = record.timeInEpoch;
  object["timeInIso"] = record.timeInIso;
  object["timeInSource"] = record.timeInSource;
  object["timeOutEpoch"] = record.timeOutEpoch;
  object["timeOutIso"] = record.timeOutIso;
  object["timeOutSource"] = record.timeOutSource;
  object["attendanceStatus"] = record.attendanceStatus;
  object["source"] = record.source;
  object["synced"] = record.synced;
  object["remoteDuplicate"] = record.remoteDuplicate;
  object["syncError"] = record.syncError;
  object["retryCount"] = record.retryCount;
}

AttendanceRecord attendanceFromJson(JsonObjectConst object) {
  AttendanceRecord record;
  record.recordId = String(object["recordId"] | "");
  record.eventId = String(object["eventId"] | "");
  record.eventTitle = String(object["eventTitle"] | "");
  record.eventDate = String(object["eventDate"] | object["date"] | "");
  record.scheduledTimeStart = String(object["scheduledTimeStart"] |
                                     object["scheduledTime"] | "");
  record.scheduledTimeEnd =
      String(object["scheduledTimeEnd"] | object["endTime"] | "");
  record.eventLocation = String(object["eventLocation"] | object["location"] | "");
  record.studentUid = String(object["studentUid"] | "");
  record.schoolId = String(object["schoolId"] | "");
  record.studentName = String(object["studentName"] | "");
  record.course = String(object["course"] | "");
  record.yearLevel = String(object["yearLevel"] | object["year"] | "");
  record.templateId = object["templateId"] | -1;
  record.deviceId = String(object["deviceId"] | "");
  record.capturedAtEpoch = object["capturedAtEpoch"].isNull()
                               ? 0ULL
                               : object["capturedAtEpoch"].as<uint64_t>();
  record.capturedAtIso = String(object["capturedAtIso"] | "");
  record.timeSource = String(object["timeSource"] | "unknown");
  record.timeInEpoch = object["timeInEpoch"].isNull()
                           ? 0ULL
                           : object["timeInEpoch"].as<uint64_t>();
  record.timeInIso = String(object["timeInIso"] | "");
  record.timeInSource = String(object["timeInSource"] | "unknown");
  record.timeOutEpoch = object["timeOutEpoch"].isNull()
                            ? 0ULL
                            : object["timeOutEpoch"].as<uint64_t>();
  record.timeOutIso = String(object["timeOutIso"] | "");
  record.timeOutSource = String(object["timeOutSource"] | "unknown");
  record.attendanceStatus = String(object["attendanceStatus"] | "");
  record.source = String(object["source"] | "portable-device");
  record.synced = object["synced"] | false;
  record.remoteDuplicate = object["remoteDuplicate"] | false;
  record.syncError = String(object["syncError"] | "");
  record.retryCount = object["retryCount"] | 0UL;

  // Migrate older one-shot attendance records into the new time-in/time-out shape.
  if (!record.hasTimeIn() && record.capturedAtEpoch > 0) {
    record.timeInEpoch = record.capturedAtEpoch;
    record.timeInIso = record.capturedAtIso;
    record.timeInSource = record.timeSource;
  }
  if (record.attendanceStatus.isEmpty()) {
    if (record.hasTimeIn() && record.hasTimeOut()) {
      record.attendanceStatus = "Present";
    } else if (record.hasTimeIn()) {
      record.attendanceStatus = "Timed In";
    }
  }
  return record;
}

bool loadArrayDocument(fs::FS &fs, const char *path, DynamicJsonDocument &doc) {
  if (!fs.exists(path)) {
    doc.to<JsonArray>();
    return true;
  }

  File file = fs.open(path, FILE_READ);
  if (!file) {
    return false;
  }

  const DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) {
    doc.to<JsonArray>();
    return false;
  }

  if (!doc.is<JsonArray>()) {
    doc.to<JsonArray>();
  }
  return true;
}

bool saveDocument(fs::FS &fs, const char *path, const char *tempPath,
                  const JsonDocument &doc) {
  fs.remove(tempPath);
  File file = fs.open(tempPath, FILE_WRITE);
  if (!file) {
    return false;
  }

  if (serializeJson(doc, file) == 0) {
    file.close();
    fs.remove(tempPath);
    return false;
  }
  file.close();

  fs.remove(path);
  return fs.rename(tempPath, path);
}

String csvEscape(const String &value) {
  String output = value;
  output.replace("\"", "\"\"");
  return "\"" + output + "\"";
}

bool isStudentStillPendingEnrollment(const StudentInfo &student) {
  if (!student.isValid()) {
    return false;
  }

  if (student.enrollmentSynced) {
    return false;
  }

  String syncStatus = student.syncStatus;
  syncStatus.toLowerCase();
  if (syncStatus == "synced") {
    return false;
  }

  String enrollmentStatus = student.enrollmentStatus;
  enrollmentStatus.toLowerCase();
  if (enrollmentStatus == "synced") {
    return false;
  }

  return true;
}

std::vector<StudentInfo> filterPendingStudents(
    const std::vector<StudentInfo> &students) {
  std::vector<StudentInfo> filtered;
  filtered.reserve(students.size());
  for (const auto &student : students) {
    if (isStudentStillPendingEnrollment(student)) {
      filtered.push_back(student);
    }
  }
  return filtered;
}

void normalizeEventSchedule(EventInfo &event) {
  if (!event.scheduledTimeEnd.isEmpty()) {
    return;
  }

  const int dashIndex = event.scheduledTime.indexOf('-');
  if (dashIndex <= 0) {
    return;
  }

  String start = event.scheduledTime.substring(0, dashIndex);
  String end = event.scheduledTime.substring(dashIndex + 1);
  start.trim();
  end.trim();
  if (start.isEmpty() || end.isEmpty()) {
    return;
  }

  event.scheduledTime = start;
  event.scheduledTimeEnd = end;
}

void eventToJson(JsonObject object, const EventInfo &event) {
  object["eventId"] = event.eventId;
  object["title"] = event.title;
  object["date"] = event.date;
  object["scheduledTime"] = event.scheduledTime;
  object["scheduledTimeEnd"] = event.scheduledTimeEnd;
  object["location"] = event.location;
  object["status"] = event.status;
  object["requiresRegistration"] = event.requiresRegistration;
  object["timeOutFinalized"] = event.timeOutFinalized;
}

EventInfo eventFromJson(JsonObjectConst object) {
  EventInfo event;
  event.eventId = String(object["eventId"] | "");
  event.title = String(object["title"] | "");
  event.date = String(object["date"] | "");
  event.scheduledTime = String(object["scheduledTime"] |
                               object["scheduledTimeStart"] |
                               object["startTime"] | "");
  event.scheduledTimeEnd =
      String(object["scheduledTimeEnd"] | object["endTime"] | "");
  event.location = String(object["location"] | "");
  event.status = String(object["status"] | "");
  event.requiresRegistration = object["requiresRegistration"] | false;
  event.timeOutFinalized = object["timeOutFinalized"] | false;
  normalizeEventSchedule(event);
  return event;
}
}  // namespace

bool StorageManager::begin() {
  prefsReady_ = prefs_.begin("campus", false);
  littleFsReady_ = LittleFS.begin(true);
  lastSdWriteSucceeded_ = !CampusConfig::kUseSd;

  if (littleFsReady_) {
    LittleFS.mkdir("/config");
    LittleFS.mkdir("/sessions");
    LittleFS.mkdir("/students");
    LittleFS.mkdir("/logs");
    saveDeviceConfigSnapshot();
  }

  if (CampusConfig::kUseSd) {
    mountSdCard();
  }

  return prefsReady_ && littleFsReady_;
}

bool StorageManager::mountSdCard() {
  if (!CampusConfig::kUseSd) {
    sdReady_ = false;
    lastSdWriteSucceeded_ = true;
    return false;
  }

  static constexpr uint32_t kSdMountFrequencies[] = {
      4000000UL,
      1000000UL,
      400000UL,
  };

  pinMode(Pins::kSdCs, OUTPUT);
  digitalWrite(Pins::kSdCs, HIGH);
  delay(5);

  SPI.begin(Pins::kSdSck, Pins::kSdMiso, Pins::kSdMosi, Pins::kSdCs);

  sdReady_ = false;
  for (uint32_t frequency : kSdMountFrequencies) {
    SD.end();
    delay(10);

    Serial.printf("[SD] mount attempt freq=%lu cs=%u sck=%u miso=%u mosi=%u\n",
                  static_cast<unsigned long>(frequency), Pins::kSdCs,
                  Pins::kSdSck, Pins::kSdMiso, Pins::kSdMosi);

    if (!SD.begin(Pins::kSdCs, SPI, frequency)) {
      continue;
    }

    const uint8_t cardType = SD.cardType();
    if (cardType == CARD_NONE) {
      Serial.printf("[SD] no card detected at freq=%lu\n",
                    static_cast<unsigned long>(frequency));
      SD.end();
      delay(10);
      continue;
    }

    sdReady_ = true;
    lastSdWriteSucceeded_ = true;
    const uint64_t cardSizeMb = SD.cardSize() / (1024ULL * 1024ULL);
    Serial.printf("[SD] ready type=%s sizeMB=%llu freq=%lu\n",
                  sdCardTypeName(cardType),
                  static_cast<unsigned long long>(cardSizeMb),
                  static_cast<unsigned long>(frequency));
    break;
  }

  if (!sdReady_) {
    lastSdWriteSucceeded_ = false;
    Serial.printf("[SD] mount failed after retries cs=%u sck=%u miso=%u mosi=%u\n",
                  Pins::kSdCs, Pins::kSdSck, Pins::kSdMiso, Pins::kSdMosi);
    return false;
  }

  SD.mkdir("/config");
  SD.mkdir("/sessions");
  SD.mkdir("/students");
  SD.mkdir("/logs");
  SD.mkdir(kSdExportDir);
  return true;
}

bool StorageManager::ensureSdReady() {
  if (!CampusConfig::kUseSd) {
    lastSdWriteSucceeded_ = true;
    return false;
  }

  if (sdReady_) {
    return true;
  }

  return mountSdCard();
}

bool StorageManager::ensurePairedEventContextLoaded() const {
  if (pairedEventContextLoaded_) {
    return pairedEventCache_.isValid();
  }

  pairedEventCache_ = loadPairedEvent();
  pairedStudentsCache_.clear();
  remoteRecordedStudentIdsCache_.clear();
  pairedEventContextLoaded_ = true;

  if (!littleFsReady_ || !LittleFS.exists(kPairedEventContextPath)) {
    return pairedEventCache_.isValid();
  }

  DynamicJsonDocument doc(kPairedEventContextDocSize);
  File file = LittleFS.open(kPairedEventContextPath, FILE_READ);
  if (!file) {
    return pairedEventCache_.isValid();
  }

  const DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) {
    return pairedEventCache_.isValid();
  }

  JsonObject eventObject = doc["event"];
  if (!eventObject.isNull()) {
    pairedEventCache_ = eventFromJson(eventObject);
  }

  JsonArray studentArray = doc["students"].as<JsonArray>();
  pairedStudentsCache_.reserve(studentArray.size());
  for (JsonObjectConst item : studentArray) {
    const StudentInfo student = studentFromJson(item);
    if (student.isValid()) {
      pairedStudentsCache_.push_back(student);
    }
  }

  JsonArray recordedArray = doc["recordedStudentIds"].as<JsonArray>();
  remoteRecordedStudentIdsCache_.reserve(recordedArray.size());
  for (JsonVariantConst item : recordedArray) {
    const char *rawStudentUid = item.as<const char *>();
    const String studentUid =
        rawStudentUid != nullptr ? String(rawStudentUid) : String("");
    if (!studentUid.isEmpty()) {
      remoteRecordedStudentIdsCache_.push_back(studentUid);
    }
  }

  return pairedEventCache_.isValid();
}

EventInfo StorageManager::loadPairedEvent() const {
  if (pairedEventContextLoaded_) {
    return pairedEventCache_;
  }

  EventInfo event;
  if (!prefsReady_) {
    return event;
  }

  event.eventId = prefs_.getString("pair_id", "");
  event.title = prefs_.getString("pair_title", "");
  event.date = prefs_.getString("pair_date", "");
  event.scheduledTime = prefs_.getString("pair_time", "");
  event.scheduledTimeEnd = prefs_.getString("pair_end", "");
  event.location = prefs_.getString("pair_loc", "");
  event.status = prefs_.getString("pair_stat", "");
  event.timeOutFinalized = prefs_.getBool("pair_to_final", false);
  normalizeEventSchedule(event);
  return event;
}

bool StorageManager::savePairedEvent(const EventInfo &event) {
  if (!prefsReady_) {
    return false;
  }

  prefs_.putString("pair_id", event.eventId);
  prefs_.putString("pair_title", event.title);
  prefs_.putString("pair_date", event.date);
  prefs_.putString("pair_time", event.scheduledTime);
  prefs_.putString("pair_end", event.scheduledTimeEnd);
  prefs_.putString("pair_loc", event.location);
  prefs_.putString("pair_stat", event.status);
  prefs_.putBool("pair_to_final", event.timeOutFinalized);
  if (pairedEventContextLoaded_) {
    pairedEventCache_ = event;
  }
  return true;
}

bool StorageManager::clearPairedEvent() {
  if (!prefsReady_) {
    return false;
  }

  prefs_.remove("pair_id");
  prefs_.remove("pair_title");
  prefs_.remove("pair_date");
  prefs_.remove("pair_time");
  prefs_.remove("pair_end");
  prefs_.remove("pair_loc");
  prefs_.remove("pair_stat");
  prefs_.remove("pair_to_final");

  if (littleFsReady_ && LittleFS.exists(kPairedEventContextPath)) {
    LittleFS.remove(kPairedEventContextPath);
  }

  pairedEventCache_ = EventInfo{};
  pairedStudentsCache_.clear();
  remoteRecordedStudentIdsCache_.clear();
  pairedEventContextLoaded_ = true;
  return true;
}

bool StorageManager::savePairedEventContext(
    const EventInfo &event, const std::vector<StudentInfo> &students,
    const std::vector<String> &recordedStudentIds) {
  if (!savePairedEvent(event) || !littleFsReady_) {
    return false;
  }

  if (!writePairedEventContext(event, students, recordedStudentIds)) {
    return false;
  }

  pairedEventCache_ = event;
  pairedStudentsCache_ = students;
  remoteRecordedStudentIdsCache_ = recordedStudentIds;
  pairedEventContextLoaded_ = true;
  return true;
}

bool StorageManager::loadPairedEventContext(
    EventInfo &event, std::vector<StudentInfo> &students,
    std::vector<String> &recordedStudentIds) const {
  ensurePairedEventContextLoaded();
  event = pairedEventCache_;
  students = pairedStudentsCache_;
  recordedStudentIds = remoteRecordedStudentIdsCache_;
  return event.isValid();
}

bool StorageManager::isStudentAuthorizedForEvent(const String &eventId,
                                                 const String &studentUid) const {
  ensurePairedEventContextLoaded();

  if (!pairedEventCache_.isValid() || pairedEventCache_.eventId != eventId ||
      pairedStudentsCache_.empty()) {
    return true;
  }

  for (const auto &student : pairedStudentsCache_) {
    if (student.studentUid == studentUid) {
      return true;
    }
  }
  return false;
}

bool StorageManager::isRemoteAttendanceRecorded(const String &eventId,
                                                const String &studentUid) const {
  ensurePairedEventContextLoaded();

  if (!pairedEventCache_.isValid() || pairedEventCache_.eventId != eventId) {
    return false;
  }

  for (const auto &recordedUid : remoteRecordedStudentIdsCache_) {
    if (recordedUid == studentUid) {
      return true;
    }
  }
  return false;
}

bool StorageManager::markRemoteAttendanceRecorded(const String &eventId,
                                                  const String &studentUid) {
  if (!ensurePairedEventContextLoaded()) {
    return false;
  }

  if (pairedEventCache_.eventId != eventId) {
    return false;
  }

  for (const auto &recordedUid : remoteRecordedStudentIdsCache_) {
    if (recordedUid == studentUid) {
      return true;
    }
  }

  remoteRecordedStudentIdsCache_.push_back(studentUid);
  return writePairedEventContext(pairedEventCache_, pairedStudentsCache_,
                                 remoteRecordedStudentIdsCache_);
}

uint64_t StorageManager::getLastKnownEpoch() const {
  if (!prefsReady_) {
    return 0;
  }
  return prefs_.getULong64("last_epoch", 0);
}

void StorageManager::setLastKnownEpoch(uint64_t epoch) {
  if (prefsReady_) {
    prefs_.putULong64("last_epoch", epoch);
  }
}

String StorageManager::deviceId() const {
  return String(CampusConfig::kDeviceId);
}

EnrollmentSessionInfo StorageManager::loadCurrentEnrollmentSession() const {
  EnrollmentSessionInfo session;
  if (!littleFsReady_ || !LittleFS.exists(kEnrollmentSessionPath)) {
    return session;
  }

  DynamicJsonDocument doc(kEnrollmentSessionDocSize);
  File file = LittleFS.open(kEnrollmentSessionPath, FILE_READ);
  if (!file) {
    return session;
  }

  const DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) {
    return session;
  }

  JsonObject object = doc.as<JsonObject>();
  if (!object.isNull()) {
    session = enrollmentSessionFromJson(object);
  }
  return session;
}

bool StorageManager::saveCurrentEnrollmentSession(
    const EnrollmentSessionInfo &session) {
  if (!littleFsReady_) {
    return false;
  }
  return writeCurrentEnrollmentSession(session);
}

bool StorageManager::clearCurrentEnrollmentSession() {
  if (!littleFsReady_) {
    return false;
  }
  if (!LittleFS.exists(kEnrollmentSessionPath)) {
    return true;
  }
  return LittleFS.remove(kEnrollmentSessionPath);
}

bool StorageManager::ensurePendingStudentsLoaded() const {
  if (pendingStudentsLoaded_) {
    return true;
  }

  pendingStudentsCache_.clear();
  pendingStudentsLoaded_ = true;
  if (!littleFsReady_) {
    return false;
  }

  DynamicJsonDocument doc(kPendingDocSize);
  loadArrayDocument(LittleFS, kPendingStudentsPath, doc);

  JsonArrayConst array = doc.as<JsonArrayConst>();
  pendingStudentsCache_.reserve(array.size());
  bool pruned = false;
  for (JsonObjectConst item : array) {
    const StudentInfo student = studentFromJson(item);
    if (isStudentStillPendingEnrollment(student)) {
      pendingStudentsCache_.push_back(student);
    } else if (student.isValid()) {
      pruned = true;
    }
  }

  if (pruned) {
    writePendingStudents(pendingStudentsCache_);
  }

  return true;
}

std::vector<StudentInfo> StorageManager::loadPendingStudents() const {
  ensurePendingStudentsLoaded();
  return pendingStudentsCache_;
}

bool StorageManager::savePendingStudents(const std::vector<StudentInfo> &students) {
  if (!littleFsReady_) {
    return false;
  }
  const std::vector<StudentInfo> filtered = filterPendingStudents(students);
  if (!writePendingStudents(filtered)) {
    return false;
  }
  pendingStudentsCache_ = filtered;
  pendingStudentsLoaded_ = true;
  return true;
}

bool StorageManager::ensureFingerprintMappingsLoaded() const {
  if (fingerprintMappingsLoaded_) {
    return true;
  }

  fingerprintMappingsCache_.clear();
  fingerprintMappingsLoaded_ = true;
  if (!littleFsReady_) {
    return false;
  }

  DynamicJsonDocument doc(kFingerprintDocSize);
  loadArrayDocument(LittleFS, kFingerprintMapPath, doc);

  JsonArrayConst array = doc.as<JsonArrayConst>();
  fingerprintMappingsCache_.reserve(array.size());
  for (JsonObjectConst item : array) {
    const StudentInfo student = studentFromJson(item);
    if (student.isValid()) {
      fingerprintMappingsCache_.push_back(student);
    }
  }

  return true;
}

std::vector<StudentInfo> StorageManager::loadFingerprintMappings() const {
  ensureFingerprintMappingsLoaded();
  return fingerprintMappingsCache_;
}

bool StorageManager::upsertFingerprintMapping(const StudentInfo &student) {
  if (!littleFsReady_) {
    return false;
  }

  ensureFingerprintMappingsLoaded();
  bool updated = false;

  for (auto &entry : fingerprintMappingsCache_) {
    if (entry.studentUid == student.studentUid || entry.templateId == student.templateId) {
      entry = student;
      updated = true;
      break;
    }
  }

  if (!updated) {
    fingerprintMappingsCache_.push_back(student);
  }

  if (!writeFingerprintMappings(fingerprintMappingsCache_)) {
    return false;
  }

  return updateEnrollmentArtifacts(student);
}

bool StorageManager::findStudentByTemplate(int templateId, StudentInfo &outStudent) const {
  ensureFingerprintMappingsLoaded();
  for (const auto &student : fingerprintMappingsCache_) {
    if (student.templateId == templateId) {
      outStudent = student;
      return true;
    }
  }
  return false;
}

int StorageManager::nextFreeTemplateId(uint16_t startId, uint16_t endId) const {
  ensureFingerprintMappingsLoaded();
  for (uint16_t templateId = startId; templateId <= endId; ++templateId) {
    bool used = false;
    for (const auto &student : fingerprintMappingsCache_) {
      if (student.templateId == templateId) {
        used = true;
        break;
      }
    }
    if (!used) {
      return templateId;
    }
  }
  return -1;
}

bool StorageManager::ensureEnrollmentSyncQueueLoaded() const {
  if (enrollmentSyncQueueLoaded_) {
    return true;
  }

  enrollmentSyncQueueCache_.clear();
  enrollmentSyncQueueLoaded_ = true;
  if (!littleFsReady_) {
    return false;
  }

  DynamicJsonDocument doc(kPendingDocSize);
  if (!loadArrayDocument(LittleFS, kEnrollmentSyncQueuePath, doc)) {
    return false;
  }

  JsonArrayConst array = doc.as<JsonArrayConst>();
  enrollmentSyncQueueCache_.reserve(array.size());
  for (JsonObjectConst item : array) {
    const StudentInfo student = studentFromJson(item);
    if (student.isValid()) {
      enrollmentSyncQueueCache_.push_back(student);
    }
  }
  return true;
}

std::vector<StudentInfo> StorageManager::loadUnsyncedEnrollments() const {
  ensureEnrollmentSyncQueueLoaded();
  std::vector<StudentInfo> pending;
  pending.reserve(enrollmentSyncQueueCache_.size());
  for (const auto &student : enrollmentSyncQueueCache_) {
    if (student.templateId > 0 && !student.enrollmentSynced) {
      pending.push_back(student);
    }
  }

  if (!pending.empty()) {
    return pending;
  }

  ensureFingerprintMappingsLoaded();
  pending.reserve(fingerprintMappingsCache_.size());
  for (const auto &student : fingerprintMappingsCache_) {
    if (student.templateId > 0 && !student.enrollmentSynced) {
      pending.push_back(student);
    }
  }
  return pending;
}

size_t StorageManager::unsyncedEnrollmentCount() const {
  ensureEnrollmentSyncQueueLoaded();
  size_t count = 0;
  for (const auto &student : enrollmentSyncQueueCache_) {
    if (student.templateId > 0 && !student.enrollmentSynced) {
      ++count;
    }
  }
  if (count > 0) {
    return count;
  }

  ensureFingerprintMappingsLoaded();
  for (const auto &student : fingerprintMappingsCache_) {
    if (student.templateId > 0 && !student.enrollmentSynced) {
      ++count;
    }
  }
  return count;
}

bool StorageManager::markEnrollmentSynced(const String &studentUid) {
  ensureFingerprintMappingsLoaded();
  bool changed = false;

  for (auto &student : fingerprintMappingsCache_) {
    if (student.studentUid == studentUid) {
      student.enrollmentSynced = true;
      changed = true;
      break;
    }
  }

  ensurePendingStudentsLoaded();
  for (auto &student : pendingStudentsCache_) {
    if (student.studentUid == studentUid) {
      student.enrollmentSynced = true;
      student.syncStatus = "synced";
      student.enrollmentStatus = "synced";
      break;
    }
  }

  const bool mappingSaved =
      changed ? writeFingerprintMappings(fingerprintMappingsCache_) : true;
  const bool pendingSaved = savePendingStudents(pendingStudentsCache_);
  const bool queueSaved = removeFromSyncQueue(studentUid);
  const bool clearedSession =
      pendingStudentsCache_.empty() && unsyncedEnrollmentCount() == 0
          ? clearCurrentEnrollmentSession()
          : true;
  return mappingSaved && pendingSaved && queueSaved && clearedSession;
}

bool StorageManager::ensureAttendanceLoaded() const {
  if (attendanceLoaded_) {
    return true;
  }

  attendanceRecordsCache_.clear();
  attendanceLoaded_ = true;
  unsyncedAttendanceCountCache_ = 0;
  if (!littleFsReady_) {
    return false;
  }

  DynamicJsonDocument doc(kAttendanceDocSize);
  loadArrayDocument(LittleFS, kAttendancePath, doc);

  JsonArrayConst array = doc.as<JsonArrayConst>();
  attendanceRecordsCache_.reserve(array.size());
  for (JsonObjectConst item : array) {
    const AttendanceRecord record = attendanceFromJson(item);
    if (!record.recordId.isEmpty()) {
      attendanceRecordsCache_.push_back(record);
      if (!record.synced) {
        ++unsyncedAttendanceCountCache_;
      }
    }
  }

  return true;
}

void StorageManager::refreshUnsyncedAttendanceCount() const {
  unsyncedAttendanceCountCache_ = 0;
  for (const auto &record : attendanceRecordsCache_) {
    if (!record.synced) {
      ++unsyncedAttendanceCountCache_;
    }
  }
}

std::vector<AttendanceRecord> StorageManager::loadAttendanceRecords() const {
  ensureAttendanceLoaded();
  return attendanceRecordsCache_;
}

std::vector<AttendanceRecord> StorageManager::loadUnsyncedAttendanceBatch(
    size_t limit) const {
  ensureAttendanceLoaded();
  std::vector<AttendanceRecord> batch;
  if (limit == 0) {
    return batch;
  }

  batch.reserve(std::min(limit, attendanceRecordsCache_.size()));
  for (const auto &record : attendanceRecordsCache_) {
    if (!record.synced) {
      batch.push_back(record);
      if (batch.size() >= limit) {
        break;
      }
    }
  }
  return batch;
}

bool StorageManager::appendAttendanceRecord(const AttendanceRecord &record) {
  return upsertAttendanceRecord(record);
}

bool StorageManager::upsertAttendanceRecord(const AttendanceRecord &record) {
  if (!littleFsReady_) {
    return false;
  }

  ensureAttendanceLoaded();
  bool updated = false;
  for (auto &entry : attendanceRecordsCache_) {
    if ((entry.eventId == record.eventId && entry.studentUid == record.studentUid) ||
        (!record.recordId.isEmpty() && entry.recordId == record.recordId)) {
      entry = record;
      updated = true;
      break;
    }
  }

  if (!updated) {
    attendanceRecordsCache_.push_back(record);
  }

  refreshUnsyncedAttendanceCount();
  const bool saved = writeAttendanceRecords(attendanceRecordsCache_);
  if (saved) {
    lastSdWriteSucceeded_ = backupAttendanceToSd(record);
    return true;
  }

  attendanceLoaded_ = false;
  ensureAttendanceLoaded();
  return false;
}

bool StorageManager::findAttendanceRecord(const String &eventId,
                                          const String &studentUid,
                                          AttendanceRecord &outRecord) const {
  ensureAttendanceLoaded();
  for (const auto &record : attendanceRecordsCache_) {
    if (record.eventId == eventId && record.studentUid == studentUid) {
      outRecord = record;
      return true;
    }
  }
  return false;
}

bool StorageManager::isDuplicateAttendance(const String &eventId,
                                           const String &studentUid) const {
  AttendanceRecord record;
  return findAttendanceRecord(eventId, studentUid, record);
}

bool StorageManager::hasUnsyncedAttendanceForEvent(const String &eventId) const {
  ensureAttendanceLoaded();
  for (const auto &record : attendanceRecordsCache_) {
    if (record.eventId == eventId && !record.synced) {
      return true;
    }
  }
  return false;
}

size_t StorageManager::unsyncedAttendanceCount() const {
  ensureAttendanceLoaded();
  return unsyncedAttendanceCountCache_;
}

bool StorageManager::applySyncResults(const std::vector<SyncItemResult> &results) {
  if (results.empty()) {
    return true;
  }

  ensureAttendanceLoaded();
  bool changed = false;

  for (auto &record : attendanceRecordsCache_) {
    for (const auto &result : results) {
      if (record.recordId != result.recordId) {
        continue;
      }

      if (result.status == "uploaded" || result.status == "duplicate") {
        record.synced = true;
        record.remoteDuplicate = result.status == "duplicate";
        record.syncError = result.message;
        markRemoteAttendanceRecorded(record.eventId, record.studentUid);
      } else {
        record.synced = false;
        record.syncError = result.message;
        record.retryCount += 1;
      }
      changed = true;
      break;
    }
  }

  if (!changed) {
    return true;
  }

  refreshUnsyncedAttendanceCount();
  return writeAttendanceRecords(attendanceRecordsCache_);
}

String StorageManager::attendanceExportPath(const String &eventId) const {
  String safeEventId = eventId;
  safeEventId.replace(" ", "_");
  safeEventId.replace("/", "_");
  safeEventId.replace("\\", "_");
  safeEventId.replace(":", "_");
  safeEventId.replace("|", "_");
  return String(kSdExportDir) + "/attendance_" + safeEventId + ".csv";
}

bool StorageManager::exportAttendanceCsv(const EventInfo &event,
                                         const TimeSnapshot &generatedAt,
                                         String &path) const {
  path = "";
  if (!sdReady_ || !event.isValid()) {
    return false;
  }

  ensureAttendanceLoaded();
  std::vector<AttendanceRecord> eventRecords;
  eventRecords.reserve(attendanceRecordsCache_.size());
  for (const auto &record : attendanceRecordsCache_) {
    if (record.eventId == event.eventId) {
      eventRecords.push_back(record);
    }
  }

  path = attendanceExportPath(event.eventId);
  SD.mkdir(kSdExportDir);
  SD.remove(path);
  File file = SD.open(path, FILE_WRITE);
  if (!file) {
    return false;
  }

  file.print("Event Title,");
  file.println(csvEscape(event.title));
  file.print("Date,");
  file.println(csvEscape(event.date));
  file.print("Scheduled Time Start,");
  file.println(csvEscape(event.scheduledTime));
  file.print("Scheduled Time End,");
  file.println(csvEscape(event.scheduledTimeEnd));
  file.print("Location,");
  file.println(csvEscape(event.location));
  file.print("Generated At,");
  file.println(csvEscape(generatedAt.iso8601));
  file.println();
  file.println(
      "School ID,Student Name,Course,Year,Attendance Status,Attendance Time In,"
      "Attendance Time Out");

  for (const auto &record : eventRecords) {
    file.print(csvEscape(record.schoolId));
    file.print(",");
    file.print(csvEscape(record.studentName));
    file.print(",");
    file.print(csvEscape(record.course));
    file.print(",");
    file.print(csvEscape(record.yearLevel));
    file.print(",");
    file.print(csvEscape(record.attendanceStatus));
    file.print(",");
    file.print(csvEscape(record.timeInIso));
    file.print(",");
    file.println(csvEscape(record.timeOutIso));
  }

  file.close();
  path = attendanceExportPath(event.eventId);
  return true;
}

bool StorageManager::writePendingStudents(
    const std::vector<StudentInfo> &students) const {
  return writeStudentList(kPendingStudentsPath, students);
}

bool StorageManager::writeStudentList(const char *path,
                                      const std::vector<StudentInfo> &students) const {
  DynamicJsonDocument doc(kPendingDocSize);
  JsonArray array = doc.to<JsonArray>();
  for (const auto &student : students) {
    JsonObject object = array.createNestedObject();
    studentToJson(object, student);
  }
  return saveDocument(LittleFS, path, kTempPath, doc);
}

bool StorageManager::writeFingerprintMappings(
    const std::vector<StudentInfo> &students) const {
  DynamicJsonDocument doc(kFingerprintDocSize);
  JsonArray array = doc.to<JsonArray>();
  for (const auto &student : students) {
    JsonObject object = array.createNestedObject();
    studentToJson(object, student);
  }
  return saveDocument(LittleFS, kFingerprintMapPath, kTempPath, doc);
}

bool StorageManager::writeCurrentEnrollmentSession(
    const EnrollmentSessionInfo &session) const {
  DynamicJsonDocument doc(kEnrollmentSessionDocSize);
  JsonObject object = doc.to<JsonObject>();
  enrollmentSessionToJson(object, session);
  return saveDocument(LittleFS, kEnrollmentSessionPath, kTempPath, doc);
}

bool StorageManager::writeAttendanceRecords(
    const std::vector<AttendanceRecord> &records) const {
  DynamicJsonDocument doc(kAttendanceDocSize);
  JsonArray array = doc.to<JsonArray>();
  for (const auto &record : records) {
    JsonObject object = array.createNestedObject();
    attendanceToJson(object, record);
  }
  return saveDocument(LittleFS, kAttendancePath, kTempPath, doc);
}

bool StorageManager::writePairedEventContext(
    const EventInfo &event, const std::vector<StudentInfo> &students,
    const std::vector<String> &recordedStudentIds) const {
  DynamicJsonDocument doc(kPairedEventContextDocSize);
  JsonObject eventObject = doc.createNestedObject("event");
  eventToJson(eventObject, event);

  JsonArray studentArray = doc.createNestedArray("students");
  for (const auto &student : students) {
    JsonObject object = studentArray.createNestedObject();
    studentToJson(object, student);
  }

  JsonArray recordedArray = doc.createNestedArray("recordedStudentIds");
  for (const auto &studentUid : recordedStudentIds) {
    recordedArray.add(studentUid);
  }

  return saveDocument(LittleFS, kPairedEventContextPath, kTempPath, doc);
}

bool StorageManager::updateEnrollmentArtifacts(const StudentInfo &student) {
  std::vector<StudentInfo> logs;
  DynamicJsonDocument logsDoc(kPendingDocSize);
  loadArrayDocument(LittleFS, kEnrollmentLogsPath, logsDoc);
  for (JsonObjectConst item : logsDoc.as<JsonArrayConst>()) {
    const StudentInfo row = studentFromJson(item);
    if (row.isValid()) {
      logs.push_back(row);
    }
  }
  logs.push_back(student);

  ensureEnrollmentSyncQueueLoaded();
  std::vector<StudentInfo> syncQueue;
  syncQueue.reserve(enrollmentSyncQueueCache_.size() + 1);
  for (const auto &row : enrollmentSyncQueueCache_) {
    if (row.isValid() && row.studentUid != student.studentUid) {
      syncQueue.push_back(row);
    }
  }
  syncQueue.push_back(student);
  enrollmentSyncQueueCache_ = syncQueue;
  enrollmentSyncQueueLoaded_ = true;

  ensurePendingStudentsLoaded();
  bool queueChanged = false;
  for (auto &entry : pendingStudentsCache_) {
    if (entry.studentUid == student.studentUid) {
      entry = student;
      queueChanged = true;
      break;
    }
  }
  if (!queueChanged) {
    pendingStudentsCache_.push_back(student);
  }

  return writeStudentList(kEnrollmentLogsPath, logs) &&
         writeStudentList(kEnrollmentSyncQueuePath, enrollmentSyncQueueCache_) &&
         writePendingStudents(pendingStudentsCache_);
}

bool StorageManager::removeFromSyncQueue(const String &studentUid) {
  if (!littleFsReady_) {
    return false;
  }

  std::vector<StudentInfo> students;
  ensureEnrollmentSyncQueueLoaded();
  students.reserve(enrollmentSyncQueueCache_.size());
  for (auto student : enrollmentSyncQueueCache_) {
    if (!student.isValid()) {
      continue;
    }
    if (student.studentUid == studentUid) {
      student.enrollmentSynced = true;
      student.syncStatus = "synced";
    }
    if (!student.enrollmentSynced) {
      students.push_back(student);
    }
  }

  if (!writeStudentList(kEnrollmentSyncQueuePath, students)) {
    return false;
  }
  enrollmentSyncQueueCache_ = students;
  enrollmentSyncQueueLoaded_ = true;
  return true;
}

bool StorageManager::saveDeviceConfigSnapshot() const {
  if (!littleFsReady_) {
    return false;
  }

  DynamicJsonDocument doc(512);
  JsonObject object = doc.to<JsonObject>();
  object["deviceId"] = CampusConfig::kDeviceId;
  object["apiBaseUrl"] = CampusConfig::kApiBaseUrl;
  object["lcdColumns"] = CampusConfig::kLcdColumns;
  object["lcdRows"] = CampusConfig::kLcdRows;
  object["usesSd"] = CampusConfig::kUseSd;
  object["usesRtc"] = CampusConfig::kUseRtc;
  return saveDocument(LittleFS, kDeviceConfigPath, kTempPath, doc);
}

bool StorageManager::backupAttendanceToSd(const AttendanceRecord &record) {
  if (!ensureSdReady()) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  ensurePairedEventContextLoaded();
  EventInfo exportEvent;
  if (pairedEventCache_.isValid() && pairedEventCache_.eventId == record.eventId) {
    exportEvent = pairedEventCache_;
  } else {
    exportEvent.eventId = record.eventId;
    exportEvent.title = record.eventTitle;
    exportEvent.date = record.eventDate;
    exportEvent.scheduledTime = record.scheduledTimeStart;
    exportEvent.scheduledTimeEnd = record.scheduledTimeEnd;
    exportEvent.location = record.eventLocation;
  }

  TimeSnapshot generatedAt;
  generatedAt.epoch = record.capturedAtEpoch;
  generatedAt.iso8601 = record.capturedAtIso;
  generatedAt.source = record.timeSource;
  generatedAt.valid = record.capturedAtEpoch > 0;

  String exportPath;
  lastSdWriteSucceeded_ = exportAttendanceCsv(exportEvent, generatedAt, exportPath);
  return lastSdWriteSucceeded_;
}

bool StorageManager::isSdReady() const {
  return sdReady_;
}

bool StorageManager::lastSdWriteSucceeded() const {
  return lastSdWriteSucceeded_;
}
