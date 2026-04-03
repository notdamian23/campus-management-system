#include "StorageManager.h"

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

constexpr size_t kPendingDocSize = 16384;
constexpr size_t kFingerprintDocSize = 16384;
constexpr size_t kAttendanceDocSize = 65536;
constexpr size_t kPairedEventContextDocSize = 65536;
constexpr size_t kEnrollmentSessionDocSize = 4096;

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
  record.source = String(object["source"] | "portable-device");
  record.synced = object["synced"] | false;
  record.remoteDuplicate = object["remoteDuplicate"] | false;
  record.syncError = String(object["syncError"] | "");
  record.retryCount = object["retryCount"] | 0UL;
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

void eventToJson(JsonObject object, const EventInfo &event) {
  object["eventId"] = event.eventId;
  object["title"] = event.title;
  object["date"] = event.date;
  object["scheduledTime"] = event.scheduledTime;
  object["location"] = event.location;
  object["status"] = event.status;
  object["requiresRegistration"] = event.requiresRegistration;
}

EventInfo eventFromJson(JsonObjectConst object) {
  EventInfo event;
  event.eventId = String(object["eventId"] | "");
  event.title = String(object["title"] | "");
  event.date = String(object["date"] | "");
  event.scheduledTime = String(object["scheduledTime"] | "");
  event.location = String(object["location"] | "");
  event.status = String(object["status"] | "");
  event.requiresRegistration = object["requiresRegistration"] | false;
  return event;
}
}  // namespace

bool StorageManager::begin() {
  prefsReady_ = prefs_.begin("campus", false);
  littleFsReady_ = LittleFS.begin(true);

  if (littleFsReady_) {
    LittleFS.mkdir("/config");
    LittleFS.mkdir("/sessions");
    LittleFS.mkdir("/students");
    LittleFS.mkdir("/logs");
    saveDeviceConfigSnapshot();
  }

  if (CampusConfig::kUseSd) {
    SPI.begin(Pins::kSdSck, Pins::kSdMiso, Pins::kSdMosi, Pins::kSdCs);
    sdReady_ = SD.begin(Pins::kSdCs);
    if (sdReady_) {
      SD.mkdir("/config");
      SD.mkdir("/sessions");
      SD.mkdir("/students");
      SD.mkdir("/logs");
    }
  }

  return prefsReady_ && littleFsReady_;
}

EventInfo StorageManager::loadPairedEvent() const {
  EventInfo event;
  if (!prefsReady_) {
    return event;
  }

  event.eventId = prefs_.getString("pair_id", "");
  event.title = prefs_.getString("pair_title", "");
  event.date = prefs_.getString("pair_date", "");
  event.scheduledTime = prefs_.getString("pair_time", "");
  event.location = prefs_.getString("pair_loc", "");
  event.status = prefs_.getString("pair_stat", "");
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
  prefs_.putString("pair_loc", event.location);
  prefs_.putString("pair_stat", event.status);
  return true;
}

bool StorageManager::savePairedEventContext(
    const EventInfo &event, const std::vector<StudentInfo> &students,
    const std::vector<String> &recordedStudentIds) {
  if (!savePairedEvent(event) || !littleFsReady_) {
    return false;
  }

  return writePairedEventContext(event, students, recordedStudentIds);
}

bool StorageManager::loadPairedEventContext(
    EventInfo &event, std::vector<StudentInfo> &students,
    std::vector<String> &recordedStudentIds) const {
  event = loadPairedEvent();
  students.clear();
  recordedStudentIds.clear();

  if (!littleFsReady_) {
    return event.isValid();
  }

  DynamicJsonDocument doc(kPairedEventContextDocSize);
  if (!LittleFS.exists(kPairedEventContextPath)) {
    return event.isValid();
  }

  File file = LittleFS.open(kPairedEventContextPath, FILE_READ);
  if (!file) {
    return event.isValid();
  }

  const DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) {
    return event.isValid();
  }

  JsonObject eventObject = doc["event"];
  if (!eventObject.isNull()) {
    event = eventFromJson(eventObject);
  }

  JsonArray studentArray = doc["students"].as<JsonArray>();
  for (JsonObjectConst item : studentArray) {
    const StudentInfo student = studentFromJson(item);
    if (student.isValid()) {
      students.push_back(student);
    }
  }

  JsonArray recordedArray = doc["recordedStudentIds"].as<JsonArray>();
  for (JsonVariantConst item : recordedArray) {
    const char *rawStudentUid = item.as<const char *>();
    const String studentUid = rawStudentUid != nullptr ? String(rawStudentUid) : String("");
    if (!studentUid.isEmpty()) {
      recordedStudentIds.push_back(studentUid);
    }
  }

  return event.isValid();
}

bool StorageManager::isStudentAuthorizedForEvent(const String &eventId,
                                                 const String &studentUid) const {
  EventInfo pairedEvent;
  std::vector<StudentInfo> students;
  std::vector<String> recordedStudentIds;
  loadPairedEventContext(pairedEvent, students, recordedStudentIds);

  if (!pairedEvent.isValid() || pairedEvent.eventId != eventId || students.empty()) {
    return true;
  }

  for (const auto &student : students) {
    if (student.studentUid == studentUid) {
      return true;
    }
  }
  return false;
}

