#include "BackendClient.h"

#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <ctype.h>

#include <CampusEligibility.h>

#include "Config.h"
#include "StorageManager.h"

namespace {
constexpr char kCreateSessionPath[] = "/campusDeviceCreateSession";
constexpr char kPairedEventContextPath[] = "/campusDevicePairedEventContext";
constexpr char kFingerprintRosterPath[] = "/campusDeviceDownloadFingerprintRoster";
constexpr char kResolveAttendanceOwnerPath[] = "/campusDeviceResolveAttendanceOwner";
constexpr char kAttendanceSyncPath[] = "/campusDeviceSyncAttendance";
constexpr char kCleanupQueuePath[] = "/campusDeviceCleanupQueue";
constexpr char kCleanupAckPath[] = "/campusDeviceCleanupQueue";
constexpr int kTlsAllocErrorCode = -10368;
constexpr size_t kErrorPreviewBytes = 768;
constexpr size_t kCommandPayloadJsonCapacity = 256;
constexpr size_t kPairEnrollmentResponseJsonCapacity = 4096;
constexpr size_t kSubmitEnrollmentPayloadJsonCapacity = 1024;
constexpr size_t kSubmitEnrollmentResponseJsonCapacity = 1024;
constexpr size_t kResolveAttendanceOwnerPayloadJsonCapacity = 512;
constexpr size_t kResolveAttendanceOwnerResponseJsonCapacity = 2048;
constexpr size_t kAttendancePayloadJsonCapacity = 2048;
constexpr size_t kCleanupAckPayloadJsonCapacity = 2048;
constexpr size_t kCleanupAckResponseJsonCapacity = 1024;
constexpr size_t kSessionResponseMaxBytes = 2048;
constexpr size_t kPairEventResponseJsonCapacity = 4096;
constexpr size_t kPairEventMaxResponseBytes = 32768;
constexpr size_t kPairedEventContextResponseJsonCapacity = 32768;
constexpr size_t kPairedEventContextMaxResponseBytes = 32768;
constexpr size_t kPairedEventContextPageSize = 20;
constexpr size_t kPairedEventContextMaxPages = 128;
constexpr uint32_t kTlsLargestFreeBlockWarningBytes = 24U * 1024U;
constexpr uint32_t kSecureClientCooldownMs = 150;
constexpr uint32_t kHttpRequestWarnMs = 2000;
constexpr uint8_t kPairedEventTlsConnectAttempts = 2;

struct RequestTarget {
  String url;
  String host;
  String uri;
  uint16_t port = 443;
  bool https = true;
  bool valid = false;
};

struct HttpRequestTimingGuard {
  explicit HttpRequestTimingGuard(const String &path, int *statusCode)
      : path(path), statusCode(statusCode), startedAt(millis()) {}

  ~HttpRequestTimingGuard() {
    const uint32_t elapsed = millis() - startedAt;
    if (elapsed < kHttpRequestWarnMs) {
      return;
    }

    Serial.printf("[HTTP][WARN] slow request path=%s code=%d ms=%lu\n",
                  path.c_str(), statusCode != nullptr ? *statusCode : 0,
                  static_cast<unsigned long>(elapsed));
  }

