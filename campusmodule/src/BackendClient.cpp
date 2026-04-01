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
}  // namespace

bool BackendClient::fetchLatestEvent(EventInfo &event, String &error) {
  DynamicJsonDocument response(4096);
  if (!requestJson("GET", "/campusDeviceLatestEvent", nullptr, response, error)) {
    return false;
  }

  JsonObject object = response["event"];
  if (object.isNull()) {
    error = "No event found";
    return false;
  }

  event.eventId = String(object["eventId"] | object["id"] | "");
  event.title = String(object["title"] | "");
  event.date = String(object["date"] | "");
  event.scheduledTime = String(object["scheduledTime"] | "");
  event.location = String(object["location"] | "");
  event.status = String(object["status"] | "");
  return event.isValid();
}

bool BackendClient::confirmPairing(const EventInfo &event, String &error) {
  DynamicJsonDocument payload(512);
  payload["eventId"] = event.eventId;
  payload["title"] = event.title;
  payload["date"] = event.date;
  payload["scheduledTime"] = event.scheduledTime;
  payload["location"] = event.location;

  String body;
  serializeJson(payload, body);

  DynamicJsonDocument response(1024);
  return requestJson("POST", "/campusDeviceConfirmPairing", &body, response, error);
}

bool BackendClient::fetchPendingEnrollments(std::vector<StudentInfo> &students,
                                            String &error) {
  const String path = String("/campusDevicePendingEnrollments?limit=") +
                      String(CampusConfig::kPendingEnrollmentLimit);
  DynamicJsonDocument response(8192);
  if (!requestJson("GET", path, nullptr, response, error)) {
    return false;
  }

  students.clear();
  JsonArray array = response["students"].as<JsonArray>();
  if (array.isNull()) {
    return true;
  }

  for (JsonObject item : array) {
    StudentInfo student;
    student.studentUid = String(item["studentUid"] | item["uid"] | "");
    student.schoolId = String(item["schoolId"] | "");
    student.studentName = String(item["studentName"] | item["name"] | "");
    student.course = String(item["course"] | "");
    student.year = String(item["year"] | "");
    if (student.isValid()) {
      students.push_back(student);
    }
  }
  return true;
}

bool BackendClient::submitEnrollment(const StudentInfo &student, String &error) {
  DynamicJsonDocument payload(512);
  payload["studentUid"] = student.studentUid;
  payload["schoolId"] = student.schoolId;
  payload["studentName"] = student.studentName;
  payload["course"] = student.course;
  payload["year"] = student.year;
  payload["templateId"] = student.templateId;

  String body;
  serializeJson(payload, body);

  DynamicJsonDocument response(1024);
  return requestJson("POST", "/campusDeviceSubmitEnrollment", &body, response, error);
}

bool BackendClient::syncAttendance(const std::vector<AttendanceRecord> &records,
                                   std::vector<SyncItemResult> &results,
                                   String &error) {
  DynamicJsonDocument payload(16384);
  JsonArray array = payload.createNestedArray("records");
  for (const auto &record : records) {
    JsonObject object = array.createNestedObject();
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
  }

  String body;
  serializeJson(payload, body);

  DynamicJsonDocument response(16384);
  if (!requestJson("POST", "/campusDeviceSyncAttendance", &body, response, error)) {
    return false;
  }

  results.clear();
  JsonArray resultArray = response["results"].as<JsonArray>();
  if (resultArray.isNull()) {
    return true;
  }

  for (JsonObject item : resultArray) {
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

bool BackendClient::requestJson(const char *method, const String &path,
                                const String *body, DynamicJsonDocument &response,
                                String &error) {
  if (WiFi.status() != WL_CONNECTED) {
    error = "Wi-Fi not connected";
    return false;
  }

  if (String(CampusConfig::kApiBaseUrl).indexOf("your-project") >= 0) {
    error = "Set API base URL";
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
  http.addHeader("X-Device-Id", CampusConfig::kDeviceId);
  http.addHeader("X-Device-Secret", CampusConfig::kDeviceSecret);

  int statusCode = -1;
  if (String(method) == "GET") {
    statusCode = http.GET();
  } else if (String(method) == "POST") {
    const String payloadToSend = body != nullptr ? *body : String("");
    statusCode = http.POST(payloadToSend);
  } else {
    error = "HTTP method unsupported";
    http.end();
    return false;
  }

  const String payload = http.getString();
  http.end();

  if (statusCode < 200 || statusCode >= 300) {
    error = "HTTP " + String(statusCode) + " " + payload;
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
