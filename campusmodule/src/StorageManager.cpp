#include "StorageManager.h"

#include <algorithm>

#include <ArduinoJson.h>
#include <FS.h>
#include <LittleFS.h>
#include <SD.h>
#include <SPI.h>

#include <CampusEligibility.h>

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
constexpr char kSdEnrollmentDir[] = "/enrollment";
constexpr char kSdPairedEventDir[] = "/events";
constexpr char kSdEnrollmentQueuePath[] = "/enrollment/session_students.csv";
constexpr char kSdEnrollmentQueueTempPath[] = "/enrollment/session_students.tmp";
constexpr char kSdEnrollmentResultsPath[] = "/enrollment/results_queue.csv";
constexpr char kSdEnrollmentResultsTempPath[] = "/enrollment/results_queue.tmp";
constexpr char kSdFingerprintRosterPath[] = "/fingerprint_roster.csv";
constexpr char kSdFingerprintRosterTempPath[] = "/logs/fingerprint_roster.tmp";
constexpr char kTempPath[] = "/campus_tmp.json";
constexpr char kSdAuditPath[] = "/attendance_audit.csv";
constexpr char kSdExportDir[] = "/exports";
constexpr uint16_t kPairedEventContextSchemaVersion = 2;

constexpr size_t kPendingDocSize = 16384;
constexpr size_t kFingerprintDocSize = 16384;
constexpr size_t kAttendanceDocSize = 65536;
constexpr size_t kPairedEventContextDocSize = 65536;
constexpr size_t kEnrollmentSessionDocSize = 4096;
constexpr size_t kFingerprintRosterFieldCount = 8;
constexpr size_t kFingerprintRosterFieldCountExtended = 10;
constexpr size_t kFingerprintRosterMaxLineLength = 320;
constexpr size_t kEnrollmentQueueFieldCount = 12;
constexpr size_t kEnrollmentResultFieldCount = 12;
constexpr size_t kPairedEventStudentFieldCount = 8;
constexpr size_t kPairedEventRecordedFieldCount = 1;

bool parseBoolValue(JsonVariantConst value, bool fallback = false) {
  if (value.isNull()) {
    return fallback;
  }
  if (value.is<bool>()) {
    return value.as<bool>();
  }
  if (value.is<int>() || value.is<long>() || value.is<unsigned int>() ||
      value.is<unsigned long>()) {
    return value.as<long>() != 0;
  }

  String text;
  if (value.is<const char *>()) {
    const char *raw = value.as<const char *>();
    text = raw != nullptr ? String(raw) : String("");
  } else {
    text = value.as<String>();
  }
  text = CampusEligibility::trimAndCollapseWhitespace(text);
  text.toLowerCase();
  if (text == "true" || text == "yes" || text == "y" || text == "1" ||
      text == "active" || text == "paid" || text == "approved" ||
      text == "registered" || text == "enrolled" || text == "complete") {
    return true;
  }
  if (text == "false" || text == "no" || text == "n" || text == "0" ||
      text == "inactive" || text == "unpaid" || text == "pending" ||
      text == "rejected" || text == "disabled") {
    return false;
  }
  return fallback;
}

bool parseBoolText(const String &text, bool fallback = false) {
  String normalized = CampusEligibility::trimAndCollapseWhitespace(text);
  normalized.toLowerCase();
  if (normalized == "true" || normalized == "yes" || normalized == "y" ||
      normalized == "1" || normalized == "active" || normalized == "paid" ||
      normalized == "approved" || normalized == "registered" ||
      normalized == "enrolled" || normalized == "complete") {
    return true;
  }
  if (normalized == "false" || normalized == "no" || normalized == "n" ||
      normalized == "0" || normalized == "inactive" || normalized == "unpaid" ||
      normalized == "pending" || normalized == "rejected" ||
      normalized == "disabled") {
    return false;
  }
  return fallback;
}

String parseStringField(JsonVariantConst value) {
  if (value.isNull()) {
    return "";
  }
  if (value.is<JsonObjectConst>()) {
    JsonObjectConst object = value.as<JsonObjectConst>();
    return String(object["studentUid"] | object["studentId"] | object["uid"] |
                  object["id"] | object["value"] | "");
  }
  if (value.is<const char *>()) {
    const char *raw = value.as<const char *>();
    return raw != nullptr ? String(raw) : String("");
  }
  return value.as<String>();
}

void logPairedEventSummary(const char *stage, const EventInfo &event,
                           size_t studentCount, size_t recordedCount) {
  Serial.printf(
      "[PAIR][CACHE] stage=%s eventId=%s title=%s targetMode=%s targetStudent=%s "
      "yearLevels=%s courses=%s sections=%s selectedStudentCount=%u "
      "selectedSchoolCount=%u bodScope=%s preregRequired=%s paymentRequired=%s "
      "activeOnly=%s audienceRestricted=%s rosterRequired=%s schema=%u "
      "students=%u recorded=%u\n",
      stage != nullptr ? stage : "-", event.eventId.c_str(), event.title.c_str(),
      event.targetMode.c_str(), event.targetStudent.c_str(),
      CampusEligibility::joinCanonicalList(event.yearLevelFilters).c_str(),
      CampusEligibility::joinCanonicalList(event.courseFilters).c_str(),
      CampusEligibility::joinCanonicalList(event.sectionFilters).c_str(),
      static_cast<unsigned>(event.targetedStudentIds.size()),
      static_cast<unsigned>(event.targetedSchoolIds.size()),
      event.bodScope.c_str(),
      event.preregistrationRequired || event.requiresRegistration ? "yes" : "no",
      event.paymentRequired ? "yes" : "no", event.activeOnly ? "yes" : "no",
      event.audienceRestricted ? "yes" : "no",
      event.rosterRequired ? "yes" : "no",
      static_cast<unsigned>(event.contextSchemaVersion),
      static_cast<unsigned>(studentCount), static_cast<unsigned>(recordedCount));
}

void appendStringValues(JsonVariantConst value, std::vector<String> &outValues) {
  if (value.isNull()) {
    return;
  }

  if (value.is<JsonArrayConst>()) {
    for (JsonVariantConst item : value.as<JsonArrayConst>()) {
      const String parsed = CampusEligibility::trimAndCollapseWhitespace(
          parseStringField(item));
      if (parsed.isEmpty()) {
        continue;
      }
      bool exists = false;
      for (const auto &entry : outValues) {
        if (entry == parsed) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        outValues.push_back(parsed);
      }
    }
    return;
  }

  const String parsed =
      CampusEligibility::trimAndCollapseWhitespace(parseStringField(value));
  if (parsed.isEmpty()) {
    return;
  }

  bool exists = false;
  for (const auto &entry : outValues) {
    if (entry == parsed) {
      exists = true;
      break;
    }
  }
  if (!exists) {
    outValues.push_back(parsed);
  }
}

bool hasCachedAudienceEvidence(const EventInfo &event) {
  EventInfo normalized = event;
  CampusEligibility::normalizeEvent(normalized);
  return CampusEligibility::isSpecificStudentsMode(normalized) ||
         CampusEligibility::hasBroadAudienceFilters(normalized) ||
         normalized.preregistrationRequired || normalized.requiresRegistration ||
         normalized.paymentRequired || normalized.activeOnly ||
         normalized.audienceRestricted || normalized.rosterRequired;
}

bool hasCachedAudienceContradiction(const EventInfo &event,
                                    const String &rawTargetMode) {
  const String targetMode = CampusEligibility::normalizeTargetMode(rawTargetMode);
  EventInfo normalized = event;
  CampusEligibility::normalizeEvent(normalized);
  const bool hasSpecificAudience =
      CampusEligibility::isSpecificStudentsMode(normalized);
  const bool hasAudienceFilters =
      CampusEligibility::hasBroadAudienceFilters(normalized);
  const bool requiresContextHint =
      event.audienceRestricted || event.rosterRequired;

  if (targetMode.isEmpty() && requiresContextHint) {
    return true;
  }
  if (targetMode == "broad" && (hasSpecificAudience || hasAudienceFilters)) {
    return true;
  }
  if (hasCachedAudienceEvidence(event) && !requiresContextHint) {
    return true;
  }
  return false;
}

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
  object["section"] = student.section;
  object["courseCanonical"] = student.courseCanonical;
  object["yearLevelCanonical"] = student.yearLevelCanonical;
  object["sectionCanonical"] = student.sectionCanonical;
  object["bodScope"] = student.bodScope;
  object["bodScopeCanonical"] = student.bodScopeCanonical;
  object["sessionId"] = student.sessionId;
  object["queueId"] = student.queueId;
  object["fingerprintStatus"] = student.fingerprintStatus;
  object["fingerprintDeviceId"] = student.fingerprintDeviceId;
  object["enrollmentStatus"] = student.enrollmentStatus;
  object["syncStatus"] = student.syncStatus;
  object["remarks"] = student.remarks;
  object["enrolledAtIso"] = student.enrolledAtIso;
  object["templateId"] = student.templateId;
  object["isActive"] = student.isActive;
  object["activeKnown"] = student.activeKnown;
  object["preregistered"] = student.preregistered;
  object["preregisteredKnown"] = student.preregisteredKnown;
  object["paymentSatisfied"] = student.paymentSatisfied;
  object["paymentKnown"] = student.paymentKnown;
  object["enrollmentSynced"] = student.enrollmentSynced;
}

