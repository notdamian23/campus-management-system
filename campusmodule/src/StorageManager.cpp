#include "StorageManager.h"

#include <ArduinoJson.h>
#include <FS.h>
#include <LittleFS.h>
#include <SD.h>
#include <SPI.h>

#include "Config.h"
#include "Pins.h"

namespace {
constexpr char kPendingStudentsPath[] = "/pending_students.json";
constexpr char kFingerprintMapPath[] = "/fingerprint_map.json";
constexpr char kAttendancePath[] = "/attendance_records.json";
constexpr char kTempPath[] = "/campus_tmp.json";
constexpr char kSdAuditPath[] = "/attendance_audit.csv";

constexpr size_t kPendingDocSize = 16384;
constexpr size_t kFingerprintDocSize = 16384;
constexpr size_t kAttendanceDocSize = 65536;

void studentToJson(JsonObject object, const StudentInfo &student) {
  object["studentUid"] = student.studentUid;
  object["schoolId"] = student.schoolId;
  object["studentName"] = student.studentName;
  object["course"] = student.course;
  object["year"] = student.year;
  object["templateId"] = student.templateId;
  object["enrollmentSynced"] = student.enrollmentSynced;
}

StudentInfo studentFromJson(JsonObjectConst object) {
  StudentInfo student;
  student.studentUid = String(object["studentUid"] | "");
  student.schoolId = String(object["schoolId"] | "");
  student.studentName = String(object["studentName"] | "");
  student.course = String(object["course"] | "");
  student.year = String(object["year"] | "");
  student.templateId = object["templateId"] | -1;
  student.enrollmentSynced = object["enrollmentSynced"] | false;
  return student;
}

void attendanceToJson(JsonObject object, const AttendanceRecord &record) {
  object["recordId"] = record.recordId;
  object["eventId"] = record.eventId;
  object["eventTitle"] = record.eventTitle;
  object["studentUid"] = record.studentUid;
  object["schoolId"] = record.schoolId;
  object["studentName"] = record.studentName;
  object["course"] = record.course;
  object["year"] = record.year;
  object["templateId"] = record.templateId;
  object["deviceId"] = record.deviceId;
  object["capturedAtEpoch"] = record.capturedAtEpoch;
  object["capturedAtIso"] = record.capturedAtIso;
  object["timeSource"] = record.timeSource;
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
  record.year = String(object["year"] | "");
  record.templateId = object["templateId"] | -1;
  record.deviceId = String(object["deviceId"] | "");
  record.capturedAtEpoch = object["capturedAtEpoch"].isNull()
                               ? 0ULL
                               : object["capturedAtEpoch"].as<uint64_t>();
  record.capturedAtIso = String(object["capturedAtIso"] | "");
  record.timeSource = String(object["timeSource"] | "unknown");
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
}  // namespace

bool StorageManager::begin() {
  prefsReady_ = prefs_.begin("campus", false);
  littleFsReady_ = LittleFS.begin(true);

  if (CampusConfig::kUseSd) {
    SPI.begin(Pins::kSdSck, Pins::kSdMiso, Pins::kSdMosi, Pins::kSdCs);
    sdReady_ = SD.begin(Pins::kSdCs);
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

  return writeFingerprintMappings(students);
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

  return changed ? writeFingerprintMappings(students) : false;
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
  DynamicJsonDocument doc(kPendingDocSize);
  JsonArray array = doc.to<JsonArray>();
  for (const auto &student : students) {
    JsonObject object = array.createNestedObject();
    studentToJson(object, student);
  }
  return saveDocument(LittleFS, kPendingStudentsPath, kTempPath, doc);
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
        "templateId,deviceId,capturedAtEpoch,capturedAtIso,timeSource");
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
  file.print(csvEscape(record.year));
  file.print(",");
  file.print(record.templateId);
  file.print(",");
  file.print(csvEscape(record.deviceId));
  file.print(",");
  file.print(record.capturedAtEpoch);
  file.print(",");
  file.print(csvEscape(record.capturedAtIso));
  file.print(",");
  file.println(csvEscape(record.timeSource));
  file.close();
  return true;
}
