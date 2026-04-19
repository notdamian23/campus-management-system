#include "BackendClient.h"

#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_heap_caps.h>

#include <memory>

#include "Config.h"

namespace {
constexpr char kCreateSessionPath[] = "/campusDeviceCreateSession";
constexpr char kAttendanceSyncPath[] = "/campusDeviceSyncAttendance";
constexpr char kCleanupQueuePath[] = "/campusDeviceCleanupQueue";
constexpr char kCleanupAckPath[] = "/campusDeviceAcknowledgeCleanupQueue";

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
  event.requiresRegistration = object["requiresRegistration"] | false;
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
}

StudentInfo studentFromJson(JsonObjectConst object) {
  StudentInfo student;
  student.studentUid =
      String(object["studentId"] | object["studentUid"] | object["uid"] | "");
  student.schoolId = String(object["schoolId"] | "");
  student.studentName = String(object["studentName"] | object["name"] | "");
  student.course = String(object["course"] | "");
  student.yearLevel = String(object["yearLevel"] | object["year"] | "");
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
  student.enrollmentSynced = student.syncStatus == "synced";
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

void logMemoryStage(const char *stage) {
  Serial.printf(
      "[MEM] stage=%s free=%u largest=%u min=%u\n", stage,
      static_cast<unsigned>(ESP.getFreeHeap()),
      static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)),
      static_cast<unsigned>(ESP.getMinFreeHeap()));
}
}  // namespace