bool StorageManager::isRemoteAttendanceRecorded(const String &eventId,
                                                const String &studentUid) const {
  EventInfo pairedEvent;
  std::vector<StudentInfo> students;
  std::vector<String> recordedStudentIds;
  loadPairedEventContext(pairedEvent, students, recordedStudentIds);

  if (!pairedEvent.isValid() || pairedEvent.eventId != eventId) {
    return false;
  }

  for (const auto &recordedUid : recordedStudentIds) {
    if (recordedUid == studentUid) {
      return true;
    }
  }
  return false;
}

bool StorageManager::markRemoteAttendanceRecorded(const String &eventId,
                                                  const String &studentUid) {
  EventInfo pairedEvent;
  std::vector<StudentInfo> students;
  std::vector<String> recordedStudentIds;
  if (!loadPairedEventContext(pairedEvent, students, recordedStudentIds)) {
    return false;
  }

  if (pairedEvent.eventId != eventId) {
    return false;
  }

  for (const auto &recordedUid : recordedStudentIds) {
    if (recordedUid == studentUid) {
      return true;
    }
  }

  recordedStudentIds.push_back(studentUid);
  return writePairedEventContext(pairedEvent, students, recordedStudentIds);
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

std::vector<StudentInfo> StorageManager::loadPendingStudents() const {
  std::vector<StudentInfo> students;
  if (!littleFsReady_) {
    return students;
  }

  DynamicJsonDocument doc(kPendingDocSize);
  loadArrayDocument(LittleFS, kPendingStudentsPath, doc);

  for (JsonObjectConst item : doc.as<JsonArrayConst>()) {
    const StudentInfo student = studentFromJson(item);
    if (student.isValid()) {
      students.push_back(student);
    }
  }

  return students;
}

bool StorageManager::savePendingStudents(const std::vector<StudentInfo> &students) {
  if (!littleFsReady_) {
    return false;
  }
  return writePendingStudents(students);
}

std::vector<StudentInfo> StorageManager::loadFingerprintMappings() const {
  std::vector<StudentInfo> students;
  if (!littleFsReady_) {
    return students;
  }

  DynamicJsonDocument doc(kFingerprintDocSize);
  loadArrayDocument(LittleFS, kFingerprintMapPath, doc);

  for (JsonObjectConst item : doc.as<JsonArrayConst>()) {
    const StudentInfo student = studentFromJson(item);
    if (student.isValid()) {
      students.push_back(student);
    }
  }

  return students;
}

bool StorageManager::upsertFingerprintMapping(const StudentInfo &student) {
  if (!littleFsReady_) {
    return false;
  }

  std::vector<StudentInfo> students = loadFingerprintMappings();
  bool updated = false;

  for (auto &entry : students) {
    if (entry.studentUid == student.studentUid || entry.templateId == student.templateId) {
      entry = student;
      updated = true;
      break;
    }
  }

  if (!updated) {
    students.push_back(student);
  }

  if (!writeFingerprintMappings(students)) {
    return false;
  }

  return updateEnrollmentArtifacts(student);
}

bool StorageManager::findStudentByTemplate(int templateId, StudentInfo &outStudent) const {
  const std::vector<StudentInfo> students = loadFingerprintMappings();
  for (const auto &student : students) {
    if (student.templateId == templateId) {
      outStudent = student;
      return true;
    }
  }
  return false;
}

int StorageManager::nextFreeTemplateId(uint16_t startId, uint16_t endId) const {
  const std::vector<StudentInfo> students = loadFingerprintMappings();
  for (uint16_t templateId = startId; templateId <= endId; ++templateId) {
    bool used = false;
    for (const auto &student : students) {
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

std::vector<StudentInfo> StorageManager::loadUnsyncedEnrollments() const {
  std::vector<StudentInfo> pending;
  DynamicJsonDocument doc(kPendingDocSize);
  if (littleFsReady_ && loadArrayDocument(LittleFS, kEnrollmentSyncQueuePath, doc)) {
    for (JsonObjectConst item : doc.as<JsonArrayConst>()) {
      const StudentInfo student = studentFromJson(item);
      if (student.templateId > 0 && !student.enrollmentSynced) {
        pending.push_back(student);
      }
    }
  }

  if (!pending.empty()) {
    return pending;
  }

  const std::vector<StudentInfo> students = loadFingerprintMappings();
  for (const auto &student : students) {
    if (student.templateId > 0 && !student.enrollmentSynced) {
      pending.push_back(student);
    }
  }
  return pending;
}

bool StorageManager::markEnrollmentSynced(const String &studentUid) {
  std::vector<StudentInfo> students = loadFingerprintMappings();
  bool changed = false;

  for (auto &student : students) {
    if (student.studentUid == studentUid) {
      student.enrollmentSynced = true;
      changed = true;
      break;
    }
  }

  std::vector<StudentInfo> queue = loadPendingStudents();
  for (auto &student : queue) {
    if (student.studentUid == studentUid) {
      student.enrollmentSynced = true;
      student.syncStatus = "synced";
      student.enrollmentStatus = "synced";
      break;
    }
  }

  const bool mappingSaved = changed ? writeFingerprintMappings(students) : true;
  const bool pendingSaved = writePendingStudents(queue);
  const bool queueSaved = removeFromSyncQueue(studentUid);
  return mappingSaved && pendingSaved && queueSaved;
}

std::vector<AttendanceRecord> StorageManager::loadAttendanceRecords() const {
  std::vector<AttendanceRecord> records;
  if (!littleFsReady_) {
    return records;
  }

  DynamicJsonDocument doc(kAttendanceDocSize);
  loadArrayDocument(LittleFS, kAttendancePath, doc);

  for (JsonObjectConst item : doc.as<JsonArrayConst>()) {
    const AttendanceRecord record = attendanceFromJson(item);
    if (!record.recordId.isEmpty()) {
      records.push_back(record);
    }
  }

  return records;
}

bool StorageManager::appendAttendanceRecord(const AttendanceRecord &record) {
  if (!littleFsReady_) {
    return false;
  }

  std::vector<AttendanceRecord> records = loadAttendanceRecords();
  records.push_back(record);
  const bool saved = writeAttendanceRecords(records);
  if (saved) {
    backupAttendanceToSd(record);
  }
  return saved;
}

bool StorageManager::isDuplicateAttendance(const String &eventId,
                                           const String &studentUid) const {
  const std::vector<AttendanceRecord> records = loadAttendanceRecords();
  for (const auto &record : records) {
    if (record.eventId == eventId && record.studentUid == studentUid) {
      return true;
    }
  }
  return false;
}

size_t StorageManager::unsyncedAttendanceCount() const {
  const std::vector<AttendanceRecord> records = loadAttendanceRecords();
  size_t count = 0;
  for (const auto &record : records) {
    if (!record.synced) {
      ++count;
    }
  }
  return count;
}

bool StorageManager::applySyncResults(const std::vector<SyncItemResult> &results) {
  if (results.empty()) {
    return true;
  }

  std::vector<AttendanceRecord> records = loadAttendanceRecords();
  bool changed = false;

  for (auto &record : records) {
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

  return changed ? writeAttendanceRecords(records) : true;
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

  std::vector<StudentInfo> syncQueue;
  DynamicJsonDocument queueDoc(kPendingDocSize);
  loadArrayDocument(LittleFS, kEnrollmentSyncQueuePath, queueDoc);
  for (JsonObjectConst item : queueDoc.as<JsonArrayConst>()) {
    const StudentInfo row = studentFromJson(item);
    if (row.isValid() && row.studentUid != student.studentUid) {
      syncQueue.push_back(row);
    }
  }
  syncQueue.push_back(student);

  auto queue = loadPendingStudents();
  bool queueChanged = false;
  for (auto &entry : queue) {
    if (entry.studentUid == student.studentUid) {
      entry = student;
      queueChanged = true;
      break;
    }
  }
  if (!queueChanged) {
    queue.push_back(student);
  }

  return writeStudentList(kEnrollmentLogsPath, logs) &&
         writeStudentList(kEnrollmentSyncQueuePath, syncQueue) &&
         writePendingStudents(queue);
}

bool StorageManager::removeFromSyncQueue(const String &studentUid) {
  if (!littleFsReady_) {
    return false;
  }

  DynamicJsonDocument doc(kPendingDocSize);
  loadArrayDocument(LittleFS, kEnrollmentSyncQueuePath, doc);
  std::vector<StudentInfo> students;
  for (JsonObjectConst item : doc.as<JsonArrayConst>()) {
    StudentInfo student = studentFromJson(item);
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

  return writeStudentList(kEnrollmentSyncQueuePath, students);
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
  if (!sdReady_) {
    return false;
  }

  const bool exists = SD.exists(kSdAuditPath);
  File file = SD.open(kSdAuditPath, FILE_APPEND);
  if (!file) {
    return false;
  }

  if (!exists) {
    file.println(
        "recordId,eventId,eventTitle,studentUid,schoolId,studentName,course,year,"
        "templateId,deviceId,capturedAtEpoch,capturedAtIso,timeSource,source");
  }

  file.print(csvEscape(record.recordId));
  file.print(",");
  file.print(csvEscape(record.eventId));
  file.print(",");
  file.print(csvEscape(record.eventTitle));
  file.print(",");
  file.print(csvEscape(record.studentUid));
  file.print(",");
  file.print(csvEscape(record.schoolId));
  file.print(",");
  file.print(csvEscape(record.studentName));
  file.print(",");
  file.print(csvEscape(record.course));
  file.print(",");
  file.print(csvEscape(record.yearLevel));
  file.print(",");
  file.print(record.templateId);
  file.print(",");
  file.print(csvEscape(record.deviceId));
  file.print(",");
  file.print(record.capturedAtEpoch);
  file.print(",");
  file.print(csvEscape(record.capturedAtIso));
  file.print(",");
  file.print(csvEscape(record.timeSource));
  file.print(",");
  file.println(csvEscape(record.source));
  file.close();
  return true;
}
