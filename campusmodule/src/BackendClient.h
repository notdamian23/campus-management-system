#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

#include "AppTypes.h"

class BackendClient {
 public:
  bool fetchAvailableEvents(std::vector<EventInfo> &events, String &error);
  bool fetchLatestEvent(EventInfo &event, String &error);
  bool fetchEnrollmentSessions(std::vector<EnrollmentSessionInfo> &sessions,
                               String &error);
  bool pairEnrollmentSession(const String &sessionId,
                             EnrollmentSessionInfo &session, String &error);
  bool downloadEnrollmentSession(const String &sessionId,
                                 EnrollmentSessionInfo &session,
                                 std::vector<StudentInfo> &students,
                                 String &error);
  bool pairEvent(const String &eventId, EventInfo &event,
                 std::vector<StudentInfo> &students,
                 std::vector<String> &recordedStudentIds, String &error);
  bool confirmPairing(const EventInfo &event, String &error);
  bool fetchPairedEventContext(EventInfo &event, std::vector<StudentInfo> &students,
                               std::vector<String> &recordedStudentIds,
                               String &error);
  bool fetchPendingEnrollments(std::vector<StudentInfo> &students, String &error);
  bool submitEnrollment(const StudentInfo &student, String &error);
  bool syncAttendance(const std::vector<AttendanceRecord> &records,
                      std::vector<SyncItemResult> &results, String &error);
  bool fetchCleanupQueue(std::vector<CleanupQueueItem> &items, String &error);
  bool acknowledgeCleanupQueue(const std::vector<CleanupQueueResult> &results,
                               String &error);
  void clearSession();
  int lastHttpStatusCode() const;
  const String &lastHttpErrorString() const;
  const String &lastResponseBody() const;
  const String &lastRequestUrl() const;
  const String &lastWifiStatus() const;
  const String &lastLocalIp() const;
  size_t lastRequestPayloadSize() const;
  size_t lastRequestRecordCount() const;

 private:
  bool ensureSession(String &error);
  bool requestSession(String &error);
  bool parseEnrollmentSession(JsonObjectConst object,
                              EnrollmentSessionInfo &session, String &error);
  bool parseEventContextResponse(DynamicJsonDocument &response, EventInfo &event,
                                 std::vector<StudentInfo> &students,
                                 std::vector<String> &recordedStudentIds,
                                 String &error);
  bool requestJson(const char *method, const String &path, const String &body,
                   DynamicJsonDocument &response, String &error,
                   bool allowRetry = true, uint8_t maxAttempts = 1,
                   size_t recordCount = 0);

  String sessionToken_;
  int lastHttpStatusCode_ = 0;
  String lastHttpErrorString_;
  String lastResponseBody_;
  String lastRequestUrl_;
  String lastWifiStatus_;
  String lastLocalIp_;
  size_t lastRequestPayloadSize_ = 0;
  size_t lastRequestRecordCount_ = 0;
};