StudentInfo studentFromJson(JsonObjectConst object) {
  StudentInfo student;
  student.studentUid = String(object["studentUid"] | "");
  student.schoolId = String(object["schoolId"] | "");
  student.studentName = String(object["studentName"] | "");
  student.course = String(object["course"] | "");
  student.yearLevel = String(object["yearLevel"] | object["year"] | "");
  student.section = String(object["section"] | "");
  student.courseCanonical =
      String(object["courseCanonical"] | object["courseCode"] | "");
  student.yearLevelCanonical =
      String(object["yearLevelCanonical"] | object["yearCanonical"] | "");
  student.sectionCanonical = String(object["sectionCanonical"] | "");
  student.bodScope =
      String(object["bodScope"] | object["organization"] | object["scope"] | "");
  student.bodScopeCanonical = String(object["bodScopeCanonical"] | "");
  student.sessionId = String(object["sessionId"] | "");
  student.queueId = String(object["queueId"] | "");
  student.fingerprintStatus = String(object["fingerprintStatus"] | "");
  student.fingerprintDeviceId = String(object["fingerprintDeviceId"] | "");
  student.enrollmentStatus = String(object["enrollmentStatus"] | "");
  student.syncStatus = String(object["syncStatus"] | "");
  student.remarks = String(object["remarks"] | "");
  student.enrolledAtIso = String(object["enrolledAtIso"] | "");
  student.templateId = object["templateId"] | -1;
  student.isActive =
      parseBoolValue(object["isActive"], parseBoolValue(object["active"], true));
  student.activeKnown =
      !object["isActive"].isNull() || !object["active"].isNull() ||
      !object["accountActive"].isNull() || !object["accountStatus"].isNull();
  if (!student.activeKnown) {
    const String accountStatus =
        String(object["accountStatus"] | object["profileStatus"] | "");
    if (!accountStatus.isEmpty()) {
      student.activeKnown = true;
      student.isActive = parseBoolText(accountStatus, true);
    }
  }
  student.preregistered = parseBoolValue(
      object["preregistered"],
      parseBoolValue(object["isPreregistered"],
                     parseBoolValue(object["hasPreregistration"], false)));
  student.preregisteredKnown =
      !object["preregistered"].isNull() || !object["isPreregistered"].isNull() ||
      !object["hasPreregistration"].isNull() ||
      !object["registrationStatus"].isNull();
  if (!object["registrationStatus"].isNull()) {
    student.preregisteredKnown = true;
    student.preregistered =
        parseBoolText(String(object["registrationStatus"] | ""), false);
  }
  student.paymentSatisfied = parseBoolValue(
      object["paymentSatisfied"],
      parseBoolValue(object["isPaid"],
                     parseBoolValue(object["paymentCleared"], false)));
  student.paymentKnown =
      !object["paymentSatisfied"].isNull() || !object["isPaid"].isNull() ||
      !object["paymentCleared"].isNull() || !object["paymentStatus"].isNull();
  if (!object["paymentStatus"].isNull()) {
    student.paymentKnown = true;
    student.paymentSatisfied =
        parseBoolText(String(object["paymentStatus"] | ""), false);
  }
  student.enrollmentSynced = object["enrollmentSynced"] | false;
  CampusEligibility::normalizeStudent(student);
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
  object["syncRejected"] = record.syncRejected;
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
  record.syncRejected = object["syncRejected"] | false;
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

bool writeCsvLine(File &file, const String &line) {
  return file.println(line) > 0;
}

String safePathComponent(const String &value) {
  String output = value;
  output.trim();
  output.replace(" ", "_");
  output.replace("/", "_");
  output.replace("\\", "_");
  output.replace(":", "_");
  output.replace("|", "_");
  output.replace("\"", "_");
  output.replace("?", "_");
  output.replace("*", "_");
  output.replace("<", "_");
  output.replace(">", "_");
  return output;
}

String pairedEventStudentsPathForEvent(const String &eventId) {
  return String(kSdPairedEventDir) + "/" + safePathComponent(eventId) +
         "_students.csv";
}

String pairedEventStudentsTempPathForEvent(const String &eventId) {
  return String(kSdPairedEventDir) + "/" + safePathComponent(eventId) +
         "_students.tmp";
}

String pairedEventRecordedPathForEvent(const String &eventId) {
  return String(kSdPairedEventDir) + "/" + safePathComponent(eventId) +
         "_recorded.csv";
}

String pairedEventRecordedTempPathForEvent(const String &eventId) {
  return String(kSdPairedEventDir) + "/" + safePathComponent(eventId) +
         "_recorded.tmp";
}

String pairedEventStudentCsvHeader() {
  return "studentUid,schoolId,studentName,course,yearLevel,section,bodScope,queueId";
}

String pairedEventStudentCsvRow(const StudentInfo &student) {
  return csvEscape(student.studentUid) + "," + csvEscape(student.schoolId) + "," +
         csvEscape(student.studentName) + "," + csvEscape(student.course) + "," +
         csvEscape(student.yearLevel) + "," + csvEscape(student.section) + "," +
         csvEscape(student.bodScope) + "," + csvEscape(student.queueId);
}

String pairedEventRecordedCsvHeader() {
  return "studentUid";
}

String pairedEventRecordedCsvRow(const String &studentUid) {
  return csvEscape(studentUid);
}

bool readBoundedLine(File &file, String &line, bool &truncated) {
  line = "";
  truncated = false;

  while (file.available()) {
    const char current = static_cast<char>(file.read());
    if (current == '\r') {
      continue;
    }
    if (current == '\n') {
      return true;
    }
    if (line.length() < kFingerprintRosterMaxLineLength) {
      line += current;
    } else {
      truncated = true;
    }
  }

  return !line.isEmpty() || truncated;
}

size_t splitCsvLine(const String &line, String *fields, size_t maxFields) {
  if (fields == nullptr || maxFields == 0) {
    return 0;
  }

  for (size_t index = 0; index < maxFields; ++index) {
    fields[index] = "";
  }

  size_t fieldIndex = 0;
  String current;
  bool inQuotes = false;

  for (size_t index = 0; index < line.length(); ++index) {
    const char currentChar = line[index];
    if (currentChar == '"') {
      if (inQuotes && (index + 1U) < line.length() && line[index + 1U] == '"') {
        current += '"';
        ++index;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (currentChar == ',' && !inQuotes) {
      if (fieldIndex < maxFields) {
        current.trim();
        fields[fieldIndex] = current;
      }
      current = "";
      ++fieldIndex;
      continue;
    }

    current += currentChar;
  }

  if (fieldIndex < maxFields) {
    current.trim();
    fields[fieldIndex] = current;
  }

  return fieldIndex + 1U;
}

bool isFingerprintRosterHeader(const String *fields, size_t fieldCount) {
  if (fields == nullptr || fieldCount == 0) {
    return false;
  }

  String header = fields[0];
  header.toLowerCase();
  return header == "templateid";
}

bool parseFingerprintRosterStudent(const String &line, StudentInfo &student,
                                   bool &active, bool &hasFingerprint) {
  String fields[kFingerprintRosterFieldCountExtended];
  const size_t parsedFields =
      splitCsvLine(line, fields, kFingerprintRosterFieldCountExtended);
  if (parsedFields == 0 || isFingerprintRosterHeader(fields, parsedFields)) {
    return false;
  }
  if (parsedFields < kFingerprintRosterFieldCount) {
    return false;
  }

  const int templateId = fields[0].toInt();
  if (templateId <= 0) {
    return false;
  }

  student = StudentInfo{};
  student.templateId = templateId;
  student.studentUid = fields[1];
  student.schoolId = fields[2];
  student.studentName = fields[3];
  student.course = fields[4];
  student.yearLevel = fields[5];
  if (parsedFields >= kFingerprintRosterFieldCountExtended) {
    student.section = fields[6];
    student.bodScope = fields[7];
    active = parseBoolText(fields[8], true);
    hasFingerprint = parseBoolText(fields[9], true);
  } else {
    active = parseBoolText(fields[6], true);
    hasFingerprint = parseBoolText(fields[7], true);
  }
  student.isActive = active;
  student.activeKnown = true;
  student.fingerprintStatus =
      hasFingerprint ? (active ? "enrolled" : "inactive") : "pending";

  if (!student.isValid()) {
    return false;
  }

  CampusEligibility::normalizeStudent(student);
  return true;
}

bool isPairedEventStudentHeader(const String *fields, size_t fieldCount) {
  if (fields == nullptr || fieldCount == 0) {
    return false;
  }

  String header = fields[0];
  header.toLowerCase();
  return header == "studentuid";
}

StudentInfo pairedEventStudentFromFields(const String *fields, size_t fieldCount) {
  StudentInfo student;
  if (fields == nullptr || fieldCount < kPairedEventStudentFieldCount ||
      isPairedEventStudentHeader(fields, fieldCount)) {
    return student;
  }

  student.studentUid = fields[0];
  student.schoolId = fields[1];
  student.studentName = fields[2];
  student.course = fields[3];
  student.yearLevel = fields[4];
  student.section = fields[5];
  student.bodScope = fields[6];
  student.queueId = fields[7];
  CampusEligibility::normalizeStudent(student);
  return student;
}

bool isPairedEventRecordedHeader(const String *fields, size_t fieldCount) {
  if (fields == nullptr || fieldCount == 0) {
    return false;
  }

  String header = fields[0];
  header.toLowerCase();
  return header == "studentuid";
}

FingerprintRosterStats collectFingerprintRosterStats(fs::FS &fs, const char *path) {
  FingerprintRosterStats stats;
  if (!fs.exists(path)) {
    return stats;
  }

  File file = fs.open(path, FILE_READ);
  if (!file) {
    return stats;
  }

  stats.rosterExists = true;
  stats.fileSize = file.size();

  String line;
  bool truncated = false;
  while (readBoundedLine(file, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    String fields[kFingerprintRosterFieldCount];
    const size_t parsedFields =
        splitCsvLine(line, fields, kFingerprintRosterFieldCount);
    if (parsedFields == 0) {
      continue;
    }
    if (!stats.headerValid && isFingerprintRosterHeader(fields, parsedFields)) {
      stats.headerValid = true;
      continue;
    }

    StudentInfo student;
    bool active = false;
    bool hasFingerprint = false;
    if (!parseFingerprintRosterStudent(line, student, active, hasFingerprint)) {
      continue;
    }
    ++stats.totalRows;
  }

  file.close();
  return stats;
}

String normalizeEnrollmentText(const String &value) {
  String normalized = CampusEligibility::trimAndCollapseWhitespace(value);
  normalized.toLowerCase();
  return normalized;
}

bool isEnrollmentQueueHeader(const String *fields, size_t fieldCount) {
  if (fields == nullptr || fieldCount < 2) {
    return false;
  }

  String first = fields[0];
  String second = fields[1];
  first.toLowerCase();
  second.toLowerCase();
  return first == "sessionid" && second == "studentuid";
}

bool isEnrollmentStudentSynced(const StudentInfo &student) {
  if (student.enrollmentSynced) {
    return true;
  }

  const String syncStatus = normalizeEnrollmentText(student.syncStatus);
  const String enrollmentStatus =
      normalizeEnrollmentText(student.enrollmentStatus);
  return syncStatus == "synced" || enrollmentStatus == "synced";
}

bool isEnrollmentStudentEnrolled(const StudentInfo &student) {
  if (student.templateId > 0) {
    return true;
  }

  const String enrollmentStatus =
      normalizeEnrollmentText(student.enrollmentStatus);
  return enrollmentStatus == "enrolled" || enrollmentStatus == "synced";
}

bool isEnrollmentStudentPendingSelection(const StudentInfo &student) {
  if (!student.isValid()) {
    return false;
  }

  if (isEnrollmentStudentSynced(student)) {
    return false;
  }

  return !isEnrollmentStudentEnrolled(student);
}

bool isEnrollmentStudentEnrolledPendingSync(const StudentInfo &student) {
  return student.isValid() && !isEnrollmentStudentSynced(student) &&
         isEnrollmentStudentEnrolled(student);
}

bool studentKeysMatch(const StudentInfo &left, const StudentInfo &right) {
  const bool sessionMatches =
      left.sessionId.isEmpty() || right.sessionId.isEmpty() ||
      left.sessionId == right.sessionId;
  if (!sessionMatches) {
    return false;
  }

  if (!left.studentUid.isEmpty() && !right.studentUid.isEmpty()) {
    return left.studentUid == right.studentUid;
  }

  if (!left.schoolId.isEmpty() && !right.schoolId.isEmpty()) {
    return left.schoolId == right.schoolId;
  }

  return false;
}

int parseCsvTemplateId(const String &value) {
  const int templateId = value.toInt();
  return templateId > 0 ? templateId : -1;
}

StudentInfo enrollmentQueueStudentFromFields(const String *fields,
                                             size_t fieldCount) {
  StudentInfo student;
  if (fields == nullptr || fieldCount < kEnrollmentQueueFieldCount ||
      isEnrollmentQueueHeader(fields, fieldCount)) {
    return student;
  }

  student.sessionId = fields[0];
  student.studentUid = fields[1];
  student.schoolId = fields[2];
  student.studentName = fields[3];
  student.course = fields[4];
  student.yearLevel = fields[5];
  student.section = fields[6];
  student.enrollmentStatus = fields[7];
  student.templateId = parseCsvTemplateId(fields[8]);
  student.syncStatus = fields[9];
  student.enrolledAtIso = fields[10];
  student.remarks = fields[11];
  student.enrollmentSynced = isEnrollmentStudentSynced(student);
  if (student.templateId > 0) {
    student.fingerprintStatus = "enrolled";
  }

  if (!student.isValid()) {
    return StudentInfo{};
  }

  CampusEligibility::normalizeStudent(student);
  return student;
}

StudentInfo enrollmentResultStudentFromFields(const String *fields,
                                              size_t fieldCount) {
  StudentInfo student;
  if (fields == nullptr || fieldCount < kEnrollmentResultFieldCount ||
      isEnrollmentQueueHeader(fields, fieldCount)) {
    return student;
  }

  student.sessionId = fields[0];
  student.studentUid = fields[1];
  student.schoolId = fields[2];
  student.studentName = fields[3];
  student.course = fields[4];
  student.yearLevel = fields[5];
  student.section = fields[6];
  student.templateId = parseCsvTemplateId(fields[7]);
  student.fingerprintDeviceId = fields[8];
  student.enrolledAtIso = fields[9];
  student.syncStatus = fields[10];
  student.remarks = fields[11];
  student.enrollmentStatus =
      isEnrollmentStudentSynced(student) ? "synced" : "enrolled";
  student.enrollmentSynced = isEnrollmentStudentSynced(student);
  if (student.templateId > 0) {
    student.fingerprintStatus = "enrolled";
  }

  if (!student.isValid()) {
    return StudentInfo{};
  }

  CampusEligibility::normalizeStudent(student);
  return student;
}

String enrollmentQueueCsvHeader() {
  return "sessionId,studentUid,schoolId,studentName,course,yearLevel,section,"
         "status,templateId,syncStatus,enrolledAtIso,remarks";
}

String enrollmentResultCsvHeader() {
  return "sessionId,studentUid,schoolId,studentName,course,yearLevel,section,"
         "templateId,fingerprintDeviceId,enrolledAtIso,syncStatus,remarks";
}

String enrollmentQueueCsvRow(const StudentInfo &student) {
  const String enrollmentStatus =
      !student.enrollmentStatus.isEmpty()
          ? student.enrollmentStatus
          : (student.templateId > 0 ? "enrolled" : "pending");
  const String syncStatus = !student.syncStatus.isEmpty()
                                ? student.syncStatus
                                : (student.enrollmentSynced ? "synced" : "pending");
  const int templateId = student.templateId > 0 ? student.templateId : -1;

  String line;
  line.reserve(256);
  line += csvEscape(student.sessionId);
  line += ",";
  line += csvEscape(student.studentUid);
  line += ",";
  line += csvEscape(student.schoolId);
  line += ",";
  line += csvEscape(student.studentName);
  line += ",";
  line += csvEscape(student.course);
  line += ",";
  line += csvEscape(student.yearLevel);
  line += ",";
  line += csvEscape(student.section);
  line += ",";
  line += csvEscape(enrollmentStatus);
  line += ",";
  line += String(templateId);
  line += ",";
  line += csvEscape(syncStatus);
  line += ",";
  line += csvEscape(student.enrolledAtIso);
  line += ",";
  line += csvEscape(student.remarks);
  return line;
}

String enrollmentResultCsvRow(const StudentInfo &student) {
  const String syncStatus = !student.syncStatus.isEmpty()
                                ? student.syncStatus
                                : (student.enrollmentSynced ? "synced" : "pending");
  const int templateId = student.templateId > 0 ? student.templateId : -1;

  String line;
  line.reserve(256);
  line += csvEscape(student.sessionId);
  line += ",";
  line += csvEscape(student.studentUid);
  line += ",";
  line += csvEscape(student.schoolId);
  line += ",";
  line += csvEscape(student.studentName);
  line += ",";
  line += csvEscape(student.course);
  line += ",";
  line += csvEscape(student.yearLevel);
  line += ",";
  line += csvEscape(student.section);
  line += ",";
  line += String(templateId);
  line += ",";
  line += csvEscape(student.fingerprintDeviceId);
  line += ",";
  line += csvEscape(student.enrolledAtIso);
  line += ",";
  line += csvEscape(syncStatus);
  line += ",";
  line += csvEscape(student.remarks);
  return line;
}

bool isStudentStillPendingEnrollment(const StudentInfo &student) {
  if (!student.isValid()) {
    return false;
  }

  return !isEnrollmentStudentSynced(student);
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

bool isActiveFingerprintOwner(const StudentInfo &student) {
  if (student.templateId <= 0) {
    return false;
  }

  String fingerprintStatus = student.fingerprintStatus;
  fingerprintStatus.toLowerCase();
  if (fingerprintStatus == "needs_reenrollment" ||
      fingerprintStatus == "stale" ||
      fingerprintStatus == "inactive" ||
      fingerprintStatus == "deleted") {
    return false;
  }

  return true;
}

bool cleanupItemMatchesStudent(const CleanupQueueItem &item,
                               const StudentInfo &student) {
  if (student.templateId <= 0) {
    return false;
  }

  if (item.templateId > 0 && student.templateId != item.templateId) {
    return false;
  }

  if (!item.studentUid.isEmpty() && student.studentUid == item.studentUid) {
    return true;
  }

  if (!item.schoolId.isEmpty() && student.schoolId == item.schoolId) {
    return true;
  }

  return item.studentUid.isEmpty() && item.schoolId.isEmpty();
}

void markStudentNeedsReenrollment(StudentInfo &student) {
  student.templateId = -1;
  student.fingerprintStatus = "needs_reenrollment";
  student.fingerprintDeviceId = "";
  student.enrollmentSynced = false;
  if (student.syncStatus == "synced") {
    student.syncStatus = "pending";
  }
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
  object["targetMode"] = event.targetMode;
  object["targetStudent"] = event.targetStudent;
  object["courseFilterLabel"] = event.courseFilterLabel;
  object["yearLevelFilterLabel"] = event.yearLevelFilterLabel;
  object["sectionFilterLabel"] = event.sectionFilterLabel;
  JsonArray courseFilters = object.createNestedArray("courseFilters");
  for (const auto &entry : event.courseFilters) {
    courseFilters.add(entry);
  }
  JsonArray yearLevelFilters = object.createNestedArray("yearLevelFilters");
  for (const auto &entry : event.yearLevelFilters) {
    yearLevelFilters.add(entry);
  }
  JsonArray sectionFilters = object.createNestedArray("sectionFilters");
  for (const auto &entry : event.sectionFilters) {
    sectionFilters.add(entry);
  }
  JsonArray targetedStudentIds = object.createNestedArray("targetedStudentIds");
  for (const auto &studentUid : event.targetedStudentIds) {
    targetedStudentIds.add(studentUid);
  }
  JsonArray targetedSchoolIds = object.createNestedArray("targetedSchoolIds");
  for (const auto &schoolId : event.targetedSchoolIds) {
    targetedSchoolIds.add(schoolId);
  }
  object["bodScope"] = event.bodScope;
  object["bodScopeCanonical"] = event.bodScopeCanonical;
  object["requiresRegistration"] = event.requiresRegistration;
  object["preregistrationRequired"] = event.preregistrationRequired;
  object["paymentRequired"] = event.paymentRequired;
  object["activeOnly"] = event.activeOnly;
  object["audienceRestricted"] = event.audienceRestricted;
  object["rosterRequired"] = event.rosterRequired;
  object["requiresContext"] = event.rosterRequired;
  object["contextSchemaVersion"] = event.contextSchemaVersion;
  object["timeOutFinalized"] = event.timeOutFinalized;
}

EventInfo eventFromJson(JsonObjectConst object,
                        bool *invalidAudienceSummary = nullptr) {
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
  const String rawTargetMode = String(object["targetMode"] |
                                      object["targetingMode"] |
                                      object["audienceMode"] | "");
  event.targetMode = rawTargetMode;
  event.targetStudent = String(object["targetStudent"] | "");
  if (event.targetMode.isEmpty() && !object["targetSpecificStudents"].isNull()) {
    if (parseBoolValue(object["targetSpecificStudents"], false)) {
      event.targetMode = "specificStudents";
    }
  } else if (event.targetMode.isEmpty() &&
             !object["specificStudentsOnly"].isNull()) {
    if (parseBoolValue(object["specificStudentsOnly"], false)) {
      event.targetMode = "specificStudents";
    }
  }
  event.courseFilterLabel = String(object["courseFilterLabel"] |
                                   object["courseFilter"] |
                                   object["targetCourse"] | object["course"] | "");
  event.yearLevelFilterLabel = String(object["yearLevelFilterLabel"] |
                                      object["yearLevelFilter"] |
                                      object["targetYearLevel"] |
                                      object["yearLevel"] | object["year"] | "");
  event.sectionFilterLabel = String(object["sectionFilterLabel"] |
                                    object["sectionFilter"] |
                                    object["targetSection"] |
                                    object["section"] | "");
  appendStringValues(object["courseFilters"], event.courseFilters);
  appendStringValues(object["targetCourses"], event.courseFilters);
  appendStringValues(object["yearLevelFilters"], event.yearLevelFilters);
  appendStringValues(object["targetYearLevels"], event.yearLevelFilters);
  appendStringValues(object["sectionFilters"], event.sectionFilters);
  appendStringValues(object["targetSections"], event.sectionFilters);
  appendStringValues(object["targetedStudentIds"], event.targetedStudentIds);
  appendStringValues(object["targetedStudents"], event.targetedStudentIds);
  appendStringValues(object["selectedStudentIds"], event.targetedStudentIds);
  appendStringValues(object["targetedSchoolIds"], event.targetedSchoolIds);
  appendStringValues(object["selectedSchoolIds"], event.targetedSchoolIds);
  if (event.targetMode.isEmpty() && !event.targetStudent.isEmpty()) {
    event.targetMode = "specificStudents";
  }
  appendStringValues(object["courses"], event.courseFilters);
  appendStringValues(object["yearLevels"], event.yearLevelFilters);
  event.bodScope =
      String(object["bodScope"] | object["bodScopeFilter"] |
             object["organizationScope"] | "");
  event.bodScopeCanonical = String(object["bodScopeCanonical"] | "");
  event.requiresRegistration = object["requiresRegistration"] | false;
  event.preregistrationRequired =
      parseBoolValue(object["preregistrationRequired"], event.requiresRegistration);
  event.paymentRequired = parseBoolValue(object["paymentRequired"],
                                         parseBoolValue(object["requiresPayment"], false));
  event.activeOnly =
      parseBoolValue(object["activeOnly"],
                     parseBoolValue(object["requiresActiveStatus"], false));
  event.audienceRestricted = parseBoolValue(object["audienceRestricted"], false);
  event.rosterRequired = parseBoolValue(
      object["rosterRequired"],
      parseBoolValue(object["requiresContext"],
                     parseBoolValue(object["pairedContextRequired"], false)));
  event.contextSchemaVersion = object["contextSchemaVersion"] | 0;
  if (event.contextSchemaVersion == 0) {
    event.contextSchemaVersion = object["pairedEventContextVersion"] | 0;
  }
  event.timeOutFinalized = object["timeOutFinalized"] | false;
  if (invalidAudienceSummary != nullptr) {
    *invalidAudienceSummary =
        hasCachedAudienceContradiction(event, rawTargetMode);
  }
  normalizeEventSchedule(event);
  CampusEligibility::normalizeEvent(event);
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
  SD.mkdir(kSdEnrollmentDir);
  SD.mkdir(kSdPairedEventDir);
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
    return pairedEventContextAvailable_;
  }

  pairedEventCache_ = loadPairedEvent();
  pairedStudentsCache_.clear();
  remoteRecordedStudentIdsCache_.clear();
  pairedEventContextLoaded_ = true;
  pairedEventContextAvailable_ = false;
  pairedEventContextStatus_ = "paired_event_context_missing";

  if (!littleFsReady_ || !LittleFS.exists(kPairedEventContextPath)) {
    return false;
  }

  DynamicJsonDocument doc(kPairedEventContextDocSize);
  File file = LittleFS.open(kPairedEventContextPath, FILE_READ);
  if (!file) {
    pairedEventContextStatus_ = "paired_event_context_corrupt";
    return false;
  }

  const DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) {
    pairedEventContextStatus_ = "paired_event_context_corrupt";
    return false;
  }

  JsonObject eventObject = doc["event"];
  if (eventObject.isNull()) {
    pairedEventContextStatus_ = "paired_event_context_corrupt";
    return false;
  }
  uint16_t schemaVersion = doc["schemaVersion"] | 0;
  if (schemaVersion == 0) {
    schemaVersion = eventObject["contextSchemaVersion"] | 0;
  }
  if (schemaVersion < kPairedEventContextSchemaVersion) {
    pairedEventContextStatus_ = "paired_event_context_legacy";
    Serial.printf(
        "[PAIR][CACHE] stage=load rejected reason=legacy-schema schema=%u required=%u\n",
        static_cast<unsigned>(schemaVersion),
        static_cast<unsigned>(kPairedEventContextSchemaVersion));
    return false;
  }

  bool invalidAudienceSummary = false;
  const EventInfo parsedEvent = eventFromJson(eventObject, &invalidAudienceSummary);
  if (!parsedEvent.isValid()) {
    pairedEventContextStatus_ = "paired_event_context_corrupt";
    return false;
  }
  if (invalidAudienceSummary) {
    pairedEventContextStatus_ = "paired_event_audience_invalid";
    Serial.printf(
        "[PAIR][CACHE] stage=load rejected reason=audience-invalid eventId=%s "
        "targetMode=%s audienceRestricted=%s rosterRequired=%s\n",
        parsedEvent.eventId.c_str(), parsedEvent.targetMode.c_str(),
        parsedEvent.audienceRestricted ? "yes" : "no",
        parsedEvent.rosterRequired ? "yes" : "no");
    return false;
  }
  pairedEventCache_ = parsedEvent;

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

  if (!CampusEligibility::requiresPairedStudentContext(pairedEventCache_)) {
    pairedStudentsCache_.clear();
    if (!remoteRecordedStudentIdsCache_.empty()) {
      StorageManager *storage = const_cast<StorageManager *>(this);
      if (storage->mergeRemoteAttendanceRecordedToSd(
              pairedEventCache_.eventId, remoteRecordedStudentIdsCache_)) {
        remoteRecordedStudentIdsCache_.clear();
      }
    }
  }

  pairedEventContextAvailable_ = true;
  pairedEventContextStatus_ = "ok";
  logPairedEventSummary("load", pairedEventCache_, pairedStudentsCache_.size(),
                        remoteRecordedStudentIdsCache_.size());
  return true;
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
  const String currentEventId =
      !pairedEventCache_.eventId.isEmpty() ? pairedEventCache_.eventId
                                           : loadPairedEvent().eventId;
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
  if (!currentEventId.isEmpty()) {
    removePairedEventStudentContextFiles(currentEventId);
  }

  pairedEventCache_ = EventInfo{};
  pairedStudentsCache_.clear();
  remoteRecordedStudentIdsCache_.clear();
  pairedEventContextLoaded_ = true;
  pairedEventContextAvailable_ = false;
  pairedEventContextStatus_ = "paired_event_context_missing";
  return true;
}

bool StorageManager::savePairedEventContext(
    const EventInfo &event, const std::vector<StudentInfo> &students,
    const std::vector<String> &recordedStudentIds) {
  const String previousEventId =
      !pairedEventCache_.eventId.isEmpty() ? pairedEventCache_.eventId
                                           : loadPairedEvent().eventId;
  EventInfo normalizedEvent = event;
  CampusEligibility::normalizeEvent(normalizedEvent);
  normalizedEvent.contextSchemaVersion = kPairedEventContextSchemaVersion;
  if (hasCachedAudienceContradiction(normalizedEvent,
                                     normalizedEvent.targetMode)) {
    pairedEventContextAvailable_ = false;
    pairedEventContextStatus_ = "paired_event_audience_invalid";
    Serial.printf(
        "[PAIR][CACHE] stage=save rejected reason=audience-invalid eventId=%s "
        "targetMode=%s audienceRestricted=%s rosterRequired=%s\n",
        normalizedEvent.eventId.c_str(), normalizedEvent.targetMode.c_str(),
        normalizedEvent.audienceRestricted ? "yes" : "no",
        normalizedEvent.rosterRequired ? "yes" : "no");
    return false;
  }
  const bool needsStudentContext =
      CampusEligibility::requiresPairedStudentContext(normalizedEvent);

  std::vector<StudentInfo> normalizedStudents = students;
  if (!needsStudentContext) {
    normalizedStudents.clear();
  }
  for (auto &student : normalizedStudents) {
    CampusEligibility::normalizeStudent(student);
  }
  std::vector<String> storedRecordedStudentIds = recordedStudentIds;
  if (!needsStudentContext) {
    if (!mergeRemoteAttendanceRecordedToSd(normalizedEvent.eventId,
                                           recordedStudentIds)) {
      pairedEventContextAvailable_ = false;
      pairedEventContextStatus_ = "paired_event_context_corrupt";
      return false;
    }
    storedRecordedStudentIds.clear();
  }

  Serial.printf("[PAIR] saving paired event context eventId=%s\n",
                normalizedEvent.eventId.c_str());
  logPairedEventSummary("save", normalizedEvent, normalizedStudents.size(),
                        storedRecordedStudentIds.size());
  if (CampusEligibility::isSpecificStudentsMode(normalizedEvent)) {
    Serial.printf("[PAIR] saving targeted roster count=%u\n",
                  static_cast<unsigned>(
                      CampusEligibility::targetedStudentCount(normalizedEvent)));
  }

  if (!previousEventId.isEmpty() && previousEventId != normalizedEvent.eventId) {
    removePairedEventStudentContextFiles(previousEventId);
  }
  if (!needsStudentContext) {
    removePairedEventStudentRosterFiles(normalizedEvent.eventId);
  }

  if (!savePairedEvent(normalizedEvent) || !littleFsReady_) {
    pairedEventContextAvailable_ = false;
    pairedEventContextStatus_ = "paired_event_context_missing";
    return false;
  }

  if (!writePairedEventContext(normalizedEvent, normalizedStudents,
                               storedRecordedStudentIds)) {
    pairedEventContextAvailable_ = false;
    pairedEventContextStatus_ = "paired_event_context_corrupt";
    return false;
  }

  pairedEventCache_ = normalizedEvent;
  pairedStudentsCache_ = normalizedStudents;
  remoteRecordedStudentIdsCache_ = storedRecordedStudentIds;
  pairedEventContextLoaded_ = true;
  pairedEventContextAvailable_ = true;
  pairedEventContextStatus_ = "ok";

  size_t fileSize = 0;
  File contextFile = LittleFS.open(kPairedEventContextPath, FILE_READ);
  if (contextFile) {
    fileSize = static_cast<size_t>(contextFile.size());
    contextFile.close();
  }
  Serial.printf("[PAIR] saved paired event context ok size=%u\n",
                static_cast<unsigned>(fileSize));
  if (CampusEligibility::isSpecificStudentsMode(normalizedEvent)) {
    Serial.printf("[PAIR] saved targeted roster ok count=%u\n",
                  static_cast<unsigned>(
                      CampusEligibility::targetedStudentCount(normalizedEvent)));
  }
  return true;
}

bool StorageManager::beginPairedEventStudentContext(const String &eventId) {
  if (eventId.isEmpty() || !ensureSdReady()) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  SD.mkdir(kSdPairedEventDir);
  const String studentTempPath = pairedEventStudentsTempPathForEvent(eventId);
  const String recordedTempPath = pairedEventRecordedTempPathForEvent(eventId);

  SD.remove(studentTempPath.c_str());
  SD.remove(recordedTempPath.c_str());

  File studentTemp = SD.open(studentTempPath.c_str(), FILE_WRITE);
  if (!studentTemp) {
    lastSdWriteSucceeded_ = false;
    return false;
  }
  if (!writeCsvLine(studentTemp, pairedEventStudentCsvHeader())) {
    studentTemp.close();
    SD.remove(studentTempPath.c_str());
    lastSdWriteSucceeded_ = false;
    return false;
  }
  studentTemp.close();

  File recordedTemp = SD.open(recordedTempPath.c_str(), FILE_WRITE);
  if (!recordedTemp) {
    SD.remove(studentTempPath.c_str());
    lastSdWriteSucceeded_ = false;
    return false;
  }
  if (!writeCsvLine(recordedTemp, pairedEventRecordedCsvHeader())) {
    recordedTemp.close();
    SD.remove(studentTempPath.c_str());
    SD.remove(recordedTempPath.c_str());
    lastSdWriteSucceeded_ = false;
    return false;
  }
  recordedTemp.close();

  Serial.printf("[PAIR] begin SD paired context eventId=%s\n", eventId.c_str());
  lastSdWriteSucceeded_ = true;
  return true;
}

bool StorageManager::appendPairedEventStudentPage(
    const String &eventId, const std::vector<StudentInfo> &students,
    const std::vector<String> &recordedStudentIds) {
  if (eventId.isEmpty() || !ensureSdReady()) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  const String studentTempPath = pairedEventStudentsTempPathForEvent(eventId);
  const String recordedTempPath = pairedEventRecordedTempPathForEvent(eventId);
  if (!appendPairedEventStudentsToSd(studentTempPath, students) ||
      !appendRecordedStudentIdsToSd(recordedTempPath, recordedStudentIds)) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  Serial.printf(
      "[PAIR] append SD paired context page eventId=%s students=%u recorded=%u\n",
      eventId.c_str(), static_cast<unsigned>(students.size()),
      static_cast<unsigned>(recordedStudentIds.size()));
  lastSdWriteSucceeded_ = true;
  return true;
}

bool StorageManager::finalizePairedEventStudentContext(const String &eventId) {
  if (eventId.isEmpty() || !ensureSdReady()) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  const String studentTempPath = pairedEventStudentsTempPathForEvent(eventId);
  const String recordedTempPath = pairedEventRecordedTempPathForEvent(eventId);
  const String studentPath = pairedEventStudentsPathForEvent(eventId);
  const String recordedPath = pairedEventRecordedPathForEvent(eventId);

  if (!SD.exists(studentTempPath.c_str()) || !SD.exists(recordedTempPath.c_str())) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  SD.remove(studentPath.c_str());
  SD.remove(recordedPath.c_str());
  const bool studentsRenamed =
      SD.rename(studentTempPath.c_str(), studentPath.c_str());
  const bool recordedRenamed =
      SD.rename(recordedTempPath.c_str(), recordedPath.c_str());
  if (!studentsRenamed || !recordedRenamed) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  File studentFile = SD.open(studentPath.c_str(), FILE_READ);
  const size_t studentSize =
      studentFile ? static_cast<size_t>(studentFile.size()) : 0U;
  if (studentFile) {
    studentFile.close();
  }
  File recordedFile = SD.open(recordedPath.c_str(), FILE_READ);
  const size_t recordedSize =
      recordedFile ? static_cast<size_t>(recordedFile.size()) : 0U;
  if (recordedFile) {
    recordedFile.close();
  }

  Serial.printf(
      "[PAIR] finalized SD paired context eventId=%s studentsSize=%u recordedSize=%u\n",
      eventId.c_str(), static_cast<unsigned>(studentSize),
      static_cast<unsigned>(recordedSize));
  lastSdWriteSucceeded_ = true;
  return true;
}

bool StorageManager::removePairedEventStudentRosterFiles(const String &eventId) {
  if (eventId.isEmpty() || !CampusConfig::kUseSd) {
    return true;
  }
  if (!ensureSdReady()) {
    return true;
  }

  const String studentTempPath = pairedEventStudentsTempPathForEvent(eventId);
  const String recordedTempPath = pairedEventRecordedTempPathForEvent(eventId);
  const String studentPath = pairedEventStudentsPathForEvent(eventId);

  bool cleared = true;
  if (SD.exists(studentTempPath.c_str())) {
    cleared = SD.remove(studentTempPath.c_str()) && cleared;
  }
  if (SD.exists(recordedTempPath.c_str())) {
    cleared = SD.remove(recordedTempPath.c_str()) && cleared;
  }
  if (SD.exists(studentPath.c_str())) {
    cleared = SD.remove(studentPath.c_str()) && cleared;
  }
  return cleared;
}

bool StorageManager::removePairedEventStudentContextFiles(const String &eventId) {
  if (eventId.isEmpty() || !CampusConfig::kUseSd) {
    return true;
  }
  if (!ensureSdReady()) {
    return true;
  }

  const String studentTempPath = pairedEventStudentsTempPathForEvent(eventId);
  const String recordedTempPath = pairedEventRecordedTempPathForEvent(eventId);
  const String studentPath = pairedEventStudentsPathForEvent(eventId);
  const String recordedPath = pairedEventRecordedPathForEvent(eventId);

  bool cleared = true;
  if (SD.exists(studentTempPath.c_str())) {
    cleared = SD.remove(studentTempPath.c_str()) && cleared;
  }
  if (SD.exists(recordedTempPath.c_str())) {
    cleared = SD.remove(recordedTempPath.c_str()) && cleared;
  }
  if (SD.exists(studentPath.c_str())) {
    cleared = SD.remove(studentPath.c_str()) && cleared;
  }
  if (SD.exists(recordedPath.c_str())) {
    cleared = SD.remove(recordedPath.c_str()) && cleared;
  }
  return cleared;
}

bool StorageManager::appendPairedEventStudentsToSd(
    const String &path, const std::vector<StudentInfo> &students) {
  File file = SD.open(path.c_str(), FILE_APPEND);
  if (!file) {
    return false;
  }

  for (auto student : students) {
    CampusEligibility::normalizeStudent(student);
    if (!student.isValid()) {
      continue;
    }
    if (!writeCsvLine(file, pairedEventStudentCsvRow(student))) {
      file.close();
      return false;
    }
  }

  file.close();
  return true;
}

bool StorageManager::appendRecordedStudentIdsToSd(
    const String &path, const std::vector<String> &recordedStudentIds) {
  File file = SD.open(path.c_str(), FILE_APPEND);
  if (!file) {
    return false;
  }

  for (const auto &studentUid : recordedStudentIds) {
    const String normalized = CampusEligibility::trimAndCollapseWhitespace(studentUid);
    if (normalized.isEmpty()) {
      continue;
    }
    if (!writeCsvLine(file, pairedEventRecordedCsvRow(normalized))) {
      file.close();
      return false;
    }
  }

  file.close();
  return true;
}

bool StorageManager::pairedEventStudentContextContainsOnSd(
    const String &eventId, const String &studentUid, const String &schoolId) const {
  if (eventId.isEmpty() || !CampusConfig::kUseSd) {
    return false;
  }

  StorageManager *storage = const_cast<StorageManager *>(this);
  if (!storage->ensureSdReady()) {
    return false;
  }

  const String studentPath = pairedEventStudentsPathForEvent(eventId);
  if (!SD.exists(studentPath.c_str())) {
    return false;
  }

  const String normalizedStudentUid =
      CampusEligibility::trimAndCollapseWhitespace(studentUid);
  const String normalizedSchoolId =
      CampusEligibility::trimAndCollapseWhitespace(schoolId);

  File file = SD.open(studentPath.c_str(), FILE_READ);
  if (!file) {
    return false;
  }

  String line;
  bool truncated = false;
  while (readBoundedLine(file, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    String fields[kPairedEventStudentFieldCount];
    const size_t parsedFields =
        splitCsvLine(line, fields, kPairedEventStudentFieldCount);
    StudentInfo row = pairedEventStudentFromFields(fields, parsedFields);
    if (!row.isValid()) {
      continue;
    }

    if ((!normalizedStudentUid.isEmpty() && row.studentUid == normalizedStudentUid) ||
        (!normalizedSchoolId.isEmpty() && row.schoolId == normalizedSchoolId)) {
      file.close();
      return true;
    }
  }

  file.close();
  return false;
}

bool StorageManager::findPairedEventStudent(const String &eventId,
                                            const String &studentUid,
                                            const String &schoolId,
                                            StudentInfo &outStudent) const {
  ensurePairedEventContextLoaded();

  if (eventId.isEmpty()) {
    return false;
  }

  const String normalizedStudentUid =
      CampusEligibility::trimAndCollapseWhitespace(studentUid);
  const String normalizedSchoolId =
      CampusEligibility::trimAndCollapseWhitespace(schoolId);

  for (const auto &student : pairedStudentsCache_) {
    if ((!normalizedStudentUid.isEmpty() &&
         student.studentUid == normalizedStudentUid) ||
        (!normalizedSchoolId.isEmpty() && student.schoolId == normalizedSchoolId)) {
      outStudent = student;
      return true;
    }
  }

  if (!CampusConfig::kUseSd || eventId.isEmpty()) {
    return false;
  }

  StorageManager *storage = const_cast<StorageManager *>(this);
  if (!storage->ensureSdReady()) {
    return false;
  }

  const String studentPath = pairedEventStudentsPathForEvent(eventId);
  if (!SD.exists(studentPath.c_str())) {
    return false;
  }

  File file = SD.open(studentPath.c_str(), FILE_READ);
  if (!file) {
    return false;
  }

  String line;
  bool truncated = false;
  while (readBoundedLine(file, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    String fields[kPairedEventStudentFieldCount];
    const size_t parsedFields =
        splitCsvLine(line, fields, kPairedEventStudentFieldCount);
    StudentInfo row = pairedEventStudentFromFields(fields, parsedFields);
    if (!row.isValid()) {
      continue;
    }

    if ((!normalizedStudentUid.isEmpty() && row.studentUid == normalizedStudentUid) ||
        (!normalizedSchoolId.isEmpty() && row.schoolId == normalizedSchoolId)) {
      file.close();
      outStudent = row;
      return true;
    }
  }

  file.close();
  return false;
}

bool StorageManager::ensureRemoteAttendanceRecordedFile(const String &eventId) {
  if (eventId.isEmpty() || !CampusConfig::kUseSd) {
    return false;
  }
  if (!ensureSdReady()) {
    return false;
  }

  SD.mkdir(kSdPairedEventDir);
  const String recordedPath = pairedEventRecordedPathForEvent(eventId);
  if (SD.exists(recordedPath.c_str())) {
    return true;
  }

  const String recordedTempPath = pairedEventRecordedTempPathForEvent(eventId);
  SD.remove(recordedTempPath.c_str());

  File file = SD.open(recordedTempPath.c_str(), FILE_WRITE);
  if (!file) {
    return false;
  }
  const bool wroteHeader = writeCsvLine(file, pairedEventRecordedCsvHeader());
  file.close();
  if (!wroteHeader) {
    SD.remove(recordedTempPath.c_str());
    return false;
  }

  SD.remove(recordedPath.c_str());
  if (!SD.rename(recordedTempPath.c_str(), recordedPath.c_str())) {
    SD.remove(recordedTempPath.c_str());
    return false;
  }
  return true;
}

bool StorageManager::mergeRemoteAttendanceRecordedToSd(
    const String &eventId, const std::vector<String> &recordedStudentIds) {
  if (recordedStudentIds.empty()) {
    return true;
  }
  if (!ensureRemoteAttendanceRecordedFile(eventId)) {
    return false;
  }

  for (const auto &studentUid : recordedStudentIds) {
    if (!appendRemoteAttendanceRecordedOnSd(eventId, studentUid)) {
      return false;
    }
  }
  return true;
}

bool StorageManager::remoteAttendanceRecordedOnSd(const String &eventId,
                                                  const String &studentUid) const {
  if (eventId.isEmpty() || studentUid.isEmpty() || !CampusConfig::kUseSd) {
    return false;
  }

  StorageManager *storage = const_cast<StorageManager *>(this);
  if (!storage->ensureSdReady()) {
    return false;
  }

  const String recordedPath = pairedEventRecordedPathForEvent(eventId);
  if (!SD.exists(recordedPath.c_str())) {
    return false;
  }

  File file = SD.open(recordedPath.c_str(), FILE_READ);
  if (!file) {
    return false;
  }

  const String normalizedStudentUid =
      CampusEligibility::trimAndCollapseWhitespace(studentUid);
  String line;
  bool truncated = false;
  while (readBoundedLine(file, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    String fields[kPairedEventRecordedFieldCount];
    const size_t parsedFields =
        splitCsvLine(line, fields, kPairedEventRecordedFieldCount);
    if (isPairedEventRecordedHeader(fields, parsedFields)) {
      continue;
    }
    if (parsedFields == 0) {
      continue;
    }

    const String rowStudentUid =
        CampusEligibility::trimAndCollapseWhitespace(fields[0]);
    if (!rowStudentUid.isEmpty() && rowStudentUid == normalizedStudentUid) {
      file.close();
      return true;
    }
  }

  file.close();
  return false;
}

bool StorageManager::appendRemoteAttendanceRecordedOnSd(const String &eventId,
                                                        const String &studentUid) {
  if (eventId.isEmpty() || studentUid.isEmpty() || !CampusConfig::kUseSd) {
    return false;
  }
  if (!ensureRemoteAttendanceRecordedFile(eventId)) {
    return false;
  }
  if (remoteAttendanceRecordedOnSd(eventId, studentUid)) {
    return true;
  }

  const String recordedPath = pairedEventRecordedPathForEvent(eventId);
  File file = SD.open(recordedPath.c_str(), FILE_APPEND);
  if (!file) {
    return false;
  }
  const bool written = writeCsvLine(
      file,
      pairedEventRecordedCsvRow(
          CampusEligibility::trimAndCollapseWhitespace(studentUid)));
  file.close();
  return written;
}

bool StorageManager::loadPairedEventContext(
    EventInfo &event, std::vector<StudentInfo> &students,
    std::vector<String> &recordedStudentIds) const {
  ensurePairedEventContextLoaded();
  event = pairedEventCache_;
  students = pairedStudentsCache_;
  recordedStudentIds = remoteRecordedStudentIdsCache_;
  return pairedEventContextAvailable_ && event.isValid();
}

bool StorageManager::hasPairedEventStudentContext(const String &eventId) const {
  if (eventId.isEmpty() || !CampusConfig::kUseSd) {
    return false;
  }

  StorageManager *storage = const_cast<StorageManager *>(this);
  if (!storage->ensureSdReady()) {
    return false;
  }

  const String studentPath = pairedEventStudentsPathForEvent(eventId);
  const String recordedPath = pairedEventRecordedPathForEvent(eventId);
  return SD.exists(studentPath.c_str()) && SD.exists(recordedPath.c_str());
}

CampusEligibility::EventEligibilityDecision
StorageManager::evaluateStudentEligibilityForEvent(const EventInfo &event,
                                                   const StudentInfo &student) const {
  ensurePairedEventContextLoaded();
  CampusEligibility::EventEligibilityDecision decision;
  if (!event.isValid()) {
    decision.stalePairedEventData = true;
    decision.finalReason = "paired_event_context_missing";
    return decision;
  }
  if (!pairedEventContextAvailable_) {
    decision.stalePairedEventData = true;
    decision.finalReason = pairedEventContextStatus_.isEmpty()
                               ? "paired_event_context_missing"
                               : pairedEventContextStatus_;
    return decision;
  }
  if (!pairedEventCache_.isValid()) {
    decision.stalePairedEventData = true;
    decision.finalReason = "paired_event_context_corrupt";
    return decision;
  }
  if (pairedEventCache_.eventId != event.eventId) {
    decision.stalePairedEventData = true;
    decision.finalReason = "paired_event_id_mismatch";
    return decision;
  }
  EventInfo normalizedEvent = pairedEventCache_;
  CampusEligibility::normalizeEvent(normalizedEvent);

  StudentInfo effectiveStudent = student;
  CampusEligibility::normalizeStudent(effectiveStudent);

  StudentInfo pairedStudent;
  const bool matchedPairedRoster = findPairedEventStudent(
      normalizedEvent.eventId, effectiveStudent.studentUid,
      effectiveStudent.schoolId, pairedStudent);
  const bool rosterAvailable = !pairedStudentsCache_.empty() ||
                               hasPairedEventStudentContext(normalizedEvent.eventId);

  if (matchedPairedRoster) {
    if (!pairedStudent.studentUid.isEmpty()) {
      effectiveStudent.studentUid = pairedStudent.studentUid;
    }
    if (!pairedStudent.schoolId.isEmpty()) {
      effectiveStudent.schoolId = pairedStudent.schoolId;
    }
    if (!pairedStudent.studentName.isEmpty()) {
      effectiveStudent.studentName = pairedStudent.studentName;
    }
    if (!pairedStudent.course.isEmpty()) {
      effectiveStudent.course = pairedStudent.course;
    }
    if (!pairedStudent.yearLevel.isEmpty()) {
      effectiveStudent.yearLevel = pairedStudent.yearLevel;
    }
    if (!pairedStudent.section.isEmpty()) {
      effectiveStudent.section = pairedStudent.section;
    }
    if (!pairedStudent.bodScope.isEmpty()) {
      effectiveStudent.bodScope = pairedStudent.bodScope;
    }
    if (!pairedStudent.queueId.isEmpty()) {
      effectiveStudent.queueId = pairedStudent.queueId;
    }
    CampusEligibility::normalizeStudent(effectiveStudent);
  }

  const CampusEligibility::EventEligibilityDecision baseDecision =
      CampusEligibility::evaluateStudentForEvent(normalizedEvent,
                                                 pairedStudentsCache_,
                                                 effectiveStudent);
  return CampusEligibility::reconcileWithPairedRoster(
      normalizedEvent, effectiveStudent, baseDecision, rosterAvailable,
      matchedPairedRoster);
}

bool StorageManager::hasPairedEventContextCache() const {
  ensurePairedEventContextLoaded();
  return pairedEventContextAvailable_;
}

String StorageManager::pairedEventContextStatus() const {
  ensurePairedEventContextLoaded();
  return pairedEventContextStatus_;
}

bool StorageManager::isStudentAuthorizedForEvent(const String &eventId,
                                                 const String &studentUid) const {
  ensurePairedEventContextLoaded();

  if (!pairedEventCache_.isValid() || pairedEventCache_.eventId != eventId) {
    return false;
  }

  for (const auto &student : pairedStudentsCache_) {
    if (student.studentUid == studentUid || student.schoolId == studentUid) {
      return true;
    }
  }
  return pairedEventStudentContextContainsOnSd(eventId, studentUid, studentUid);
}

bool StorageManager::isRemoteAttendanceRecorded(const String &eventId,
                                                const String &studentUid) const {
  ensurePairedEventContextLoaded();

  if (!pairedEventCache_.isValid() || pairedEventCache_.eventId != eventId) {
    return false;
  }
  const String normalizedStudentUid =
      CampusEligibility::trimAndCollapseWhitespace(studentUid);
  if (normalizedStudentUid.isEmpty()) {
    return false;
  }

  for (const auto &recordedUid : remoteRecordedStudentIdsCache_) {
    if (recordedUid == normalizedStudentUid) {
      return true;
    }
  }
  return remoteAttendanceRecordedOnSd(eventId, normalizedStudentUid);
}

bool StorageManager::markRemoteAttendanceRecorded(const String &eventId,
                                                  const String &studentUid) {
  if (!ensurePairedEventContextLoaded()) {
    return false;
  }

  if (pairedEventCache_.eventId != eventId) {
    return false;
  }
  const String normalizedStudentUid =
      CampusEligibility::trimAndCollapseWhitespace(studentUid);
  if (normalizedStudentUid.isEmpty()) {
    return false;
  }

  for (const auto &recordedUid : remoteRecordedStudentIdsCache_) {
    if (recordedUid == normalizedStudentUid) {
      return true;
    }
  }

  if (appendRemoteAttendanceRecordedOnSd(eventId, normalizedStudentUid)) {
    return true;
  }

  if (!CampusEligibility::requiresPairedStudentContext(pairedEventCache_)) {
    return false;
  }

  remoteRecordedStudentIdsCache_.push_back(normalizedStudentUid);
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

  bool cleared = true;
  if (LittleFS.exists(kEnrollmentSessionPath)) {
    cleared = LittleFS.remove(kEnrollmentSessionPath);
  }

  if (CampusConfig::kUseSd && ensureSdReady()) {
    if (SD.exists(kSdEnrollmentQueueTempPath)) {
      SD.remove(kSdEnrollmentQueueTempPath);
    }
    if (SD.exists(kSdEnrollmentQueuePath)) {
      cleared = SD.remove(kSdEnrollmentQueuePath) && cleared;
    }
  }

  return cleared;
}

bool StorageManager::saveEnrollmentQueueToSd(
    const EnrollmentSessionInfo &session, const std::vector<StudentInfo> &students) {
  if (!ensureSdReady()) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  SD.mkdir(kSdEnrollmentDir);
  SD.remove(kSdEnrollmentQueueTempPath);

  File file = SD.open(kSdEnrollmentQueueTempPath, FILE_WRITE);
  if (!file) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  Serial.printf("[ENROLL][QUEUE] saving to SD count=%u\n",
                static_cast<unsigned>(students.size()));
  if (!writeCsvLine(file, enrollmentQueueCsvHeader())) {
    file.close();
    SD.remove(kSdEnrollmentQueueTempPath);
    lastSdWriteSucceeded_ = false;
    return false;
  }

  for (auto student : students) {
    student.sessionId = session.sessionId;
    if (student.enrollmentStatus.isEmpty()) {
      student.enrollmentStatus = "pending";
    }
    if (student.syncStatus.isEmpty()) {
      student.syncStatus = "pending";
    }
    if (student.templateId <= 0) {
      student.templateId = -1;
    }
    CampusEligibility::normalizeStudent(student);
    if (!writeCsvLine(file, enrollmentQueueCsvRow(student))) {
      file.close();
      SD.remove(kSdEnrollmentQueueTempPath);
      lastSdWriteSucceeded_ = false;
      return false;
    }
  }

  file.close();

  SD.remove(kSdEnrollmentQueuePath);
  if (!SD.rename(kSdEnrollmentQueueTempPath, kSdEnrollmentQueuePath)) {
    SD.remove(kSdEnrollmentQueueTempPath);
    lastSdWriteSucceeded_ = false;
    return false;
  }

  File savedFile = SD.open(kSdEnrollmentQueuePath, FILE_READ);
  const size_t fileSize =
      savedFile ? static_cast<size_t>(savedFile.size()) : 0U;
  if (savedFile) {
    savedFile.close();
  }

  Serial.printf("[ENROLL][QUEUE] saved to SD count=%u size=%u\n",
                static_cast<unsigned>(students.size()),
                static_cast<unsigned>(fileSize));
  lastSdWriteSucceeded_ = true;
  return true;
}

bool StorageManager::loadEnrollmentQueuePageFromSd(
    size_t offset, size_t limit, std::vector<StudentInfo> &students,
    bool pendingOnly) const {
  students.clear();
  if (limit == 0 || !CampusConfig::kUseSd) {
    return false;
  }

  StorageManager *storage = const_cast<StorageManager *>(this);
  if (!storage->ensureSdReady() || !SD.exists(kSdEnrollmentQueuePath)) {
    return false;
  }

  File file = SD.open(kSdEnrollmentQueuePath, FILE_READ);
  if (!file) {
    return false;
  }

  size_t matchedRows = 0;
  String line;
  bool truncated = false;
  while (readBoundedLine(file, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    String fields[kEnrollmentQueueFieldCount];
    const size_t parsedFields =
        splitCsvLine(line, fields, kEnrollmentQueueFieldCount);
    StudentInfo student =
        enrollmentQueueStudentFromFields(fields, parsedFields);
    if (!student.isValid()) {
      continue;
    }

    if (pendingOnly && !isEnrollmentStudentPendingSelection(student)) {
      continue;
    }

    if (matchedRows < offset) {
      ++matchedRows;
      continue;
    }

    students.push_back(student);
    ++matchedRows;
    if (students.size() >= limit) {
      break;
    }
  }

  file.close();
  return true;
}

EnrollmentQueueStats StorageManager::getEnrollmentQueueStatsFromSd() const {
  EnrollmentQueueStats stats;
  if (!CampusConfig::kUseSd) {
    return stats;
  }

  StorageManager *storage = const_cast<StorageManager *>(this);
  stats.sdReady = storage->ensureSdReady();
  if (!stats.sdReady || !SD.exists(kSdEnrollmentQueuePath)) {
    return stats;
  }

  File file = SD.open(kSdEnrollmentQueuePath, FILE_READ);
  if (!file) {
    return stats;
  }

  stats.queueExists = true;
  stats.fileSize = static_cast<size_t>(file.size());

  String line;
  bool truncated = false;
  while (readBoundedLine(file, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    String fields[kEnrollmentQueueFieldCount];
    const size_t parsedFields =
        splitCsvLine(line, fields, kEnrollmentQueueFieldCount);
    StudentInfo student =
        enrollmentQueueStudentFromFields(fields, parsedFields);
    if (!student.isValid()) {
      continue;
    }

    ++stats.totalRows;
    if (isEnrollmentStudentSynced(student)) {
      ++stats.syncedRows;
    } else if (isEnrollmentStudentPendingSelection(student)) {
      ++stats.pendingRows;
    } else {
      ++stats.enrolledPendingSyncRows;
    }
  }

  file.close();
  return stats;
}

bool StorageManager::findEnrollmentStudentInSd(const String &studentKey,
                                               StudentInfo &student) const {
  student = StudentInfo{};
  if (studentKey.isEmpty() || !CampusConfig::kUseSd) {
    return false;
  }

  StorageManager *storage = const_cast<StorageManager *>(this);
  if (!storage->ensureSdReady() || !SD.exists(kSdEnrollmentQueuePath)) {
    return false;
  }

  File file = SD.open(kSdEnrollmentQueuePath, FILE_READ);
  if (!file) {
    return false;
  }

  String line;
  bool truncated = false;
  while (readBoundedLine(file, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    String fields[kEnrollmentQueueFieldCount];
    const size_t parsedFields =
        splitCsvLine(line, fields, kEnrollmentQueueFieldCount);
    StudentInfo row = enrollmentQueueStudentFromFields(fields, parsedFields);
    if (!row.isValid()) {
      continue;
    }

    if (row.studentUid == studentKey || row.schoolId == studentKey) {
      student = row;
      file.close();
      return true;
    }
  }

  file.close();
  return false;
}

bool StorageManager::updateEnrollmentStudentRowOnSd(const StudentInfo &student) {
  if (!ensureSdReady()) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  SD.mkdir(kSdEnrollmentDir);
  File source = SD.open(kSdEnrollmentQueuePath, FILE_READ);
  if (!source) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  SD.remove(kSdEnrollmentQueueTempPath);
  File temp = SD.open(kSdEnrollmentQueueTempPath, FILE_WRITE);
  if (!temp) {
    source.close();
    lastSdWriteSucceeded_ = false;
    return false;
  }

  StudentInfo updatedStudent = student;
  if (updatedStudent.templateId <= 0) {
    updatedStudent.templateId = -1;
  }
  CampusEligibility::normalizeStudent(updatedStudent);

  if (!writeCsvLine(temp, enrollmentQueueCsvHeader())) {
    source.close();
    temp.close();
    SD.remove(kSdEnrollmentQueueTempPath);
    lastSdWriteSucceeded_ = false;
    return false;
  }

  bool replaced = false;
  String line;
  bool truncated = false;
  while (readBoundedLine(source, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    String fields[kEnrollmentQueueFieldCount];
    const size_t parsedFields =
        splitCsvLine(line, fields, kEnrollmentQueueFieldCount);
    if (isEnrollmentQueueHeader(fields, parsedFields)) {
      continue;
    }

    StudentInfo row = enrollmentQueueStudentFromFields(fields, parsedFields);
    if (row.isValid() && studentKeysMatch(row, updatedStudent)) {
      if (updatedStudent.sessionId.isEmpty()) {
        updatedStudent.sessionId = row.sessionId;
      }
      if (!writeCsvLine(temp, enrollmentQueueCsvRow(updatedStudent))) {
        source.close();
        temp.close();
        SD.remove(kSdEnrollmentQueueTempPath);
        lastSdWriteSucceeded_ = false;
        return false;
      }
      replaced = true;
      continue;
    }

    if (row.isValid()) {
      if (!writeCsvLine(temp, enrollmentQueueCsvRow(row))) {
        source.close();
        temp.close();
        SD.remove(kSdEnrollmentQueueTempPath);
        lastSdWriteSucceeded_ = false;
        return false;
      }
    } else {
      if (!writeCsvLine(temp, line)) {
        source.close();
        temp.close();
        SD.remove(kSdEnrollmentQueueTempPath);
        lastSdWriteSucceeded_ = false;
        return false;
      }
    }
  }

  if (!replaced) {
    if (!writeCsvLine(temp, enrollmentQueueCsvRow(updatedStudent))) {
      source.close();
      temp.close();
      SD.remove(kSdEnrollmentQueueTempPath);
      lastSdWriteSucceeded_ = false;
      return false;
    }
  }

  source.close();
  temp.close();

  SD.remove(kSdEnrollmentQueuePath);
  if (!SD.rename(kSdEnrollmentQueueTempPath, kSdEnrollmentQueuePath)) {
    SD.remove(kSdEnrollmentQueueTempPath);
    lastSdWriteSucceeded_ = false;
    return false;
  }

  Serial.printf("[ENROLL][QUEUE] update row student=%s template=%d\n",
                updatedStudent.studentUid.c_str(), updatedStudent.templateId);
  lastSdWriteSucceeded_ = true;
  return true;
}

bool StorageManager::appendEnrollmentResultToSd(const StudentInfo &student) {
  if (!ensureSdReady()) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  SD.mkdir(kSdEnrollmentDir);
  SD.remove(kSdEnrollmentResultsTempPath);

  File temp = SD.open(kSdEnrollmentResultsTempPath, FILE_WRITE);
  if (!temp) {
    lastSdWriteSucceeded_ = false;
    return false;
  }

  StudentInfo updatedStudent = student;
  if (updatedStudent.templateId <= 0) {
    updatedStudent.templateId = -1;
  }
  CampusEligibility::normalizeStudent(updatedStudent);

  if (!writeCsvLine(temp, enrollmentResultCsvHeader())) {
    temp.close();
    SD.remove(kSdEnrollmentResultsTempPath);
    lastSdWriteSucceeded_ = false;
    return false;
  }

  bool replaced = false;
  if (SD.exists(kSdEnrollmentResultsPath)) {
    File source = SD.open(kSdEnrollmentResultsPath, FILE_READ);
    if (!source) {
      temp.close();
      SD.remove(kSdEnrollmentResultsTempPath);
      lastSdWriteSucceeded_ = false;
      return false;
    }

    String line;
    bool truncated = false;
    while (readBoundedLine(source, line, truncated)) {
      if (truncated || line.isEmpty()) {
        continue;
      }

      String fields[kEnrollmentResultFieldCount];
      const size_t parsedFields =
          splitCsvLine(line, fields, kEnrollmentResultFieldCount);
      if (isEnrollmentQueueHeader(fields, parsedFields)) {
        continue;
      }

      StudentInfo row = enrollmentResultStudentFromFields(fields, parsedFields);
      if (row.isValid() && studentKeysMatch(row, updatedStudent)) {
        if (updatedStudent.sessionId.isEmpty()) {
          updatedStudent.sessionId = row.sessionId;
        }
        if (!writeCsvLine(temp, enrollmentResultCsvRow(updatedStudent))) {
          source.close();
          temp.close();
          SD.remove(kSdEnrollmentResultsTempPath);
          lastSdWriteSucceeded_ = false;
          return false;
        }
        replaced = true;
        continue;
      }

      if (row.isValid()) {
        if (!writeCsvLine(temp, enrollmentResultCsvRow(row))) {
          source.close();
          temp.close();
          SD.remove(kSdEnrollmentResultsTempPath);
          lastSdWriteSucceeded_ = false;
          return false;
        }
      } else {
        if (!writeCsvLine(temp, line)) {
          source.close();
          temp.close();
          SD.remove(kSdEnrollmentResultsTempPath);
          lastSdWriteSucceeded_ = false;
          return false;
        }
      }
    }

    source.close();
  }

  if (!replaced) {
    if (!writeCsvLine(temp, enrollmentResultCsvRow(updatedStudent))) {
      temp.close();
      SD.remove(kSdEnrollmentResultsTempPath);
      lastSdWriteSucceeded_ = false;
      return false;
    }
  }

  temp.close();

  SD.remove(kSdEnrollmentResultsPath);
  if (!SD.rename(kSdEnrollmentResultsTempPath, kSdEnrollmentResultsPath)) {
    SD.remove(kSdEnrollmentResultsTempPath);
    lastSdWriteSucceeded_ = false;
    return false;
  }

  Serial.printf("[ENROLL][RESULT] queued student=%s template=%d\n",
                updatedStudent.studentUid.c_str(), updatedStudent.templateId);
  lastSdWriteSucceeded_ = true;
  return true;
}

std::vector<StudentInfo> StorageManager::loadUnsyncedEnrollmentResultsFromSd(
    size_t limit) const {
  std::vector<StudentInfo> students;
  if (limit == 0 || !CampusConfig::kUseSd) {
    return students;
  }

  StorageManager *storage = const_cast<StorageManager *>(this);
  if (!storage->ensureSdReady() || !SD.exists(kSdEnrollmentResultsPath)) {
    return students;
  }

  File file = SD.open(kSdEnrollmentResultsPath, FILE_READ);
  if (!file) {
    return students;
  }

  String line;
  bool truncated = false;
  while (readBoundedLine(file, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    String fields[kEnrollmentResultFieldCount];
    const size_t parsedFields =
        splitCsvLine(line, fields, kEnrollmentResultFieldCount);
    StudentInfo student =
        enrollmentResultStudentFromFields(fields, parsedFields);
    if (!student.isValid() || isEnrollmentStudentSynced(student) ||
        student.templateId <= 0) {
      continue;
    }

    students.push_back(student);
    if (students.size() >= limit) {
      break;
    }
  }

  file.close();
  return students;
}

bool StorageManager::markEnrollmentResultSyncedOnSd(const String &sessionId,
                                                    const String &studentUid) {
  if (studentUid.isEmpty() || !ensureSdReady() ||
      !SD.exists(kSdEnrollmentResultsPath)) {
    return false;
  }

  SD.remove(kSdEnrollmentResultsTempPath);
  File source = SD.open(kSdEnrollmentResultsPath, FILE_READ);
  File temp = SD.open(kSdEnrollmentResultsTempPath, FILE_WRITE);
  if (!source || !temp) {
    if (source) {
      source.close();
    }
    if (temp) {
      temp.close();
    }
    SD.remove(kSdEnrollmentResultsTempPath);
    lastSdWriteSucceeded_ = false;
    return false;
  }

  if (!writeCsvLine(temp, enrollmentResultCsvHeader())) {
    source.close();
    temp.close();
    SD.remove(kSdEnrollmentResultsTempPath);
    lastSdWriteSucceeded_ = false;
    return false;
  }

  bool updated = false;
  String line;
  bool truncated = false;
  while (readBoundedLine(source, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    String fields[kEnrollmentResultFieldCount];
    const size_t parsedFields =
        splitCsvLine(line, fields, kEnrollmentResultFieldCount);
    if (isEnrollmentQueueHeader(fields, parsedFields)) {
      continue;
    }

    StudentInfo row = enrollmentResultStudentFromFields(fields, parsedFields);
    if (!row.isValid()) {
      if (!writeCsvLine(temp, line)) {
        source.close();
        temp.close();
        SD.remove(kSdEnrollmentResultsTempPath);
        lastSdWriteSucceeded_ = false;
        return false;
      }
      continue;
    }

    if (row.studentUid == studentUid &&
        (sessionId.isEmpty() || row.sessionId == sessionId)) {
      row.syncStatus = "synced";
      row.enrollmentStatus = "synced";
      row.enrollmentSynced = true;
      if (!writeCsvLine(temp, enrollmentResultCsvRow(row))) {
        source.close();
        temp.close();
        SD.remove(kSdEnrollmentResultsTempPath);
        lastSdWriteSucceeded_ = false;
        return false;
      }
      updated = true;
      continue;
    }

    if (!writeCsvLine(temp, enrollmentResultCsvRow(row))) {
      source.close();
      temp.close();
      SD.remove(kSdEnrollmentResultsTempPath);
      lastSdWriteSucceeded_ = false;
      return false;
    }
  }

  source.close();
  temp.close();

  if (!updated) {
    SD.remove(kSdEnrollmentResultsTempPath);
    lastSdWriteSucceeded_ = false;
    return false;
  }

  SD.remove(kSdEnrollmentResultsPath);
  if (!SD.rename(kSdEnrollmentResultsTempPath, kSdEnrollmentResultsPath)) {
    SD.remove(kSdEnrollmentResultsTempPath);
    lastSdWriteSucceeded_ = false;
    return false;
  }

  StudentInfo queueStudent;
  if (findEnrollmentStudentInSd(studentUid, queueStudent)) {
    if (sessionId.isEmpty() || queueStudent.sessionId == sessionId) {
      queueStudent.syncStatus = "synced";
      queueStudent.enrollmentStatus = "synced";
      queueStudent.enrollmentSynced = true;
      updateEnrollmentStudentRowOnSd(queueStudent);
    }
  }

  Serial.printf("[ENROLL][SYNC] marked synced student=%s\n", studentUid.c_str());
  lastSdWriteSucceeded_ = true;
  return true;
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

  StudentInfo normalizedStudent = student;
  CampusEligibility::normalizeStudent(normalizedStudent);

  ensureFingerprintMappingsLoaded();
  bool updated = false;

  for (auto &entry : fingerprintMappingsCache_) {
    if (entry.studentUid == normalizedStudent.studentUid ||
        entry.templateId == normalizedStudent.templateId) {
      entry = normalizedStudent;
      updated = true;
      break;
    }
  }

  if (!updated) {
    fingerprintMappingsCache_.push_back(normalizedStudent);
  }

  if (!writeFingerprintMappings(fingerprintMappingsCache_)) {
    return false;
  }

  return updateEnrollmentArtifacts(normalizedStudent);
}

bool StorageManager::upsertFingerprintMappingCacheOnly(const StudentInfo &student) {
  if (!littleFsReady_) {
    return false;
  }

  StudentInfo normalizedStudent = student;
  CampusEligibility::normalizeStudent(normalizedStudent);

  ensureFingerprintMappingsLoaded();
  bool updated = false;

  for (auto &entry : fingerprintMappingsCache_) {
    if (entry.studentUid == normalizedStudent.studentUid ||
        entry.templateId == normalizedStudent.templateId) {
      entry = normalizedStudent;
      updated = true;
      break;
    }
  }

  if (!updated) {
    fingerprintMappingsCache_.push_back(normalizedStudent);
  }

  return writeFingerprintMappings(fingerprintMappingsCache_);
}

bool StorageManager::findStudentByTemplate(int templateId, StudentInfo &outStudent) const {
  const FingerprintTemplateOwnership ownership = resolveTemplateOwnership(templateId);
  if (ownership.state != FingerprintOwnershipState::Unique) {
    return false;
  }
  outStudent = ownership.student;
  return true;
}

FingerprintTemplateOwnership StorageManager::resolveTemplateOwnership(
    int templateId) const {
  ensureFingerprintMappingsLoaded();
  FingerprintTemplateOwnership ownership;
  for (const auto &student : fingerprintMappingsCache_) {
    if (student.templateId == templateId) {
      ++ownership.totalMatches;
      if (!isActiveFingerprintOwner(student)) {
        continue;
      }

      ++ownership.activeOwners;
      if (ownership.activeOwners == 1) {
        ownership.student = student;
        ownership.state = FingerprintOwnershipState::Unique;
      } else {
        ownership.state = FingerprintOwnershipState::Duplicate;
      }
    }
  }
  if (ownership.activeOwners == 0) {
    ownership.state = FingerprintOwnershipState::None;
  } else if (ownership.activeOwners > 1) {
    ownership.state = FingerprintOwnershipState::Duplicate;
  }
  return ownership;
}

FingerprintTemplateOwnership StorageManager::resolveTemplateOwnershipFromSd(
    int templateId) const {
  FingerprintTemplateOwnership ownership;
  if (templateId <= 0 || !CampusConfig::kUseSd) {
    return ownership;
  }

  StorageManager *storage = const_cast<StorageManager *>(this);
  if (!storage->ensureSdReady() || !SD.exists(kSdFingerprintRosterPath)) {
    return ownership;
  }

  File file = SD.open(kSdFingerprintRosterPath, FILE_READ);
  if (!file) {
    return ownership;
  }

  String line;
  bool truncated = false;
  while (readBoundedLine(file, line, truncated)) {
    if (truncated || line.isEmpty()) {
      continue;
    }

    StudentInfo student;
    bool active = false;
    bool hasFingerprint = false;
    if (!parseFingerprintRosterStudent(line, student, active, hasFingerprint)) {
      continue;
    }
    if (student.templateId != templateId) {
      continue;
    }

    ++ownership.totalMatches;
    if (!active || !hasFingerprint || !isActiveFingerprintOwner(student)) {
      continue;
    }

    ++ownership.activeOwners;
    if (ownership.activeOwners == 1) {
      ownership.student = student;
      ownership.state = FingerprintOwnershipState::Unique;
    } else {
      ownership.state = FingerprintOwnershipState::Duplicate;
    }
  }

  file.close();

  if (ownership.activeOwners == 0) {
    ownership.state = FingerprintOwnershipState::None;
  } else if (ownership.activeOwners > 1) {
    ownership.state = FingerprintOwnershipState::Duplicate;
  }

  return ownership;
}

bool StorageManager::applyCleanupQueueItem(const CleanupQueueItem &item,
                                           String &error) {
  if (!littleFsReady_) {
    error = "Storage unavailable";
    return false;
  }

  ensureFingerprintMappingsLoaded();
  ensurePendingStudentsLoaded();
  ensureEnrollmentSyncQueueLoaded();
  ensurePairedEventContextLoaded();

  bool mappingsChanged = false;
  std::vector<StudentInfo> filteredMappings;
  filteredMappings.reserve(fingerprintMappingsCache_.size());
  for (const auto &student : fingerprintMappingsCache_) {
    if (cleanupItemMatchesStudent(item, student) ||
        (item.type == "deleteTemplateIfUnused" && item.templateId > 0 &&
         student.templateId == item.templateId)) {
      mappingsChanged = true;
      continue;
    }
    filteredMappings.push_back(student);
  }
  if (mappingsChanged) {
    fingerprintMappingsCache_ = filteredMappings;
  }

  bool pendingChanged = false;
  for (auto &student : pendingStudentsCache_) {
    if (!cleanupItemMatchesStudent(item, student) &&
        !(item.type == "deleteTemplateIfUnused" && item.templateId > 0 &&
          student.templateId == item.templateId)) {
      continue;
    }
    markStudentNeedsReenrollment(student);
    pendingChanged = true;
  }

  bool syncQueueChanged = false;
  for (auto &student : enrollmentSyncQueueCache_) {
    if (!cleanupItemMatchesStudent(item, student) &&
        !(item.type == "deleteTemplateIfUnused" && item.templateId > 0 &&
          student.templateId == item.templateId)) {
      continue;
    }
    markStudentNeedsReenrollment(student);
    syncQueueChanged = true;
  }

  bool pairedChanged = false;
  for (auto &student : pairedStudentsCache_) {
    if (!cleanupItemMatchesStudent(item, student) &&
        !(item.type == "deleteTemplateIfUnused" && item.templateId > 0 &&
          student.templateId == item.templateId)) {
      continue;
    }
    markStudentNeedsReenrollment(student);
    pairedChanged = true;
  }

  if (!mappingsChanged && !pendingChanged && !syncQueueChanged && !pairedChanged) {
    return true;
  }

  if (mappingsChanged && !writeFingerprintMappings(fingerprintMappingsCache_)) {
    error = "Fingerprint map save failed";
    return false;
  }
  if (pendingChanged && !writePendingStudents(pendingStudentsCache_)) {
    error = "Pending queue save failed";
    return false;
  }
  if (syncQueueChanged &&
      !writeStudentList(kEnrollmentSyncQueuePath, enrollmentSyncQueueCache_)) {
    error = "Enrollment sync queue save failed";
    return false;
  }
  if (pairedChanged && pairedEventCache_.isValid() &&
      !writePairedEventContext(pairedEventCache_, pairedStudentsCache_,
                               remoteRecordedStudentIdsCache_)) {
    error = "Paired event context save failed";
    return false;
  }
  return true;
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
  const std::vector<StudentInfo> sdResults =
      loadUnsyncedEnrollmentResultsFromSd(1);
  if (!sdResults.empty()) {
    return sdResults;
  }

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
  if (CampusConfig::kUseSd) {
    StorageManager *storage = const_cast<StorageManager *>(this);
    if (storage->ensureSdReady() && SD.exists(kSdEnrollmentResultsPath)) {
      File file = SD.open(kSdEnrollmentResultsPath, FILE_READ);
      if (file) {
        size_t count = 0;
        String line;
        bool truncated = false;
        while (readBoundedLine(file, line, truncated)) {
          if (truncated || line.isEmpty()) {
            continue;
          }

          String fields[kEnrollmentResultFieldCount];
          const size_t parsedFields =
              splitCsvLine(line, fields, kEnrollmentResultFieldCount);
          StudentInfo student =
              enrollmentResultStudentFromFields(fields, parsedFields);
          if (student.isValid() && !isEnrollmentStudentSynced(student) &&
              student.templateId > 0) {
            ++count;
          }
        }
        file.close();
        if (count > 0) {
          return count;
        }
      }
    }
  }

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
  const EnrollmentQueueStats sdQueueStats = getEnrollmentQueueStatsFromSd();
  const bool hasPendingQueue =
      sdQueueStats.queueExists ? sdQueueStats.pendingRows > 0
                               : !pendingStudentsCache_.empty();
  const bool clearedSession =
      !hasPendingQueue && unsyncedEnrollmentCount() == 0 ? clearCurrentEnrollmentSession()
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
      if (!record.synced && !record.syncRejected) {
        ++unsyncedAttendanceCountCache_;
      }
    }
  }

  return true;
}

void StorageManager::refreshUnsyncedAttendanceCount() const {
  unsyncedAttendanceCountCache_ = 0;
  for (const auto &record : attendanceRecordsCache_) {
    if (!record.synced && !record.syncRejected) {
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
    if (!record.synced && !record.syncRejected) {
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
    if (record.eventId == eventId && !record.synced && !record.syncRejected) {
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
        record.syncRejected = false;
        record.remoteDuplicate = result.status == "duplicate";
        record.syncError = result.message;
        record.retryCount = 0;
        markRemoteAttendanceRecorded(record.eventId, record.studentUid);
      } else if (result.status == "rejected") {
        record.synced = false;
        record.syncRejected = true;
        record.remoteDuplicate = false;
        record.syncError = result.message;
        record.retryCount += 1;
      } else {
        record.synced = false;
        record.syncRejected = false;
        record.remoteDuplicate = false;
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

bool StorageManager::saveFingerprintRosterToSd(
    Stream &stream, size_t expectedBytes, FingerprintRosterStats &stats,
    String &error) {
  stats = FingerprintRosterStats{};
  error = "";

  if (!ensureSdReady()) {
    error = "SD unavailable";
    lastSdWriteSucceeded_ = false;
    return false;
  }

  SD.mkdir("/logs");
  SD.remove(kSdFingerprintRosterTempPath);

  File file = SD.open(kSdFingerprintRosterTempPath, FILE_WRITE);
  if (!file) {
    error = "SD temp file open failed";
    lastSdWriteSucceeded_ = false;
    return false;
  }

  uint8_t buffer[256];
  size_t writtenBytes = 0;
  while (expectedBytes == 0 || writtenBytes < expectedBytes) {
    size_t requestedBytes = sizeof(buffer);
    if (expectedBytes > 0) {
      const size_t remainingBytes = expectedBytes - writtenBytes;
      if (remainingBytes < requestedBytes) {
        requestedBytes = remainingBytes;
      }
    }

    const size_t chunkSize =
        stream.readBytes(reinterpret_cast<char *>(buffer), requestedBytes);
    if (chunkSize == 0) {
      break;
    }

    const size_t savedBytes = file.write(buffer, chunkSize);
    if (savedBytes != chunkSize) {
      file.close();
      SD.remove(kSdFingerprintRosterTempPath);
      error = "SD roster write failed";
      lastSdWriteSucceeded_ = false;
      return false;
    }

    writtenBytes += chunkSize;
  }

  file.close();

  if (expectedBytes > 0 && writtenBytes != expectedBytes) {
    SD.remove(kSdFingerprintRosterTempPath);
    error = "Roster download incomplete";
    lastSdWriteSucceeded_ = false;
    return false;
  }

  const FingerprintRosterStats tempStats =
      collectFingerprintRosterStats(SD, kSdFingerprintRosterTempPath);
  if (!tempStats.rosterExists || !tempStats.headerValid) {
    SD.remove(kSdFingerprintRosterTempPath);
    error = "Roster file invalid";
    lastSdWriteSucceeded_ = false;
    return false;
  }

  SD.remove(kSdFingerprintRosterPath);
  if (!SD.rename(kSdFingerprintRosterTempPath, kSdFingerprintRosterPath)) {
    SD.remove(kSdFingerprintRosterTempPath);
    error = "Roster file replace failed";
    lastSdWriteSucceeded_ = false;
    return false;
  }

  stats = collectFingerprintRosterStats(SD, kSdFingerprintRosterPath);
  lastSdWriteSucceeded_ = true;
  return true;
}

FingerprintRosterStats StorageManager::getFingerprintRosterStats() {
  if (!ensureSdReady()) {
    return FingerprintRosterStats{};
  }
  return collectFingerprintRosterStats(SD, kSdFingerprintRosterPath);
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
  doc["schemaVersion"] = kPairedEventContextSchemaVersion;
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

  const bool sdQueueAvailable =
      CampusConfig::kUseSd && ensureSdReady() && SD.exists(kSdEnrollmentQueuePath);

  bool syncQueueSaved = true;
  if (sdQueueAvailable) {
    syncQueueSaved = updateEnrollmentStudentRowOnSd(student) &&
                     appendEnrollmentResultToSd(student);
  } else {
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
    syncQueueSaved = writeStudentList(kEnrollmentSyncQueuePath,
                                      enrollmentSyncQueueCache_);
  }

  bool pendingSaved = true;
  if (!sdQueueAvailable) {
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
    pendingSaved = writePendingStudents(pendingStudentsCache_);
  }

  const bool logsSaved = writeStudentList(kEnrollmentLogsPath, logs);
  if (!logsSaved) {
    Serial.println("[ENROLL][RESULT] enrollment log save skipped");
  }
  return syncQueueSaved && pendingSaved;
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
