#include "BackendClient.h"

#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "Config.h"

namespace {
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

void applyDeviceSecretHeaders(HTTPClient &http) {
  http.addHeader("X-Device-Id", CampusConfig::kDeviceId);
  http.addHeader("X-Device-Secret", CampusConfig::kDeviceSecret);
}

void eventFromJson(JsonObjectConst object, EventInfo &event) {
  event.eventId = String(object["eventId"] | object["id"] | "");
  event.title = String(object["title"] | "");
  event.date = String(object["date"] | "");
  event.scheduledTime = String(object["scheduledTime"] | "");
  event.location = String(object["location"] | "");
  event.status = String(object["status"] | "");
  event.requiresRegistration = object["requiresRegistration"] | false;
}

StudentInfo studentFromJson(JsonObjectConst object) {
  StudentInfo student;
  student.studentUid =
      String(object["studentId"] | object["studentUid"] | object["uid"] | "");
  student.schoolId = String(object["schoolId"] | "");
  student.studentName = String(object["studentName"] | object["name"] | "");
  student.course = String(object["course"] | "");
  student.yearLevel = String(object["yearLevel"] | object["year"] | "");
  student.queueId = String(object["queueId"] | "");
  student.fingerprintStatus = String(object["fingerprintStatus"] | "");
  student.fingerprintDeviceId = String(object["fingerprintDeviceId"] | "");
  student.templateId =
      object["fingerprintTemplateId"] | object["templateId"] | -1;
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
}  // namespace

bool BackendClient::fetchAvailableEvents(std::vector<EventInfo> &events,
                                         String &error) {
  DynamicJsonDocument response(16384);
  if (!requestJson("GET",
                   String("/campusDeviceListEvents?limit=") +
                       String(CampusConfig::kEventListLimit),
                   nullptr, response, error)) {
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

bool BackendClient::pairEvent(const String &eventId, EventInfo &event,
                              std::vector<StudentInfo> &students,
                              std::vector<String> &recordedStudentIds,
                              String &error) {
  DynamicJsonDocument payload(256);
  payload["eventId"] = eventId;

  String body;
  serializeJson(payload, body);

  DynamicJsonDocument response(32768);
  if (!requestJson("POST", "/campusDevicePairEvent", &body, response, error)) {
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
  if (!requestJson("GET", "/campusDevicePairedEventContext", nullptr, response,
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
                   nullptr, response, error)) {
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
  DynamicJsonDocument payload(768);
  payload["studentId"] = student.studentUid;
  payload["schoolId"] = student.schoolId;
  payload["studentName"] = student.studentName;
  payload["course"] = student.course;
  payload["yearLevel"] = student.yearLevel;
  payload["queueId"] = student.queueId;
  payload["fingerprintTemplateId"] = student.templateId;

  String body;
  serializeJson(payload, body);

  DynamicJsonDocument response(1024);
  return requestJson("POST", "/campusDeviceSubmitEnrollment", &body, response,
                     error);
}

bool BackendClient::syncAttendance(const std::vector<AttendanceRecord> &records,
                                   std::vector<SyncItemResult> &results,
                                   String &error) {
  DynamicJsonDocument payload(24576);
  JsonArray array = payload.createNestedArray("records");
  for (const auto &record : records) {
    JsonObject object = array.createNestedObject();
    object["recordId"] = record.recordId;
    object["eventId"] = record.eventId;
    object["eventTitle"] = record.eventTitle;
    object["studentId"] = record.studentUid;
    object["studentUid"] = record.studentUid;
    object["schoolId"] = record.schoolId;
    object["studentName"] = record.studentName;
    object["course"] = record.course;
    object["yearLevel"] = record.yearLevel;
    object["fingerprintTemplateId"] = record.templateId;
    object["deviceId"] = record.deviceId;
    object["timestampEpoch"] = record.capturedAtEpoch;
    object["timestampIso"] = record.capturedAtIso;
    object["timeSource"] = record.timeSource;
    object["source"] = record.source;
  }

  String body;
  serializeJson(payload, body);

  DynamicJsonDocument response(16384);
  if (!requestJson("POST", "/campusDeviceSyncAttendance", &body, response,
                   error)) {
    return false;
  }

  results.clear();
  JsonArray resultArray = response["results"].as<JsonArray>();
  if (resultArray.isNull()) {
    return true;
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

bool BackendClient::requestSession(String &error) {
  DynamicJsonDocument response(2048);
  String body = "{}";
  if (!requestJson("POST", "/campusDeviceCreateSession", &body, response, error,
                   false)) {
    return false;
  }

  sessionToken_ = String(response["sessionToken"] | "");
  if (sessionToken_.isEmpty()) {
    error = "Session token missing";
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
                                const String *body,
                                DynamicJsonDocument &response, String &error,
                                bool allowRetry) {
  if (WiFi.status() != WL_CONNECTED) {
    error = "Wi-Fi not connected";
    return false;
  }

  if (String(CampusConfig::kApiBaseUrl).indexOf("your-project") >= 0) {
    error = "Set API base URL";
    return false;
  }

  const bool isSessionRequest = path == "/campusDeviceCreateSession";
  if (!isSessionRequest && !ensureSession(error)) {
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  const String url = buildUrl(path);
  if (!http.begin(client, url)) {
    error = "HTTP begin failed";
    return false;
  }

  http.setTimeout(CampusConfig::kHttpTimeoutMs);
  http.addHeader("Content-Type", "application/json");

  if (isSessionRequest) {
    applyDeviceSecretHeaders(http);
  } else if (!sessionToken_.isEmpty()) {
    http.addHeader("Authorization", "Bearer " + sessionToken_);
  } else {
    applyDeviceSecretHeaders(http);
  }

  int statusCode = -1;
  if (String(method) == "GET") {
    statusCode = http.GET();
  } else if (String(method) == "POST") {
    statusCode = http.POST(body != nullptr ? *body : String("{}"));
  } else {
    error = "HTTP method unsupported";
    http.end();
    return false;
  }

  const String payload = http.getString();
  http.end();

  if ((statusCode == 401 || statusCode == 403) && !isSessionRequest &&
      allowRetry) {
    clearSession();
    if (!ensureSession(error)) {
      return false;
    }
    return requestJson(method, path, body, response, error, false);
  }

  if (statusCode < 200 || statusCode >= 300) {
    if (!parseApiErrorPayload(payload, error)) {
      error = payload.isEmpty() ? ("HTTP " + String(statusCode))
                                : ("HTTP " + String(statusCode) + " " + payload);
    }
    return false;
  }

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