bool BackendClient::fetchAvailableEvents(std::vector<EventInfo> &events,
                                         String &error) {
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
  DynamicJsonDocument payload(256);
  payload["sessionId"] = sessionId;

  String body;
  serializeJson(payload, body);

  DynamicJsonDocument response(4096);
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
  DynamicJsonDocument payload(256);
  payload["sessionId"] = sessionId;

  String body;
  serializeJson(payload, body);

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
  DynamicJsonDocument payload(256);
  payload["eventId"] = eventId;

  String body;
  serializeJson(payload, body);

  DynamicJsonDocument response(32768);
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
  if (!ensureSession(error)) {
    return false;
  }

  DynamicJsonDocument payload(1024);
  if (!student.sessionId.isEmpty()) {
    payload["sessionId"] = student.sessionId;
  }
  payload["studentId"] = student.studentUid;
  payload["schoolId"] = student.schoolId;
  payload["studentName"] = student.studentName;
  payload["course"] = student.course;
  payload["yearLevel"] = student.yearLevel;
  payload["queueId"] = student.queueId;
  payload["status"] = student.enrollmentStatus;
  payload["syncStatus"] = student.syncStatus;
  payload["remarks"] = student.remarks;
  payload["timestampIso"] = student.enrolledAtIso;
  payload["fingerprintTemplateId"] = student.templateId;

  String body;
  serializeJson(payload, body);

  DynamicJsonDocument response(1024);
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

  if (!ensureSession(error)) {
    return false;
  }

  const RequestTarget target = buildRequestTarget(kAttendanceSyncPath);
  for (const auto &record : records) {
    logMemoryStage("before building payload");

    String body;
    {
      DynamicJsonDocument payload(2048);
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

      body.reserve(1024);
      serializeJson(payload, body);
    }

    logMemoryStage("after building payload");
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
  if (!ensureSession(error)) {
    return false;
  }

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
    cleanupItem.cleanupId = String(item["cleanupId"] | "");
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

  return true;
}

bool BackendClient::acknowledgeCleanupQueue(
    const std::vector<CleanupQueueResult> &results, String &error) {
  if (results.empty()) {
    return true;
  }

  if (!ensureSession(error)) {
    return false;
  }

  DynamicJsonDocument payload(2048);
  JsonArray array = payload.createNestedArray("results");
  for (const auto &result : results) {
    JsonObject object = array.createNestedObject();
    object["cleanupId"] = result.cleanupId;
    object["processed"] = result.processed;
    object["message"] = result.message;
  }

  String body;
  serializeJson(payload, body);

  DynamicJsonDocument response(1024);
  return requestJson("POST", kCleanupAckPath, body, response, error, true,
                     CampusConfig::kHttpRetryAttempts, results.size());
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

bool BackendClient::requestSession(String &error) {
  DynamicJsonDocument response(2048);
  logMemoryStage("before building payload");
  const String &body = emptyJsonObjectBody();
  logMemoryStage("after building payload");
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
    DynamicJsonDocument &response, EventInfo &event,
    std::vector<StudentInfo> &students, std::vector<String> &recordedStudentIds,
    String &error) {
  JsonObject eventObject = response["event"];
  if (eventObject.isNull()) {
    error = "Event payload missing";
    return false;
  }

  eventFromJson(eventObject, event);
  students.clear();
  recordedStudentIds.clear();

  JsonArray studentArray = response["students"].as<JsonArray>();
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
                                DynamicJsonDocument &response, String &error,
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

  if (WiFi.status() != WL_CONNECTED) {
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
    error = "Set API base URL";
    return false;
  }

  if (!target.valid) {
    error = "Invalid API base URL";
    return false;
  }

  if (maxAttempts == 0) {
    maxAttempts = 1;
  }

  const bool isSessionRequest = path == kCreateSessionPath;
  if (!isSessionRequest && !ensureSession(error)) {
    return false;
  }

  response.clear();
  bool sessionRefreshAvailable = allowRetry;
  for (uint8_t attempt = 1; attempt <= maxAttempts; ++attempt) {
    lastWifiStatus_ = wifiStatusName(WiFi.status());
    lastLocalIp_ = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
    const char *requestHost = target.host.c_str();
    const char *requestUri = target.uri.c_str();

    if (WiFi.status() != WL_CONNECTED) {
      error = "Wi-Fi not connected";
      return false;
    }

    auto client = std::make_unique<WiFiClientSecure>();
    if (client == nullptr) {
      error = "TLS client alloc failed";
      return false;
    }

    // TODO: Replace setInsecure() with the production root CA certificate.
    const bool insecureTls = true;
    const bool caCertConfigured = false;
    client->setInsecure();
    client->setTimeout(CampusConfig::kHttpTimeoutMs);

    IPAddress resolvedIp;
    const int dnsResult = WiFi.hostByName(requestHost, resolvedIp);
    Serial.printf(
        "[HTTP] dns host=%s result=%d resolved=%s\n", requestHost,
        dnsResult, dnsResult == 1 ? resolvedIp.toString().c_str() : "-");
    Serial.printf("[HTTP] tlsMode=insecure setInsecure=%s caCert=%s\n",
                  insecureTls ? "yes" : "no",
                  caCertConfigured ? "yes" : "no");
    if (caCertConfigured) {
      Serial.println("[BUG] CA cert still enabled during insecure test");
    }
    logMemoryStage("before TLS connect");

    char tlsErrorBuffer[160] = {0};
    const bool tlsConnected = client->connect(requestHost, target.port);
    if (!tlsConnected) {
      const int tlsLastError =
          client->lastError(tlsErrorBuffer, sizeof(tlsErrorBuffer));
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
      logMemoryStage("after TLS connect failure");
      client->stop();
      if (shouldRetryRequest(lastHttpStatusCode_, attempt, maxAttempts)) {
        delay(250UL * attempt);
        continue;
      }
      return false;
    }
    Serial.printf("[HTTP] tls host=%s port=%u connected=yes\n",
                  requestHost, static_cast<unsigned>(target.port));
    logMemoryStage("after TLS connect success");

    auto https = std::make_unique<HTTPClient>();
    if (https == nullptr) {
      client->stop();
      error = "HTTP client alloc failed";
      return false;
    }

    if (!https->begin(*client, requestHost, target.port, requestUri,
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
      client->stop();
      if (shouldRetryRequest(lastHttpStatusCode_, attempt, maxAttempts)) {
        delay(250UL * attempt);
        continue;
      }
      return false;
    }

    https->setTimeout(CampusConfig::kHttpTimeoutMs);
    https->setConnectTimeout(CampusConfig::kHttpTimeoutMs);
    https->addHeader("Content-Type", "application/json");

    if (isSessionRequest) {
      applyDeviceSecretHeaders(*https);
    } else if (!sessionToken_.isEmpty()) {
      https->addHeader("Authorization", "Bearer " + sessionToken_);
    } else {
      applyDeviceSecretHeaders(*https);
    }

    int statusCode = -1;
    if (String(method) == "GET") {
      statusCode = https->GET();
    } else if (String(method) == "POST") {
      statusCode = https->POST(body.isEmpty() ? emptyJsonObjectBody() : body);
    } else {
      error = "HTTP method unsupported";
      https->end();
      client->stop();
      return false;
    }

    String payload = "";
    if (statusCode > 0) {
      payload = https->getString();
    }

    lastHttpStatusCode_ = statusCode;
    lastHttpErrorString_ = https->errorToString(statusCode);
    lastResponseBody_ = payload;

    Serial.printf(
        "[HTTP] attempt=%u/%u method=%s wifi=%s ip=%s host=%s port=%u uri=%s "
        "payloadBytes=%u records=%u code=%d err=%s\n",
        static_cast<unsigned>(attempt), static_cast<unsigned>(maxAttempts),
        method, lastWifiStatus_.c_str(),
        lastLocalIp_.isEmpty() ? "-" : lastLocalIp_.c_str(),
        requestHost, static_cast<unsigned>(target.port),
        requestUri, static_cast<unsigned>(lastRequestPayloadSize_),
        static_cast<unsigned>(lastRequestRecordCount_), statusCode,
        lastHttpErrorString_.c_str());
    if (statusCode > 0) {
      Serial.printf("[HTTP] response=%s\n", payload.c_str());
    }

    https->end();
    client->stop();

    if ((statusCode == 401 || statusCode == 403) && !isSessionRequest &&
        sessionRefreshAvailable) {
      sessionRefreshAvailable = false;
      clearSession();
      if (!ensureSession(error)) {
        return false;
      }
      attempt = 0;
      continue;
    }

    if (statusCode >= 200 && statusCode < 300) {
      if (payload.isEmpty()) {
        response.to<JsonObject>();
        return true;
      }

      const DeserializationError jsonError = deserializeJson(response, payload);
      if (jsonError) {
        error = "JSON parse failed";
        return false;
      }
      return true;
    }

    if (shouldRetryRequest(statusCode, attempt, maxAttempts)) {
      delay(250UL * attempt);
      continue;
    }

    if (!parseApiErrorPayload(payload, error)) {
      if (statusCode <= 0) {
        error = "HTTPS " + String(statusCode) + " " + lastHttpErrorString_;
      } else {
        error = payload.isEmpty() ? ("HTTP " + String(statusCode))
                                  : ("HTTP " + String(statusCode) + " " + payload);
      }
    }
    return false;
  }

  if (error.isEmpty()) {
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

size_t BackendClient::lastRequestPayloadSize() const {
  return lastRequestPayloadSize_;
}

size_t BackendClient::lastRequestRecordCount() const {
  return lastRequestRecordCount_;
}
