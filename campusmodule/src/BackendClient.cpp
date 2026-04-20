#include "BackendClient.h"

#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <CampusEligibility.h>

#include "Config.h"

namespace {
constexpr char kCreateSessionPath[] = "/campusDeviceCreateSession";
constexpr char kAttendanceSyncPath[] = "/campusDeviceSyncAttendance";
constexpr char kCleanupQueuePath[] = "/campusDeviceCleanupQueue";
constexpr char kCleanupAckPath[] = "/campusDeviceCleanupQueue";
constexpr int kTlsAllocErrorCode = -10368;
constexpr size_t kErrorPreviewBytes = 768;
constexpr size_t kCommandPayloadJsonCapacity = 256;
constexpr size_t kPairEnrollmentResponseJsonCapacity = 4096;
constexpr size_t kSubmitEnrollmentPayloadJsonCapacity = 1024;
constexpr size_t kSubmitEnrollmentResponseJsonCapacity = 1024;
constexpr size_t kAttendancePayloadJsonCapacity = 2048;
constexpr size_t kCleanupAckPayloadJsonCapacity = 2048;
constexpr size_t kCleanupAckResponseJsonCapacity = 1024;
constexpr size_t kSessionResponseJsonCapacity = 512;
constexpr uint32_t kTlsLargestFreeBlockWarningBytes = 24U * 1024U;

struct RequestTarget {
  String url;
  String host;
  String uri;
  uint16_t port = 443;
  bool https = true;
  bool valid = false;
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

void applyDeviceSecretHeaders(HTTPClient &http) {
  http.addHeader("X-Campus-Device-Id", CampusConfig::kDeviceId);
  http.addHeader("X-Campus-Device-Secret", CampusConfig::kDeviceSecret);
  http.addHeader("X-Device-Id", CampusConfig::kDeviceId);
  http.addHeader("X-Device-Secret", CampusConfig::kDeviceSecret);
}

void eventFromJson(JsonObjectConst object, EventInfo &event) {
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
  event.targetMode = String(object["targetMode"] | object["targetingMode"] |
                            object["audienceMode"] | "");
  if (event.targetMode.isEmpty() && !object["targetSpecificStudents"].isNull()) {
    event.targetMode =
        parseBoolValue(object["targetSpecificStudents"], false) ? "specificStudents"
                                                                : "broad";
  } else if (event.targetMode.isEmpty() &&
             !object["specificStudentsOnly"].isNull()) {
    event.targetMode =
        parseBoolValue(object["specificStudentsOnly"], false) ? "specificStudents"
                                                              : "broad";
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

  DynamicJsonDocument response(32768);
  logMemoryStage("after pairEvent response", "/campusDevicePairEvent");
  if (!requestJson("POST", "/campusDevicePairEvent", body, response, error)) {
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

bool BackendClient::fetchPairedEventContext(
    EventInfo &event, std::vector<StudentInfo> &students,
    std::vector<String> &recordedStudentIds, String &error) {
  if (!ensureSessionForRequest("/campusDevicePairedEventContext", error)) {
    return false;
  }

  DynamicJsonDocument response(32768);
  if (!requestJson("GET", "/campusDevicePairedEventContext", emptyRequestBody(), response,
                   error)) {
    return false;
  }

  return parseEventContextResponse(response, event, students, recordedStudentIds,
                                   error);
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
  payload["syncStatus"] = student.syncStatus;
  payload["remarks"] = student.remarks;
  payload["timestampIso"] = student.enrolledAtIso;
  payload["fingerprintTemplateId"] = student.templateId;

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
  return requestJson("POST", "/campusDeviceSubmitEnrollment", body, response,
                     error, true, CampusConfig::kHttpRetryAttempts, 1);
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
    cleanupItem.reason = String(item["reason"] | "");
    if (!cleanupItem.cleanupId.isEmpty() && cleanupItem.templateId > 0 &&
        !cleanupItem.type.isEmpty()) {
      items.push_back(cleanupItem);
    }
  }

  Serial.printf("[CLEANUP] queue code=%d items=%u\n", lastHttpStatusCode_,
                static_cast<unsigned>(items.size()));
  for (const auto &item : items) {
    Serial.printf("[CLEANUP] item type=%s templateId=%d schoolId=%s uid=%s\n",
                  item.type.c_str(), item.templateId, item.schoolId.c_str(),
                  item.studentUid.c_str());
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
  JsonArray array = payload.createNestedArray("processedIds");
  size_t processedIds = 0;
  for (const auto &result : results) {
    if (!result.processed || result.cleanupId.isEmpty()) {
      continue;
    }
    array.add(result.cleanupId);
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
                   CampusConfig::kHttpRetryAttempts)) {
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

  eventFromJson(eventObject, event);
  JsonObject rosterObject = response["roster"];
  if (!rosterObject.isNull()) {
    if (event.targetMode.isEmpty()) {
      event.targetMode =
          String(rosterObject["targetMode"] | rosterObject["targetingMode"] | "");
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
    appendStringValues(rosterObject["courseFilters"], event.courseFilters);
    appendStringValues(rosterObject["yearLevelFilters"], event.yearLevelFilters);
    appendStringValues(rosterObject["sectionFilters"], event.sectionFilters);
    appendStringValues(rosterObject["targetedStudentIds"], event.targetedStudentIds);
    appendStringValues(rosterObject["targetedStudents"], event.targetedStudentIds);
  }
  CampusEligibility::normalizeEvent(event);
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

  return event.isValid();
}

bool BackendClient::requestJson(const char *method, const String &path,
                                const String &body,
                                JsonDocument &response, String &error,
                                bool allowRetry, uint8_t maxAttempts,
                                size_t recordCount) {
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

  const bool isSessionRequest = path == kCreateSessionPath;
  const bool isCleanupRequest = path.startsWith(kCleanupQueuePath);
  if (!isSessionRequest && !isCleanupRequest && !ensureSession(error)) {
    return false;
  }

  response.clear();
  bool sessionRefreshAvailable = allowRetry;
  for (uint8_t attempt = 1; attempt <= maxAttempts; ++attempt) {
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
      logMemoryStage("before cleanup", path, attempt, maxAttempts);
      if (http != nullptr) {
        http->end();
      }
      secureClient_.stop();
      delay(5);
      logMemoryStage(stage, path, attempt, maxAttempts);
    };

    if (WiFi.status() != WL_CONNECTED) {
      lastFailureStage_ = "wifi";
      error = "Wi-Fi not connected";
      return false;
    }

    // TODO: Replace setInsecure() with the production root CA certificate.
    const bool insecureTls = true;
    const bool caCertConfigured = false;
    logMemoryStage("before secure client", path, attempt, maxAttempts);
    secureClient_.stop();
    secureClient_.setInsecure();
    secureClient_.setTimeout(timeoutSeconds);
    secureClient_.setHandshakeTimeout(timeoutSeconds);
    logMemoryStage("after secure client", path, attempt, maxAttempts);

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
    logMemoryStage("before TLS connect", path, attempt, maxAttempts);
    warnIfTlsLargestBlockLow(path, attempt, maxAttempts);

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
      Serial.printf("[HTTP] tlsMemoryPressure=%s retryBackoffMs=%lu\n",
                    lastTlsMemoryPressure_ ? "yes" : "no",
                    static_cast<unsigned long>(
                        retryDelayMs(attempt, lastTlsMemoryPressure_)));
      logMemoryStage("after TLS failure", path, attempt, maxAttempts);
      cleanupRequest(nullptr, "after TLS cleanup");
      if (shouldRetryRequest(lastHttpStatusCode_, attempt, maxAttempts)) {
        delay(retryDelayMs(attempt, lastTlsMemoryPressure_));
        continue;
      }
      return false;
    }
    Serial.printf("[HTTP] tls host=%s port=%u connected=yes\n",
                  requestHost, static_cast<unsigned>(target.port));
    logMemoryStage("after TLS connect", path, attempt, maxAttempts);

    logMemoryStage("before HTTP client", path, attempt, maxAttempts);
    HTTPClient https;
    https.setReuse(false);
    https.useHTTP10(true);
    logMemoryStage("after HTTP client", path, attempt, maxAttempts);

    lastFailureStage_ = "http_begin";
    if (!https.begin(secureClient_, requestHost, target.port, requestUri,
                      target.https)) {
      lastHttpStatusCode_ = -1;
      lastHttpErrorString_ = "HTTP begin failed";
      error = "HTTP begin failed";
      Serial.printf(
          "[HTTP] attempt=%u/%u method=%s wifi=%s ip=%s host=%s port=%u uri=%s "
          "payloadBytes=%u records=%u code=%d err=%s\n",
          static_cast<unsigned>(attempt), static_cast<unsigned>(maxAttempts),
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
    logMemoryStage("after HTTP send", path, attempt, maxAttempts);

    Serial.printf(
        "[HTTP] attempt=%u/%u method=%s wifi=%s ip=%s host=%s port=%u uri=%s "
        "payloadBytes=%u records=%u code=%d err=%s responseBytes=%d\n",
        static_cast<unsigned>(attempt), static_cast<unsigned>(maxAttempts),
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

      lastFailureStage_ = "response_parse";
      logMemoryStage("before response parse", path, attempt, maxAttempts);
      const DeserializationError jsonError = deserializeJson(response, *stream);
      logMemoryStage("after response parse", path, attempt, maxAttempts);
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
        return false;
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