  String path;
  int *statusCode = nullptr;
  uint32_t startedAt = 0;
};

String buildUrl(const String &path) {
  String base = CampusConfig::kApiBaseUrl;
  if (base.endsWith("/")) {
    base.remove(base.length() - 1);
  }
  if (path.startsWith("/")) {
    return base + path;
  }
  return base + "/" + path;
}

RequestTarget buildRequestTarget(const String &path) {
  RequestTarget target;
  target.url = buildUrl(path);

  String base = CampusConfig::kApiBaseUrl;
  base.trim();
  if (base.isEmpty()) {
    return target;
  }

  int schemeSplit = base.indexOf("://");
  String remainder = base;
  if (schemeSplit >= 0) {
    const String scheme = base.substring(0, schemeSplit);
    target.https = !scheme.equalsIgnoreCase("http");
    target.port = target.https ? 443 : 80;
    remainder = base.substring(schemeSplit + 3);
  }

  int slashIndex = remainder.indexOf('/');
  String authority = slashIndex >= 0 ? remainder.substring(0, slashIndex) : remainder;
  String basePath = slashIndex >= 0 ? remainder.substring(slashIndex) : "";
  authority.trim();
  basePath.trim();

  int colonIndex = authority.indexOf(':');
  if (colonIndex >= 0) {
    target.host = authority.substring(0, colonIndex);
    const int parsedPort = authority.substring(colonIndex + 1).toInt();
    if (parsedPort > 0 && parsedPort <= 65535) {
      target.port = static_cast<uint16_t>(parsedPort);
    }
  } else {
    target.host = authority;
  }

  if (target.host.isEmpty()) {
    return target;
  }

  if (basePath.isEmpty()) {
    target.uri = path.startsWith("/") ? path : "/" + path;
  } else if (path.startsWith("/")) {
    target.uri = basePath + path;
  } else {
    target.uri = basePath + "/" + path;
  }

  target.valid = true;
  return target;
}

String wifiStatusName(wl_status_t status) {
  switch (status) {
    case WL_CONNECTED:
      return "WL_CONNECTED";
    case WL_IDLE_STATUS:
      return "WL_IDLE_STATUS";
    case WL_NO_SSID_AVAIL:
      return "WL_NO_SSID_AVAIL";
    case WL_SCAN_COMPLETED:
      return "WL_SCAN_COMPLETED";
    case WL_CONNECT_FAILED:
      return "WL_CONNECT_FAILED";
    case WL_CONNECTION_LOST:
      return "WL_CONNECTION_LOST";
    case WL_DISCONNECTED:
      return "WL_DISCONNECTED";
    default:
      return "WL_UNKNOWN(" + String(static_cast<int>(status)) + ")";
  }
}

bool shouldRetryRequest(int httpCode, uint8_t attempt, uint8_t maxAttempts) {
  if (attempt >= maxAttempts) {
    return false;
  }

  if (httpCode < 0) {
    return true;
  }

  return httpCode == 408 || httpCode == 429 || httpCode >= 500;
}

uint32_t retryDelayMs(uint8_t attempt, bool tlsMemoryPressure) {
  const uint32_t baseDelay =
      tlsMemoryPressure ? CampusConfig::kTlsHandshakeRetryBackoffMs
                        : CampusConfig::kHttpRetryBaseDelayMs;
  return baseDelay * static_cast<uint32_t>(attempt);
}

bool isTlsMemoryFailure(int errorCode, const char *detail) {
  if (errorCode == kTlsAllocErrorCode) {
    return true;
  }

  if (detail == nullptr || detail[0] == '\0') {
    return false;
  }

  String normalized = detail;
  normalized.toLowerCase();
  return normalized.indexOf("allocation of memory failed") >= 0 ||
         normalized.indexOf("out of memory") >= 0 ||
         normalized.indexOf("alloc") >= 0;
}

bool isClearAs608CleanupType(const String &type) {
  return type.equalsIgnoreCase("clear_as608_database");
}

bool isDeleteTemplateCleanupType(const String &type) {
  return type.equalsIgnoreCase("deleteTemplateIfUnused");
}

bool isSupportedCleanupType(const String &type) {
  return isClearAs608CleanupType(type) || isDeleteTemplateCleanupType(type);
}

bool cleanupTargetMatchesLocalDevice(const String &targetDeviceId) {
  return targetDeviceId.isEmpty() ||
         targetDeviceId.equalsIgnoreCase(CampusConfig::kDeviceId);
}

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

void appendStringValues(JsonVariantConst value, std::vector<String> &outValues) {
  if (value.isNull()) {
    return;
  }

  auto addValue = [&outValues](const String &raw) {
    const String parsed = CampusEligibility::trimAndCollapseWhitespace(raw);
    if (parsed.isEmpty()) {
      return;
    }
    for (const auto &entry : outValues) {
      if (entry == parsed) {
        return;
      }
    }
    outValues.push_back(parsed);
  };

  if (value.is<JsonArrayConst>()) {
    for (JsonVariantConst item : value.as<JsonArrayConst>()) {
      addValue(parseStringField(item));
    }
    return;
  }

  addValue(parseStringField(value));
}

void appendUniqueStringValue(const String &value, std::vector<String> &outValues) {
  const String normalized = CampusEligibility::trimAndCollapseWhitespace(value);
  if (normalized.isEmpty()) {
    return;
  }
  for (const auto &entry : outValues) {
    if (entry == normalized) {
      return;
    }
  }
  outValues.push_back(normalized);
}

void appendUniqueStringValues(const std::vector<String> &values,
                              std::vector<String> &outValues) {
  for (const auto &value : values) {
    appendUniqueStringValue(value, outValues);
  }
}

bool hasPairAudienceEvidence(const EventInfo &event) {
  EventInfo normalized = event;
  CampusEligibility::normalizeEvent(normalized);
  return CampusEligibility::isSpecificStudentsMode(normalized) ||
         CampusEligibility::hasBroadAudienceFilters(normalized) ||
         normalized.preregistrationRequired || normalized.requiresRegistration ||
         normalized.paymentRequired || normalized.activeOnly ||
         normalized.audienceRestricted || normalized.rosterRequired;
}

bool hasPairAudienceContradiction(const EventInfo &event,
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
  if (hasPairAudienceEvidence(event) && !requiresContextHint) {
    return true;
  }
  return false;
}

bool shouldReplaceTargetMode(const String &current, const String &incoming) {
  const String normalizedIncoming =
      CampusEligibility::normalizeTargetMode(incoming);
  if (normalizedIncoming.isEmpty()) {
    return false;
  }
  const String normalizedCurrent = CampusEligibility::normalizeTargetMode(current);
  return normalizedCurrent.isEmpty() ||
         (normalizedCurrent == "broad" && normalizedIncoming != "broad");
}

void logEventAudienceState(const char *stage, const EventInfo &event,
                           size_t studentCount, size_t recordedCount) {
  Serial.printf(
      "[PAIR][HTTP] stage=%s eventId=%s title=%s targetMode=%s targetStudent=%s "
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

void applyDeviceSecretHeaders(HTTPClient &http) {
  http.addHeader("X-Campus-Device-Id", CampusConfig::kDeviceId);
  http.addHeader("X-Campus-Device-Secret", CampusConfig::kDeviceSecret);
  http.addHeader("X-Device-Id", CampusConfig::kDeviceId);
  http.addHeader("X-Device-Secret", CampusConfig::kDeviceSecret);
}

void eventFromJson(JsonObjectConst object, EventInfo &event,
                   bool *invalidAudienceSummary = nullptr) {
  event.eventId = String(object["eventId"] | object["id"] | "");
  event.title = String(object["title"] | "");
  event.date = String(object["date"] | "");
  event.scheduledTime = String(object["scheduledTimeStart"] |
                               object["scheduledTime"] |
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
  if (invalidAudienceSummary != nullptr) {
    *invalidAudienceSummary =
        hasPairAudienceContradiction(event, rawTargetMode);
  }
  if (event.scheduledTimeEnd.isEmpty()) {
    const int dashIndex = event.scheduledTime.indexOf('-');
    if (dashIndex > 0) {
      String start = event.scheduledTime.substring(0, dashIndex);
      String end = event.scheduledTime.substring(dashIndex + 1);
      start.trim();
      end.trim();
      if (!start.isEmpty() && !end.isEmpty()) {
        event.scheduledTime = start;
        event.scheduledTimeEnd = end;
      }
    }
  }
  CampusEligibility::normalizeEvent(event);
}

StudentInfo studentFromJson(JsonObjectConst object) {
  StudentInfo student;
  student.studentUid =
      String(object["studentId"] | object["studentUid"] | object["uid"] | "");
  student.schoolId = String(object["schoolId"] | "");
  student.studentName = String(object["studentName"] | object["name"] | "");
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
  student.enrollmentStatus =
      String(object["enrollmentStatus"] | object["status"] | "");
  student.syncStatus = String(object["syncStatus"] | "");
  student.remarks = String(object["remarks"] | "");
  student.enrolledAtIso =
      String(object["enrolledAtIso"] | object["timestampIso"] | "");
  student.templateId =
      object["fingerprintTemplateId"] | object["templateId"] | -1;
  student.isActive =
      parseBoolValue(object["isActive"], parseBoolValue(object["active"], true));
  student.activeKnown =
      !object["isActive"].isNull() || !object["active"].isNull() ||
      !object["accountActive"].isNull() || !object["accountStatus"].isNull() ||
      !object["profileStatus"].isNull();
  student.preregistered = parseBoolValue(
      object["preregistered"],
      parseBoolValue(object["isPreregistered"],
                     parseBoolValue(object["hasPreregistration"], false)));
  student.preregisteredKnown =
      !object["preregistered"].isNull() || !object["isPreregistered"].isNull() ||
      !object["hasPreregistration"].isNull() ||
      !object["registrationStatus"].isNull();
  if (!object["registrationStatus"].isNull()) {
    student.preregistered =
        parseBoolValue(object["registrationStatus"], student.preregistered);
  }
  student.paymentSatisfied = parseBoolValue(
      object["paymentSatisfied"],
      parseBoolValue(object["isPaid"],
                     parseBoolValue(object["paymentCleared"], false)));
  student.paymentKnown =
      !object["paymentSatisfied"].isNull() || !object["isPaid"].isNull() ||
      !object["paymentCleared"].isNull() || !object["paymentStatus"].isNull();
  if (!object["paymentStatus"].isNull()) {
    student.paymentSatisfied =
        parseBoolValue(object["paymentStatus"], student.paymentSatisfied);
  }
  student.enrollmentSynced = student.syncStatus == "synced";
  CampusEligibility::normalizeStudent(student);
  return student;
}

bool isPairedEventContextRequestPath(const String &path) {
  return path.startsWith(kPairedEventContextPath);
}

String buildPairedEventContextPath(size_t offset, size_t limit) {
  String path = kPairedEventContextPath;
  path += "?offset=";
  path += String(static_cast<unsigned>(offset));
  path += "&limit=";
  path += String(static_cast<unsigned>(limit));
  return path;
}

void forceCloseSecureClient(WiFiClientSecure &client) {
  client.stop();
  delay(kSecureClientCooldownMs);
}

AttendanceOwnerResolution attendanceOwnerResolutionFromJson(
    JsonObjectConst object) {
  AttendanceOwnerResolution resolution;
  resolution.ownerFound = parseBoolValue(object["ownerFound"], false);
  resolution.eventAllowed = parseBoolValue(object["eventAllowed"], false);
  resolution.templateId =
      object["fingerprintTemplateId"] | object["templateId"] | -1;
  resolution.reason = String(object["reason"] | "");

  if (!resolution.ownerFound) {
    return resolution;
  }

  StudentInfo student = studentFromJson(object);
  if (student.studentName.isEmpty()) {
    student.studentName = String(object["name"] | "");
  }
  if (student.templateId <= 0) {
    student.templateId = resolution.templateId;
  }
  student.isActive = parseBoolValue(object["active"], true);
  student.activeKnown = true;
  const bool hasFingerprint =
      parseBoolValue(object["hasFingerprint"], student.templateId > 0);
  student.fingerprintStatus =
      hasFingerprint ? (student.isActive ? "enrolled" : "inactive") : "pending";
  CampusEligibility::normalizeStudent(student);
  resolution.student = student;
  return resolution;
}

bool parseApiErrorPayload(const String &payload, String &error) {
  DynamicJsonDocument doc(1024);
  if (deserializeJson(doc, payload) != DeserializationError::Ok) {
    return false;
  }

  const String errorText = String(doc["error"] | "");
  if (!errorText.isEmpty()) {
    error = errorText;
    return true;
  }
  return false;
}

const String &emptyRequestBody() {
  static const String kEmptyBody;
  return kEmptyBody;
}

const String &emptyJsonObjectBody() {
  static const String kEmptyJsonBody("{}");
  return kEmptyJsonBody;
}

void logMemoryStage(const char *stage, const String &path = String(),
                    uint8_t attempt = 0, uint8_t maxAttempts = 0) {
  const uint32_t freeHeap = ESP.getFreeHeap();
  const uint32_t largestBlock =
      heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  const uint32_t minHeap = ESP.getMinFreeHeap();
  const uint32_t psramSize = ESP.getPsramSize();
  const uint32_t psramFree = ESP.getFreePsram();
  const uint32_t stackHighWaterBytes =
      static_cast<uint32_t>(uxTaskGetStackHighWaterMark(nullptr)) *
      sizeof(StackType_t);
  const bool fragmented = freeHeap > 0 && largestBlock < (freeHeap / 3U);

  Serial.printf(
      "[MEM] stage=%s attempt=%u/%u path=%s free=%u largest=%u min=%u "
      "fragmented=%s stackMinFree=%u psram=%u psramFree=%u\n",
      stage, static_cast<unsigned>(attempt), static_cast<unsigned>(maxAttempts),
      path.isEmpty() ? "-" : path.c_str(), static_cast<unsigned>(freeHeap),
      static_cast<unsigned>(largestBlock), static_cast<unsigned>(minHeap),
      fragmented ? "yes" : "no",
      static_cast<unsigned>(stackHighWaterBytes),
      static_cast<unsigned>(psramSize), static_cast<unsigned>(psramFree));
}

void logSimpleMemory(const char *label) {
  const uint32_t freeHeap = ESP.getFreeHeap();
  const uint32_t largestBlock =
      heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  Serial.printf("[MEM] %s free=%u largest=%u\n", label,
                static_cast<unsigned>(freeHeap),
                static_cast<unsigned>(largestBlock));
}

void logCompactMemory(const char *label) {
  const uint32_t freeHeap = ESP.getFreeHeap();
  const uint32_t largestBlock =
      heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  const uint32_t minHeap = ESP.getMinFreeHeap();
  Serial.printf("[MEM] %s free=%u largest=%u min=%u\n", label,
                static_cast<unsigned>(freeHeap),
                static_cast<unsigned>(largestBlock),
                static_cast<unsigned>(minHeap));
}

bool hasSafeHeapForPairedContextPage(const String &path, size_t offset,
                                     String &error) {
  const uint32_t freeHeap = ESP.getFreeHeap();
  const uint32_t largestBlock =
      heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  if (largestBlock >= kTlsLargestFreeBlockWarningBytes) {
    return true;
  }

  error = "Context too large";
  Serial.printf(
      "[PAIR] skip context page path=%s offset=%u largest=%u belowSafe=%u free=%u\n",
      path.c_str(), static_cast<unsigned>(offset),
      static_cast<unsigned>(largestBlock),
      static_cast<unsigned>(kTlsLargestFreeBlockWarningBytes),
      static_cast<unsigned>(freeHeap));
  return false;
}

void warnIfTlsLargestBlockLow(const String &path, uint8_t attempt = 0,
                              uint8_t maxAttempts = 0) {
  const uint32_t freeHeap = ESP.getFreeHeap();
  const uint32_t largestBlock =
      heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  const bool fragmented = freeHeap > 0 && largestBlock < (freeHeap / 3U);
  if (largestBlock >= kTlsLargestFreeBlockWarningBytes) {
    return;
  }

  Serial.printf(
      "[TLS][WARN] attempt=%u/%u path=%s largest=%u belowSafe=%u free=%u "
      "fragmented=%s\n",
      static_cast<unsigned>(attempt), static_cast<unsigned>(maxAttempts),
      path.isEmpty() ? "-" : path.c_str(), static_cast<unsigned>(largestBlock),
      static_cast<unsigned>(kTlsLargestFreeBlockWarningBytes),
      static_cast<unsigned>(freeHeap), fragmented ? "yes" : "no");
}

void reserveJsonBody(const JsonDocument &doc, String &body) {
  body.reserve(measureJson(doc) + 1U);
}

void mergeEventInfoPage(const EventInfo &pageEvent, EventInfo &event) {
  if (!pageEvent.isValid()) {
    return;
  }

  if (!event.isValid()) {
    event = pageEvent;
    CampusEligibility::normalizeEvent(event);
    return;
  }

  if (event.title.isEmpty()) {
    event.title = pageEvent.title;
  }
  if (event.date.isEmpty()) {
    event.date = pageEvent.date;
  }
  if (event.scheduledTime.isEmpty()) {
    event.scheduledTime = pageEvent.scheduledTime;
  }
  if (event.scheduledTimeEnd.isEmpty()) {
    event.scheduledTimeEnd = pageEvent.scheduledTimeEnd;
  }
  if (event.location.isEmpty()) {
    event.location = pageEvent.location;
  }
  if (event.status.isEmpty()) {
    event.status = pageEvent.status;
  }
  if (shouldReplaceTargetMode(event.targetMode, pageEvent.targetMode)) {
    event.targetMode = pageEvent.targetMode;
  }
  if (event.targetStudent.isEmpty()) {
    event.targetStudent = pageEvent.targetStudent;
  }
  if (event.courseFilterLabel.isEmpty()) {
    event.courseFilterLabel = pageEvent.courseFilterLabel;
  }
  if (event.yearLevelFilterLabel.isEmpty()) {
    event.yearLevelFilterLabel = pageEvent.yearLevelFilterLabel;
  }
  if (event.sectionFilterLabel.isEmpty()) {
    event.sectionFilterLabel = pageEvent.sectionFilterLabel;
  }
  if (event.bodScope.isEmpty()) {
    event.bodScope = pageEvent.bodScope;
  }
  if (event.bodScopeCanonical.isEmpty()) {
    event.bodScopeCanonical = pageEvent.bodScopeCanonical;
  }
  event.audienceRestricted = event.audienceRestricted || pageEvent.audienceRestricted;
  event.rosterRequired = event.rosterRequired || pageEvent.rosterRequired;
  if (event.contextSchemaVersion == 0) {
    event.contextSchemaVersion = pageEvent.contextSchemaVersion;
  }

  appendUniqueStringValues(pageEvent.courseFilters, event.courseFilters);
  appendUniqueStringValues(pageEvent.yearLevelFilters, event.yearLevelFilters);
  appendUniqueStringValues(pageEvent.sectionFilters, event.sectionFilters);
  appendUniqueStringValues(pageEvent.targetedStudentIds, event.targetedStudentIds);
  appendUniqueStringValues(pageEvent.targetedSchoolIds, event.targetedSchoolIds);

  event.requiresRegistration =
      event.requiresRegistration || pageEvent.requiresRegistration;
  event.preregistrationRequired =
      event.preregistrationRequired || pageEvent.preregistrationRequired;
  event.paymentRequired = event.paymentRequired || pageEvent.paymentRequired;
  event.activeOnly = event.activeOnly || pageEvent.activeOnly;
  event.timeOutFinalized = event.timeOutFinalized || pageEvent.timeOutFinalized;

  CampusEligibility::normalizeEvent(event);
}

void upsertEventContextStudents(const std::vector<StudentInfo> &pageStudents,
                                std::vector<StudentInfo> &students) {
  for (const auto &student : pageStudents) {
    bool updated = false;
    for (auto &existing : students) {
      if (existing.studentUid == student.studentUid) {
        existing = student;
        updated = true;
        break;
      }
    }
    if (!updated) {
      students.push_back(student);
    }
  }
}

struct EventContextPageInfo {
  bool hasMoreStudents = false;
  bool hasMoreRecordedStudentIds = false;
  bool hasMoreSelectedStudentIds = false;
  bool hasMoreSelectedSchoolIds = false;
  int nextOffset = -1;

  bool hasMore() const {
    return hasMoreStudents || hasMoreRecordedStudentIds ||
           hasMoreSelectedStudentIds || hasMoreSelectedSchoolIds;
  }
};

EventContextPageInfo eventContextPageInfoFromJson(JsonDocument &response) {
  EventContextPageInfo info;
  JsonObjectConst pageObject = response["page"].as<JsonObjectConst>();
  if (pageObject.isNull()) {
    return info;
  }

  info.hasMoreStudents = parseBoolValue(pageObject["hasMoreStudents"], false);
  info.hasMoreRecordedStudentIds =
      parseBoolValue(pageObject["hasMoreRecordedStudentIds"], false);
  info.hasMoreSelectedStudentIds =
      parseBoolValue(pageObject["hasMoreSelectedStudentIds"], false);
  info.hasMoreSelectedSchoolIds =
      parseBoolValue(pageObject["hasMoreSelectedSchoolIds"], false);
  info.nextOffset = pageObject["nextOffset"] | -1;
  return info;
}

bool ensureDynamicJsonCapacity(const DynamicJsonDocument &doc,
                               size_t requestedCapacity,
                               const String &path,
                               const char *label,
                               String &error) {
  if (requestedCapacity == 0 || doc.capacity() >= requestedCapacity) {
    return true;
  }

  error = String(label) + " JSON allocation failed";
  Serial.printf("[JSON] allocFailed path=%s label=%s requested=%u actual=%u\n",
                path.c_str(), label, static_cast<unsigned>(requestedCapacity),
                static_cast<unsigned>(doc.capacity()));
  logMemoryStage("json alloc failed", path);
  return false;
}

void captureErrorPreview(HTTPClient &http, String &preview) {
  preview = "";
  WiFiClient *stream = http.getStreamPtr();
  if (stream == nullptr) {
    return;
  }

  preview.reserve(kErrorPreviewBytes);
  uint32_t startedAt = millis();
  while (preview.length() < kErrorPreviewBytes &&
         (millis() - startedAt) < CampusConfig::kHttpTimeoutMs) {
    while (stream->available() > 0 && preview.length() < kErrorPreviewBytes) {
      const int nextByte = stream->read();
      if (nextByte < 0) {
        break;
      }
      preview += static_cast<char>(nextByte);
    }

    if (!stream->connected() && stream->available() == 0) {
      break;
    }
    delay(2);
  }
}

String redactedJsonPreview(const String &payload) {
  String preview = payload;
  if (preview.length() > kErrorPreviewBytes) {
    preview = preview.substring(0, kErrorPreviewBytes);
  }

  const char *sensitiveKeys[] = {
      "\"sessionToken\"",
      "\"token\"",
      "\"secret\"",
      "\"Authorization\"",
  };

  for (const char *key : sensitiveKeys) {
    int searchFrom = 0;
    while (true) {
      const int keyIndex = preview.indexOf(key, searchFrom);
      if (keyIndex < 0) {
        break;
      }
      const int colonIndex = preview.indexOf(':', keyIndex);
      if (colonIndex < 0) {
        break;
      }
      int valueStart = colonIndex + 1;
      while (valueStart < preview.length() &&
             isspace(static_cast<unsigned char>(preview[valueStart]))) {
        ++valueStart;
      }
      if (valueStart >= preview.length() || preview[valueStart] != '"') {
        searchFrom = valueStart;
        continue;
      }
      const int valueEnd = preview.indexOf('"', valueStart + 1);
      if (valueEnd < 0) {
        preview.remove(valueStart + 1);
        preview += "[REDACTED]";
        break;
      }
      const int redactStart = valueStart + 1;
      preview = preview.substring(0, redactStart) + "[REDACTED]" +
                preview.substring(valueEnd);
      searchFrom = redactStart + 10;
    }
  }

  return preview;
}

bool readResponseBody(HTTPClient &http, String &body, size_t maxBytes) {
  body = "";
  WiFiClient *stream = http.getStreamPtr();
  if (stream == nullptr) {
    return false;
  }

  body.reserve(maxBytes > 0 ? maxBytes : kErrorPreviewBytes);
  uint32_t startedAt = millis();
  while ((maxBytes == 0 || body.length() < maxBytes) &&
         (millis() - startedAt) < CampusConfig::kHttpTimeoutMs) {
    while (stream->available() > 0 &&
           (maxBytes == 0 || body.length() < maxBytes)) {
      const int nextByte = stream->read();
      if (nextByte < 0) {
        break;
      }
      body += static_cast<char>(nextByte);
    }

    if (!stream->connected() && stream->available() == 0) {
      break;
    }
    delay(2);
  }

  return true;
}
}  // namespace

bool BackendClient::fetchAvailableEvents(std::vector<EventInfo> &events,
                                         String &error) {
  if (!ensureSessionForRequest("/campusDeviceListEvents", error)) {
    return false;
  }

  DynamicJsonDocument response(16384);
  if (!requestJson("GET",
                   String("/campusDeviceListEvents?limit=") +
                       String(CampusConfig::kEventListLimit),
                   emptyRequestBody(), response, error)) {
    return false;
  }

  events.clear();
  JsonArray array = response["events"].as<JsonArray>();
  if (array.isNull()) {
    return true;
  }

  for (JsonObjectConst item : array) {
    EventInfo event;
    eventFromJson(item, event);
    if (event.isValid()) {
      events.push_back(event);
    }
  }

  return true;
}

bool BackendClient::fetchLatestEvent(EventInfo &event, String &error) {
  std::vector<EventInfo> events;
  if (!fetchAvailableEvents(events, error)) {
    return false;
  }
  if (events.empty()) {
    error = "No event found";
    return false;
  }
  event = events.front();
  return true;
}

bool BackendClient::fetchEnrollmentSessions(
    std::vector<EnrollmentSessionInfo> &sessions, String &error) {
  if (!ensureSessionForRequest("/campusDeviceListEnrollmentSessions", error)) {
    return false;
  }

  DynamicJsonDocument response(16384);
  if (!requestJson("GET",
                   String("/campusDeviceListEnrollmentSessions?limit=") +
                       String(CampusConfig::kPendingEnrollmentLimit),
                   emptyRequestBody(), response, error)) {
    return false;
  }

  sessions.clear();
  JsonArray array = response["sessions"].as<JsonArray>();
  if (array.isNull()) {
    return true;
  }

  for (JsonObjectConst item : array) {
    EnrollmentSessionInfo session;
    if (parseEnrollmentSession(item, session, error) && session.isValid()) {
      sessions.push_back(session);
    }
  }
  return true;
}

bool BackendClient::pairEnrollmentSession(const String &sessionId,
                                          EnrollmentSessionInfo &session,
                                          String &error) {
  if (!ensureSessionForRequest("/campusDevicePairEnrollmentSession", error)) {
    return false;
  }

  DynamicJsonDocument payload(kCommandPayloadJsonCapacity);
  if (!ensureDynamicJsonCapacity(payload, kCommandPayloadJsonCapacity,
                                 "/campusDevicePairEnrollmentSession",
                                 "pairEnrollment payload", error)) {
    return false;
  }
  logMemoryStage("before pairEnrollment payload",
                 "/campusDevicePairEnrollmentSession");
  payload["sessionId"] = sessionId;

  String body;
  reserveJsonBody(payload, body);
  serializeJson(payload, body);
  logMemoryStage("after pairEnrollment payload",
                 "/campusDevicePairEnrollmentSession");

  DynamicJsonDocument response(kPairEnrollmentResponseJsonCapacity);
  if (!ensureDynamicJsonCapacity(response, kPairEnrollmentResponseJsonCapacity,
                                 "/campusDevicePairEnrollmentSession",
                                 "pairEnrollment response", error)) {
    return false;
  }
  if (!requestJson("POST", "/campusDevicePairEnrollmentSession", body,
                   response, error)) {
    return false;
  }

  JsonObject sessionObject = response["session"];
  if (sessionObject.isNull()) {
    error = "Session payload missing";
    return false;
  }

  return parseEnrollmentSession(sessionObject, session, error);
}

bool BackendClient::downloadEnrollmentSession(const String &sessionId,
                                              EnrollmentSessionInfo &session,
                                              std::vector<StudentInfo> &students,
                                              String &error) {
  if (!ensureSessionForRequest("/campusDeviceDownloadEnrollmentSession", error)) {
    return false;
  }

  DynamicJsonDocument payload(kCommandPayloadJsonCapacity);
  if (!ensureDynamicJsonCapacity(payload, kCommandPayloadJsonCapacity,
                                 "/campusDeviceDownloadEnrollmentSession",
                                 "downloadEnrollment payload", error)) {
    return false;
  }
  logMemoryStage("before downloadSession payload",
                 "/campusDeviceDownloadEnrollmentSession");
  payload["sessionId"] = sessionId;

  String body;
  reserveJsonBody(payload, body);
  serializeJson(payload, body);
  logMemoryStage("after downloadSession payload",
                 "/campusDeviceDownloadEnrollmentSession");

  DynamicJsonDocument response(24576);
  if (!requestJson("POST", "/campusDeviceDownloadEnrollmentSession", body,
                   response, error)) {
    return false;
  }

  JsonObject sessionObject = response["session"];
  if (sessionObject.isNull() || !parseEnrollmentSession(sessionObject, session, error)) {
    error = error.isEmpty() ? "Session payload missing" : error;
    return false;
  }

  students.clear();
  JsonArray array = response["students"].as<JsonArray>();
  if (array.isNull()) {
    return true;
  }

  for (JsonObjectConst item : array) {
    StudentInfo student = studentFromJson(item);
    student.sessionId = session.sessionId;
    if (student.isValid()) {
      students.push_back(student);
    }
  }
  return true;
}

bool BackendClient::pairEvent(const String &eventId, EventInfo &event,
                              std::vector<StudentInfo> &students,
                              std::vector<String> &recordedStudentIds,
                              String &error) {
  if (!ensureSessionForRequest("/campusDevicePairEvent", error)) {
    return false;
  }

  logMemoryStage("before pairEvent payload", "/campusDevicePairEvent");
  DynamicJsonDocument payload(kCommandPayloadJsonCapacity);
  if (!ensureDynamicJsonCapacity(payload, kCommandPayloadJsonCapacity,
                                 "/campusDevicePairEvent",
                                 "pairEvent payload", error)) {
    return false;
  }
  payload["eventId"] = eventId;

  String body;
  reserveJsonBody(payload, body);
  serializeJson(payload, body);
  logMemoryStage("after pairEvent payload", "/campusDevicePairEvent");
  logMemoryStage("before pairEvent response", "/campusDevicePairEvent");

  DynamicJsonDocument response(kPairEventResponseJsonCapacity);
  if (!ensureDynamicJsonCapacity(response, kPairEventResponseJsonCapacity,
                                 "/campusDevicePairEvent",
                                 "pairEvent response", error)) {
    return false;
  }
  logMemoryStage("after pairEvent response", "/campusDevicePairEvent");
  if (!requestJson("POST", "/campusDevicePairEvent", body, response, error,
                   true, 1, 0, kPairEventMaxResponseBytes,
                   "Pair response too large")) {
    return false;
  }

  return parseEventContextResponse(response, event, students, recordedStudentIds,
                                   error);
}

bool BackendClient::confirmPairing(const EventInfo &event, String &error) {
  EventInfo pairedEvent;
  std::vector<StudentInfo> students;
  std::vector<String> recordedStudentIds;
  return pairEvent(event.eventId, pairedEvent, students, recordedStudentIds,
                   error);
}

bool BackendClient::downloadPairedEventContextToStorage(
    EventInfo &event, StorageManager &storage, String &error) {
  if (!ensureSessionForRequest("/campusDevicePairedEventContext", error)) {
    return false;
  }
  if (!event.isValid()) {
    error = "No paired event";
    return false;
  }
  if (!storage.beginPairedEventStudentContext(event.eventId)) {
    error = "Context storage unavailable";
    return false;
  }

  size_t offset = 0;
  for (size_t pageIndex = 0; pageIndex < kPairedEventContextMaxPages; ++pageIndex) {
    const String path =
        buildPairedEventContextPath(offset, kPairedEventContextPageSize);
    if (!hasSafeHeapForPairedContextPage(path, offset, error)) {
      return false;
    }

    DynamicJsonDocument response(kPairedEventContextResponseJsonCapacity);
    if (!ensureDynamicJsonCapacity(response,
                                   kPairedEventContextResponseJsonCapacity,
                                   path, "pairedEventContext response", error)) {
      return false;
    }
    if (!requestJson("GET", path, emptyRequestBody(), response, error, true,
                     CampusConfig::kHttpRetryAttempts, 0,
                     kPairedEventContextMaxResponseBytes,
                     "Paired event context response too large")) {
      return false;
    }

    EventInfo pageEvent;
    std::vector<StudentInfo> pageStudents;
    std::vector<String> pageRecordedStudentIds;
    if (!parseEventContextResponse(response, pageEvent, pageStudents,
                                   pageRecordedStudentIds, error)) {
      if (error.isEmpty()) {
        error = "Paired event context parse failed";
      }
      return false;
    }

    mergeEventInfoPage(pageEvent, event);
    if (!storage.appendPairedEventStudentPage(event.eventId, pageStudents,
                                              pageRecordedStudentIds)) {
      error = "Context storage unavailable";
      return false;
    }

    Serial.printf(
        "[PAIR] streamed context page eventId=%s offset=%u students=%u recorded=%u\n",
        event.eventId.c_str(), static_cast<unsigned>(offset),
        static_cast<unsigned>(pageStudents.size()),
        static_cast<unsigned>(pageRecordedStudentIds.size()));
    const EventContextPageInfo pageInfo = eventContextPageInfoFromJson(response);
    pageStudents.clear();
    pageRecordedStudentIds.clear();
    response.clear();

    if (!pageInfo.hasMore()) {
      if (!storage.finalizePairedEventStudentContext(event.eventId)) {
        error = "Context storage unavailable";
        return false;
      }
      return true;
    }

    const size_t nextOffset =
        pageInfo.nextOffset > static_cast<int>(offset)
            ? static_cast<size_t>(pageInfo.nextOffset)
            : (offset + kPairedEventContextPageSize);
    if (nextOffset <= offset) {
      error = "Paired event context pagination stalled";
      return false;
    }
    offset = nextOffset;
  }

  error = "Paired event context exceeded page limit";
  return false;
}

bool BackendClient::fetchPendingEnrollments(std::vector<StudentInfo> &students,
                                            String &error) {
  if (!ensureSessionForRequest("/campusDevicePendingEnrollments", error)) {
    return false;
  }

  DynamicJsonDocument response(16384);
  if (!requestJson("GET",
                   String("/campusDevicePendingEnrollments?limit=") +
                       String(CampusConfig::kPendingEnrollmentLimit),
                   emptyRequestBody(), response, error)) {
    return false;
  }

  students.clear();
  JsonArray array = response["students"].as<JsonArray>();
  if (array.isNull()) {
    return true;
  }

  for (JsonObjectConst item : array) {
    StudentInfo student = studentFromJson(item);
    if (student.isValid()) {
      students.push_back(student);
    }
  }
  return true;
}

bool BackendClient::submitEnrollment(const StudentInfo &student, String &error) {
  if (!ensureSessionForRequest("/campusDeviceSubmitEnrollment", error)) {
    return false;
  }

  logMemoryStage("before enrollment payload", "/campusDeviceSubmitEnrollment");
  DynamicJsonDocument payload(kSubmitEnrollmentPayloadJsonCapacity);
  if (!ensureDynamicJsonCapacity(payload, kSubmitEnrollmentPayloadJsonCapacity,
                                 "/campusDeviceSubmitEnrollment",
                                 "submitEnrollment payload", error)) {
    return false;
  }
  if (!student.sessionId.isEmpty()) {
    payload["sessionId"] = student.sessionId;
  }
  payload["studentId"] = student.studentUid;
  payload["studentUid"] = student.studentUid;
  payload["schoolId"] = student.schoolId;
  payload["studentName"] = student.studentName;
  payload["course"] = student.course;
  payload["yearLevel"] = student.yearLevel;
  payload["section"] = student.section;
  payload["courseCanonical"] = student.courseCanonical;
  payload["yearLevelCanonical"] = student.yearLevelCanonical;
  payload["sectionCanonical"] = student.sectionCanonical;
  payload["queueId"] = student.queueId;
  payload["status"] = student.enrollmentStatus;
  payload["enrollmentStatus"] = student.enrollmentStatus;
  payload["syncStatus"] = student.syncStatus;
  payload["remarks"] = student.remarks;
  payload["timestampIso"] = student.enrolledAtIso;
  payload["enrolledAtIso"] = student.enrolledAtIso;
  payload["fingerprintTemplateId"] = student.templateId;
  payload["templateId"] = student.templateId;
  payload["fingerprintDeviceId"] = student.fingerprintDeviceId;

  String body;
  reserveJsonBody(payload, body);
  serializeJson(payload, body);
  logMemoryStage("after enrollment payload", "/campusDeviceSubmitEnrollment");

  DynamicJsonDocument response(kSubmitEnrollmentResponseJsonCapacity);
  if (!ensureDynamicJsonCapacity(response, kSubmitEnrollmentResponseJsonCapacity,
                                 "/campusDeviceSubmitEnrollment",
                                 "submitEnrollment response", error)) {
    return false;
  }
  if (!requestJson("POST", "/campusDeviceSubmitEnrollment", body, response,
                   error, true, CampusConfig::kHttpRetryAttempts, 1)) {
    return false;
  }

  String status = String(response["status"] | "");
  status.toLowerCase();
  if (status == "failed") {
    error = String(response["error"] | response["message"] | "");
    if (error.isEmpty()) {
      error = "Enrollment upload failed";
    }
    return false;
  }

  return true;
}

bool BackendClient::downloadFingerprintRoster(StorageManager &storage,
                                              FingerprintRosterStats &stats,
                                              String &error,
                                              const String &validatedSessionId) {
  stats = FingerprintRosterStats{};
  const RequestTarget target = buildRequestTarget(kFingerprintRosterPath);
  lastRequestUrl_ = target.url;
  lastRequestPayloadSize_ = 0;
  lastRequestRecordCount_ = 0;
  lastHttpStatusCode_ = 0;
  lastHttpErrorString_ = "";
  lastResponseBody_ = "";
  lastWifiStatus_ = wifiStatusName(WiFi.status());
  lastLocalIp_ = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
  lastFailureStage_ = "init";
  lastResponsePayloadSize_ = 0;
  lastTlsMemoryPressure_ = false;
  error = "";

  if (WiFi.status() != WL_CONNECTED) {
    lastFailureStage_ = "wifi";
    error = "Wi-Fi not connected";
    return false;
  }

  if (!target.valid) {
    lastFailureStage_ = "config";
    error = "Invalid API base URL";
    return false;
  }

  if (!ensureSessionForRequest(kFingerprintRosterPath, error)) {
    return false;
  }

  Serial.println("[ROSTER] download started");
  logSimpleMemory("before roster download");

  bool sessionRefreshAvailable = true;
  const uint8_t maxAttempts = CampusConfig::kHttpRetryAttempts == 0
                                  ? 1
                                  : CampusConfig::kHttpRetryAttempts;
  for (uint8_t attempt = 1; attempt <= maxAttempts; ++attempt) {
    lastResponseBody_ = "";
    lastResponsePayloadSize_ = 0;
    lastTlsMemoryPressure_ = false;
    lastWifiStatus_ = wifiStatusName(WiFi.status());
    lastLocalIp_ = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";

    auto cleanupRequest = [&](HTTPClient *http, const char *stage) {
      logMemoryStage("before cleanup", kFingerprintRosterPath, attempt, maxAttempts);
      if (http != nullptr) {
        http->end();
      }
      secureClient_.stop();
      delay(5);
      logMemoryStage(stage, kFingerprintRosterPath, attempt, maxAttempts);
    };

    if (WiFi.status() != WL_CONNECTED) {
      lastFailureStage_ = "wifi";
      error = "Wi-Fi not connected";
      return false;
    }

    const uint32_t timeoutSeconds =
        (CampusConfig::kHttpTimeoutMs + 999UL) / 1000UL;
    const char *requestHost = target.host.c_str();
    const char *requestUri = target.uri.c_str();

    logMemoryStage("before secure client", kFingerprintRosterPath, attempt,
                   maxAttempts);
    secureClient_.stop();
    secureClient_.setInsecure();
    secureClient_.setTimeout(timeoutSeconds);
    secureClient_.setHandshakeTimeout(timeoutSeconds);
    logMemoryStage("after secure client", kFingerprintRosterPath, attempt,
                   maxAttempts);

    IPAddress resolvedIp;
    const int dnsResult = WiFi.hostByName(requestHost, resolvedIp);
    lastFailureStage_ = "dns";
    if (dnsResult != 1) {
      lastHttpStatusCode_ = -1;
      lastHttpErrorString_ = "DNS lookup failed";
      error = lastHttpErrorString_;
      return false;
    }

    logMemoryStage("before TLS connect", kFingerprintRosterPath, attempt,
                   maxAttempts);
    warnIfTlsLargestBlockLow(kFingerprintRosterPath, attempt, maxAttempts);
    char tlsErrorBuffer[160] = {0};
    const bool tlsConnected = secureClient_.connect(requestHost, target.port);
    if (!tlsConnected) {
      const int tlsLastError =
          secureClient_.lastError(tlsErrorBuffer, sizeof(tlsErrorBuffer));
      lastFailureStage_ = "tls";
      lastTlsMemoryPressure_ = isTlsMemoryFailure(tlsLastError, tlsErrorBuffer);
      lastHttpStatusCode_ = -1;
      lastHttpErrorString_ = "TLS connect failed";
      error = lastHttpErrorString_;
      cleanupRequest(nullptr, "after TLS cleanup");
      if (shouldRetryRequest(lastHttpStatusCode_, attempt, maxAttempts)) {
        delay(retryDelayMs(attempt, lastTlsMemoryPressure_));
        continue;
      }
      return false;
    }
    logMemoryStage("after TLS connect", kFingerprintRosterPath, attempt,
                   maxAttempts);

    HTTPClient https;
    https.setReuse(false);
    https.useHTTP10(true);

    lastFailureStage_ = "http_begin";
    if (!https.begin(secureClient_, requestHost, target.port, requestUri,
                     target.https)) {
      lastHttpStatusCode_ = -1;
      lastHttpErrorString_ = "HTTP begin failed";
      error = lastHttpErrorString_;
      cleanupRequest(&https, "after HTTP begin cleanup");
      if (shouldRetryRequest(lastHttpStatusCode_, attempt, maxAttempts)) {
        delay(retryDelayMs(attempt, false));
        continue;
      }
      return false;
    }

    https.setTimeout(CampusConfig::kHttpTimeoutMs);
    https.setConnectTimeout(CampusConfig::kHttpTimeoutMs);
    const char *headerKeys[] = {"X-Campus-Roster-Count"};
    https.collectHeaders(headerKeys, 1);

    if (!sessionToken_.isEmpty()) {
      String authHeader;
      authHeader.reserve(sessionToken_.length() + 8U);
      authHeader = "Bearer ";
      authHeader += sessionToken_;
      https.addHeader("Authorization", authHeader);
    } else {
      applyDeviceSecretHeaders(https);
    }

    lastFailureStage_ = "http_send";
    const int statusCode = https.GET();
    lastHttpStatusCode_ = statusCode;
    lastHttpErrorString_ = https.errorToString(statusCode);
    const int responseBytes = https.getSize();
    lastResponsePayloadSize_ = responseBytes > 0 ? static_cast<size_t>(responseBytes)
                                                 : 0U;

    if ((statusCode == 401 || statusCode == 403) && sessionRefreshAvailable) {
      cleanupRequest(&https, "after auth failure cleanup");
      sessionRefreshAvailable = false;
      clearSession();
      if (!ensureSession(error)) {
        return false;
      }
      attempt = 0;
      continue;
    }

    if (statusCode >= 200 && statusCode < 300) {
      WiFiClient *stream = https.getStreamPtr();
      if (stream == nullptr) {
        lastFailureStage_ = "response_read";
        error = "Response stream unavailable";
        cleanupRequest(&https, "after response cleanup");
        return false;
      }

      const unsigned receivedCount =
          static_cast<unsigned>(https.header("X-Campus-Roster-Count").toInt());
      if (receivedCount > 0) {
        Serial.printf("[ROSTER] received count=%u\n", receivedCount);
      }

      lastFailureStage_ = "response_save";
      if (!storage.saveFingerprintRosterToSd(
              *stream, lastResponsePayloadSize_, stats, error)) {
        cleanupRequest(&https, "after response cleanup");
        lastHttpErrorString_ = error;
        Serial.printf("[ROSTER] save failed reason=%s\n", error.c_str());
        return false;
      }

      cleanupRequest(&https, "after response cleanup");
      logSimpleMemory("after roster download");
      if (!storage.markFingerprintRosterValidatedSession(validatedSessionId, stats)) {
        Serial.printf("[ROSTER] validation metadata save failed session=%s\n",
                      validatedSessionId.c_str());
      }
      Serial.printf("[ROSTER] saved count=%u size=%u\n",
                    static_cast<unsigned>(stats.totalRows),
                    static_cast<unsigned>(stats.fileSize));
      lastFailureStage_ = "none";
      return true;
    }

    lastFailureStage_ = statusCode <= 0 ? "http_send" : "response_read";
    captureErrorPreview(https, lastResponseBody_);
    cleanupRequest(&https, "after response cleanup");

    if (shouldRetryRequest(statusCode, attempt, maxAttempts)) {
      delay(retryDelayMs(attempt, false));
      continue;
    }

    if (!parseApiErrorPayload(lastResponseBody_, error)) {
      error = lastResponseBody_.isEmpty()
                  ? ("HTTP " + String(statusCode))
                  : ("HTTP " + String(statusCode) + " " + lastResponseBody_);
    }
    return false;
  }

  if (error.isEmpty()) {
    lastFailureStage_ = "http";
    error = "Roster download failed";
  }
  return false;
}

bool BackendClient::resolveAttendanceOwner(int templateId, const String &eventId,
                                           AttendanceOwnerResolution &result,
                                           String &error) {
  result = AttendanceOwnerResolution{};
  if (!ensureSessionForRequest(kResolveAttendanceOwnerPath, error)) {
    return false;
  }

  DynamicJsonDocument payload(kResolveAttendanceOwnerPayloadJsonCapacity);
  if (!ensureDynamicJsonCapacity(payload,
                                 kResolveAttendanceOwnerPayloadJsonCapacity,
                                 kResolveAttendanceOwnerPath,
                                 "resolveAttendanceOwner payload", error)) {
    return false;
  }
  payload["templateId"] = templateId;
  payload["fingerprintDeviceId"] = CampusConfig::kDeviceId;
  payload["eventId"] = eventId;

  String body;
  reserveJsonBody(payload, body);
  serializeJson(payload, body);

  DynamicJsonDocument response(kResolveAttendanceOwnerResponseJsonCapacity);
  if (!ensureDynamicJsonCapacity(response,
                                 kResolveAttendanceOwnerResponseJsonCapacity,
                                 kResolveAttendanceOwnerPath,
                                 "resolveAttendanceOwner response", error)) {
    return false;
  }
  if (!requestJson("POST", kResolveAttendanceOwnerPath, body, response, error,
                   true, CampusConfig::kHttpRetryAttempts, 1)) {
    return false;
  }

  JsonObject object = response.as<JsonObject>();
  result = attendanceOwnerResolutionFromJson(object);
  return true;
}

bool BackendClient::syncAttendance(const std::vector<AttendanceRecord> &records,
                                   std::vector<SyncItemResult> &results,
                                   String &error) {
  results.clear();
  if (records.empty()) {
    return true;
  }

  if (!ensureSessionForRequest(kAttendanceSyncPath, error)) {
    return false;
  }

  const RequestTarget target = buildRequestTarget(kAttendanceSyncPath);
  for (const auto &record : records) {
    logMemoryStage("before attendance payload", kAttendanceSyncPath);

    String body;
    {
      DynamicJsonDocument payload(kAttendancePayloadJsonCapacity);
      if (!ensureDynamicJsonCapacity(payload, kAttendancePayloadJsonCapacity,
                                     kAttendanceSyncPath,
                                     "attendance payload", error)) {
        SyncItemResult failure;
        failure.recordId = record.recordId;
        failure.status = "failed";
        failure.message = error;
        results.push_back(failure);
        return false;
      }
      JsonArray array = payload.createNestedArray("records");
      JsonObject object = array.createNestedObject();
      object["recordId"] = record.recordId;
      object["eventId"] = record.eventId;
      object["eventTitle"] = record.eventTitle;
      object["eventDate"] = record.eventDate;
      object["scheduledTimeStart"] = record.scheduledTimeStart;
      object["scheduledTimeEnd"] = record.scheduledTimeEnd;
      object["location"] = record.eventLocation;
      object["studentId"] = record.studentUid;
      object["studentUid"] = record.studentUid;
      object["schoolId"] = record.schoolId;
      object["studentName"] = record.studentName;
      object["course"] = record.course;
      object["yearLevel"] = record.yearLevel;
      object["attendanceStatus"] = record.attendanceStatus;
      object["timeInEpoch"] = record.timeInEpoch;
      object["timeInIso"] = record.timeInIso;
      object["timeInSource"] = record.timeInSource;
      object["timeOutEpoch"] = record.timeOutEpoch;
      object["timeOutIso"] = record.timeOutIso;
      object["timeOutSource"] = record.timeOutSource;
      object["attendanceType"] =
          record.hasTimeOut() ? "time-out" : "time-in";
      object["fingerprintTemplateId"] = record.templateId;
      object["deviceId"] = record.deviceId;
      object["timestampEpoch"] = record.capturedAtEpoch;
      object["timestampIso"] = record.capturedAtIso;
      object["timeSource"] = record.timeSource;
      object["source"] = record.source;

      reserveJsonBody(payload, body);
      serializeJson(payload, body);
    }

    logMemoryStage("after attendance payload", kAttendanceSyncPath);
    Serial.printf(
        "[SYNC][ATTEND] pending=%u payloadBytes=%u wifi=%s ip=%s url=%s\n",
        static_cast<unsigned>(records.size()),
        static_cast<unsigned>(body.length()),
        wifiStatusName(WiFi.status()).c_str(),
        WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "-",
        target.url.c_str());

    DynamicJsonDocument response(4096);
    const size_t resultsBefore = results.size();
    if (!requestJson("POST", kAttendanceSyncPath, body, response, error, true,
                     CampusConfig::kHttpRetryAttempts, 1)) {
      SyncItemResult failure;
      failure.recordId = record.recordId;
      failure.status = "failed";
      failure.message = error;
      results.push_back(failure);
      return false;
    }

    JsonArray resultArray = response["results"].as<JsonArray>();
    if (resultArray.isNull()) {
      error = "Attendance sync results missing.";
      SyncItemResult failure;
      failure.recordId = record.recordId;
      failure.status = "failed";
      failure.message = error;
      results.push_back(failure);
      return false;
    }

    for (JsonObjectConst item : resultArray) {
      SyncItemResult result;
      result.recordId = String(item["recordId"] | "");
      result.status = String(item["status"] | "");
      result.message = String(item["message"] | "");
      if (!result.recordId.isEmpty()) {
        results.push_back(result);
      }
    }

    if (!(response["ok"] | false) && results.size() == resultsBefore) {
      error = String(response["error"] | "Attendance sync rejected.");
      SyncItemResult failure;
      failure.recordId = record.recordId;
      failure.status = "failed";
      failure.message = error;
      results.push_back(failure);
      return false;
    }

    Serial.printf("[SYNC][ATTEND] synced=%u resultCount=%u\n",
                  static_cast<unsigned>(response["synced"] | 0),
                  static_cast<unsigned>(results.size()));
  }
  return true;
}

bool BackendClient::fetchCleanupQueue(std::vector<CleanupQueueItem> &items,
                                      String &error) {
  items.clear();
  DynamicJsonDocument response(8192);
  if (!requestJson("GET",
                   String(kCleanupQueuePath) + "?limit=" +
                       String(10),
                   emptyRequestBody(), response, error)) {
    return false;
  }

  JsonArray array = response["items"].as<JsonArray>();
  if (array.isNull()) {
    return true;
  }

  for (JsonObjectConst item : array) {
    CleanupQueueItem cleanupItem;
    cleanupItem.cleanupId = String(item["id"] | item["cleanupId"] | "");
    cleanupItem.type = String(item["type"] | "");
    cleanupItem.templateId = item["templateId"] | -1;
    cleanupItem.studentUid =
        String(item["uid"] | item["studentUid"] | item["studentId"] | "");
    cleanupItem.schoolId = String(item["schoolId"] | "");
    cleanupItem.targetDeviceId = String(item["targetDeviceId"] | "");
    cleanupItem.clearMode = String(item["clearMode"] | "");
    cleanupItem.markEnrollmentSessionRowsStale =
        parseBoolValue(item["markEnrollmentSessionRowsStale"], false);
    cleanupItem.reason = String(item["reason"] | "");

    cleanupItem.cleanupId.trim();
    cleanupItem.type.trim();
    cleanupItem.studentUid.trim();
    cleanupItem.schoolId.trim();
    cleanupItem.targetDeviceId.trim();
    cleanupItem.clearMode.trim();
    cleanupItem.reason.trim();

    if (isClearAs608CleanupType(cleanupItem.type)) {
      cleanupItem.type = "clear_as608_database";
      if (cleanupItem.clearMode.isEmpty()) {
        cleanupItem.clearMode = "full_sensor_and_firebase_after_ack";
      }
    } else if (isDeleteTemplateCleanupType(cleanupItem.type)) {
      cleanupItem.type = "deleteTemplateIfUnused";
    }

    if (cleanupItem.cleanupId.isEmpty() || cleanupItem.type.isEmpty()) {
      Serial.println("[CLEANUP] skipped malformed item missing id/type");
      continue;
    }

    if (!isSupportedCleanupType(cleanupItem.type)) {
      Serial.printf("[CLEANUP] skipped unsupported type=%s cleanupId=%s\n",
                    cleanupItem.type.c_str(), cleanupItem.cleanupId.c_str());
      continue;
    }

    if (!cleanupTargetMatchesLocalDevice(cleanupItem.targetDeviceId)) {
      Serial.printf("[CLEANUP] skipped foreign target cleanupId=%s device=%s\n",
                    cleanupItem.cleanupId.c_str(),
                    cleanupItem.targetDeviceId.c_str());
      continue;
    }

    const bool requiresTemplateId = !isClearAs608CleanupType(cleanupItem.type);
    if (requiresTemplateId && cleanupItem.templateId <= 0) {
      Serial.printf("[CLEANUP] skipped malformed item cleanupId=%s type=%s template=%d\n",
                    cleanupItem.cleanupId.c_str(), cleanupItem.type.c_str(),
                    cleanupItem.templateId);
      continue;
    }

    items.push_back(cleanupItem);
    yield();
  }

  Serial.printf("[CLEANUP] queue code=%d items=%u\n", lastHttpStatusCode_,
                static_cast<unsigned>(items.size()));
  for (const auto &item : items) {
    Serial.printf(
        "[CLEANUP] item type=%s templateId=%d schoolId=%s uid=%s device=%s "
        "clearMode=%s markStale=%s\n",
        item.type.c_str(), item.templateId, item.schoolId.c_str(),
        item.studentUid.c_str(), item.targetDeviceId.c_str(),
        item.clearMode.c_str(),
        item.markEnrollmentSessionRowsStale ? "yes" : "no");
  }

  return true;
}

bool BackendClient::acknowledgeCleanupQueue(
    const std::vector<CleanupQueueResult> &results, String &error) {
  if (results.empty()) {
    return true;
  }

  DynamicJsonDocument payload(kCleanupAckPayloadJsonCapacity);
  if (!ensureDynamicJsonCapacity(payload, kCleanupAckPayloadJsonCapacity,
                                 kCleanupAckPath,
                                 "cleanupAck payload", error)) {
    return false;
  }
  JsonArray array = payload.createNestedArray("results");
  size_t processedIds = 0;
  for (const auto &result : results) {
    if (!result.processed || result.cleanupId.isEmpty()) {
      continue;
    }
    JsonObject entry = array.createNestedObject();
    entry["cleanupId"] = result.cleanupId;
    entry["processed"] = result.processed;
    entry["success"] = result.success;
    entry["message"] = result.message;
    if (!result.error.isEmpty()) {
      entry["error"] = result.error;
    }
    ++processedIds;
  }

  if (processedIds == 0) {
    return true;
  }

  String body;
  reserveJsonBody(payload, body);
  serializeJson(payload, body);

  DynamicJsonDocument response(kCleanupAckResponseJsonCapacity);
  if (!ensureDynamicJsonCapacity(response, kCleanupAckResponseJsonCapacity,
                                 kCleanupAckPath,
                                 "cleanupAck response", error)) {
    return false;
  }
  if (!requestJson("POST", kCleanupAckPath, body, response, error, true,
                   CampusConfig::kHttpRetryAttempts, results.size())) {
    return false;
  }

  const int processed = response["processed"] | 0;
  Serial.printf("[CLEANUP] processed confirmation code=%d processed=%d\n",
                lastHttpStatusCode_, processed);
  return true;
}

void BackendClient::clearSession() {
  sessionToken_ = "";
}

bool BackendClient::ensureSession(String &error) {
  if (!sessionToken_.isEmpty()) {
    return true;
  }
  return requestSession(error);
}

bool BackendClient::ensureSessionForRequest(const char *path, String &error) {
  if (!sessionToken_.isEmpty()) {
    return true;
  }

  logMemoryStage("before ensure session", path);
  const bool ok = ensureSession(error);
  logMemoryStage(ok ? "after ensure session" : "after ensure session failure",
                 path);
  return ok;
}

bool BackendClient::requestSession(String &error) {
  DynamicJsonDocument response(kSessionResponseJsonCapacity);
  if (!ensureDynamicJsonCapacity(response, kSessionResponseJsonCapacity,
                                 kCreateSessionPath,
                                 "session response", error)) {
    return false;
  }
  logMemoryStage("before session payload", kCreateSessionPath);
  const String &body = emptyJsonObjectBody();
  logMemoryStage("after session payload", kCreateSessionPath);
  if (!requestJson("POST", kCreateSessionPath, body, response, error, false,
                   CampusConfig::kHttpRetryAttempts, 0,
                   kSessionResponseMaxBytes, "Session response too large")) {
    return false;
  }

  sessionToken_ = String(response["sessionToken"] | "");
  if (sessionToken_.isEmpty()) {
    error = "Session token missing";
    return false;
  }
  return true;
}

bool BackendClient::parseEnrollmentSession(JsonObjectConst object,
                                           EnrollmentSessionInfo &session,
                                           String &error) {
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
  if (!session.isValid()) {
    error = "Session ID missing";
    return false;
  }
  return true;
}

bool BackendClient::parseEventContextResponse(
    JsonDocument &response, EventInfo &event,
    std::vector<StudentInfo> &students, std::vector<String> &recordedStudentIds,
    String &error) {
  JsonObject eventObject = response["event"];
  if (eventObject.isNull()) {
    error = "Event payload missing";
    return false;
  }

  bool invalidAudienceSummary = false;
  eventFromJson(eventObject, event, &invalidAudienceSummary);
  JsonObject eligibilityObject = response["eligibility"];
  if (!eligibilityObject.isNull()) {
    EventInfo eligibilityEvent;
    bool invalidEligibilitySummary = false;
    eventFromJson(eligibilityObject, eligibilityEvent,
                  &invalidEligibilitySummary);
    invalidAudienceSummary =
        invalidAudienceSummary || invalidEligibilitySummary;
    if (shouldReplaceTargetMode(event.targetMode, eligibilityEvent.targetMode)) {
      event.targetMode = eligibilityEvent.targetMode;
    }
    if (event.targetStudent.isEmpty()) {
      event.targetStudent = eligibilityEvent.targetStudent;
    }
    if (event.courseFilterLabel.isEmpty()) {
      event.courseFilterLabel = eligibilityEvent.courseFilterLabel;
    }
    if (event.yearLevelFilterLabel.isEmpty()) {
      event.yearLevelFilterLabel = eligibilityEvent.yearLevelFilterLabel;
    }
    if (event.sectionFilterLabel.isEmpty()) {
      event.sectionFilterLabel = eligibilityEvent.sectionFilterLabel;
    }
    if (event.bodScope.isEmpty()) {
      event.bodScope = eligibilityEvent.bodScope;
    }
    if (event.bodScopeCanonical.isEmpty()) {
      event.bodScopeCanonical = eligibilityEvent.bodScopeCanonical;
    }
    event.audienceRestricted =
        event.audienceRestricted || eligibilityEvent.audienceRestricted;
    event.rosterRequired = event.rosterRequired || eligibilityEvent.rosterRequired;
    if (event.contextSchemaVersion == 0) {
      event.contextSchemaVersion = eligibilityEvent.contextSchemaVersion;
    }
    appendStringValues(eligibilityObject["courseFilters"], event.courseFilters);
    appendStringValues(eligibilityObject["targetCourses"], event.courseFilters);
    appendStringValues(eligibilityObject["courses"], event.courseFilters);
    appendStringValues(eligibilityObject["yearLevelFilters"],
                       event.yearLevelFilters);
    appendStringValues(eligibilityObject["targetYearLevels"],
                       event.yearLevelFilters);
    appendStringValues(eligibilityObject["yearLevels"], event.yearLevelFilters);
    appendStringValues(eligibilityObject["sectionFilters"], event.sectionFilters);
    appendStringValues(eligibilityObject["targetSections"], event.sectionFilters);
    appendStringValues(eligibilityObject["targetedStudentIds"],
                       event.targetedStudentIds);
    appendStringValues(eligibilityObject["targetedStudents"],
                       event.targetedStudentIds);
    appendStringValues(eligibilityObject["selectedStudentIds"],
                       event.targetedStudentIds);
    appendStringValues(eligibilityObject["targetedSchoolIds"],
                       event.targetedSchoolIds);
    appendStringValues(eligibilityObject["selectedSchoolIds"],
                       event.targetedSchoolIds);
    event.requiresRegistration =
        event.requiresRegistration || eligibilityEvent.requiresRegistration;
    event.preregistrationRequired =
        event.preregistrationRequired || eligibilityEvent.preregistrationRequired;
    event.paymentRequired =
        event.paymentRequired || eligibilityEvent.paymentRequired;
    event.activeOnly = event.activeOnly || eligibilityEvent.activeOnly;
  }
  JsonObject rosterObject = response["roster"];
  if (!rosterObject.isNull()) {
    const String rosterTargetMode =
        String(rosterObject["targetMode"] | rosterObject["targetingMode"] |
               rosterObject["audienceMode"] | "");
    if (shouldReplaceTargetMode(event.targetMode, rosterTargetMode)) {
      event.targetMode = rosterTargetMode;
    }
    if (event.targetStudent.isEmpty()) {
      event.targetStudent = String(rosterObject["targetStudent"] | "");
    }
    if (event.courseFilterLabel.isEmpty()) {
      event.courseFilterLabel = String(rosterObject["courseFilterLabel"] |
                                       rosterObject["courseFilter"] |
                                       rosterObject["targetCourse"] | "");
    }
    if (event.yearLevelFilterLabel.isEmpty()) {
      event.yearLevelFilterLabel =
          String(rosterObject["yearLevelFilterLabel"] |
                 rosterObject["yearLevelFilter"] |
                 rosterObject["targetYearLevel"] | "");
    }
    if (event.sectionFilterLabel.isEmpty()) {
      event.sectionFilterLabel = String(rosterObject["sectionFilterLabel"] |
                                        rosterObject["sectionFilter"] |
                                        rosterObject["targetSection"] | "");
    }
    if (event.bodScope.isEmpty()) {
      event.bodScope = String(rosterObject["bodScope"] |
                              rosterObject["bodScopeFilter"] |
                              rosterObject["organizationScope"] | "");
    }
    event.audienceRestricted =
        event.audienceRestricted ||
        parseBoolValue(rosterObject["audienceRestricted"], false);
    event.rosterRequired = event.rosterRequired ||
                           parseBoolValue(rosterObject["rosterRequired"], false);
    if (event.contextSchemaVersion == 0) {
      event.contextSchemaVersion = rosterObject["contextSchemaVersion"] | 0;
      if (event.contextSchemaVersion == 0) {
        event.contextSchemaVersion =
            rosterObject["pairedEventContextVersion"] | 0;
      }
    }
    appendStringValues(rosterObject["courseFilters"], event.courseFilters);
    appendStringValues(rosterObject["yearLevelFilters"], event.yearLevelFilters);
    appendStringValues(rosterObject["sectionFilters"], event.sectionFilters);
    appendStringValues(rosterObject["targetedStudentIds"], event.targetedStudentIds);
    appendStringValues(rosterObject["targetedStudents"], event.targetedStudentIds);
    appendStringValues(rosterObject["selectedStudentIds"], event.targetedStudentIds);
    appendStringValues(rosterObject["targetedSchoolIds"], event.targetedSchoolIds);
    appendStringValues(rosterObject["selectedSchoolIds"], event.targetedSchoolIds);
  }
  CampusEligibility::normalizeEvent(event);
  if (invalidAudienceSummary) {
    logEventAudienceState("invalid", event, 0, 0);
    error = "Pair data audience invalid; re-pair/sync required";
    return false;
  }
  students.clear();
  recordedStudentIds.clear();

  JsonArray studentArray = response["students"].as<JsonArray>();
  if (studentArray.isNull() && !rosterObject.isNull()) {
    studentArray = rosterObject["students"].as<JsonArray>();
  }
  for (JsonObjectConst item : studentArray) {
    StudentInfo student = studentFromJson(item);
    if (student.isValid()) {
      students.push_back(student);
    }
  }

  JsonArray recordedArray = response["roster"]["recordedStudentIds"].as<JsonArray>();
  for (JsonVariantConst item : recordedArray) {
    const char *rawStudentUid = item.as<const char *>();
    const String studentUid = rawStudentUid != nullptr ? String(rawStudentUid) : String("");
    if (!studentUid.isEmpty()) {
      recordedStudentIds.push_back(studentUid);
    }
  }

  logEventAudienceState("parsed", event, students.size(), recordedStudentIds.size());
  return event.isValid();
}

bool BackendClient::requestJson(const char *method, const String &path,
                                const String &body,
                                JsonDocument &response, String &error,
                                bool allowRetry, uint8_t maxAttempts,
                                size_t recordCount, size_t maxResponseBytes,
                                const char *responseTooLargeError) {
  HttpRequestTimingGuard requestTiming(path, &lastHttpStatusCode_);
  const RequestTarget target = buildRequestTarget(path);
  lastRequestUrl_ = target.url;
  lastRequestPayloadSize_ = body.length();
  lastRequestRecordCount_ = recordCount;
  lastHttpStatusCode_ = 0;
  lastHttpErrorString_ = "";
  lastResponseBody_ = "";
  lastWifiStatus_ = wifiStatusName(WiFi.status());
  lastLocalIp_ = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
  lastFailureStage_ = "init";
  lastResponsePayloadSize_ = 0;
  lastTlsMemoryPressure_ = false;

  if (WiFi.status() != WL_CONNECTED) {
    lastFailureStage_ = "wifi";
    error = "Wi-Fi not connected";
    Serial.printf("[HTTP] wifi=%s ip=%s url=%s payloadBytes=%u records=%u\n",
                  lastWifiStatus_.c_str(),
                  lastLocalIp_.isEmpty() ? "-" : lastLocalIp_.c_str(),
                  lastRequestUrl_.c_str(),
                  static_cast<unsigned>(lastRequestPayloadSize_),
                  static_cast<unsigned>(lastRequestRecordCount_));
    return false;
  }

  if (String(CampusConfig::kApiBaseUrl).indexOf("your-project") >= 0) {
    lastFailureStage_ = "config";
    error = "Set API base URL";
    return false;
  }

  if (!target.valid) {
    lastFailureStage_ = "config";
    error = "Invalid API base URL";
    return false;
  }

  if (maxAttempts == 0) {
    maxAttempts = 1;
  }

  const bool isPairedEventContextRequest = isPairedEventContextRequestPath(path);
  const uint8_t loopAttempts =
      isPairedEventContextRequest && maxAttempts < kPairedEventTlsConnectAttempts
          ? kPairedEventTlsConnectAttempts
          : maxAttempts;
  const bool isSessionRequest = path == kCreateSessionPath;
  const bool isCleanupRequest = path.startsWith(kCleanupQueuePath);
  if (!isSessionRequest && !isCleanupRequest && !ensureSession(error)) {
    return false;
  }

  response.clear();
  bool sessionRefreshAvailable = allowRetry;
  for (uint8_t attempt = 1; attempt <= loopAttempts; ++attempt) {
    lastResponseBody_ = "";
    lastResponsePayloadSize_ = 0;
    lastTlsMemoryPressure_ = false;
    lastWifiStatus_ = wifiStatusName(WiFi.status());
    lastLocalIp_ = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
    const char *requestHost = target.host.c_str();
    const char *requestUri = target.uri.c_str();
    const uint32_t timeoutSeconds =
        (CampusConfig::kHttpTimeoutMs + 999UL) / 1000UL;

    auto cleanupRequest = [&](HTTPClient *http, const char *stage) {
      logMemoryStage("before cleanup", path, attempt, loopAttempts);
      if (http != nullptr) {
        http->end();
      }
      forceCloseSecureClient(secureClient_);
      logMemoryStage(stage, path, attempt, loopAttempts);
      if (isPairedEventContextRequest) {
        Serial.println("[HTTP] cleanup done");
        logCompactMemory("after paired event cleanup");
      }
    };

    if (WiFi.status() != WL_CONNECTED) {
      lastFailureStage_ = "wifi";
      error = "Wi-Fi not connected";
      return false;
    }

    // TODO: Replace setInsecure() with the production root CA certificate.
    const bool insecureTls = true;
    const bool caCertConfigured = false;
    logMemoryStage("before secure client", path, attempt, loopAttempts);
    if (isPairedEventContextRequest) {
      Serial.println("[HTTP] endpoint=campusDevicePairedEventContext");
      Serial.printf("[HTTP] host=%s\n", requestHost);
      Serial.printf("[HTTP] attempt=%u\n", static_cast<unsigned>(attempt));
      Serial.printf("[HTTP] tlsMode=%s\n", insecureTls ? "insecure" : "caCert");
      logCompactMemory("before paired event TLS");
    }
    forceCloseSecureClient(secureClient_);
    secureClient_.setInsecure();
    secureClient_.setTimeout(timeoutSeconds);
    secureClient_.setHandshakeTimeout(timeoutSeconds);
    logMemoryStage("after secure client", path, attempt, loopAttempts);

    IPAddress resolvedIp;
    const int dnsResult = WiFi.hostByName(requestHost, resolvedIp);
    lastFailureStage_ = "dns";
    Serial.printf(
        "[HTTP] dns host=%s result=%d resolved=%s\n", requestHost,
        dnsResult, dnsResult == 1 ? resolvedIp.toString().c_str() : "-");
    Serial.printf("[HTTP] tlsMode=insecure setInsecure=%s caCert=%s\n",
                  insecureTls ? "yes" : "no",
                  caCertConfigured ? "yes" : "no");
    if (caCertConfigured) {
      Serial.println("[BUG] CA cert still enabled during insecure test");
    }
    logMemoryStage("before TLS connect", path, attempt, loopAttempts);
    warnIfTlsLargestBlockLow(path, attempt, loopAttempts);

    char tlsErrorBuffer[160] = {0};
    const bool tlsConnected = secureClient_.connect(requestHost, target.port);
    if (!tlsConnected) {
      const int tlsLastError =
          secureClient_.lastError(tlsErrorBuffer, sizeof(tlsErrorBuffer));
      const bool dnsFailure = dnsResult != 1;
      lastFailureStage_ = dnsFailure ? "dns" : "tls";
      lastTlsMemoryPressure_ = isTlsMemoryFailure(tlsLastError, tlsErrorBuffer);
      lastHttpStatusCode_ = -1;
      lastHttpErrorString_ =
          String("TLS connect failed");
      if (tlsLastError != 0) {
        lastHttpErrorString_ += " (" + String(tlsLastError) + ")";
      }
      if (tlsErrorBuffer[0] != '\0') {
        lastHttpErrorString_ += " ";
        lastHttpErrorString_ += tlsErrorBuffer;
      }
      error = lastHttpErrorString_;
      Serial.printf("[HTTP] tls host=%s port=%u connected=no lastError=%d detail=%s\n",
                    requestHost, static_cast<unsigned>(target.port),
                    tlsLastError,
                    tlsErrorBuffer[0] != '\0' ? tlsErrorBuffer : "-");
      if (isPairedEventContextRequest) {
        Serial.printf("[HTTP] tls failed code=%d message=%s\n", tlsLastError,
                      lastHttpErrorString_.c_str());
      }
      Serial.printf("[HTTP] tlsMemoryPressure=%s retryBackoffMs=%lu\n",
                    lastTlsMemoryPressure_ ? "yes" : "no",
                    static_cast<unsigned long>(
                        retryDelayMs(attempt, lastTlsMemoryPressure_)));
      logMemoryStage("after TLS failure", path, attempt, loopAttempts);
      cleanupRequest(nullptr, "after TLS cleanup");
      if (isPairedEventContextRequest && attempt < loopAttempts) {
        Serial.println("[HTTP] retrying after TLS failure");
        delay(retryDelayMs(attempt, lastTlsMemoryPressure_));
        continue;
      }
      if (shouldRetryRequest(lastHttpStatusCode_, attempt, maxAttempts)) {
        delay(retryDelayMs(attempt, lastTlsMemoryPressure_));
        continue;
      }
      return false;
    }
    Serial.printf("[HTTP] tls host=%s port=%u connected=yes\n",
                  requestHost, static_cast<unsigned>(target.port));
    logMemoryStage("after TLS connect", path, attempt, loopAttempts);

    logMemoryStage("before HTTP client", path, attempt, loopAttempts);
    HTTPClient https;
    https.setReuse(false);
    https.useHTTP10(true);
    logMemoryStage("after HTTP client", path, attempt, loopAttempts);

    lastFailureStage_ = "http_begin";
    if (!https.begin(secureClient_, requestHost, target.port, requestUri,
                      target.https)) {
      lastHttpStatusCode_ = -1;
      lastHttpErrorString_ = "HTTP begin failed";
      error = "HTTP begin failed";
      Serial.printf(
          "[HTTP] attempt=%u/%u method=%s wifi=%s ip=%s host=%s port=%u uri=%s "
          "payloadBytes=%u records=%u code=%d err=%s\n",
          static_cast<unsigned>(attempt), static_cast<unsigned>(loopAttempts),
          method, lastWifiStatus_.c_str(),
          lastLocalIp_.isEmpty() ? "-" : lastLocalIp_.c_str(),
          requestHost, static_cast<unsigned>(target.port), requestUri,
          static_cast<unsigned>(lastRequestPayloadSize_),
          static_cast<unsigned>(lastRequestRecordCount_), lastHttpStatusCode_,
          lastHttpErrorString_.c_str());
      cleanupRequest(&https, "after HTTP begin cleanup");
      if (shouldRetryRequest(lastHttpStatusCode_, attempt, maxAttempts)) {
        delay(retryDelayMs(attempt, false));
        continue;
      }
      return false;
    }

    https.setTimeout(CampusConfig::kHttpTimeoutMs);
    https.setConnectTimeout(CampusConfig::kHttpTimeoutMs);
    https.addHeader("Content-Type", "application/json");

    if (isSessionRequest || isCleanupRequest) {
      applyDeviceSecretHeaders(https);
    } else if (!sessionToken_.isEmpty()) {
      String authHeader;
      authHeader.reserve(sessionToken_.length() + 8U);
      authHeader = "Bearer ";
      authHeader += sessionToken_;
      https.addHeader("Authorization", authHeader);
    } else {
      applyDeviceSecretHeaders(https);
    }

    int statusCode = -1;
    lastFailureStage_ = "http_send";
    if (strcmp(method, "GET") == 0) {
      statusCode = https.GET();
    } else if (strcmp(method, "POST") == 0) {
      statusCode = https.POST(body.isEmpty() ? emptyJsonObjectBody() : body);
    } else {
      lastFailureStage_ = "http_method";
      error = "HTTP method unsupported";
      cleanupRequest(&https, "after method cleanup");
      return false;
    }

    lastHttpStatusCode_ = statusCode;
    lastHttpErrorString_ = https.errorToString(statusCode);
    const int responseBytes = https.getSize();
    lastResponsePayloadSize_ = responseBytes > 0 ? static_cast<size_t>(responseBytes)
                                                 : 0U;
    logMemoryStage("after HTTP send", path, attempt, loopAttempts);

    Serial.printf(
        "[HTTP] attempt=%u/%u method=%s wifi=%s ip=%s host=%s port=%u uri=%s "
        "payloadBytes=%u records=%u code=%d err=%s responseBytes=%d\n",
        static_cast<unsigned>(attempt), static_cast<unsigned>(loopAttempts),
        method, lastWifiStatus_.c_str(),
        lastLocalIp_.isEmpty() ? "-" : lastLocalIp_.c_str(),
        requestHost, static_cast<unsigned>(target.port),
        requestUri, static_cast<unsigned>(lastRequestPayloadSize_),
        static_cast<unsigned>(lastRequestRecordCount_), statusCode,
        lastHttpErrorString_.c_str(), responseBytes);

    if ((statusCode == 401 || statusCode == 403) && !isSessionRequest &&
        sessionRefreshAvailable) {
      captureErrorPreview(https, lastResponseBody_);
      cleanupRequest(&https, "after auth failure cleanup");
      sessionRefreshAvailable = false;
      clearSession();
      if (!ensureSession(error)) {
        return false;
      }
      attempt = 0;
      continue;
    }

    if (statusCode >= 200 && statusCode < 300) {
      if (statusCode == 204 || statusCode == 205 || responseBytes == 0) {
        cleanupRequest(&https, "after response cleanup");
        response.to<JsonObject>();
        lastFailureStage_ = "none";
        return true;
      }

      WiFiClient *stream = https.getStreamPtr();
      if (stream == nullptr) {
        lastFailureStage_ = "response_read";
        error = "Response stream unavailable";
        cleanupRequest(&https, "after response cleanup");
        return false;
      }

      if (maxResponseBytes > 0 && responseBytes > 0 &&
          static_cast<size_t>(responseBytes) > maxResponseBytes) {
        lastFailureStage_ = "response_too_large";
        error =
            (responseTooLargeError != nullptr && responseTooLargeError[0] != '\0')
                ? String(responseTooLargeError)
                : String("Response too large");
        lastHttpErrorString_ = error + " bytes=" + String(responseBytes) +
                               " limit=" + String(maxResponseBytes);
        Serial.printf("[HTTP] response too large path=%s bytes=%d limit=%u\n",
                      path.c_str(), responseBytes,
                      static_cast<unsigned>(maxResponseBytes));
        cleanupRequest(&https, "after response cleanup");
        return false;
      }

      lastFailureStage_ = "response_parse";
      logMemoryStage("before response parse", path, attempt, loopAttempts);
      DeserializationError jsonError = DeserializationError::Ok;
      String sessionResponseBody;
      if (isSessionRequest) {
        if (!readResponseBody(https, sessionResponseBody,
                              kSessionResponseMaxBytes + 1U)) {
          lastFailureStage_ = "response_read";
          error = "Response stream unavailable";
          cleanupRequest(&https, "after response cleanup");
          return false;
        }
        if (sessionResponseBody.length() > kSessionResponseMaxBytes) {
          lastFailureStage_ = "response_too_large";
          error = "Session response too large";
          error += " bytes=";
          error += String(sessionResponseBody.length());
          error += " limit=";
          error += String(kSessionResponseMaxBytes);
          lastHttpErrorString_ = error;
          lastResponseBody_ = redactedJsonPreview(sessionResponseBody);
          Serial.printf(
              "[HTTP][JSON] parseBlocked path=%s reason=response_too_large "
              "rawBytes=%u cap=%u preview=%s\n",
              path.c_str(),
              static_cast<unsigned>(sessionResponseBody.length()),
              static_cast<unsigned>(response.capacity()),
              lastResponseBody_.c_str());
          cleanupRequest(&https, "after response cleanup");
          return false;
        }
        lastResponsePayloadSize_ = sessionResponseBody.length();
        jsonError = deserializeJson(response, sessionResponseBody);
      } else {
        jsonError = deserializeJson(response, *stream);
      }
      logMemoryStage("after response parse", path, attempt, loopAttempts);
      cleanupRequest(&https, "after response cleanup");
      if (jsonError) {
        if (jsonError == DeserializationError::EmptyInput) {
          response.to<JsonObject>();
          lastFailureStage_ = "none";
          return true;
        }
        error = "JSON parse failed: ";
        error += jsonError.c_str();
        if (jsonError == DeserializationError::NoMemory) {
          lastFailureStage_ = "response_too_large";
          error += " cap=";
          error += String(response.capacity());
          if (responseBytes > 0) {
            error += " bytes=";
            error += String(responseBytes);
          }
        }
        lastHttpErrorString_ = error;
        if (isSessionRequest) {
          const String redactedPreview = redactedJsonPreview(sessionResponseBody);
          lastResponseBody_ = redactedPreview;
          const size_t rawLength = sessionResponseBody.length();
          Serial.printf(
              "[HTTP][JSON] parseFailed path=%s rawBytes=%u cap=%u "
              "errorCode=%d error=%s preview=%s\n",
              path.c_str(), static_cast<unsigned>(rawLength),
              static_cast<unsigned>(response.capacity()),
              static_cast<int>(jsonError.code()), jsonError.c_str(),
              redactedPreview.c_str());
        }
        return false;
      }
      if (isSessionRequest) {
        lastResponseBody_ = "";
      }
      lastFailureStage_ = "none";
      return true;
    }

    lastFailureStage_ = statusCode <= 0 ? "http_send" : "response_read";
    captureErrorPreview(https, lastResponseBody_);
    if (lastResponsePayloadSize_ == 0 && !lastResponseBody_.isEmpty()) {
      lastResponsePayloadSize_ = lastResponseBody_.length();
    }
    if (!lastResponseBody_.isEmpty()) {
      Serial.printf("[HTTP] responsePreview=%s\n", lastResponseBody_.c_str());
    }
    cleanupRequest(&https, "after response cleanup");

    if (shouldRetryRequest(statusCode, attempt, maxAttempts)) {
      delay(retryDelayMs(attempt, false));
      continue;
    }

    if (!parseApiErrorPayload(lastResponseBody_, error)) {
      if (statusCode <= 0) {
        error = "HTTPS " + String(statusCode) + " " + lastHttpErrorString_;
      } else {
        error = lastResponseBody_.isEmpty()
                    ? ("HTTP " + String(statusCode))
                    : ("HTTP " + String(statusCode) + " " + lastResponseBody_);
      }
    }
    return false;
  }

  if (error.isEmpty()) {
    lastFailureStage_ = "http";
    error = "HTTP request failed";
  }
  return false;
}

int BackendClient::lastHttpStatusCode() const {
  return lastHttpStatusCode_;
}

const String &BackendClient::lastHttpErrorString() const {
  return lastHttpErrorString_;
}

const String &BackendClient::lastResponseBody() const {
  return lastResponseBody_;
}

const String &BackendClient::lastRequestUrl() const {
  return lastRequestUrl_;
}

const String &BackendClient::lastWifiStatus() const {
  return lastWifiStatus_;
}

const String &BackendClient::lastLocalIp() const {
  return lastLocalIp_;
}

const String &BackendClient::lastFailureStage() const {
  return lastFailureStage_;
}

size_t BackendClient::lastRequestPayloadSize() const {
  return lastRequestPayloadSize_;
}

size_t BackendClient::lastRequestRecordCount() const {
  return lastRequestRecordCount_;
}

size_t BackendClient::lastResponsePayloadSize() const {
  return lastResponsePayloadSize_;
}

bool BackendClient::lastTlsMemoryPressure() const {
  return lastTlsMemoryPressure_;
}
