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
  void clearSession();

 private:
  bool ensureSession(String &error);
  bool requestSession(String &error);
  bool parseEnrollmentSession(JsonObjectConst object,
                              EnrollmentSessionInfo &session, String &error);
  bool parseEventContextResponse(DynamicJsonDocument &response, EventInfo &event,
                                 std::vector<StudentInfo> &students,
                                 std::vector<String> &recordedStudentIds,
                                 String &error);
  bool requestJson(const char *method, const String &path, const String *body,
                   DynamicJsonDocument &response, String &error,
                   bool allowRetry = true);

  String sessionToken_;
};
