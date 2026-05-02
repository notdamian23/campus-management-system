#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <vector>

#include "AppTypes.h"

class StorageManager;

class BackendClient {
 public:
  static constexpr size_t kSessionResponseJsonCapacity = 1536;

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
  bool downloadPairedEventContextToStorage(EventInfo &event, StorageManager &storage,
                                           String &error);
  bool downloadPairedEventAttendanceStateToStorage(
      EventInfo &event, StorageManager &storage, AttendanceRestoreStats &stats,
      String &error);
  bool fetchPendingEnrollments(std::vector<StudentInfo> &students, String &error);
  bool submitEnrollment(const StudentInfo &student, String &error);
  bool downloadFingerprintRoster(StorageManager &storage,
                                 FingerprintRosterStats &stats, String &error,
                                 const String &validatedSessionId = "");
  bool resolveAttendanceOwner(int templateId, const String &eventId,
                              AttendanceOwnerResolution &result, String &error);
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
  const String &lastFailureStage() const;
  size_t lastRequestPayloadSize() const;
  size_t lastRequestRecordCount() const;
  size_t lastResponsePayloadSize() const;
  bool lastTlsMemoryPressure() const;

 private:
  bool ensureSession(String &error);
  bool ensureSessionForRequest(const char *path, String &error);
  bool requestSession(String &error);
  bool parseEnrollmentSession(JsonObjectConst object,
                              EnrollmentSessionInfo &session, String &error);
  bool parseEventContextResponse(JsonDocument &response, EventInfo &event,
                                 std::vector<StudentInfo> &students,
                                 std::vector<String> &recordedStudentIds,
                                 String &error);
  bool requestJson(const char *method, const String &path, const String &body,
                   JsonDocument &response, String &error,
                   bool allowRetry = true, uint8_t maxAttempts = 1,
                   size_t recordCount = 0, size_t maxResponseBytes = 0,
                   const char *responseTooLargeError = nullptr);

  String sessionToken_;
  int lastHttpStatusCode_ = 0;
  String lastHttpErrorString_;
  String lastResponseBody_;
  String lastRequestUrl_;
  String lastWifiStatus_;
  String lastLocalIp_;
  String lastFailureStage_;
  size_t lastRequestPayloadSize_ = 0;
  size_t lastRequestRecordCount_ = 0;
  size_t lastResponsePayloadSize_ = 0;
  bool lastTlsMemoryPressure_ = false;
  WiFiClientSecure secureClient_;
};
